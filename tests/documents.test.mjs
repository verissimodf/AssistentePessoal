// Phase 3 — private local document store (TXT). Owner-scoped storage, validation, search, delete.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-doc-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
process.env.JARVIS_MAX_DOCUMENT = "1000";
const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { callTool } = await import("../server/tools.js");
const { ownerOf } = await import("../server/ownership.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let server, base;
const A = {},
  B = {};

const req = (path, { method = "GET", body, s, bearer } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(s ? { cookie: s.cookie, "x-jarvis-csrf": s.csrf } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const json = async (r) => ({ status: r.status, body: await r.json() });
async function login(u, target) {
  const r = await req("/api/auth/login", { method: "POST", body: { username: u, password: PW } });
  assert.equal(r.status, 200);
  const j = await r.json();
  Object.assign(target, {
    cookie: r.headers.get("set-cookie").split(";")[0],
    csrf: j.csrf,
    id: j.admin.id,
  });
  target.principal = auth.validateSession(target.cookie.split("=")[1]);
}

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  await login("ana", A);
  assert.equal(
    (
      await req("/api/auth/admins", {
        method: "POST",
        body: { username: "bia", password: PW, currentPassword: PW },
        s: A,
      })
    ).status,
    200,
  );
  await login("bia", B);
});
after(() => server.close());

const SECRET = "segredo-documental-da-ana";

test("documents: owner stores and reads their own; the other admin sees nothing", async () => {
  const d = await json(
    await req("/api/documents", {
      method: "POST",
      body: { name: "notas.txt", mime: "text/plain", content: `conteudo ${SECRET}` },
      s: A,
    }),
  );
  assert.equal(d.status, 200);
  assert.equal(ownerOf("document", d.body.id), A.id);
  assert.equal(
    (await json(await req("/api/documents", { s: A }))).body.some((x) => x.id === d.body.id),
    true,
  );
  assert.equal(
    (await json(await req("/api/documents", { s: B }))).body.some((x) => x.id === d.body.id),
    false,
  );
  const full = await json(await req(`/api/documents/${d.body.id}`, { s: A }));
  assert.equal(full.status, 200);
  assert.match(full.body.content, new RegExp(SECRET));
  assert.equal((await req(`/api/documents/${d.body.id}`, { s: B })).status, 404);
  assert.equal(
    (await json(await req("/api/documents/search?q=documental", { s: B }))).body.length,
    0,
  );
  assert.ok(
    (await json(await req("/api/documents/search?q=documental", { s: A }))).body.length >= 1,
  );
});

test("documents: invalid inputs are rejected (type, empty, oversize, binary, name)", async () => {
  const post = (body) => req("/api/documents", { method: "POST", body, s: A });
  assert.equal((await post({ name: "x.png", mime: "image/png", content: "png" })).status, 415);
  assert.equal(
    (await post({ name: "x.pdf", mime: "application/pdf", content: "%PDF" })).status,
    400,
  ); // invalid signature
  assert.equal((await post({ name: "v.txt", mime: "text/plain", content: "" })).status, 400);
  assert.equal(
    (await post({ name: "g.txt", mime: "text/plain", content: "a".repeat(2000) })).status,
    413,
  );
  assert.equal(
    (await post({ name: "b.txt", mime: "text/plain", content: "abc\u0000def" })).status,
    400,
  );
  assert.equal((await post({ name: "", mime: "text/plain", content: "x" })).status, 400);
});

test("documents: delete removes row, ownership and file", async () => {
  const d = (
    await json(
      await req("/api/documents", {
        method: "POST",
        body: { name: "tmp.txt", mime: "text/plain", content: "apagar" },
        s: A,
      }),
    )
  ).body;
  const path = db.prepare("SELECT path FROM documents WHERE id=?").get(d.id).path;
  assert.equal(existsSync(path), true);
  assert.equal((await req(`/api/documents/${d.id}`, { method: "DELETE", s: B })).status, 404); // foreign → 404
  assert.equal((await req(`/api/documents/${d.id}`, { method: "DELETE", s: A })).status, 200);
  assert.equal(db.prepare("SELECT 1 FROM documents WHERE id=?").get(d.id), undefined);
  assert.equal(ownerOf("document", d.id), null);
  assert.equal(existsSync(path), false);
});

test("documents: document_search tool is scoped to the owner's documents", async () => {
  await req("/api/documents", {
    method: "POST",
    body: { name: "plano.txt", mime: "text/plain", content: "reuniao de arquitetura amanha" },
    s: A,
  });
  const cA = { autonomy: "confirm", pending: [], principal: A.principal };
  const cB = { autonomy: "confirm", pending: [], principal: B.principal };
  assert.match(await callTool("document_search", { query: "arquitetura" }, cA), /plano\.txt/);
  assert.match(await callTool("document_search", { query: "arquitetura" }, cB), /Nenhum documento/);
  const orphan = {
    autonomy: "confirm",
    pending: [],
    principal: { type: "channel", channel: "telegram", adminId: null, scopes: ["documents:read"] },
  };
  assert.match(
    await callTool("document_search", { query: "arquitetura" }, orphan),
    /Permissão negada/,
  );
});

test("documents: a service token needs the documents scope", async () => {
  const { token: noScope } = auth.createServiceToken(A.principal, {
    name: "sem-doc",
    scopes: ["chat"],
  });
  assert.equal((await req("/api/documents", { bearer: noScope })).status, 403);
  const { token: withScope } = auth.createServiceToken(A.principal, {
    name: "com-doc",
    scopes: ["documents:read"],
  });
  assert.equal((await req("/api/documents", { bearer: withScope })).status, 200);
});

test("documents: untrusted content is stored and returned verbatim, never executed", async () => {
  const payload = "$(rm -rf /) && `id`; <script>alert(1)</script>";
  const d = (
    await json(
      await req("/api/documents", {
        method: "POST",
        body: { name: "inject.txt", mime: "text/plain", content: payload },
        s: A,
      }),
    )
  ).body;
  const full = (await json(await req(`/api/documents/${d.id}`, { s: A }))).body;
  assert.equal(full.content, payload); // returned as data, unchanged
});
