// Fase G — auditoria de alterações de agentes (ator, item e estado resultante; nunca o conteúdo)
// e confirmação de que o template embutido não oferece send_message nem escopos admin-only.
// Banco TEMPORÁRIO (JARVIS_DATA_DIR): nunca toca o banco ativo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-agent-audit-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { DEFAULT_AGENT } = await import("../server/llm.js");
const { TOOL_SCOPES, ADMIN_ONLY } = await import("../server/auth.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let server, base, adminId, S;
let agentId = null;

const req = (path, { method = "GET", body, s } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(s ? { cookie: s.cookie, "x-jarvis-csrf": s.csrf } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const events = (kind) =>
  db
    .prepare("SELECT detail FROM audit WHERE kind = ? ORDER BY id")
    .all(kind)
    .map((r) => JSON.parse(r.detail));

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  adminId = db.prepare("SELECT id FROM admins WHERE active = 1").get().id;
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username: "ana", password: PW },
  });
  const j = await r.json();
  S = { cookie: r.headers.get("set-cookie").split(";")[0], csrf: j.csrf };
});
after(async () => {
  await new Promise((r) => server.close(r));
});

test("template embutido: sem send_message; ferramentas nunca dependem de escopo admin-only", () => {
  assert.equal(
    DEFAULT_AGENT.tools.includes("send_message"),
    false,
    "send_message fora do template",
  );
  assert.deepEqual(DEFAULT_AGENT.tools, [
    "web_search",
    "fetch_url",
    "remember",
    "recall",
    "run_command",
    "cli_agent",
    "document_search",
    "rea_analyze",
    "gigabrain_recall",
    "gigabrain_remember",
  ]);
  for (const t of DEFAULT_AGENT.tools) {
    const scope = TOOL_SCOPES[t];
    assert.ok(scope, `escopo declarado para ${t}`);
    assert.equal(
      ADMIN_ONLY.includes(scope),
      false,
      `${t} não pode exigir escopo admin-only (${scope})`,
    );
  }
});

test("POST /api/agents cria e audita agent.created (ator + item; sem conteúdo)", async () => {
  const r = await req("/api/agents", {
    method: "POST",
    body: {
      name: "Auxiliar",
      provider: "ollama",
      model: "qwen2.5:7b",
      instructions: "texto-livre-que-nao-vai-para-a-auditoria",
      tools: ["remember"],
    },
    s: S,
  });
  assert.equal(r.status, 200);
  const saved = await r.json();
  agentId = saved.id;
  assert.deepEqual(events("agent.created"), [{ admin: adminId, type: "agent", ids: [saved.id] }]);
  const all = db
    .prepare("SELECT detail FROM audit")
    .all()
    .map((x) => x.detail)
    .join("\n");
  assert.equal(
    all.includes("texto-livre-que-nao-vai-para-a-auditoria"),
    false,
    "conteúdo do agente nunca entra na auditoria",
  );
});

test("PUT registra agent.updated com o estado resultante (desativação e reativação)", async () => {
  const off = await req(`/api/agents/${agentId}`, { method: "PUT", body: { active: false }, s: S });
  assert.equal(off.status, 200);
  const on = await req(`/api/agents/${agentId}`, { method: "PUT", body: { active: true }, s: S });
  assert.equal(on.status, 200);
  assert.deepEqual(events("agent.updated"), [
    { admin: adminId, type: "agent", ids: [agentId], status: "inactive" },
    { admin: adminId, type: "agent", ids: [agentId], status: "active" },
  ]);
});

test("DELETE audita agent.deleted e libera a propriedade; id desconhecido não fabrica evento", async () => {
  const bad = await req("/api/agents/nao-existe", { method: "DELETE", s: S });
  assert.equal(bad.status, 404);
  assert.equal(
    events("agent.deleted").length,
    0,
    "tentativa inválida não gera evento (sem histórico retroativo)",
  );
  const del = await req(`/api/agents/${agentId}`, { method: "DELETE", s: S });
  assert.equal(del.status, 200);
  assert.deepEqual(events("agent.deleted"), [{ admin: adminId, type: "agent", ids: [agentId] }]);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) n FROM ownership WHERE resource_type='agent' AND resource_id=?")
      .get(agentId).n,
    0,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agents WHERE id=?").get(agentId).n, 0);
  for (const kind of ["agent.created", "agent.updated", "agent.deleted"]) {
    for (const d of events(kind))
      assert.equal("dropped" in d, false, "nenhum campo do evento foi descartado pela sanitização");
  }
});
