// Tools the agent can call. Each returns a string result for the model.
import { exec } from "node:child_process";
import { db, now, uid, audit } from "./db.js";
import { getSettings } from "./settings.js";
import { decide } from "./hostpolicy.js";
import { embed, cosine } from "./llm.js";
import { sendMessage, sendEmail, readInbox, readCalendar } from "./comms.js";

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

export async function remember(content, tags = "") {
  const id = uid();
  const vec = await embed(content).catch(() => null);
  db.prepare("INSERT INTO memories (id, content, tags, embedding, created_at) VALUES (?, ?, ?, ?, ?)").run(id, content, tags, vec ? JSON.stringify(vec) : null, now());
  return { id, content, tags, created_at: now() };
}

export async function recall(query, limit = 6) {
  const rows = db.prepare("SELECT id, content, tags, embedding, created_at FROM memories").all();
  const qv = await embed(query).catch(() => null);
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const scored = rows.map((r) => {
    let score = words.filter((w) => `${r.content} ${r.tags}`.toLowerCase().includes(w)).length / Math.max(1, words.length);
    if (qv && r.embedding) score = Math.max(score, cosine(qv, JSON.parse(r.embedding)));
    return { ...r, score };
  });
  return scored.filter((r) => r.score > 0.2).sort((a, b) => b.score - a.score).slice(0, limit);
}

async function cliAgent(agent, prompt) {
  const s = getSettings();
  const cfg = s.integrations?.[agent];
  if (!cfg?.enabled) return `Integração "${agent}" não está habilitada em Configurações.`;
  const quoted = JSON.stringify(prompt);
  const cmd = String(cfg.command || "").replace("{prompt}", quoted);
  audit("cli_agent", cmd);
  return runShell(cmd, 600000);
}

/** ctx: { autonomy: "confirm"|"safe"|"full", pending: [] } */
export async function callTool(name, input, ctx) {
  const s = getSettings();
  switch (name) {
    case "web_search": return webSearch(input.query);
    case "fetch_url": return fetchUrl(input.url);
    case "remember": await remember(input.content, input.tags); return "Memória salva.";
    case "recall": {
      const r = await recall(input.query);
      return r.length ? r.map((x) => `- ${x.content} (${x.tags})`).join("\n") : "Nada encontrado na memória.";
    }
    case "run_command": {
      const verdict = decide(input.command, { enabled: !!s.host?.enabled, allowlist: s.host?.allowlist, autonomy: ctx.autonomy });
      if (verdict === "deny") return "Comando recusado pela política de segurança (habilite Ações no host ou ajuste a lista de comandos).";
      if (verdict === "ask") {
        const id = uid();
        db.prepare("INSERT INTO approvals (id, command, status, created_at) VALUES (?, ?, 'pending', ?)").run(id, input.command, now());
        ctx.pending.push({ id, command: input.command });
        return "Comando enviado para aprovação do usuário. Informe que ele precisa aprovar no painel.";
      }
      audit("run_command", input.command);
      return runShell(input.command);
    }
    case "cli_agent": return cliAgent(input.agent, input.prompt);
    case "send_message": return sendMessage(input.channel, input.text);
    case "send_email": return sendEmail(input.account, input.to, input.subject, input.body);
    case "read_email": return readInbox(input.account);
    case "read_calendar": return readCalendar();
    default: return `Ferramenta desconhecida: ${name}`;
  }
}

export async function resolveApproval(id, approve) {
  const row = db.prepare("SELECT * FROM approvals WHERE id = ?").get(id);
  if (!row || row.status !== "pending") return { output: "Aprovação inexistente ou já resolvida." };
  if (!approve) {
    db.prepare("UPDATE approvals SET status='denied' WHERE id = ?").run(id);
    return { output: "Negado pelo usuário." };
  }
  audit("run_command(approved)", row.command);
  const output = await runShell(row.command);
  db.prepare("UPDATE approvals SET status='done', output=? WHERE id = ?").run(output, id);
  return { output };
}
