// Jarvis local service — http://127.0.0.1:7777
// The web panel auto-detects this address; no token or manual pairing is needed because the
// service only listens on localhost and only accepts browser requests from trusted origins.
import { createServer } from "node:http";
import { db, agents, bots, now, uid } from "./db.js";
import { publicSettings, updateSettings, getSettings } from "./settings.js";
import { runAgent, testProvider } from "./llm.js";
import { remember, recall, resolveApproval } from "./tools.js";
import { runBot, listRuns, startScheduler, triggerByText } from "./bots.js";
import { tts, cloneVoice } from "./voice.js";
import { startTelegramPolling, sendMessage } from "./comms.js";

const PORT = Number(process.env.JARVIS_PORT || 7777);
const HOST = process.env.JARVIS_HOST || "127.0.0.1";
const EXTRA_ORIGINS = (process.env.JARVIS_ALLOWED_ORIGINS || "").split(",").filter(Boolean);
const VERSION = "1.0.0";

const trusted = (o) =>
  !o || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o) ||
  /^https:\/\/[a-z0-9-]+\.(lovable\.app|lovableproject\.com)$/.test(o) || EXTRA_ORIGINS.includes(o);

function send(res, status, body, origin, type = "application/json") {
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    vary: "origin",
  });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let raw = "";
  for await (const c of req) raw += c;
  return raw ? JSON.parse(raw) : {};
}

const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), fn });

route("GET", "/api/health", () => ({ ok: true, version: VERSION, name: getSettings().general?.agentName, platform: process.platform }));
route("GET", "/api/settings", () => publicSettings());
route("PUT", "/api/settings", async ({ body }) => updateSettings(body));
route("POST", "/api/providers/:id/test", ({ params }) => testProvider(params.id));

route("POST", "/api/chat", async ({ body }) => {
  const last = body.messages?.at(-1)?.content || "";
  triggerByText("voice", last);
  return runAgent({ agentId: body.agentId, messages: body.messages || [], autonomy: "confirm" });
});
route("POST", "/api/approvals/:id", async ({ params, body }) => resolveApproval(params.id, !!body.approve));

route("GET", "/api/memories", ({ query }) =>
  query.get("q") ? recall(query.get("q"), 50) : db.prepare("SELECT id, content, tags, created_at FROM memories ORDER BY created_at DESC").all());
route("POST", "/api/memories", ({ body }) => remember(body.content, body.tags));
route("PUT", "/api/memories/:id", ({ params, body }) => { db.prepare("UPDATE memories SET content=?, tags=? WHERE id=?").run(body.content, body.tags || "", params.id); return { ok: true }; });
route("DELETE", "/api/memories/:id", ({ params }) => { db.prepare("DELETE FROM memories WHERE id=?").run(params.id); return { ok: true }; });

for (const [name, store] of [["agents", agents], ["bots", bots]]) {
  route("GET", `/api/${name}`, () => store.list());
  route("POST", `/api/${name}`, ({ body }) => store.save(body));
  route("PUT", `/api/${name}/:id`, ({ params, body }) => store.save({ ...body, id: params.id }));
  route("DELETE", `/api/${name}/:id`, ({ params }) => { store.remove(params.id); return { ok: true }; });
}
route("POST", "/api/bots/:id/run", ({ params }) => runBot(bots.get(params.id), "manual"));
route("GET", "/api/bots/:id/runs", ({ params }) => listRuns(params.id));

route("POST", "/api/tts", async ({ body }) => { const a = await tts(body.text, body.lang); return { __raw: a.data, __type: a.type }; });
route("POST", "/api/voice/clone", async ({ form }) => {
  const r = await cloneVoice(form.get("file"), form.get("engine"));
  updateSettings({ voice: { clonedVoiceId: r.voiceId, clonedEngine: r.engine } });
  return r;
});

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!trusted(origin)) return send(res, 403, { error: "origin not allowed" }, origin);
  if (req.method === "OPTIONS") return send(res, 204, "", origin, "text/plain");
  const url = new URL(req.url, `http://${req.headers.host}`);
  for (const r of routes) {
    const m = r.method === req.method && url.pathname.match(r.re);
    if (!m) continue;
    try {
      const ct = req.headers["content-type"] || "";
      let body = {}, form = null;
      if (ct.includes("multipart/form-data")) {
        form = await new Request(url, { method: req.method, headers: req.headers, body: req, duplex: "half" }).formData();
      } else if (req.method !== "GET" && req.method !== "DELETE") body = await readJson(req);
      const out = await r.fn({ params: m.groups || {}, query: url.searchParams, body, form });
      if (out?.__raw) return send(res, 200, out.__raw, origin, out.__type);
      return send(res, 200, out ?? { ok: true }, origin);
    } catch (e) {
      console.error(e);
      return send(res, 500, { error: e.message }, origin);
    }
  }
  send(res, 404, { error: "not found" }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  J.A.R.V.I.S. local ativo em http://${HOST}:${PORT}`);
  console.log(`  Painel: http://localhost:8080  (o painel detecta este serviço automaticamente)\n`);
});

startScheduler();
startTelegramPolling(async (channel, text) => {
  await Promise.all(triggerByText("message", text));
  const r = await runAgent({ messages: [{ role: "user", content: text }], autonomy: "confirm" });
  await sendMessage(channel, r.reply + (r.pending.length ? "\n\n(Há uma ação aguardando sua aprovação no painel.)" : ""));
});

export { server, uid, now };
