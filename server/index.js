// Jarvis local service — http://127.0.0.1:7777
// Security model (Phase 1): every route except the explicit PUBLIC list requires either
//  - an admin session (HttpOnly SameSite=Strict cookie) + X-Jarvis-CSRF header on every
//    state-changing request (POST/PUT/PATCH/DELETE), logout included; or
//  - a revocable, scoped service token (Authorization: Bearer jst_…) for MCP/scripts.
// CORS/Origin checks are kept as defense in depth, never as authentication.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { db, agents, bots, auth, audit } from "./db.js";
import { AuthError, can, isVerifiedAdmin, sanitizeBotScopes, DEFAULT_BOT_SCOPES } from "./auth.js";
import { publicSettings, updateSettings, legacySettingsInventory, claimLegacySettings } from "./settings.js";
import { owns, ownerOf, ownedIds, assignNew, dropOwnership, tx, legacyInventory, claimLegacy, ClaimError, inactiveAdminInventory, transferResources } from "./ownership.js";
import { runAgent, testProvider } from "./llm.js";
import { remember, recall, resolveApproval } from "./tools.js";
import { listDocuments, getDocument, saveDocument, searchDocuments, deleteDocument } from "./documents.js";
import { runBot, listRuns, startScheduler, triggerByText, auditLegacyBlocked } from "./bots.js";
import { tts, cloneVoice } from "./voice.js";
import { startTelegramPolling, sendMessage } from "./comms.js";

const VERSION = "1.2.0";
const COOKIE = "jarvis_sid";
const SECURE_COOKIE = process.env.JARVIS_COOKIE_SECURE === "1";
const MAX_BODY = 1_000_000;
const MAX_UPLOAD = Number(process.env.JARVIS_MAX_UPLOAD) || 25_000_000;

/** Parse multipart enforcing the limit on bytes actually read (Content-Length may be absent/chunked). */
async function readLimitedForm(req, url, max) {
  let n = 0, over = false;
  const stream = new ReadableStream({
    async start(c) {
      try {
        for await (const chunk of req) {
          n += chunk.length;
          if (n > max) { over = true; c.error(new AuthError(413, "payload_too_large")); return; }
          c.enqueue(chunk);
        }
        c.close();
      } catch (e) { c.error(e); }
    },
  });
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["content-length", "transfer-encoding"].includes(k)));
  try {
    return await new Request(url, { method: req.method, headers, body: stream, duplex: "half" }).formData();
  } catch (e) {
    if (over) throw new AuthError(413, "payload_too_large");
    throw new AuthError(400, "invalid_form");
  }
}
const EXTRA_ORIGINS = (process.env.JARVIS_ALLOWED_ORIGINS || "").split(",").filter(Boolean);

const trusted = (o) =>
  !o || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o) ||
  /^https:\/\/[a-z0-9-]+\.(lovable\.app|lovableproject\.com)$/.test(o) || EXTRA_ORIGINS.includes(o);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function headers(origin, type, extra = {}) {
  return {
    "content-type": type,
    ...(origin ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" } : {}),
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-jarvis-csrf,authorization",
    "access-control-allow-private-network": "true",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    vary: "origin",
    ...extra,
  };
}
function send(res, status, body, origin, type = "application/json", extra) {
  res.writeHead(status, headers(origin, type, extra));
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}
const cookieHeader = (sid, maxAge) =>
  `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${SECURE_COOKIE ? "; Secure" : ""}`;
const readCookie = (req) => (req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === COOKIE)?.[1] || null;
const eq = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length > 0 && x.length === y.length && timingSafeEqual(x, y); };

async function readJson(req) {
  let raw = "";
  for await (const c of req) { raw += c; if (raw.length > MAX_BODY) throw new AuthError(413, "payload_too_large"); }
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new AuthError(400, "invalid_json"); }
}

// ---------- routing ----------
// access: "public" | "session" (human admin only) | <scope string>
const routes = [];
const route = (method, pattern, access, fn) =>
  routes.push({ method, pattern, access, re: new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`), fn });
export const routeTable = () => routes.map(({ method, pattern, access }) => ({ method, pattern, access }));

// Public (explicit, minimal). Health reveals only operational status.
route("GET", "/api/health", "public", () => ({ ok: true, version: VERSION, setupRequired: auth.setupRequired() }));
route("POST", "/api/auth/setup", "public", ({ body }) => auth.setupFirstAdmin(body));
route("POST", "/api/auth/login", "public", ({ body, req, res }) => {
  const r = auth.login({ username: body.username, password: body.password, ip: req.socket.remoteAddress, userAgent: req.headers["user-agent"], previousSid: readCookie(req) });
  res.setCookie = cookieHeader(r.sid, 12 * 3600);
  return { admin: r.admin, csrf: r.csrf };
});

// Session (human admin)
route("GET", "/api/auth/me", "session", ({ principal }) => ({ admin: { id: principal.adminId, username: principal.username }, csrf: principal.csrf }));
route("POST", "/api/auth/logout", "session", ({ req, res }) => { auth.revokeSession(readCookie(req)); res.setCookie = cookieHeader("", 0); return { ok: true }; });
route("GET", "/api/auth/admins", "session", () => auth.listAdmins());
route("POST", "/api/auth/admins", "session", ({ principal, body }) => auth.createAdmin(principal, body));
route("DELETE", "/api/auth/admins/:id", "session", ({ principal, params }) => auth.removeAdmin(principal, params.id));
route("GET", "/api/auth/sessions", "session", ({ principal }) => auth.listSessions(principal.adminId));
route("DELETE", "/api/auth/sessions/:id", "session", ({ principal, params }) => auth.revokeSessionById(principal.adminId, params.id));
route("GET", "/api/auth/tokens", "session", () => auth.listServiceTokens());
route("POST", "/api/auth/tokens", "session", ({ principal, body }) => auth.createServiceToken(principal, body));
route("DELETE", "/api/auth/tokens/:id", "session", ({ principal, params }) => auth.revokeServiceToken(principal, params.id));
route("POST", "/api/approvals/:id", "session", ({ params, body, principal }) => {
  if (!owns(principal?.adminId, "approval", params.id)) throw new AuthError(404, "not_found"); // foreign/legacy/unknown look the same
  return resolveApproval(params.id, !!body.approve, principal);
});
route("GET", "/api/audit", "audit:read", () => db.prepare("SELECT id, at, kind, detail FROM audit ORDER BY id DESC LIMIT 200").all());

// ---------- Phase 2: every resource is scoped to principal.adminId (no owner → invisible) ----------
const me = (p) => p?.adminId || null;
const notFound = () => { throw new AuthError(404, "not_found"); };

route("GET", "/api/settings", "settings:read", ({ principal }) => publicSettings(me(principal)));
route("PUT", "/api/settings", "settings:write", ({ body, principal }) => updateSettings(body, { adminId: me(principal), allowGlobal: isVerifiedAdmin(principal) }));
route("POST", "/api/providers/:id/test", "settings:write", ({ params, principal }) => testProvider(params.id, me(principal)));

route("POST", "/api/chat", "chat", async ({ body, principal }) => {
  const last = body.messages?.at(-1)?.content || "";
  if (can(principal, "bots:run")) triggerByText("voice", last, me(principal));
  return runAgent({ agentId: body.agentId, messages: body.messages || [], autonomy: "confirm", principal });
});

const MEM_OWNED = `SELECT m.id, m.content, m.tags, m.created_at FROM memories m
  JOIN ownership o ON o.resource_type = 'memory' AND o.resource_id = m.id AND o.owner_admin_id = ? ORDER BY m.created_at DESC`;
route("GET", "/api/memories", "memories:read", async ({ query, principal }) =>
  query.get("q") ? (await recall(query.get("q"), 50, me(principal))).map(({ score: _s, ...m }) => m) : db.prepare(MEM_OWNED).all(me(principal)));
route("POST", "/api/memories", "memories:write", ({ body, principal }) => remember(String(body.content || ""), body.tags, me(principal)));
route("PUT", "/api/memories/:id", "memories:write", ({ params, body, principal }) => {
  if (!owns(me(principal), "memory", params.id)) notFound();
  db.prepare("UPDATE memories SET content=?, tags=? WHERE id=?").run(String(body.content || ""), body.tags || "", params.id); return { ok: true };
});
route("DELETE", "/api/memories/:id", "memories:write", ({ params, principal }) => {
  if (!owns(me(principal), "memory", params.id)) notFound();
  tx(() => { db.prepare("DELETE FROM memories WHERE id=?").run(params.id); dropOwnership("memory", params.id); }); return { ok: true };
});

// ---------- documents (Phase 3: private local document store, TXT first) ----------
route("GET", "/api/documents", "documents:read", ({ principal }) => listDocuments(me(principal)));
route("GET", "/api/documents/search", "documents:read", ({ query, principal }) => searchDocuments(me(principal), query.get("q") || ""));
route("GET", "/api/documents/:id", "documents:read", ({ params, principal }) => {
  const d = getDocument(me(principal), params.id);
  if (!d) notFound();
  return { id: d.id, name: d.name, mime: d.mime, size: d.size, created_at: d.created_at, content: d.content_text };
});
route("POST", "/api/documents", "documents:write", async ({ body, form, principal }) => {
  const owner = me(principal);
  if (form) {
    const file = form.get("file");
    if (!file || typeof file === "string") throw new AuthError(400, "file_required");
    const buf = Buffer.from(await file.arrayBuffer());
    return saveDocument(owner, { name: String(form.get("name") || file.name || "documento.txt"), mime: String(form.get("mime") || file.type || "text/plain"), buffer: buf });
  }
  return saveDocument(owner, { name: String(body.name ?? ""), mime: String(body.mime || "text/plain"), buffer: Buffer.from(String(body.content ?? ""), "utf8") });
});
route("DELETE", "/api/documents/:id", "documents:write", ({ params, principal }) => {
  if (!deleteDocument(me(principal), params.id).ok) notFound();
  return { ok: true };
});

for (const [name, store, type] of [["agents", agents, "agent"], ["bots", bots, "bot"]]) {
  const withOwner = (item, adminId) => (name === "bots" ? { ...item, owner_admin_id: adminId } : item);
  route("GET", `/api/${name}`, `${name}:read`, ({ principal }) =>
    [...ownedIds(me(principal), type)].map((id) => store.get(id)).filter(Boolean).map((i) => withOwner(i, me(principal))));
  const stamp = (body, existing) =>
    name === "bots" ? { ...body, scopes: sanitizeBotScopes(body.scopes) ?? existing?.scopes ?? DEFAULT_BOT_SCOPES } : body;
  route("POST", `/api/${name}`, `${name}:write`, ({ body, principal }) => {
    const adminId = me(principal);
    if (!adminId) throw new AuthError(403, "owner_required");
    return tx(() => {
      const saved = store.save(stamp({ ...body, id: undefined, ...(name === "bots" ? { owner_admin_id: adminId } : {}) }, null));
      assignNew(type, saved.id, adminId);
      return saved;
    });
  });
  route("PUT", `/api/${name}/:id`, `${name}:write`, ({ params, body, principal }) => {
    if (!owns(me(principal), type, params.id)) notFound();
    const existing = store.get(params.id);
    const { owner_admin_id: _ignored, ...rest } = body || {};
    return withOwner(store.save(stamp({ ...rest, id: params.id, ...(name === "bots" ? { owner_admin_id: existing?.owner_admin_id ?? me(principal) } : {}) }, existing)), me(principal));
  });
  route("DELETE", `/api/${name}/:id`, `${name}:write`, ({ params, principal }) => {
    if (!owns(me(principal), type, params.id)) notFound();
    tx(() => { store.remove(params.id); dropOwnership(type, params.id); }); return { ok: true };
  });
}
route("POST", "/api/bots/:id/run", "bots:run", ({ params, principal }) => {
  if (!owns(me(principal), "bot", params.id)) {
    if (bots.get(params.id) && !ownerOf("bot", params.id)) auditLegacyBlocked(params.id, "manual"); // still 404 to the caller
    notFound();
  }
  return runBot(bots.get(params.id), "manual", "manual");
});
route("GET", "/api/bots/:id/runs", "bots:read", ({ params, principal }) => {
  if (!owns(me(principal), "bot", params.id)) notFound();
  return listRuns(params.id, me(principal));
});

route("POST", "/api/tts", "voice", async ({ body, principal }) => { const a = await tts(body.text, body.lang, me(principal)); return { __raw: a.data, __type: a.type }; });
route("POST", "/api/voice/clone", "settings:write", async ({ form, principal }) => {
  const adminId = me(principal);
  if (!adminId) throw new AuthError(403, "owner_required");
  const r = await cloneVoice(form.get("file"), form.get("engine"), adminId);
  updateSettings({ voice: { clonedVoiceId: r.voiceId, clonedEngine: r.engine } }, { adminId, allowGlobal: false });
  return r;
});

// Legacy (unowned) data — human admin only. Metadata only; claims are explicit, atomic, audited.
route("GET", "/api/legacy", "session", () => ({ resources: legacyInventory(), settings: legacySettingsInventory() }));
route("POST", "/api/legacy/claim", "session", ({ body, principal }) => {
  try { return claimLegacy(principal.adminId, body); } catch (e) { if (e instanceof ClaimError) throw new AuthError(e.status, e.code); throw e; }
});
route("POST", "/api/legacy/settings/claim", "session", ({ body, principal }) => claimLegacySettings(principal.adminId, body.confirm));

// ---------- D_REC: reauthentication + controlled ownership transfer ----------
route("POST", "/api/auth/reauth", "session", ({ body, principal }) => auth.reauth(principal, body.password));
route("GET", "/api/ownership/inactive", "session", () => inactiveAdminInventory());
route("POST", "/api/ownership/transfer", "session", ({ body, principal }) => {
  if (!auth.hasRecentReauth(principal)) throw new AuthError(403, "reauth_required");
  if (body.confirm !== "TRANSFERIR") throw new AuthError(400, "confirmation_required");
  try { return transferResources(principal.adminId, body); }
  catch (e) { if (e instanceof ClaimError) throw new AuthError(e.status, e.code); throw e; }
});

// ---------- authentication + authorization (single choke point) ----------
function authenticate(req) {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];
  if (bearer) return { principal: auth.validateServiceToken(bearer), via: "token" };
  return { principal: auth.validateSession(readCookie(req)), via: "cookie" };
}

export function createApp() {
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!trusted(origin)) return send(res, 403, { error: "origin_not_allowed" }, undefined);
    if (req.method === "OPTIONS") return send(res, 204, "", origin, "text/plain");
    const url = new URL(req.url, "http://127.0.0.1");
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) return send(res, 404, { error: "not_found" }, origin);
    try {
      let principal = null;
      if (r.access !== "public") {
        const a = authenticate(req);
        principal = a.principal;
        if (!principal) return send(res, 401, { error: "unauthenticated" }, origin);
        // CSRF: cookie sessions must echo the session-bound token on every state change.
        if (a.via === "cookie" && MUTATING.has(req.method) && !eq(req.headers["x-jarvis-csrf"], principal.csrf)) {
          audit("authz.csrf_rejected", { route: r.pattern });
          return send(res, 403, { error: "csrf" }, origin);
        }
        const ok = r.access === "session" ? isVerifiedAdmin(principal) : can(principal, r.access);
        if (!ok) {
          audit("authz.denied", { route: r.pattern, need: r.access, principal: principal.type });
          return send(res, 403, { error: "forbidden", need: r.access }, origin);
        }
      }
      const ct = req.headers["content-type"] || "";
      let body = {}, form = null;
      if (ct.includes("multipart/form-data")) {
        if (Number(req.headers["content-length"] || 0) > MAX_UPLOAD) throw new AuthError(413, "payload_too_large");
        form = await readLimitedForm(req, url, MAX_UPLOAD);
      } else if (req.method !== "GET" && req.method !== "DELETE") body = await readJson(req);
      const m = url.pathname.match(r.re);
      const out = await r.fn({ params: m.groups || {}, query: url.searchParams, body, form, principal, req, res });
      const extra = res.setCookie ? { "set-cookie": res.setCookie } : undefined;
      if (out?.__raw) return send(res, 200, out.__raw, origin, out.__type, extra);
      return send(res, 200, out ?? { ok: true }, origin, "application/json", extra);
    } catch (e) {
      if (e instanceof AuthError || (e && typeof e.status === "number" && typeof e.code === "string")) {
        if (e.status === 413) res.setHeader("connection", "close"); // unread body: never reuse this socket
        const extra = e.retryAfter ? { "retry-after": String(e.retryAfter) } : undefined;
        return send(res, e.status, { error: e.code, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) }, origin, "application/json", extra);
      }
      console.error(`[erro] ${req.method} ${url.pathname}: ${e.message}`); // never logs bodies/headers
      return send(res, 500, { error: "internal_error" }, origin);
    }
  });
}

// ---------- main ----------
const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain && !process.env.JARVIS_NO_LISTEN) {
  const PORT = Number(process.env.JARVIS_PORT || 7777);
  const HOST = process.env.JARVIS_HOST || "127.0.0.1";
  const boot = auth.ensureBootstrap();
  createApp().listen(PORT, HOST, () => {
    console.log(`\n  J.A.R.V.I.S. local ativo em http://${HOST}:${PORT}`);
    console.log("  Painel: http://localhost:8080  (o painel detecta este serviço automaticamente)");
    if (boot) {
      console.log("\n  PRIMEIRO ACESSO: nenhum administrador cadastrado.");
      console.log(`  O código de configuração (uso único, válido por 15 min) está em: ${boot.file}`);
      console.log("  Abra o arquivo, copie o código e cole no painel. Ao reiniciar o serviço, um novo código é gerado.\n");
    }
  });
  setInterval(() => auth.purgeAttempts(), 3600_000).unref();
  startScheduler();
  // P2: inbound messages run as the admin whose own settings hold the channel credentials.
  const activeAdmins = () => db.prepare("SELECT id FROM admins WHERE active = 1").all().map((r) => r.id);
  startTelegramPolling(async (adminId, channel, text) => {
    const principal = { type: "channel", channel, adminId, scopes: ["chat", "web", "memories:read"] }; // no host/comms from an inbound message
    await Promise.all(triggerByText("message", text, adminId));
    const r = await runAgent({ messages: [{ role: "user", content: text }], autonomy: "confirm", principal });
    await sendMessage(adminId, channel, r.reply + (r.pending.length ? "\n\n(Há uma ação aguardando sua aprovação no painel.)" : ""));
  }, activeAdmins);
}
