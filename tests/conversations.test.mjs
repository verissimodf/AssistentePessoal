// Fase H — histórico persistente de conversas: criação, persistência das duas pontas, ordem e
// reconstrução do contexto A PARTIR DO BANCO, isolamento entre administradores, idempotência de
// reenvio, falha do provedor sem perder a mensagem do usuário, exclusão em transação com auditoria
// sem conteúdo, limites de payload e continuidade do caminho legado (MCP/scripts).
// Banco TEMPORÁRIO (JARVIS_DATA_DIR): nunca toca o banco ativo. O "modelo" é um stub local
// (globalThis.fetch) — nada externo é chamado. Nenhum segredo real é usado aqui.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "jarvis-conv-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db } = await import("../server/db.js");
const { updateSettings } = await import("../server/settings.js");
const { createApp } = await import("../server/index.js");
const { compactConversationContext } = await import("../server/conversations.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let server, base, SA, SB, adminA, adminB;
let chatCalls = 0, lastChatBody = null, chatMode = "echo", toolRounds = 0;

// Stub do provedor: intercepta somente /chat/completions; o resto segue para a rede real.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.includes("/chat/completions")) return realFetch(input, init);
  chatCalls++;
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  lastChatBody = body;
  if (chatMode === "fail") return new Response("falha simulada do provedor", { status: 500 });
  const isTool = chatMode === "tool" && toolRounds > 0;
  if (isTool) toolRounds--;
  const message = isTool
    ? {
        role: "assistant",
        content: "",
        tool_calls: [{ id: `call_${chatCalls}`, type: "function", function: { name: "remember", arguments: JSON.stringify({ content: "lembrete-de-teste-h", tags: "fase-h" }) } }],
      }
    : { role: "assistant", content: `eco-${chatCalls}` };
  return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { "content-type": "application/json" } });
};

const req = (path, { method = "GET", body, s, csrf = true } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(s ? { cookie: s.cookie, ...(csrf ? { "x-jarvis-csrf": s.csrf } : {}) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const json = async (r) => ({ status: r.status, body: await r.json() });
const login = async (username, password) => {
  const r = await req("/api/auth/login", { method: "POST", body: { username, password } });
  const j = await r.json();
  return { cookie: (r.headers.get("set-cookie") || "").split(";")[0], csrf: j.csrf, id: j.admin.id };
};
const chat = (s, body) => req("/api/chat", { method: "POST", body, s });
const exchange = async (s, message, extra = {}) => json(await chat(s, { message, clientMsgId: randomUUID(), ...extra }));
const convCount = (adminId) => db.prepare("SELECT COUNT(*) n FROM conversations WHERE admin_id = ?").get(adminId).n;
const msgCount = (convId) => db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id = ?").get(convId).n;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  SA = await login("ana", PW);
  adminA = SA.id;
  assert.equal((await req("/api/auth/admins", { method: "POST", body: { username: "bia", password: PW, currentPassword: PW }, s: SA })).status, 200);
  SB = await login("bia", PW);
  adminB = SB.id;
  // Provedor "ollama" apontando para o stub (a URL nunca é usada de verdade: o fetch é interceptado).
  updateSettings({ providers: { ollama: { enabled: false, model: "stub-model" } } }, { adminId: adminA });
  updateSettings({ providers: { ollama: { enabled: false, model: "stub-model" } } }, { adminId: adminB });
});
after(async () => { await new Promise((r) => server.close(r)); });

// ---------- autenticação, CSRF e validação ----------

test("sem sessão: chat e conversas recusados (401)", async () => {
  assert.equal((await chat(undefined, { message: "oi" })).status, 401);
  assert.equal((await req("/api/conversations")).status, 401);
  assert.equal((await req("/api/conversations/qualquer")).status, 401);
});

test("com sessão mas sem CSRF: recusado (403 csrf)", async () => {
  const r = await req("/api/chat", { method: "POST", body: { message: "oi", clientMsgId: randomUUID() }, s: SA, csrf: false });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "csrf");
});

test("validação de payload: mensagem vazia/não-string/longa, clientMsgId inválido, conversa inexistente", async () => {
  let r = await chat(SA, { message: "   ", clientMsgId: randomUUID() });
  assert.equal(r.status, 400); assert.equal((await r.json()).error, "empty_message");
  r = await chat(SA, { message: 42, clientMsgId: randomUUID() });
  assert.equal(r.status, 400); assert.equal((await r.json()).error, "invalid_message");
  r = await chat(SA, { message: "x".repeat(16_001), clientMsgId: randomUUID() });
  assert.equal(r.status, 400); assert.equal((await r.json()).error, "message_too_long");
  r = await chat(SA, { message: "ok", clientMsgId: "nao-e-uuid" });
  assert.equal(r.status, 400); assert.equal((await r.json()).error, "invalid_client_msg_id");
  r = await chat(SA, { message: "ok", conversationId: "nao-existe-mesmo" });
  assert.equal(r.status, 404); assert.equal((await r.json()).error, "not_found");
  assert.equal((await req("/api/conversations/nao-existe", { s: SA })).status, 404);
});

// ---------- persistência das duas pontas ----------

test("cria conversa, persiste a mensagem do usuário e a resposta do assistente", async () => {
  chatMode = "echo";
  const r = await exchange(SA, "olá mundo persistente");
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.conversation.id, "string");
  assert.equal(r.body.conversation.title, "olá mundo persistente");
  const conv = db.prepare("SELECT * FROM conversations WHERE id = ?").get(r.body.conversation.id);
  assert.equal(conv.admin_id, adminA);
  const rows = db.prepare("SELECT role, content, reply_to, client_msg_id FROM conversation_messages WHERE conversation_id = ? ORDER BY rowid").all(conv.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].role, "user");
  assert.equal(rows[0].content, "olá mundo persistente");
  assert.equal(rows[1].role, "assistant");
  assert.equal(rows[1].reply_to, db.prepare("SELECT id FROM conversation_messages WHERE conversation_id = ? AND role = 'user'").get(conv.id).id);
  assert.equal(r.body.reply, rows[1].content);
  assert.equal(r.body.userMessage.content, "olá mundo persistente");
});

test("chamada de ferramenta: resultado e metadados ficam no histórico; memória é criada com dono", async () => {
  chatMode = "tool"; toolRounds = 1;
  const r = await exchange(SA, "guarde na memória que o código do teste é lembrete-de-teste-h");
  assert.equal(r.status, 200);
  const convId = r.body.conversation.id;
  const assistant = db.prepare("SELECT meta FROM conversation_messages WHERE conversation_id = ? AND role = 'assistant' ORDER BY rowid DESC").get(convId);
  const meta = JSON.parse(assistant.meta);
  assert.equal(meta.tools[0].name, "remember");
  const mem = db.prepare("SELECT m.content FROM memories m JOIN ownership o ON o.resource_type='memory' AND o.resource_id=m.id WHERE o.owner_admin_id = ?").get(adminA);
  assert.equal(mem.content, "lembrete-de-teste-h");
  const got = await json(await req(`/api/conversations/${convId}`, { s: SA }));
  assert.equal(got.status, 200);
  assert.equal(got.body.messages.at(-1).meta.tools[0].name, "remember");
});

test("ordem cronológica correta e contexto reconstruído do banco (sem misturar conversas)", async () => {
  chatMode = "echo";
  const c1 = (await exchange(SA, "primeira pergunta")).body.conversation.id;
  const r2 = await exchange(SA, "segunda pergunta", { conversationId: c1 });
  assert.equal(r2.status, 200);
  const got = await json(await req(`/api/conversations/${c1}`, { s: SA }));
  assert.deepEqual(got.body.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
  const [u1, a1, u2, a2] = got.body.messages;
  assert.equal(u1.content, "primeira pergunta");
  assert.equal(u2.content, "segunda pergunta");
  assert.match(a1.content, /^eco-\d+$/);
  assert.match(a2.content, /^eco-\d+$/);

  // Terceira mensagem: o contexto enviado ao modelo deve ser exatamente o histórico DESTA conversa.
  const r3 = await exchange(SA, "terceira pergunta", { conversationId: c1 });
  assert.equal(r3.status, 200);
  const sent = lastChatBody.messages;
  assert.equal(sent[0].role, "system");
  assert.deepEqual(sent.slice(1).map((m) => [m.role, m.content]),
    [["user", "primeira pergunta"], ["assistant", a1.content],
     ["user", "segunda pergunta"], ["assistant", a2.content], ["user", "terceira pergunta"]]);

  // Outra conversa não aparece no contexto desta.
  const c2 = (await exchange(SA, "conversa separada")).body.conversation.id;
  const again = await exchange(SA, "voltei", { conversationId: c1 });
  assert.equal(again.status, 200);
  assert.equal(lastChatBody.messages.some((m) => String(m.content).includes("conversa separada")), false);
  assert.notEqual(c1, c2);
});

test("listagem: só as conversas do dono, mais recentes primeiro; mensagens persistidas em disco", async () => {
  const list = await json(await req("/api/conversations", { s: SA }));
  assert.equal(list.status, 200);
  assert.ok(list.body.length >= 3);
  assert.equal(list.body.every((c) => typeof c.title === "string" && c.id), true);
  // Segunda conexão no MESMO arquivo: prova de que os dados estão no disco, não em memória.
  const { DatabaseSync } = await import("node:sqlite");
  const fresh = new DatabaseSync(join(dir, "jarvis.db"));
  assert.ok(fresh.prepare("SELECT COUNT(*) n FROM conversations").get().n >= 3);
  assert.ok(fresh.prepare("SELECT COUNT(*) n FROM conversation_messages").get().n >= 6);
  fresh.close();
});

// ---------- isolamento entre proprietários ----------

test("isolamento: B não lista, não lê, não escreve nem exclui conversa de A (404 uniforme)", async () => {
  const created = await exchange(SA, "segredo de A");
  const convA = created.body.conversation.id;
  const before = msgCount(convA);

  const listB = await json(await req("/api/conversations", { s: SB }));
  assert.equal(listB.status, 200);
  assert.equal(listB.body.some((c) => c.id === convA), false);

  assert.equal((await req(`/api/conversations/${convA}`, { s: SB })).status, 404);
  assert.equal((await req(`/api/conversations/${convA}`, { method: "DELETE", s: SB })).status, 404);
  const intrude = await chat(SB, { message: "invadir", conversationId: convA, clientMsgId: randomUUID() });
  assert.equal(intrude.status, 404);

  assert.equal(msgCount(convA), before, "nenhuma mensagem foi acrescentada à conversa de A");
  const still = await json(await req(`/api/conversations/${convA}`, { s: SA }));
  assert.equal(still.status, 200);
  assert.equal(still.body.messages.length, before);

  // E o caminho inverso: A não vê a conversa de B.
  const convB = (await exchange(SB, "conversa de B")).body.conversation.id;
  assert.equal((await req(`/api/conversations/${convB}`, { s: SA })).status, 404);
  const listA = await json(await req("/api/conversations", { s: SA }));
  assert.equal(listA.body.some((c) => c.id === convB), false);
});

// ---------- idempotência e falha do provedor ----------

test("reenvio com o mesmo clientMsgId não duplica nem reexecuta o modelo", async () => {
  const cmid = randomUUID();
  const r1 = await json(await chat(SA, { message: "mensagem idempotente", clientMsgId: cmid }));
  assert.equal(r1.status, 200);
  const callsAfterFirst = chatCalls;
  const convsBefore = db.prepare("SELECT COUNT(*) n FROM conversations").get().n;
  const r2 = await json(await chat(SA, { message: "mensagem idempotente", clientMsgId: cmid }));
  assert.equal(r2.status, 200);
  assert.equal(r2.body.duplicate, true);
  assert.equal(r2.body.reply, r1.body.reply);
  assert.equal(r2.body.conversation.id, r1.body.conversation.id, "retry sem conversationId reencontra a MESMA conversa");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conversations").get().n, convsBefore, "nenhuma conversa nova foi criada");
  assert.equal(chatCalls, callsAfterFirst, "o modelo não foi chamado de novo");
  const conv = r1.body.conversation.id;
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id = ? AND role = 'user'").get(conv).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id = ? AND role = 'assistant'").get(conv).n, 1);
});

test("falha do provedor: mensagem do usuário preservada, sem resposta falsa; retry reexecuta sem duplicar", async () => {
  chatMode = "fail";
  const cmid = randomUUID();
  const r = await chat(SA, { message: "esta vai falhar", clientMsgId: cmid });
  assert.equal(r.status, 502);
  const j = await r.json();
  assert.equal(j.error, "provider_error");
  assert.equal(JSON.stringify(j).includes("falha simulada"), false, "detalhe do provedor não vaza na resposta");
  const user = db.prepare("SELECT id, conversation_id FROM conversation_messages WHERE client_msg_id = ?").get(cmid);
  assert.ok(user, "mensagem do usuário persistida apesar da falha");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE reply_to = ?").get(user.id).n, 0, "nenhuma resposta falsa");

  chatMode = "echo";
  const convsBefore = db.prepare("SELECT COUNT(*) n FROM conversations").get().n;
  const retry = await json(await chat(SA, { message: "esta vai falhar", clientMsgId: cmid }));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.conversation.id, user.conversation_id, "retry reexecuta NA MESMA conversa");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conversations").get().n, convsBefore, "retry não cria conversa duplicada");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id = ? AND role = 'user'").get(user.conversation_id).n, 1, "retry não duplicou a mensagem");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id = ? AND role = 'assistant'").get(user.conversation_id).n, 1);
});

// ---------- exclusão, auditoria e privacidade ----------

test("excluir: confirmação no cliente é irrelevante no servidor; remove conversa + mensagens em transação e audita sem conteúdo", async () => {
  chatMode = "echo";
  const conv = (await exchange(SA, "conversa que será excluída")).body.conversation.id;
  await exchange(SA, "segunda mensagem da conversa", { conversationId: conv });
  assert.equal(msgCount(conv), 4);
  const del = await json(await req(`/api/conversations/${conv}`, { method: "DELETE", s: SA }));
  assert.equal(del.status, 200);
  assert.deepEqual(del.body, { ok: true, deletedMessages: 4 });
  assert.equal(msgCount(conv), 0);
  assert.equal(db.prepare("SELECT 1 FROM conversations WHERE id = ?").get(conv), undefined);
  assert.equal((await req(`/api/conversations/${conv}`, { s: SA })).status, 404);
  const again = await req(`/api/conversations/${conv}`, { method: "DELETE", s: SA });
  assert.equal(again.status, 404);
  const auditRow = db.prepare("SELECT detail FROM audit WHERE kind = 'conversation.deleted' ORDER BY id DESC LIMIT 1").get();
  const detail = JSON.parse(auditRow.detail);
  assert.equal(detail.admin, adminA);
  assert.deepEqual(detail.ids, [conv]);
  assert.equal(detail.count, 4);
  assert.equal(JSON.stringify(detail).includes("conversa que será excluída"), false);
});

test("exclusão do histórico NÃO remove memórias independentes", async () => {
  const mem = await json(await req("/api/memories", { method: "POST", body: { content: "memória independente CEU-AZUL-42" }, s: SA }));
  assert.equal(mem.status, 200);
  const conv = (await exchange(SA, "conversa efêmera")).body.conversation.id;
  assert.equal((await req(`/api/conversations/${conv}`, { method: "DELETE", s: SA })).status, 200);
  const list = await json(await req("/api/memories", { s: SA }));
  assert.equal(list.body.some((m) => m.content === "memória independente CEU-AZUL-42"), true);
});

test("nenhuma credencial ou conteúdo de mensagem em logs, auditoria ou respostas de erro", async () => {
  const KEY = "chave-secreta-de-teste-xyz";
  const MARK = "MARCA-CONFIDENCIAL-77";
  updateSettings({ providers: { ollama: { apiKey: KEY } } }, { adminId: adminA });
  // A chave fica criptografada em repouso.
  const raw = db.prepare("SELECT data FROM admin_settings WHERE admin_id = ?").get(adminA).data;
  assert.equal(raw.includes(KEY), false, "API key não é gravada em texto claro");

  const logs = [];
  const origLog = console.log, origError = console.error;
  console.log = (...a) => { logs.push(a.map(String).join(" ")); };
  console.error = (...a) => { logs.push(a.map(String).join(" ")); };
  try {
    const r = await exchange(SA, `mensagem com ${MARK}`);
    assert.equal(r.status, 200);
    chatMode = "fail";
    await chat(SA, { message: `falha com ${MARK}`, clientMsgId: randomUUID() });
    chatMode = "echo";
    const conv = r.body.conversation.id;
    assert.equal((await req(`/api/conversations/${conv}`, { method: "DELETE", s: SA })).status, 200);
  } finally {
    console.log = origLog;
    console.error = origError;
  }
  const all = logs.join("\n");
  assert.equal(all.includes(KEY), false, "a API key nunca aparece em logs");
  assert.equal(all.includes(MARK), false, "o conteúdo da mensagem nunca aparece em logs");

  const auditDump = JSON.stringify(db.prepare("SELECT kind, detail FROM audit").all());
  assert.equal(auditDump.includes(KEY), false);
  assert.equal(auditDump.includes(MARK), false, "auditoria não copia o conteúdo das mensagens");
  const authz = await json(await req("/api/audit", { s: SA }));
  assert.equal(JSON.stringify(authz.body).includes(MARK), false);
});

// ---------- limites e endpoint de criação ----------

test("limites de paginação e endpoint explícito de criação (conversa vazia)", async () => {
  chatMode = "echo";
  const conv = (await exchange(SA, "primeira")).body.conversation.id;
  const second = (await exchange(SA, "segunda", { conversationId: conv })).body;
  const one = await json(await req(`/api/conversations/${conv}?limit=1`, { s: SA }));
  assert.equal(one.body.messages.length, 1);
  assert.equal(one.body.messages[0].role, "assistant", "limit=1 devolve a ÚLTIMA mensagem (a resposta)");
  assert.equal(one.body.messages[0].content, second.reply);
  const listed = await json(await req("/api/conversations?limit=1", { s: SA }));
  assert.equal(listed.body.length, 1);
  assert.equal(typeof listed.body[0].updated_at, "string");

  const created = await json(await req("/api/conversations", { method: "POST", body: { title: "Conversa vazia de teste" }, s: SA }));
  assert.equal(created.status, 200);
  assert.equal(created.body.title, "Conversa vazia de teste");
  const opened = await json(await req(`/api/conversations/${created.body.id}`, { s: SA }));
  assert.deepEqual(opened.body.messages, []);
  const t = await json(await req("/api/conversations", { method: "POST", body: { title: "x".repeat(200) }, s: SA }));
  assert.equal(t.body.title.length, 80);
});

// ---------- seleção de modelo por conversa ----------

test("agente fixado na criação da conversa; não altera o padrão nem as outras conversas", async () => {
  chatMode = "echo";
  const mkAgent = async (name, model, active = false) =>
    (await json(await req("/api/agents", { method: "POST", body: { name, provider: "ollama", model, tools: [], active }, s: SA }))).body;
  const zen = await mkAgent("Zen de teste", "agent-zen-x");
  const outro = await mkAgent("Outro agente", "agent-outro-y", true); // agente ativo = padrão do admin

  const r = await exchange(SA, "conversa com agente fixado", { agentId: zen.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.conversation.agent_id, zen.id);
  assert.equal(lastChatBody.model, "agent-zen-x", "a conversa usa o agente fixado");

  // Mensagem seguinte continua no agente fixado, mesmo se o cliente pedir outro.
  const r2 = await exchange(SA, "seguindo na mesma conversa", { conversationId: r.body.conversation.id, agentId: outro.id });
  assert.equal(r2.status, 200);
  assert.equal(lastChatBody.model, "agent-zen-x");

  // Conversa nova sem escolha: usa o padrão do administrador — nunca o fixado na outra.
  const r3 = await exchange(SA, "conversa padrão");
  assert.equal(r3.status, 200);
  assert.equal(r3.body.conversation.agent_id, null);
  assert.notEqual(lastChatBody.model, "agent-zen-x");

  // Agente inexistente/estrangeiro: recusado na criação (400 invalid_agent).
  const bad = await exchange(SA, "tentativa com agente inválido", { agentId: randomUUID() });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_agent");

  // Agente excluído depois: a conversa volta ao padrão do administrador, sem erro nem resposta falsa.
  assert.equal((await req(`/api/agents/${zen.id}`, { method: "DELETE", s: SA })).status, 200);
  const r4 = await exchange(SA, "depois de excluir o agente", { conversationId: r.body.conversation.id });
  assert.equal(r4.status, 200);
  assert.equal(lastChatBody.model, "agent-outro-y");
});

// ---------- compatibilidade ----------

test("caminho legado (MCP/scripts) continua funcionando e não persiste nada", async () => {
  const before = db.prepare("SELECT COUNT(*) n FROM conversations").get().n;
  const r = await json(await chat(SA, { messages: [{ role: "user", content: "pergunta legada" }] }));
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.reply, "string");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conversations").get().n, before);
});

// ---------- interface (regra de seleção) ----------
// A regra de seleção após recarga é testada no frontend: src/test/conversations.test.ts.

// ---------- smart context compaction (v1.6.0) ----------

test("compactConversationContext: histórico dentro dos limites não é alterado", () => {
  const shortHistory = [
    { role: "system", content: "Instruções do sistema." },
    { role: "user", content: "Olá Jarvis" },
    { role: "assistant", content: "Olá! Como posso ajudar hoje?" },
  ];

  const result = compactConversationContext(shortHistory, { maxMessages: 16, maxChars: 24000, preserveTail: 6 });
  assert.equal(result.compacted, false);
  assert.equal(result.savedChars, 0);
  assert.equal(result.compactedCount, 3);
  assert.deepEqual(result.messages, shortHistory);
});

test("compactConversationContext: histórico longo sintetiza o meio, preserva system e últimas mensagens", () => {
  const longHistory = [
    { role: "system", content: "Instruções mestras imutáveis." },
  ];

  for (let i = 1; i <= 20; i++) {
    longHistory.push({
      role: "user",
      content: `Pergunta detalhada ${i}: ` + "Discutindo arquitetura de microserviços, fallback resiliente e RAG semântico. ".repeat(4),
    });
    longHistory.push({
      role: "assistant",
      content: `Resposta aprofundada ${i}: ` + "Aqui está o detalhamento completo dos requisitos, contratos de API e logs operacionais. ".repeat(4),
    });
  }

  const preserveTail = 6;
  const result = compactConversationContext(longHistory, { maxMessages: 10, maxChars: 5000, preserveTail });

  assert.equal(result.compacted, true);
  assert.ok(result.savedChars > 0, "deve economizar caracteres");
  assert.equal(result.originalCount, 41);
  assert.equal(result.messages[0].role, "system");
  assert.equal(result.messages[0].content, "Instruções mestras imutáveis.");
  assert.equal(result.messages[1].role, "system");
  assert.match(result.messages[1].content, /\[Resumo de Contexto Anterior Compactado: \d+ mensagens\]/);

  // As últimas preserveTail mensagens são preservadas intactas
  const tailExtracted = result.messages.slice(-preserveTail);
  const originalTail = longHistory.slice(-preserveTail);
  assert.deepEqual(tailExtracted, originalTail);
});

test("compactConversationContext: entradas nulas ou vazias", () => {
  assert.deepEqual(compactConversationContext([]), {
    messages: [],
    compacted: false,
    savedChars: 0,
    originalCount: 0,
    compactedCount: 0,
  });
  assert.deepEqual(compactConversationContext(null), {
    messages: [],
    compacted: false,
    savedChars: 0,
    originalCount: 0,
    compactedCount: 0,
  });
});

