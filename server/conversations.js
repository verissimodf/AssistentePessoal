// Fase H — histórico persistente de conversas (painel do J.A.R.V.I.S.).
// Fonte da verdade: banco do servidor. Uma conversa pertence a exatamente um administrador
// (`conversations.admin_id`) e nunca é reivindicada, transferida ou vista por outro: toda
// consulta é filtrada pelo dono e "não existe" e "não é sua" respondem igual (404 uniforme).
//
// Regras centrais:
//  - mensagens: papel user|assistant; a resposta referencia a mensagem do usuário (`reply_to`);
//  - idempotência: `client_msg_id` único por conversa evita duplicação em reenvio/retry/recarga;
//  - falha do provedor preserva a mensagem do usuário e NÃO cria resposta falsa (erro 502);
//  - o contexto enviado ao modelo é reconstruído do banco (últimas N mensagens da PRÓPRIA
//    conversa, com tetos de quantidade e de caracteres) — nunca a partir do cliente;
//  - exclusão remove conversa + mensagens em uma transação e é auditada sem conteúdo;
//  - memória (tabela `memories`) e histórico (estas tabelas) continuam sendo recursos separados:
//    excluir uma conversa nunca toca memórias, documentos ou outras conversas.
import { db, now, uid, audit } from "./db.js";
import { tx, owns } from "./ownership.js";

export class ConvError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export const MAX_MESSAGE_CHARS = 16_000;   // teto por mensagem do usuário
export const MAX_TITLE_CHARS = 80;         // título derivado da primeira mensagem
export const LIST_LIMIT_DEFAULT = 50;      // conversas por página
export const LIST_LIMIT_MAX = 200;
export const MSG_LIMIT_DEFAULT = 200;      // mensagens devolvidas por conversa
export const MSG_LIMIT_MAX = 500;
export const CONTEXT_MAX_MESSAGES = 40;    // turnos considerados na reconstrução do contexto
export const CONTEXT_MAX_CHARS = 48_000;   // teto total de caracteres enviados ao modelo
const CONTEXT_MSG_CHARS = 8_000;           // teto por mensagem na reconstrução
const META_REASONING_CHARS = 16_000;
const META_TOOL_INPUT_CHARS = 2_000;
const META_TOOL_OUTPUT_CHARS = 4_000;
const META_PENDING_MAX = 20;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const convView = (r) => ({ id: r.id, title: r.title, agent_id: r.agent_id ?? null, created_at: r.created_at, updated_at: r.updated_at });
const parseMeta = (raw) => { if (!raw) return null; try { const m = JSON.parse(raw); return m && typeof m === "object" && !Array.isArray(m) ? m : null; } catch { return null; } };
const cap = (s, n) => String(s ?? "").slice(0, n);

/** Texto da mensagem: string, não vazio após trim, dentro do limite. */
export function validateMessage(message) {
  if (typeof message !== "string") throw new ConvError(400, "invalid_message");
  const text = message.trim();
  if (!text) throw new ConvError(400, "empty_message");
  if (text.length > MAX_MESSAGE_CHARS) throw new ConvError(400, "message_too_long");
  return text;
}

/** Título curto derivado da primeira mensagem (nunca aceito como conteúdo livre do cliente). */
const titleFrom = (text) => (text.replace(/\s+/g, " ").slice(0, MAX_TITLE_CHARS).trim() || "Nova conversa");

export function createConversation(ownerId, title, agentId = null) {
  if (!ownerId) throw new ConvError(403, "admin_session_required");
  if (agentId !== undefined && agentId !== null && !owns(ownerId, "agent", agentId)) throw new ConvError(400, "invalid_agent");
  const t = typeof title === "string" && title.trim()
    ? title.replace(/\s+/g, " ").slice(0, MAX_TITLE_CHARS).trim()
    : "Nova conversa";
  const id = uid();
  const at = now();
  db.prepare("INSERT INTO conversations (id, admin_id, title, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, ownerId, t, agentId || null, at, at);
  return { id, title: t, agent_id: agentId || null, created_at: at, updated_at: at };
}

export const conversationCount = (ownerId) =>
  ownerId ? db.prepare("SELECT COUNT(*) n FROM conversations WHERE admin_id = ?").get(ownerId).n : 0;

/** Conversas do dono, mais recentes primeiro (paginação com teto). */
export function listConversations(ownerId, { limit, offset } = {}) {
  if (!ownerId) return [];
  const lim = Math.min(Math.max(Number(limit) || LIST_LIMIT_DEFAULT, 1), LIST_LIMIT_MAX);
  const off = Math.max(Number(offset) || 0, 0);
  return db.prepare(
    `SELECT id, title, created_at, updated_at FROM conversations
     WHERE admin_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(ownerId, lim, off).map(convView);
}

const gotConv = (ownerId, id) =>
  ownerId ? db.prepare("SELECT * FROM conversations WHERE id = ? AND admin_id = ?").get(String(id), ownerId) : null;

/** Estado atual das aprovações pendentes (para a interface não oferecer um botão morto). */
function withPendingStatus(pending = []) {
  if (!pending.length) return [];
  const ids = [...new Set(pending.map((p) => p.id))].slice(0, 200);
  const q = db.prepare(`SELECT id, status FROM approvals WHERE id IN (${ids.map(() => "?").join(",")})`);
  const map = new Map(q.all(...ids).map((r) => [r.id, r.status]));
  return pending.map((p) => ({ ...p, status: map.get(p.id) || "missing" }));
}

/** Uma conversa com as últimas N mensagens (ordem cronológica) — ou null se não for do dono. */
export function getConversation(ownerId, id, { limit } = {}) {
  const conv = gotConv(ownerId, id);
  if (!conv) return null;
  const lim = Math.min(Math.max(Number(limit) || MSG_LIMIT_DEFAULT, 1), MSG_LIMIT_MAX);
  const rows = db.prepare(
    `SELECT id, role, content, meta, created_at FROM conversation_messages
     WHERE conversation_id = ? ORDER BY rowid DESC LIMIT ?`).all(conv.id, lim).reverse();
  const messages = rows.map((r) => {
    const meta = parseMeta(r.meta);
    return { id: r.id, role: r.role, content: r.content, created_at: r.created_at, meta: meta ? { ...meta, pending: withPendingStatus(meta.pending || []) } : null };
  });
  return { conversation: convView(conv), messages };
}

/** Contexto para o modelo: últimas mensagens DESTA conversa, com tetos de quantidade/caracteres. */
export function buildContext(conversationId) {
  const rows = db.prepare(
    `SELECT role, content FROM conversation_messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT ?`)
    .all(conversationId, CONTEXT_MAX_MESSAGES).reverse();
  const out = [];
  let total = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const content = cap(rows[i].content, CONTEXT_MSG_CHARS);
    if (out.length && total + content.length > CONTEXT_MAX_CHARS) break;
    out.unshift({ role: rows[i].role, content });
    total += content.length;
  }
  return out;
}

/** Metadados mínimos para reproduzir a interface (tetos rígidos; nunca credenciais). */
function buildMeta(out) {
  const meta = {};
  if (out?.reasoning) meta.reasoning = cap(out.reasoning, META_REASONING_CHARS);
  if (Array.isArray(out?.tools) && out.tools.length) {
    meta.tools = out.tools.slice(0, 50).map((t) => {
      const inputStr = JSON.stringify(t.input ?? {});
      return {
        name: cap(t.name, 80),
        input: inputStr.length > META_TOOL_INPUT_CHARS ? cap(inputStr, META_TOOL_INPUT_CHARS) : (t.input ?? {}),
        output: cap(t.output, META_TOOL_OUTPUT_CHARS),
      };
    });
  }
  if (Array.isArray(out?.pending) && out.pending.length) {
    meta.pending = out.pending.slice(0, META_PENDING_MAX).map((p) => ({ id: cap(p.id, 64), command: cap(p.command, 300) }));
  }
  return Object.keys(meta).length ? JSON.stringify(meta) : null;
}

const userView = (u) => ({ id: u.id, content: u.content, created_at: u.created_at });
const cached = (conv, user, done) => {
  const meta = parseMeta(done.meta) || {};
  return {
    conversation: convView(conv),
    userMessage: userView(user),
    reply: done.content,
    reasoning: meta.reasoning || "",
    tools: meta.tools || [],
    pending: withPendingStatus(meta.pending || []),
    assistantMessageId: done.id,
    duplicate: true,
  };
};

/**
 * Envia uma mensagem e persiste a troca: mensagem do usuário primeiro (sobrevive a falhas),
 * resposta do assistente somente após sucesso do modelo. `run` é o executor do modelo:
 * ({ messages, agentId }) => { reply, reasoning, tools, pending }.
 *
 *  - sem conversationId → cria uma conversa nova (título = começo da mensagem);
 *  - conversationId de outro dono/inexistente → 404 uniforme;
 *  - clientMsgId repetido → não duplica; devolve a troca já persistida (ou reexecuta se a
 *    resposta ainda não existe, ex.: falha anterior);
 *  - falha do modelo → a mensagem do usuário permanece; nada de resposta falsa (502 provider_error).
 */
export async function chatExchange(ownerId, { conversationId, message, clientMsgId, agentId }, run) {
  if (!ownerId) throw new ConvError(403, "admin_session_required");
  const text = validateMessage(message);
  if (clientMsgId !== undefined && clientMsgId !== null && (typeof clientMsgId !== "string" || !UUID_V4.test(clientMsgId))) {
    throw new ConvError(400, "invalid_client_msg_id");
  }
  const cmid = clientMsgId || null;

  let conv = conversationId ? gotConv(ownerId, conversationId) : null;
  if (conversationId && !conv) throw new ConvError(404, "not_found");

  // Idempotência primeiro: a mesma mensagem (mesmo clientMsgId) nunca entra duas vezes —
  // na conversa informada ou em qualquer conversa do PRÓPRIO dono (retry sem conversationId,
  // ex. resposta perdida antes do cliente conhecer a conversa nova, não cria duplicata).
  let user = null;
  if (cmid) {
    const found = conv
      ? db.prepare("SELECT id, content, created_at FROM conversation_messages WHERE conversation_id = ? AND client_msg_id = ?").get(conv.id, cmid)
      : db.prepare(`SELECT m.id, m.content, m.created_at, m.conversation_id FROM conversation_messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE m.client_msg_id = ? AND c.admin_id = ? LIMIT 1`).get(cmid, ownerId);
    if (found) {
      if (!conv) conv = gotConv(ownerId, found.conversation_id);
      if (conv) user = { id: found.id, content: found.content, created_at: found.created_at };
    }
  }
  if (user) {
    const done = db.prepare("SELECT id, content, meta, created_at FROM conversation_messages WHERE reply_to = ?").get(user.id);
    if (done) return cached(conv, user, done); // reenvio após sucesso → mesma resposta, sem nova chamada
  }

  if (!conv) conv = createConversation(ownerId, titleFrom(text), agentId);

  if (!user) {
    const id = uid();
    const at = now();
    try {
      tx(() => {
        db.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, meta, client_msg_id, reply_to, created_at) VALUES (?, ?, 'user', ?, NULL, ?, NULL, ?)")
          .run(id, conv.id, text, cmid, at);
        db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(at, conv.id);
      });
      user = { id, content: text, created_at: at };
    } catch (e) {
      // Corrida de reenvio: outra requisição inseriu a mesma mensagem primeiro.
      if (cmid && /UNIQUE constraint failed/.test(String(e.message))) {
        user = db.prepare("SELECT id, content, created_at FROM conversation_messages WHERE conversation_id = ? AND client_msg_id = ?").get(conv.id, cmid);
        if (!user) throw e;
        const done = db.prepare("SELECT id, content, meta, created_at FROM conversation_messages WHERE reply_to = ?").get(user.id);
        if (done) return cached(conv, user, done);
      } else if (/FOREIGN KEY constraint failed/.test(String(e.message))) {
        throw new ConvError(404, "not_found"); // conversa excluída concorrentemente
      } else throw e;
    }
  }

  const rawMessages = buildContext(conv.id);
  const { messages } = compactConversationContext(rawMessages);
  // Agente fixado na conversa (só se ainda pertencer ao dono); caso contrário, o padrão do
  // administrador. Uma conversa existente nunca muda de agente por causa de um pedido avulso.
  const pinned = conv.agent_id && owns(ownerId, "agent", conv.agent_id) ? conv.agent_id : null;
  let out;
  try {
    out = await run({ messages, agentId: pinned });
  } catch (e) {
    // A mensagem do usuário fica preservada; nenhuma resposta falsa é gravada.
    console.error(`[chat] provedor falhou (mensagem preservada): ${cap(e?.message || e, 300)}`);
    // P2-B: erro de CONFIGURAÇÃO (ex.: modelo ausente) é acionável — nunca vira 502 genérico.
    if (e && typeof e.status === "number" && typeof e.code === "string") {
      throw new ConvError(e.status, e.code);
    }
    throw new ConvError(502, "provider_error");
  }

  const meta = buildMeta(out);
  const aid = uid();
  const at = now();
  const reply = typeof out?.reply === "string" ? out.reply : "";
  try {
    tx(() => {
      db.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, meta, client_msg_id, reply_to, created_at) VALUES (?, ?, 'assistant', ?, ?, NULL, ?, ?)")
        .run(aid, conv.id, reply, meta, user.id, at);
      db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(at, conv.id);
    });
  } catch (e) {
    if (/UNIQUE constraint failed/.test(String(e.message))) {
      const done = db.prepare("SELECT id, content, meta, created_at FROM conversation_messages WHERE reply_to = ?").get(user.id);
      if (done) return cached(conv, user, done); // outra requisição gravou a resposta primeiro
    }
    if (/FOREIGN KEY constraint failed/.test(String(e.message))) throw new ConvError(404, "not_found");
    throw e;
  }

  const fresh = db.prepare("SELECT * FROM conversations WHERE id = ?").get(conv.id) || conv;
  const parsed = parseMeta(meta) || {};
  return {
    conversation: convView(fresh),
    userMessage: userView(user),
    reply,
    reasoning: out.reasoning || "",
    tools: out.tools || [],
    pending: withPendingStatus(parsed.pending || []),
    assistantMessageId: aid,
  };
}

/**
 * Exclui a conversa e TODAS as mensagens na mesma transação. O evento de auditoria registra
 * apenas dono, id e quantidade — nunca o conteúdo das mensagens.
 */
export function deleteConversation(ownerId, id) {
  if (!ownerId) throw new ConvError(403, "admin_session_required");
  return tx(() => {
    const conv = db.prepare("SELECT id FROM conversations WHERE id = ? AND admin_id = ?").get(String(id), ownerId);
    if (!conv) throw new ConvError(404, "not_found");
    const count = db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id = ?").get(conv.id).n;
    db.prepare("DELETE FROM conversation_messages WHERE conversation_id = ?").run(conv.id);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(conv.id);
    audit("conversation.deleted", { admin: ownerId, ids: [String(id)], count });
    return { ok: true, deletedMessages: count };
  });
}

/**
 * Smart Context Compaction (Roadmap v1.6.0).
 * Otimização inteligente da janela de contexto para diálogos extensos sem perda de
 * fatos críticos, sintetizando turnos antigos no meio e preservando as últimas mensagens intactas.
 */
export function compactConversationContext(
  messages,
  { maxMessages = 16, maxChars = 24000, preserveTail = 6 } = {}
) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      messages: [],
      compacted: false,
      savedChars: 0,
      originalCount: 0,
      compactedCount: 0,
    };
  }

  const originalCount = messages.length;
  const originalChars = messages.reduce((acc, m) => acc + (m.content ? String(m.content).length : 0), 0);

  // Se estiver dentro dos tetos estabelecidos, preserva integralmente
  if (originalCount <= maxMessages && originalChars <= maxChars) {
    return {
      messages,
      compacted: false,
      savedChars: 0,
      originalCount,
      compactedCount: originalCount,
    };
  }

  // 1. Isola mensagens de system no início (instruções primárias do assistente)
  const systemMessages = [];
  let startIdx = 0;
  while (startIdx < messages.length && messages[startIdx].role === "system") {
    systemMessages.push(messages[startIdx]);
    startIdx++;
  }

  const conversationTurns = messages.slice(startIdx);
  const tailCount = Math.min(preserveTail, conversationTurns.length);
  const headAndMiddle = conversationTurns.slice(0, conversationTurns.length - tailCount);
  const tail = conversationTurns.slice(conversationTurns.length - tailCount);

  // Se não há mensagens anteriores no meio para compactar
  if (headAndMiddle.length === 0) {
    return {
      messages,
      compacted: false,
      savedChars: 0,
      originalCount,
      compactedCount: originalCount,
    };
  }

  // 2. Sintetiza turnos do meio em bloco estruturado de resumo contextual
  const summaryLines = headAndMiddle.map((m) => {
    const roleLabel = m.role === "user" ? "Usuário" : "Assistente";
    const clean = String(m.content || "").replace(/\s+/g, " ").trim();
    const snippet = clean.length > 140 ? clean.slice(0, 137) + "..." : clean;
    return `- ${roleLabel}: ${snippet}`;
  });

  let summaryBlock = `[Resumo de Contexto Anterior Compactado: ${headAndMiddle.length} mensagens]\n${summaryLines.join("\n")}`;

  let compactedMessages = [
    ...systemMessages,
    { role: "system", content: summaryBlock },
    ...tail,
  ];

  let compactedChars = compactedMessages.reduce(
    (acc, m) => acc + (m.content ? String(m.content).length : 0),
    0
  );

  // Se mesmo compactado ainda ultrapassar maxChars, ajusta o bloco de resumo
  if (compactedChars > maxChars) {
    const sysTailChars =
      systemMessages.reduce((acc, m) => acc + String(m.content || "").length, 0) +
      tail.reduce((acc, m) => acc + String(m.content || "").length, 0);
    const summaryBudget = Math.max(100, maxChars - sysTailChars);
    if (summaryBlock.length > summaryBudget) {
      summaryBlock = summaryBlock.slice(0, summaryBudget - 3) + "...";
      compactedMessages = [
        ...systemMessages,
        { role: "system", content: summaryBlock },
        ...tail,
      ];
    }
  }

  const finalChars = compactedMessages.reduce(
    (acc, m) => acc + (m.content ? String(m.content).length : 0),
    0
  );
  const savedChars = Math.max(0, originalChars - finalChars);

  return {
    messages: compactedMessages,
    compacted: true,
    originalCount,
    compactedCount: compactedMessages.length,
    savedChars,
  };
}
