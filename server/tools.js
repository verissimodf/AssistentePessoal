// Tools the agent can call. Each returns a string result for the model.
import { exec } from "node:child_process";
import { db, now, uid, audit } from "./db.js";
import { getSettings } from "./settings.js";
import { decide } from "./hostpolicy.js";
import { can, TOOL_SCOPES, AuthError } from "./auth.js";
import { embed, cosine } from "./llm.js";
import { searchDocuments } from "./documents.js";
import { assignNew, owns, tx } from "./ownership.js";
import { sendMessage, readCalendar } from "./comms.js";
import { getMailService } from "./mail-service.js";
import { MailError } from "./mail.js";

export const TOOL_DEFS = {
  web_search: { description: "Search the internet. Returns titles, links and snippets.", params: { query: "string" } },
  fetch_url: { description: "Download a web page and return its readable text.", params: { url: "string" } },
  remember: { description: "Save a fact or note to long-term memory.", params: { content: "string", tags: "string" } },
  recall: { description: "Search long-term memory for relevant facts.", params: { query: "string" } },
  run_command: { description: "Run a shell command on the host computer (Windows or Linux).", params: { command: "string" } },
  cli_agent: { description: "Delegate a task to an external coding agent: claude_code, codex, opencode, hermes.", params: { agent: "string", prompt: "string" } },
  send_message: { description: "Send a message via telegram, whatsapp or signal.", params: { channel: "string", text: "string" } },
  send_email: { description: "Send an email via gmail or outlook.", params: { account: "string", to: "string", subject: "string", body: "string" } },
  read_email: { description: "Read the latest emails from gmail or outlook inbox.", params: { account: "string" } },
  read_calendar: { description: "List upcoming calendar events.", params: {} },
  context7_docs: { description: "Fetch up-to-date library/framework documentation from Context7 (context7-mcp).", params: { library: "string", topic: "string" } },
  crawl_page: { description: "Crawl a web page (including JavaScript pages) with crawl4ai and return clean markdown.", params: { url: "string" } },
  openhands_task: { description: "Delegate a software task to the OpenHands autonomous coding agent.", params: { task: "string" } },
  document_search: { description: "Search the user's own documents (TXT) for relevant passages.", params: { query: "string" } },
};
// Alias exposed in the panel
TOOL_DEFS.read_calendar.params = {};

export const runShell = (command, timeout = 60000) =>
  new Promise((resolve) => {
    exec(command, { timeout, maxBuffer: 2_000_000, windowsHide: true }, (err, stdout, stderr) => {
      resolve(`${stdout || ""}${stderr ? `\n[stderr] ${stderr}` : ""}${err && !stdout ? `\n[erro] ${err.message}` : ""}`.trim().slice(0, 8000));
    });
  });

async function webSearch(query) {
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { "user-agent": "Mozilla/5.0 Jarvis" } });
  const html = await r.text();
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < 8) {
    let link = m[1];
    const u = link.match(/uddg=([^&]+)/);
    if (u) link = decodeURIComponent(u[1]);
    const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
    out.push(`- ${strip(m[2])}\n  ${link}\n  ${strip(m[3])}`);
  }
  return out.join("\n") || "Nenhum resultado.";
}

async function fetchUrl(url) {
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 Jarvis" }, signal: AbortSignal.timeout(20000) });
  const html = await r.text();
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 12000);
}

// ---------- Integrações externas: context7-mcp, crawl4ai, openhands ----------

// Cliente MCP mínimo sobre HTTP (streamable transport), usado pelo context7-mcp.
async function mcpHttp(url, method, params, sessionId, id) {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", ...(id ? { id } : {}), method, params }),
    signal: AbortSignal.timeout(60000),
  });
  const sid = r.headers.get("mcp-session-id") || sessionId;
  const text = await r.text();
  const dataLine = text.split(/\r?\n/).find((l) => l.startsWith("data:"));
  let json = {};
  try { json = JSON.parse(dataLine ? dataLine.slice(5).trim() : text); } catch { /* SSE vazio */ }
  return { json, sid };
}

const mcpText = (res) => (res?.json?.result?.content || []).map((c) => c.text).filter(Boolean).join("\n");

async function context7Docs(library, topic = "") {
  const url = getSettings().integrations?.context7?.command || "http://127.0.0.1:8000/mcp";
  const init = await mcpHttp(url, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "assistente-pessoal", version: "1.0.0" } }, null, 1);
  if (!init.sid) return "Context7 indisponível (não retornou sessão MCP).";
  await mcpHttp(url, "notifications/initialized", {}, init.sid).catch(() => {});
  const resolved = await mcpHttp(url, "tools/call", { name: "resolve-library-uri", arguments: { libraryName: library } }, init.sid, 2);
  const uri = (mcpText(resolved).match(/context7:\/\/libraries\/[^\s"']+/) || [])[0];
  if (!uri) return `Context7: biblioteca "${library}" não encontrada.\n${mcpText(resolved).slice(0, 400)}`;
  const docs = await mcpHttp(url, "tools/call", { name: "search-library-docs", arguments: { resourceURI: uri, ...(topic ? { topic } : {}) } }, init.sid, 3);
  return `Documentação Context7 — ${library} (${uri}):\n${mcpText(docs).slice(0, 6000) || "(sem conteúdo)"}`;
}

async function crawlPage(url) {
  const cfg = getSettings().integrations?.crawl4ai || {};
  const base = (cfg.command || "http://192.168.2.29:11235").replace(/\/$/, "");
  const r = await fetch(`${base}/md`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({ url, f: "fit" }),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) return `crawl4ai ${r.status}: ${await r.text()}`;
  const j = await r.json();
  return String(j.markdown || j.fit_markdown || JSON.stringify(j)).slice(0, 8000);
}

async function openhandsTask(task) {
  const cfg = getSettings().integrations?.openhands || {};
  const base = (cfg.command || "http://127.0.0.1:8085").replace(/\/$/, "");
  const r = await fetch(`${base}/api/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({ initial_user_msg: task }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) return `OpenHands ${r.status}: ${await r.text()}`;
  const j = await r.json();
  return `Tarefa enviada ao OpenHands (conversation_id: ${j.conversation_id || j.id}, status: ${j.conversation_status || j.status || "?"}). Acompanhe em ${base}.`;
}

/** Memories always belong to one admin; without an owner nothing is written. */
export async function remember(content, tags = "", ownerId) {
  if (!ownerId) throw new Error("remember requires an owner");
  const id = uid();
  const vec = await embed(content, ownerId).catch(() => null);
  const at = now();
  tx(() => {
    db.prepare("INSERT INTO memories (id, content, tags, embedding, created_at) VALUES (?, ?, ?, ?, ?)").run(id, content, tags || "", vec ? JSON.stringify(vec) : null, at);
    assignNew("memory", id, ownerId);
  });
  return { id, content, tags: tags || "", created_at: at };
}

/** Only the owner's memories are ever scanned; unowned (legacy) rows are never read. */
export async function recall(query, limit = 6, ownerId) {
  if (!ownerId) return [];
  const rows = db.prepare(`SELECT m.id, m.content, m.tags, m.embedding, m.created_at FROM memories m
    JOIN ownership o ON o.resource_type = 'memory' AND o.resource_id = m.id AND o.owner_admin_id = ?`).all(ownerId);
  const qv = await embed(query, ownerId).catch(() => null);
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scored = rows.map((r) => {
    let score = words.filter((w) => `${r.content} ${r.tags}`.toLowerCase().includes(w)).length / Math.max(1, words.length);
    if (qv && r.embedding) score = Math.max(score, cosine(qv, JSON.parse(r.embedding)));
    const { embedding: _e, ...rest } = r;
    return { ...rest, score };
  });
  return scored.filter((r) => r.score > 0.2).sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Pending approval owned by the admin responsible for the run. */
function queueApproval(command, ownerId) {
  const id = uid();
  tx(() => {
    db.prepare("INSERT INTO approvals (id, command, status, created_at) VALUES (?, ?, 'pending', ?)").run(id, command, now());
    assignNew("approval", id, ownerId);
  });
  return id;
}

const who = (p) => (p ? `${p.type}:${p.adminId || p.tokenId || p.botId || p.channel || "?"}` : "none");

/** ctx: { autonomy: "confirm"|"safe"|"full", pending: [], principal } — authorization is re-checked here, at execution time. */
export async function callTool(name, input, ctx) {
  const scope = TOOL_SCOPES[name];
  if (!scope) return `Ferramenta desconhecida: ${name}`;
  if (!can(ctx.principal, scope)) {
    audit("authz.tool_denied", { tool: name, scope, principal: who(ctx.principal) });
    return `Permissão negada: a identidade desta execução não tem o escopo "${scope}".`;
  }
  const adminId = ctx.principal?.adminId || null;
  if (!adminId) {
    audit("authz.tool_denied", { tool: name, reason: "no_owner", principal: who(ctx.principal) });
    return "Permissão negada: esta execução não tem um administrador proprietário válido.";
  }
  const s = getSettings(adminId);
  switch (name) {
    case "web_search": return webSearch(input.query);
    case "fetch_url": return fetchUrl(input.url);
    case "remember": await remember(input.content, input.tags, adminId); return "Memória salva.";
    case "recall": {
      const r = await recall(input.query, 6, adminId);
      return r.length ? r.map((x) => `- ${x.content} (${x.tags})`).join("\n") : "Nada encontrado na memória.";
    }
    case "run_command": {
      const verdict = decide(input.command, { enabled: !!s.host?.enabled, allowlist: s.host?.allowlist, autonomy: ctx.autonomy });
      if (verdict === "deny") return "Comando recusado pela política de segurança (habilite Ações no host ou ajuste a lista de comandos).";
      if (verdict === "ask") {
        const id = queueApproval(input.command, adminId);
        audit("run_command(requested)", { approvalId: id, status: "requested", autonomy: ctx.autonomy, principal: who(ctx.principal) });
        ctx.pending.push({ id, command: input.command });
        return "Comando enviado para aprovação do usuário. Informe que ele precisa aprovar no painel.";
      }
      audit("run_command", { status: "executed", autonomy: ctx.autonomy, principal: who(ctx.principal) });
      return runShell(input.command);
    }
    case "cli_agent": {
      // External agents run arbitrary work on the host and have no validated policy of their own,
      // so EVERY delegation needs human approval, whatever the autonomy (confirm, safe or full).
      // decide() is still consulted so a disabled host or a destructive command is refused.
      const cfg = s.integrations?.[input.agent];
      if (!cfg?.enabled) return `Integração "${input.agent}" não está habilitada em Configurações.`;
      const command = String(cfg.command || "").replace("{prompt}", JSON.stringify(String(input.prompt ?? "")));
      const verdict = decide(command, { enabled: !!s.host?.enabled, allowlist: "", autonomy: "confirm" });
      if (verdict === "deny") return "Ações no host estão desabilitadas.";
      const id = queueApproval(command, adminId);
      audit("cli_agent(requested)", { agent: input.agent, approvalId: id, status: "requested", autonomy: ctx.autonomy, principal: who(ctx.principal) });
      ctx.pending.push({ id, command });
      return "Delegação enviada para aprovação do usuário no painel.";
    }
    case "send_message": return sendMessage(adminId, input.channel, input.text);
    case "send_email": {
      // D9: an agent/bot must never send without an explicit human approval. Implementing that flow
      // would require carrying the message body from request to approval, i.e. persisting the body —
      // which this phase forbids (docs/FASE-4-EMAIL.md §10/§11). Direct sending from a tool is
      // therefore refused; the human sends from the panel with the explicit ENVIAR confirmation.
      audit("send_email(blocked)", { status: "needs_approval", principal: who(ctx.principal) });
      return "Envio de e-mail por agente/bot exige confirmacao humana e ainda nao esta disponivel. Use o painel (E-mail) para enviar com confirmacao explicita.";
    }
    case "read_email": {
      try {
        const page = await getMailService().list(adminId, input.account, { limit: 10 });
        return page.messages.length ? page.messages.map((m) => `- ${m.date ?? "?"} | ${m.from} | ${m.subject}`).join("\n") : "Caixa vazia.";
      } catch (e) {
        if (e instanceof MailError) return `Nao foi possivel ler a conta "${input.account}": ${e.code}.`;
        throw e;
      }
    }
    case "read_calendar": return readCalendar(adminId);
    case "document_search": {
      const r = searchDocuments(adminId, input.query);
      return r.length ? r.map((x) => `- ${x.name}: ${x.snippet}`).join("\n") : "Nenhum documento relevante.";
    }
    case "context7_docs": return context7Docs(input.library, input.topic);
    case "crawl_page": return crawlPage(input.url);
    case "openhands_task": return openhandsTask(input.task);
    default: return `Ferramenta desconhecida: ${name}`;
  }
}

/**
 * Only the owner admin may resolve. States: pending → running → done | error, or pending → denied.
 * Ownership is checked and the transition pending→(running|denied) is one conditional UPDATE, so two
 * concurrent requests can never both execute. A crash after "running" leaves the row "interrupted"
 * at next start (db.js) — never re-executed. Foreign, legacy and unknown ids → 404.
 */
export async function resolveApproval(id, approve, principal) {
  const adminId = principal?.adminId || null;
  if (!owns(adminId, "approval", id)) throw new AuthError(404, "not_found");
  const row = db.prepare("SELECT command FROM approvals WHERE id = ?").get(id);
  if (!row) throw new AuthError(404, "not_found");
  const hostOn = !!getSettings(adminId).host?.enabled;
  const next = !approve ? "denied" : hostOn ? "running" : "denied";
  const claimed = db.prepare("UPDATE approvals SET status = ? WHERE id = ? AND status = 'pending'").run(next, id).changes;
  if (!claimed) throw new AuthError(409, "already_resolved");
  if (!approve) { audit("run_command(denied)", { approvalId: id, status: "denied", principal: who(principal) }); return { output: "Negado pelo usuário." }; }
  if (!hostOn) {
    db.prepare("UPDATE approvals SET output = ? WHERE id = ?").run("Ações no host desabilitadas.", id);
    audit("run_command(denied)", { approvalId: id, status: "denied", reason: "host_disabled", principal: who(principal) });
    return { output: "Ações no host estão desabilitadas; comando não executado." };
  }
  audit("run_command(approved)", { approvalId: id, status: "approved", principal: who(principal) });
  try {
    const output = await runShell(row.command);
    db.prepare("UPDATE approvals SET status = 'done', output = ? WHERE id = ?").run(output, id);
    return { output };
  } catch (e) {
    db.prepare("UPDATE approvals SET status = 'error', output = ? WHERE id = ?").run(String(e?.message || e).slice(0, 2000), id);
    audit("run_command(error)", { approvalId: id, status: "error", principal: who(principal) });
    return { output: "Falha ao executar o comando." };
  }
}
