import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../server/migrations.js";
import { createAuth, can, isVerifiedAdmin, IDLE_MS, ABSOLUTE_MS, BOOTSTRAP_TTL_MS } from "../server/auth.js";

const PW = "senha-muito-forte-1";
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-auth-"));
  const db = new DatabaseSync(join(dir, "jarvis.db"));
  migrate(db, dir);
  const clock = { t: 1_800_000_000_000 };
  const events = [];
  const auth = createAuth(db, { dataDir: dir, clock: () => clock.t, audit: (k, d) => events.push([k, JSON.stringify(d)]) });
  return { db, dir, clock, auth, events };
}
const firstAdmin = (ctx) => {
  const { token } = ctx.auth.ensureBootstrap();
  return ctx.auth.setupFirstAdmin({ token, username: "ana", password: PW });
};

test("bootstrap token: random, file is owner-only, never stored in clear", () => {
  const ctx = setup();
  const a = ctx.auth.ensureBootstrap();
  assert.match(a.token, /^jbt_[A-Za-z0-9_-]{43}$/);
  assert.equal(readFileSync(a.file, "utf8").trim(), a.token);
  if (process.platform !== "win32") assert.equal(statSync(a.file).mode & 0o777, 0o600);
  assert.equal(ctx.db.prepare("SELECT token_hash FROM bootstrap").get().token_hash.includes(a.token), false);
  const b = ctx.auth.ensureBootstrap();
  assert.notEqual(a.token, b.token);
  assert.throws(() => ctx.auth.setupFirstAdmin({ token: a.token, username: "ana", password: PW }), { code: "invalid_bootstrap_token" });
});

test("bootstrap rejects missing/wrong/expired token and weak password", () => {
  const ctx = setup();
  const { token } = ctx.auth.ensureBootstrap();
  assert.throws(() => ctx.auth.setupFirstAdmin({ username: "ana", password: PW }), { status: 403 });
  assert.throws(() => ctx.auth.setupFirstAdmin({ token: "jbt_x", username: "ana", password: PW }), { status: 403 });
  assert.throws(() => ctx.auth.setupFirstAdmin({ token, username: "ana", password: "curta" }), { code: "weak_password" });
  ctx.clock.t += BOOTSTRAP_TTL_MS + 1;
  assert.throws(() => ctx.auth.setupFirstAdmin({ token, username: "ana", password: PW }), { code: "bootstrap_token_expired" });
  assert.equal(ctx.auth.setupRequired(), true);
});

test("bootstrap is single-use: token consumed, file removed, setup closed", () => {
  const ctx = setup();
  const { token, file } = ctx.auth.ensureBootstrap();
  ctx.auth.setupFirstAdmin({ token, username: "ana", password: PW });
  assert.equal(existsSync(file), false);
  assert.equal(ctx.auth.setupRequired(), false);
  assert.throws(() => ctx.auth.setupFirstAdmin({ token, username: "bia", password: PW }), { code: "setup_closed" });
  assert.equal(ctx.auth.ensureBootstrap(), null);
});

test("concurrent bootstrap from two connections creates exactly one admin", () => {
  const ctx = setup();
  const { token } = ctx.auth.ensureBootstrap();
  const db2 = new DatabaseSync(join(ctx.dir, "jarvis.db"));
  db2.exec("PRAGMA busy_timeout = 2000");
  const auth2 = createAuth(db2, { clock: () => ctx.clock.t });
  ctx.db.exec("BEGIN IMMEDIATE"); // connection 1 holds the write lock
  ctx.db.exec("ROLLBACK");
  const results = [() => ctx.auth.setupFirstAdmin({ token, username: "ana", password: PW }), () => auth2.setupFirstAdmin({ token, username: "bia", password: PW })]
    .map((f) => { try { return f(); } catch (e) { return e; } });
  assert.equal(results.filter((r) => r.id).length, 1);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM admins").get().n, 1);
});

test("second admin needs re-auth; third admin is refused", () => {
  const ctx = setup();
  const a = firstAdmin(ctx);
  assert.throws(() => ctx.auth.createAdmin({ adminId: a.id }, { username: "bia", password: PW, currentPassword: "errada" }), { code: "reauth_failed" });
  ctx.auth.createAdmin({ adminId: a.id }, { username: "bia", password: PW, currentPassword: PW });
  assert.throws(() => ctx.auth.createAdmin({ adminId: a.id }, { username: "caio", password: PW, currentPassword: PW }), { code: "admin_limit_reached" });
});

test("last active admin cannot be removed; removing one revokes its sessions", () => {
  const ctx = setup();
  const a = firstAdmin(ctx);
  assert.throws(() => ctx.auth.removeAdmin({ adminId: a.id }, a.id), { code: "last_admin_protected" });
  const b = ctx.auth.createAdmin({ adminId: a.id }, { username: "bia", password: PW, currentPassword: PW });
  const s = ctx.auth.login({ username: "bia", password: PW, ip: "1" });
  ctx.auth.removeAdmin({ adminId: a.id }, b.id);
  assert.equal(ctx.auth.validateSession(s.sid), null);
  assert.throws(() => ctx.auth.login({ username: "bia", password: PW, ip: "1" }), { code: "invalid_credentials" });
});

test("login: generic error, unknown user indistinguishable, sid rotated, stored hashed", () => {
  const ctx = setup();
  firstAdmin(ctx);
  const e1 = (() => { try { ctx.auth.login({ username: "ana", password: "x", ip: "9" }); } catch (e) { return e; } })();
  const e2 = (() => { try { ctx.auth.login({ username: "ninguem", password: "x", ip: "8" }); } catch (e) { return e; } })();
  assert.deepEqual([e1.status, e1.code], [401, "invalid_credentials"]);
  assert.deepEqual([e2.status, e2.code], [401, "invalid_credentials"]);
  const s1 = ctx.auth.login({ username: "ANA", password: PW, ip: "1" });
  const s2 = ctx.auth.login({ username: "ana", password: PW, ip: "1", previousSid: s1.sid });
  assert.notEqual(s1.sid, s2.sid);
  assert.equal(ctx.auth.validateSession(s1.sid), null); // old id revoked on rotation
  assert.ok(ctx.auth.validateSession(s2.sid));
  const dump = JSON.stringify(ctx.db.prepare("SELECT * FROM sessions").all()) + JSON.stringify(ctx.events);
  assert.equal(dump.includes(s2.sid), false);
  assert.equal(dump.includes(PW), false);
});

test("sessions expire on inactivity (30 min) and absolute lifetime (12 h); logout revokes", () => {
  const ctx = setup();
  firstAdmin(ctx);
  const s = ctx.auth.login({ username: "ana", password: PW, ip: "1" });
  ctx.clock.t += IDLE_MS - 1000;
  assert.ok(ctx.auth.validateSession(s.sid)); // sliding
  ctx.clock.t += IDLE_MS + 1;
  assert.equal(ctx.auth.validateSession(s.sid), null);

  const s2 = ctx.auth.login({ username: "ana", password: PW, ip: "1" });
  for (let i = 0; i < 30; i++) { ctx.clock.t += 25 * 60_000; ctx.auth.validateSession(s2.sid); }
  assert.ok(ctx.clock.t > 1_800_000_000_000 + ABSOLUTE_MS);
  assert.equal(ctx.auth.validateSession(s2.sid), null);

  const s3 = ctx.auth.login({ username: "ana", password: PW, ip: "1" });
  ctx.auth.revokeSession(s3.sid);
  assert.equal(ctx.auth.validateSession(s3.sid), null);
});

test("rate limit: progressive delay, lockout after 5, recovers after window", () => {
  const ctx = setup();
  firstAdmin(ctx);
  const fail = () => { try { ctx.auth.login({ username: "ana", password: "x", ip: "10.0.0.1" }); } catch (e) { return e; } };
  assert.equal(fail().code, "invalid_credentials");
  const locked = fail(); // within the 1 s delay window
  assert.equal(locked.code, "too_many_attempts");
  for (let i = 0; i < 4; i++) { ctx.clock.t += 16_000; fail(); }
  const e = fail();
  assert.equal(e.code, "too_many_attempts");
  assert.ok(e.retryAfter > 200 && e.retryAfter <= 300);
  // even the right password is refused while locked
  assert.throws(() => ctx.auth.login({ username: "ana", password: PW, ip: "10.0.0.1" }), { code: "too_many_attempts" });
  ctx.clock.t += 5 * 60_000 + 1;
  assert.ok(ctx.auth.login({ username: "ana", password: PW, ip: "10.0.0.1" }).sid);
});

test("rate limit: an attacker on another source cannot lock the admin out", () => {
  const ctx = setup();
  firstAdmin(ctx);
  for (let i = 0; i < 6; i++) { ctx.clock.t += 16_000; try { ctx.auth.login({ username: "ana", password: "x", ip: "evil" }); } catch {} }
  assert.ok(ctx.auth.login({ username: "ana", password: PW, ip: "legit" }).sid);
});

const adminSession = (ctx) => {
  firstAdmin(ctx);
  const { sid } = ctx.auth.login({ username: "ana", password: PW, ip: "127.0.0.1" });
  return { sid, p: ctx.auth.validateSession(sid) };
};

test("service tokens: scoped, shown once, revocable, admin-only scopes never granted", () => {
  const ctx = setup();
  const { p: admin } = adminSession(ctx);
  const a = { id: admin.adminId };
  assert.throws(() => ctx.auth.createServiceToken(admin, { name: "x", scopes: ["approvals:resolve"] }), { code: "admin_scope_forbidden" });
  assert.throws(() => ctx.auth.createServiceToken(admin, { name: "x", scopes: [] }), { code: "invalid_scopes" });
  const t = ctx.auth.createServiceToken(admin, { name: "mcp", scopes: ["memories:read"] });
  const p = ctx.auth.validateServiceToken(t.token);
  assert.equal(can(p, "memories:read"), true);
  assert.equal(can(p, "memories:write"), false);
  assert.equal(can(p, "host:run"), false);
  assert.equal(can(p, "approvals:resolve"), false);
  assert.equal(JSON.stringify(ctx.db.prepare("SELECT * FROM service_tokens").all()).includes(t.token), false);
  ctx.auth.revokeServiceToken({ adminId: a.id }, t.id);
  assert.equal(ctx.auth.validateServiceToken(t.token), null);
});

test("can(): no principal → denied; real admin session → allowed", () => {
  assert.equal(can(null, "chat"), false);
  const { p } = adminSession(setup());
  for (const s of ["approvals:resolve", "host:run", "chat"]) assert.equal(can(p, s), true, s);
  assert.equal(isVerifiedAdmin(p), true);
});

test("can(): wildcard is ignored for any non-admin principal", () => {
  for (const type of ["bot", "channel", "service", undefined]) {
    const p = { type, adminId: type === "bot" ? "a1" : null, scopes: ["*"] };
    assert.equal(can(p, "host:run"), false, `${type} host:run`);
    assert.equal(can(p, "approvals:resolve"), false, `${type} approvals`);
    assert.equal(can(p, "chat"), false, `${type} chat`);
  }
  assert.equal(can({ type: "admin", adminId: null, scopes: ["*"] }, "chat"), false);
  assert.equal(can({ type: "admin", adminId: "a1" }, "chat"), false);
});

test("local recovery script: disables admins, revokes sessions, reopens setup, keeps data", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "jarvis-rec-"));
  const env = { ...process.env, JARVIS_DATA_DIR: dir };
  const script = `
    const { auth, db } = await import("./server/db.js");
    const { token } = auth.ensureBootstrap();
    auth.setupFirstAdmin({ token, username: "ana", password: "${PW}" });
    db.prepare("INSERT INTO memories (id, content, created_at) VALUES ('m','fato','x')").run();
    const s = auth.login({ username: "ana", password: "${PW}", ip: "1" });
    process.stdout.write(s.sid);`;
  const sid = execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", script], { env, cwd: new URL("..", import.meta.url) }).toString().trim().split("\n").pop();
  execFileSync(process.execPath, ["--no-warnings", "server/recuperar-acesso.js"], { env, cwd: new URL("..", import.meta.url) });
  const db = new DatabaseSync(join(dir, "jarvis.db"));
  const a = createAuth(db, {});
  assert.equal(a.setupRequired(), true);
  assert.equal(a.validateSession(sid), null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM memories").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='trg_admins_protect_last_delete'").get().n, 1);
  const { token } = a.ensureBootstrap();
  assert.ok(a.setupFirstAdmin({ token, username: "ana", password: PW }).id); // name reusable
});

test("rate limit (local): shared 127.0.0.1 failures on other accounts never block a valid login", () => {
  const ctx = setup();
  firstAdmin(ctx);
  for (let i = 0; i < 30; i++) { try { ctx.auth.login({ username: `outro${i}`, password: "x", ip: "127.0.0.1" }); } catch {} }
  assert.ok(ctx.auth.login({ username: "ana", password: PW, ip: "127.0.0.1" }).sid);
});

test("rate limit: successful login clears the per-ip counter too (remote source)", () => {
  const ctx = setup();
  firstAdmin(ctx);
  for (let i = 0; i < 19; i++) { try { ctx.auth.login({ username: `u${i}`, password: "x", ip: "10.9.9.9" }); } catch {} }
  assert.ok(ctx.auth.login({ username: "ana", password: PW, ip: "10.9.9.9" }).sid);
  try { ctx.auth.login({ username: "zz", password: "x", ip: "10.9.9.9" }); } catch {}
  assert.ok(ctx.auth.login({ username: "ana", password: PW, ip: "10.9.9.9" }).sid); // would be locked if the counter survived
});

// ---------- Fase 1 hardening: wildcard bound to a verified session ----------
const SENSITIVE = ["host:run", "approvals:resolve", "chat"];

test("forged admin objects never pass, even with every field of a real principal", () => {
  const { p } = adminSession(setup());
  const forged = [
    { type: "admin", adminId: "a1", scopes: ["*"] },
    { type: "admin", adminId: p.adminId, scopes: ["*"] },
    { ...p }, // exact copy of a real principal
    Object.assign(Object.create(Object.getPrototypeOf(p)), p),
    JSON.parse(JSON.stringify(p)),
    { type: "admin", adminId: "", scopes: ["*"] },
    { type: "admin", scopes: ["*"] },
    { type: "admin", adminId: "a1", scopes: ["*"], verified: true, validated: true },
    { type: "admin", adminId: "a1", scopes: "*" },
    { type: "admin", adminId: "a1", scopes: [{}] },
  ];
  for (const f of forged) {
    assert.equal(isVerifiedAdmin(f), false);
    for (const s of SENSITIVE) assert.equal(can(f, s), false, `${JSON.stringify(f)} ${s}`);
  }
  assert.throws(() => { p.scopes.push("x"); });
  assert.throws(() => { "use strict"; p.adminId = "other"; });
});

test("non-human principals with wildcard get nothing; untyped/malformed denied", () => {
  for (const type of ["service", "bot", "channel", undefined, "Admin", "root"]) {
    const x = { type, adminId: "a1", scopes: ["*"] };
    for (const s of [...SENSITIVE, "*"]) assert.equal(can(x, s), false, `${type} ${s}`);
  }
  for (const bad of [{}, { type: "service" }, { type: "service", scopes: "chat" }, { type: "service", scopes: [1] }, "admin", 42])
    assert.equal(can(bad, "chat"), false);
  assert.equal(can({ type: "service", scopes: ["chat"] }, ""), false);
});

test("explicit scopes still work for non-admins; admin-only and literal * stay denied", () => {
  const svc = { type: "service", adminId: "a1", scopes: ["chat", "approvals:resolve", "admins:manage", "*"] };
  assert.equal(can(svc, "chat"), true);
  assert.equal(can(svc, "host:run"), false);
  for (const s of ["approvals:resolve", "admins:manage", "sessions:manage", "tokens:manage", "*"]) assert.equal(can(svc, s), false, s);
});

test("verified principal loses power on logout, idle, absolute expiry and admin deactivation", () => {
  let ctx = setup(); let s = adminSession(ctx);
  ctx.auth.revokeSession(s.sid);
  for (const x of SENSITIVE) assert.equal(can(s.p, x), false, `revoked ${x}`);

  ctx = setup(); s = adminSession(ctx);
  ctx.clock.t += IDLE_MS + 1;
  assert.equal(can(s.p, "host:run"), false, "idle");

  ctx = setup(); s = adminSession(ctx);
  const start = ctx.clock.t;
  while (ctx.clock.t - start < ABSOLUTE_MS - IDLE_MS) { ctx.clock.t += IDLE_MS - 1000; assert.ok(ctx.auth.validateSession(s.sid)); }
  ctx.clock.t = start + ABSOLUTE_MS + 1;
  assert.equal(can(s.p, "approvals:resolve"), false, "absolute");

  ctx = setup(); s = adminSession(ctx);
  ctx.auth.createAdmin(s.p, { username: "bia", password: PW, currentPassword: PW });
  const bia = ctx.auth.validateSession(ctx.auth.login({ username: "bia", password: PW, ip: "127.0.0.1" }).sid);
  assert.equal(can(bia, "host:run"), true);
  ctx.auth.removeAdmin(s.p, bia.adminId);
  for (const x of SENSITIVE) assert.equal(can(bia, x), false, `deactivated ${x}`);
  assert.equal(can(s.p, "host:run"), true, "the other admin is unaffected");
});

test("createServiceToken: rejects wildcard, admin-only, unknown, empty and malformed scopes with specific codes", () => {
  const ctx = setup();
  const { p } = adminSession(ctx);
  const bad = [
    [["*"], "wildcard_scope_forbidden"], [["chat", "*"], "wildcard_scope_forbidden"],
    [["approvals:resolve"], "admin_scope_forbidden"], [["admins:manage"], "admin_scope_forbidden"],
    [["sessions:manage"], "admin_scope_forbidden"], [["tokens:manage"], "admin_scope_forbidden"],
    [["root"], "unknown_scope"], [["chat", "host:everything"], "unknown_scope"],
    [[], "invalid_scopes"], ["chat", "invalid_scopes"], [null, "invalid_scopes"], [undefined, "invalid_scopes"],
    [[1], "invalid_scopes"], [[["chat"]], "invalid_scopes"], [{ 0: "chat", length: 1 }, "invalid_scopes"],
  ];
  for (const [scopes, code] of bad) assert.throws(() => ctx.auth.createServiceToken(p, { name: "x", scopes }), { status: 400, code }, JSON.stringify(scopes));
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM service_tokens").get().n, 0);
});

test("createServiceToken: only a verified live admin session may issue", () => {
  const ctx = setup();
  const { sid, p } = adminSession(ctx);
  for (const actor of [{ adminId: p.adminId }, { ...p }, { type: "admin", adminId: p.adminId, scopes: ["*"] }, null, undefined])
    assert.throws(() => ctx.auth.createServiceToken(actor, { name: "x", scopes: ["chat"] }), { status: 403, code: "admin_session_required" });
  const svc = ctx.auth.validateServiceToken(ctx.auth.createServiceToken(p, { name: "ok", scopes: ["chat"] }).token);
  assert.throws(() => ctx.auth.createServiceToken(svc, { name: "x", scopes: ["chat"] }), { code: "admin_session_required" });
  ctx.auth.revokeSession(sid);
  assert.throws(() => ctx.auth.createServiceToken(p, { name: "x", scopes: ["chat"] }), { code: "admin_session_required" });
});

test("issued service token: exactly its scopes, never admin powers, revocable", () => {
  const ctx = setup();
  const { p } = adminSession(ctx);
  const t = ctx.auth.createServiceToken(p, { name: "mcp", scopes: ["chat", "chat", "web"] });
  assert.deepEqual(t.scopes, ["chat", "web"]);
  assert.match(t.token, /^jst_/);
  const sp = ctx.auth.validateServiceToken(t.token);
  assert.equal(sp.type, "service");
  assert.equal(isVerifiedAdmin(sp), false);
  assert.equal(can(sp, "chat"), true);
  for (const s of ["host:run", "approvals:resolve", "admins:manage", "tokens:manage", "*"]) assert.equal(can(sp, s), false, s);
  assert.equal(JSON.stringify(ctx.db.prepare("SELECT * FROM service_tokens").all()).includes(t.token), false);
  ctx.auth.revokeServiceToken(p, t.id);
  assert.equal(ctx.auth.validateServiceToken(t.token), null);
});
