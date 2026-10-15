// Authentication & authorization core. Pure functions over a DatabaseSync handle and a clock,
// so every rule is unit-testable. Secrets are stored only as hashes; nothing here logs them.
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

export const IDLE_MS = 30 * 60 * 1000; // 30 min without activity
export const ABSOLUTE_MS = 12 * 60 * 60 * 1000; // 12 h max lifetime
export const BOOTSTRAP_TTL_MS = 15 * 60 * 1000;
export const MAX_ADMINS = 2;
export const MIN_PASSWORD = 12;

/** Scopes a service token may hold. Admin sessions implicitly have all of them. */
export const SCOPES = [
  "chat", "memories:read", "memories:write", "agents:read", "agents:write", "bots:read", "bots:write",
  "bots:run", "settings:read", "settings:write", "voice", "web", "host:run", "comms:read", "comms:send", "audit:read",
];
/** Scopes reserved for a human admin session — never grantable to a token. */
export const ADMIN_ONLY = ["approvals:resolve", "admins:manage", "sessions:manage", "tokens:manage"];

/** Tool → scope needed on the execution path (re-checked at call time). */
export const TOOL_SCOPES = {
  web_search: "web", fetch_url: "web", remember: "memories:write", recall: "memories:read",
  run_command: "host:run", cli_agent: "host:run", send_message: "comms:send", send_email: "comms:send",
  read_email: "comms:read", read_calendar: "comms:read",
};

/** Loopback sources (all local processes look identical here). */
export const isLoopback = (ip = "") => /^(127\.|::1$|::ffff:127\.)/.test(String(ip)) || ip === "localhost";

/** Scopes a bot may be granted explicitly (least privilege; never admin-only ones). */
export const BOT_SCOPES = ["web", "memories:read", "memories:write", "host:run", "comms:read", "comms:send"];
/** Documented compatibility policy for legacy bots (no owner, no explicit scopes): read-only. */
export const LEGACY_BOT_SCOPES = ["web", "memories:read"];
/** Default for a bot that has no explicit list: nothing beyond reading the web and memory. */
export const DEFAULT_BOT_SCOPES = ["web", "memories:read"];
/** Sanitize a bot's requested scopes: only known bot scopes, deduplicated. */
export const sanitizeBotScopes = (list) => (Array.isArray(list) ? [...new Set(list.filter((s) => BOT_SCOPES.includes(s)))] : null);
/** Effective scopes for a bot run. Never "*". */
export function resolveBotScopes(bot) {
  const explicit = sanitizeBotScopes(bot?.scopes);
  if (explicit) return explicit;
  return bot?.owner_admin_id ? DEFAULT_BOT_SCOPES : LEGACY_BOT_SCOPES;
}

// ---------- verified-admin capability ----------
// A principal only counts as a human admin if THIS module issued it from a validated session.
// The registry is module-private (WeakMap keyed by object identity): callers cannot add entries,
// and copying/spreading/forging an object with the same fields yields a different identity that is
// not registered. Each entry carries a liveness check that re-reads the session and admin row, so
// revocation, expiry, idle timeout or admin deactivation take effect even for an already-issued
// principal. The principal object is frozen so its fields cannot be swapped after issuance.
const VERIFIED = new WeakMap();
/** True only for a principal issued by validateSession() whose session is still live. */
export function isVerifiedAdmin(p) {
  const live = p && typeof p === "object" ? VERIFIED.get(p) : undefined;
  if (!live) return false;
  try { return live() === true; } catch { return false; }
}

const sha = (s) => createHash("sha256").update(s).digest("hex");
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const randomToken = (prefix) => `${prefix}${randomBytes(32).toString("base64url")}`;

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
export function verifyPassword(pw, stored) {
  const [, s, h] = String(stored).split("$");
  if (!s || !h) return false;
  const calc = scryptSync(String(pw), Buffer.from(s, "hex"), 64, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(calc, Buffer.from(h, "hex"));
}
// Used when the account does not exist, so timing does not reveal it.
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

export class AuthError extends Error {
  constructor(status, code, extra = {}) { super(code); this.status = status; this.code = code; Object.assign(this, extra); }
}

function validateCredentials(username, password) {
  if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{3,32}$/.test(username)) throw new AuthError(400, "invalid_username");
  if (typeof password !== "string" || password.length < MIN_PASSWORD || password.length > 256) throw new AuthError(400, "weak_password");
}

export function createAuth(db, { clock = () => Date.now(), dataDir, audit = () => {} } = {}) {
  const adminCount = () => db.prepare("SELECT COUNT(*) AS n FROM admins WHERE active = 1").get().n;
  const tokenFile = dataDir ? join(dataDir, "bootstrap-token.txt") : null;

  // ---------- bootstrap (first admin) ----------
  /** Creates a fresh one-time token if no admin exists. Returns the file path, never the token. */
  function ensureBootstrap() {
    if (adminCount() > 0) { clearBootstrapFile(); return null; }
    const token = randomToken("jbt_");
    db.prepare("INSERT INTO bootstrap (id, token_hash, expires_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at")
      .run(sha(token), clock() + BOOTSTRAP_TTL_MS);
    if (tokenFile) {
      if (existsSync(tokenFile)) unlinkSync(tokenFile);
      writeFileSync(tokenFile, token + "\n", { mode: 0o600, flag: "wx" });
      try { chmodSync(tokenFile, 0o600); } catch { /* Windows: ACL of the user profile applies */ }
    }
    return { file: tokenFile, token };
  }
  function clearBootstrapFile() { if (tokenFile && existsSync(tokenFile)) unlinkSync(tokenFile); }
  const setupRequired = () => adminCount() === 0;

  /** Atomic: validates + consumes the token and inserts admin #1 in one IMMEDIATE transaction. */
  function setupFirstAdmin({ token, username, password }) {
    validateCredentials(username, password);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (adminCount() > 0) throw new AuthError(409, "setup_closed");
      const row = db.prepare("SELECT token_hash, expires_at FROM bootstrap WHERE id = 1").get();
      if (!row || typeof token !== "string" || !safeEq(sha(token), row.token_hash)) throw new AuthError(403, "invalid_bootstrap_token");
      if (clock() > row.expires_at) throw new AuthError(403, "bootstrap_token_expired");
      const id = randomUUID();
      db.prepare("INSERT INTO admins (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(id, username, hashPassword(password), new Date(clock()).toISOString());
      db.prepare("DELETE FROM bootstrap WHERE id = 1").run();
      db.exec("COMMIT");
      clearBootstrapFile();
      audit("auth.setup_first_admin", { admin: id, username });
      return { id, username };
    } catch (e) {
      db.exec("ROLLBACK");
      if (e.status) audit("auth.setup_denied", { reason: e.code });
      throw e;
    }
  }

  // ---------- admins ----------
  function createAdmin(actor, { username, password, currentPassword }) {
    validateCredentials(username, password);
    const me = db.prepare("SELECT password_hash FROM admins WHERE id = ? AND active = 1").get(actor.adminId);
    if (!me || !verifyPassword(currentPassword || "", me.password_hash)) throw new AuthError(403, "reauth_failed");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (adminCount() >= MAX_ADMINS) throw new AuthError(409, "admin_limit_reached");
      const id = randomUUID();
      db.prepare("INSERT INTO admins (id, username, password_hash, created_at, created_by) VALUES (?, ?, ?, ?, ?)").run(id, username, hashPassword(password), new Date(clock()).toISOString(), actor.adminId);
      db.exec("COMMIT");
      audit("auth.admin_created", { by: actor.adminId, admin: id, username });
      return { id, username };
    } catch (e) {
      db.exec("ROLLBACK");
      if (/admin_limit_reached/.test(e.message)) throw new AuthError(409, "admin_limit_reached");
      if (/UNIQUE/.test(e.message)) throw new AuthError(409, "username_taken");
      throw e;
    }
  }
  function removeAdmin(actor, id) {
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare("UPDATE sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL").run(clock(), id);
      db.prepare("UPDATE service_tokens SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL").run(clock(), id);
      db.prepare("UPDATE admins SET active = 0, username = username || '#off-' || ? WHERE id = ? AND active = 1").run(String(clock()), id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      if (/last_admin_protected/.test(e.message)) throw new AuthError(409, "last_admin_protected");
      throw e;
    }
    audit("auth.admin_disabled", { by: actor.adminId, admin: id });
    return { ok: true };
  }
  const listAdmins = () => db.prepare("SELECT id, username, active, created_at, created_by FROM admins ORDER BY created_at").all();

  // ---------- login throttling ----------
  // (ip+account) gets progressive delay & 5-min lockout after 5 failures; the account alone only
  // gets a capped delay (max 60 s) so nobody can lock the admin out for long. A per-IP rule exists
  // ONLY for non-loopback sources: locally every process shares 127.0.0.1, so a shared counter
  // would let failures on one account block every other local login. A successful login clears
  // all counters it touched (pair, account and ip).
  const delayFor = (n) => (n <= 0 ? 0 : n >= 5 ? 5 * 60_000 : Math.min(15_000, 1000 * 2 ** (n - 1)));
  const rules = [
    { k: (ip, u) => `pair:${ip}|${u}`, delay: delayFor },
    { k: (ip) => `ip:${ip}`, delay: (n) => (n >= 20 ? 5 * 60_000 : 0), remoteOnly: true },
    { k: (_ip, u) => `acct:${u}`, delay: (n) => (n >= 10 ? Math.min(60_000, 1000 * (n - 9)) : 0) },
  ];
  const applies = (r, ip) => !(r.remoteOnly && isLoopback(ip));
  function lockedFor(ip, user) {
    const t = clock();
    let wait = 0;
    for (const r of rules.filter((x) => applies(x, ip))) {
      const row = db.prepare("SELECT locked_until FROM login_attempts WHERE key = ?").get(r.k(ip, user));
      if (row && row.locked_until > t) wait = Math.max(wait, row.locked_until - t);
    }
    return wait;
  }
  function recordFailure(ip, user) {
    const t = clock();
    for (const r of rules.filter((x) => applies(x, ip))) {
      const key = r.k(ip, user);
      const row = db.prepare("SELECT failures FROM login_attempts WHERE key = ?").get(key);
      const n = (row?.failures || 0) + 1;
      db.prepare("INSERT INTO login_attempts (key, failures, locked_until, last_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures, locked_until=excluded.locked_until, last_at=excluded.last_at")
        .run(key, n, t + r.delay(n), t);
    }
  }
  function clearFailures(ip, user) {
    db.prepare("DELETE FROM login_attempts WHERE key IN (?, ?, ?)").run(`pair:${ip}|${user}`, `acct:${user}`, `ip:${ip}`);
  }
  /** Drop throttling rows older than 24 h (retention). */
  const purgeAttempts = () => db.prepare("DELETE FROM login_attempts WHERE last_at < ? AND locked_until < ?").run(clock() - 86_400_000, clock());

  // ---------- sessions ----------
  function login({ username, password, ip = "?", userAgent = "", previousSid }) {
    const user = String(username || "").toLowerCase().slice(0, 64);
    const wait = lockedFor(ip, user);
    if (wait > 0) { audit("auth.login_throttled", { username: user }); throw new AuthError(429, "too_many_attempts", { retryAfter: Math.ceil(wait / 1000) }); }
    const row = db.prepare("SELECT id, username, password_hash FROM admins WHERE username = ? AND active = 1").get(user);
    const ok = verifyPassword(String(password || ""), row ? row.password_hash : DUMMY_HASH) && !!row;
    if (!ok) { recordFailure(ip, user); audit("auth.login_failed", { username: user }); throw new AuthError(401, "invalid_credentials"); }
    clearFailures(ip, user);
    if (previousSid) revokeSession(previousSid); // rotation: never reuse a pre-login id
    const sid = randomToken("jss_");
    const csrf = randomBytes(32).toString("base64url");
    const t = clock();
    db.prepare("INSERT INTO sessions (id_hash, admin_id, csrf, created_at, last_seen, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(sha(sid), row.id, csrf, t, t, t + ABSOLUTE_MS, String(userAgent).slice(0, 200));
    audit("auth.login", { admin: row.id });
    return { sid, csrf, admin: { id: row.id, username: row.username } };
  }
  /** Returns the principal for a session id, sliding the idle window; null when invalid. */
  function validateSession(sid) {
    if (!sid) return null;
    const s = db.prepare("SELECT s.*, a.username, a.active FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.id_hash = ?").get(sha(sid));
    const t = clock();
    if (!s || s.revoked_at || !s.active || t > s.expires_at || t - s.last_seen > IDLE_MS) return null;
    db.prepare("UPDATE sessions SET last_seen = ? WHERE id_hash = ?").run(t, s.id_hash);
    const principal = Object.freeze({ type: "admin", adminId: s.admin_id, username: s.username, csrf: s.csrf, sessionHash: s.id_hash, scopes: Object.freeze(["*"]) });
    const idHash = s.id_hash, adminId = s.admin_id;
    VERIFIED.set(principal, () => {
      const r = db.prepare("SELECT s.revoked_at, s.expires_at, s.last_seen, a.active FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.id_hash = ? AND s.admin_id = ?").get(idHash, adminId);
      const now = clock();
      return !!r && !r.revoked_at && !!r.active && now <= r.expires_at && now - r.last_seen <= IDLE_MS;
    });
    return principal;
  }
  function revokeSession(sid) { db.prepare("UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL").run(clock(), sha(sid)); }
  const listSessions = (adminId) => db.prepare("SELECT substr(id_hash,1,12) AS id, created_at, last_seen, expires_at, user_agent FROM sessions WHERE admin_id = ? AND revoked_at IS NULL AND expires_at > ? AND last_seen > ? ORDER BY last_seen DESC").all(adminId, clock(), clock() - IDLE_MS);
  function revokeSessionById(adminId, shortId) {
    const r = db.prepare("UPDATE sessions SET revoked_at = ? WHERE admin_id = ? AND substr(id_hash,1,12) = ? AND revoked_at IS NULL").run(clock(), adminId, String(shortId));
    audit("auth.session_revoked", { admin: adminId });
    return { ok: r.changes > 0 };
  }

  // ---------- service tokens (MCP / scripts) ----------
  function createServiceToken(actor, { name, scopes } = {}) {
    if (!isVerifiedAdmin(actor)) throw new AuthError(403, "admin_session_required");
    if (!Array.isArray(scopes) || !scopes.length || scopes.some((s) => typeof s !== "string")) throw new AuthError(400, "invalid_scopes");
    if (scopes.includes("*")) throw new AuthError(400, "wildcard_scope_forbidden");
    if (scopes.some((s) => ADMIN_ONLY.includes(s))) throw new AuthError(400, "admin_scope_forbidden");
    const list = [...new Set(scopes)];
    if (list.some((s) => !SCOPES.includes(s))) throw new AuthError(400, "unknown_scope");
    const token = randomToken("jst_");
    const id = randomUUID();
    db.prepare("INSERT INTO service_tokens (id, name, token_hash, scopes, admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, String(name || "token").slice(0, 60), sha(token), list.join(" "), actor.adminId, clock());
    audit("auth.token_created", { by: actor.adminId, token: id, scopes: list });
    return { id, token, scopes: list }; // token shown once
  }
  function validateServiceToken(token) {
    if (!token || !String(token).startsWith("jst_")) return null;
    const r = db.prepare("SELECT t.*, a.active FROM service_tokens t JOIN admins a ON a.id = t.admin_id WHERE token_hash = ?").get(sha(token));
    if (!r || r.revoked_at || !r.active) return null;
    db.prepare("UPDATE service_tokens SET last_used = ? WHERE id = ?").run(clock(), r.id);
    return { type: "service", tokenId: r.id, adminId: r.admin_id, scopes: r.scopes.split(" ") };
  }
  const listServiceTokens = () => db.prepare("SELECT id, name, scopes, admin_id, created_at, last_used FROM service_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC").all();
  function revokeServiceToken(actor, id) {
    db.prepare("UPDATE service_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(clock(), id);
    audit("auth.token_revoked", { by: actor.adminId, token: id });
    return { ok: true };
  }

  return {
    ensureBootstrap, setupRequired, setupFirstAdmin, createAdmin, removeAdmin, listAdmins,
    login, validateSession, revokeSession, listSessions, revokeSessionById, purgeAttempts,
    createServiceToken, validateServiceToken, listServiceTokens, revokeServiceToken,
  };
}

/** Authorization check used on every route and on every tool call. */
// Deny by default. The "*" wildcard and admin-only scopes are honoured ONLY for a principal
// issued by validateSession() whose session is still live (isVerifiedAdmin). A forged or copied
// object with type "admin" / adminId / "*" gets nothing; an unverified "admin" gets nothing at all.
// Non-admin principals (service tokens, bots, channels) get exactly their explicit scopes.
export function can(principal, scope) {
  if (!principal || typeof principal !== "object" || typeof scope !== "string" || !scope) return false;
  if (!Array.isArray(principal.scopes) || principal.scopes.some((s) => typeof s !== "string")) return false;
  if (isVerifiedAdmin(principal)) return true;
  if (principal.type === "admin") return false; // claims admin but was not issued by a live session
  if (!["service", "bot", "channel"].includes(principal.type)) return false;
  if (scope === "*" || ADMIN_ONLY.includes(scope)) return false;
  return principal.scopes.includes(scope);
}
