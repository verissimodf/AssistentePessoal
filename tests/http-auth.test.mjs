// End-to-end: boots the real service on an ephemeral port with an isolated data dir.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-http-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
process.env.JARVIS_MAX_UPLOAD = "200000";
const { createApp, routeTable } = await import("../server/index.js");
const { auth } = await import("../server/db.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let server, base;
before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const req = (path, { method = "GET", body, cookie, csrf, bearer, origin = ORIGIN } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-jarvis-csrf": csrf } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

let session; // { cookie, csrf }

test("health is public and minimal", async () => {
  const r = await req("/api/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  // Contrato explícito: nenhum campo fora destes (nada de segredo, dono, config ou dado de sessão).
  assert.deepEqual(Object.keys(body).sort(), ["buildTime", "commit", "mode", "ok", "setupRequired", "version"]);
  // Identidade de build injetada pelo build, nunca adivinhada em runtime.
  for (const k of ["version", "commit", "buildTime", "mode"]) assert.equal(typeof body[k], "string", k);
});

test("every non-public route rejects anonymous callers with 401", async () => {
  const publicOnes = routeTable().filter((r) => r.access === "public").map((r) => `${r.method} ${r.pattern}`);
  assert.deepEqual(publicOnes.sort(), ["GET /api/health", "POST /api/auth/login", "POST /api/auth/setup"]);
  for (const r of routeTable().filter((x) => x.access !== "public")) {
    const path = r.pattern.replace(/:(\w+)/g, "x");
    const res = await req(path, { method: r.method, body: r.method === "GET" || r.method === "DELETE" ? undefined : {} });
    assert.equal(res.status, 401, `${r.method} ${r.pattern}`);
  }
});

test("untrusted origin is refused even for public routes", async () => {
  assert.equal((await req("/api/health", { origin: "https://evil.example" })).status, 403);
});

test("concurrent bootstrap attempts produce exactly one admin", async () => {
  const { token, file } = auth.ensureBootstrap();
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => req("/api/auth/setup", { method: "POST", body: { token, username: `adm${i}`, password: PW } })),
  );
  const codes = results.map((r) => r.status);
  assert.equal(codes.filter((c) => c === 200).length, 1, String(codes));
  assert.ok(codes.every((c) => c === 200 || c === 409 || c === 403));
  assert.equal(existsSync(file), false);
  assert.equal(auth.listAdmins().length, 1);
  // reuse after success is refused
  assert.equal((await req("/api/auth/setup", { method: "POST", body: { token, username: "x9x", password: PW } })).status, 409);
});

test("login sets HttpOnly SameSite=Strict cookie and returns CSRF token", async () => {
  const username = auth.listAdmins()[0].username;
  const r = await req("/api/auth/login", { method: "POST", body: { username, password: PW } });
  assert.equal(r.status, 200);
  const sc = r.headers.get("set-cookie");
  assert.match(sc, /jarvis_sid=jss_/);
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  const { csrf } = await r.json();
  session = { cookie: sc.split(";")[0], csrf };
  assert.equal((await req("/api/settings", { cookie: session.cookie })).status, 200);
});

test("CSRF: state-changing requests without/with wrong token are refused (logout included)", async () => {
  const body = { content: "teste csrf" };
  assert.equal((await req("/api/memories", { method: "POST", body, cookie: session.cookie })).status, 403);
  assert.equal((await req("/api/memories", { method: "POST", body, cookie: session.cookie, csrf: "errado" })).status, 403);
  assert.equal((await req("/api/auth/logout", { method: "POST", body: {}, cookie: session.cookie })).status, 403);
  assert.equal((await req("/api/memories", { method: "POST", body, cookie: session.cookie, csrf: session.csrf })).status, 200);
});

test("service token: scope enforced on route; admin-only routes refused; revocation immediate", async () => {
  const mk = await req("/api/auth/tokens", { method: "POST", body: { name: "mcp", scopes: ["memories:read"] }, ...session });
  assert.equal(mk.status, 200);
  const { id, token } = await mk.json();
  assert.equal((await req("/api/memories", { bearer: token })).status, 200);
  assert.equal((await req("/api/memories", { method: "POST", body: { content: "x" }, bearer: token })).status, 403);
  assert.equal((await req("/api/settings", { bearer: token })).status, 403);
  assert.equal((await req("/api/approvals/x", { method: "POST", body: { approve: true }, bearer: token })).status, 403);
  assert.equal((await req("/api/auth/tokens", { method: "POST", body: { name: "y", scopes: ["chat"] }, bearer: token })).status, 403);
  assert.equal((await req(`/api/auth/tokens/${id}`, { method: "DELETE", ...session })).status, 200);
  assert.equal((await req("/api/memories", { bearer: token })).status, 401);
});

test("tool scope is re-checked on the execution path", async () => {
  const { callTool } = await import("../server/tools.js");
  const out = await callTool("run_command", { command: "ls" }, { autonomy: "full", pending: [], principal: { type: "service", tokenId: "t", scopes: ["chat"] } });
  assert.match(out, /Permissão negada/);
  const none = await callTool("recall", { query: "x" }, { autonomy: "full", pending: [] });
  assert.match(none, /Permissão negada/);
});

test("third admin refused over HTTP; bootstrap file contained token only", async () => {
  const add = (u) => req("/api/auth/admins", { method: "POST", body: { username: u, password: PW, currentPassword: PW }, ...session });
  assert.equal((await add("segunda")).status, 200);
  const third = await add("terceira");
  assert.equal(third.status, 409);
  assert.equal((await third.json()).error, "admin_limit_reached");
  assert.equal(readFileSync(join(dir, "jarvis.db")).includes(Buffer.from(PW)), false);
});

test("bots created now record an owner; approvals cannot be resolved twice", async () => {
  const r = await req("/api/bots", { method: "POST", body: { name: "b", goal: "g", enabled: false }, ...session });
  const bot = await r.json();
  assert.equal(bot.owner_admin_id, auth.listAdmins()[0].id);
  const { db } = await import("../server/db.js");
  db.prepare("INSERT INTO approvals (id, command, status, created_at) VALUES ('ap1','echo oi','pending','now')").run();
  // Phase 2: an approval without owner is invisible; give this one a real owner for the race check.
  assert.equal((await req("/api/approvals/ap1", { method: "POST", body: { approve: false }, ...session })).status, 404);
  const { assignNew } = await import("../server/ownership.js");
  assignNew("approval", "ap1", auth.listAdmins()[0].id);
  const [a, b] = await Promise.all([1, 2].map(() => req("/api/approvals/ap1", { method: "POST", body: { approve: false }, ...session })));
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test("bot scopes are sanitized on save: wildcard/admin-only scopes are dropped", async () => {
  const r = await req("/api/bots", { method: "POST", body: { name: "s", goal: "g", enabled: false, scopes: ["*", "approvals:resolve", "web", "comms:send"] }, ...session });
  assert.deepEqual((await r.json()).scopes, ["web", "comms:send"]);
  const d = await req("/api/bots", { method: "POST", body: { name: "d", goal: "g", enabled: false }, ...session });
  assert.deepEqual((await d.json()).scopes, ["web", "memories:read"]);
});

test("upload limit is enforced on bytes read, even without Content-Length (chunked)", async () => {
  const boundary = "----jarvis";
  const head = new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="v.wav"\r\nContent-Type: audio/wav\r\n\r\n`);
  const chunk = new Uint8Array(64 * 1024);
  let sent = 0;
  const body = new ReadableStream({
    pull(c) {
      if (sent === 0) c.enqueue(head);
      if (sent > 600_000) { c.enqueue(new TextEncoder().encode(`\r\n--${boundary}--\r\n`)); return c.close(); }
      sent += chunk.length; c.enqueue(chunk);
    },
  });
  const r = await fetch(base + "/api/voice/clone", {
    method: "POST", duplex: "half", body,
    headers: { origin: ORIGIN, cookie: session.cookie, "x-jarvis-csrf": session.csrf, "content-type": `multipart/form-data; boundary=${boundary}` },
  }).catch((e) => ({ status: "conn-closed:" + e.message }));
  assert.equal(r.status, 413);
});

test("HTTP local throttling: failures on other accounts from 127.0.0.1 do not block a valid login", async () => {
  for (let i = 0; i < 25; i++) await req("/api/auth/login", { method: "POST", body: { username: `fantasma${i}`, password: "errada-errada" } });
  const username = auth.listAdmins()[0].username;
  const ok = await req("/api/auth/login", { method: "POST", body: { username, password: PW } });
  assert.equal(ok.status, 200);
  // and again after more failures (counters touched by the valid login were cleared)
  await req("/api/auth/login", { method: "POST", body: { username: "fantasma-x", password: "errada-errada" } });
  assert.equal((await req("/api/auth/login", { method: "POST", body: { username, password: PW } })).status, 200);
});

test("logout with CSRF revokes the session server-side", async () => {
  const r = await req("/api/auth/logout", { method: "POST", body: {}, ...session });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await req("/api/settings", { cookie: session.cookie })).status, 401);
});

test("HTTP login throttling returns 429 with Retry-After", async () => {
  let last;
  for (let i = 0; i < 3; i++) last = await req("/api/auth/login", { method: "POST", body: { username: "segunda", password: "errada-errada" } });
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) >= 1);
});
