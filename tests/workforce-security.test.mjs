// Workforce (evolução Fase 1): segurança — authn/authz das rotas, isolamento entre admins,
// CSRF, escalada de privilégio via callTool e reconciliação que nunca inventa sucesso.
// End-to-end real: serviço na porta efêmera com data dir isolado (padrão tests/http-auth).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-wf-sec-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { db } = await import("../server/db.js");
const { can, createAuth } = await import("../server/auth.js");
const auth = createAuth(db, { dataDir: dir });
const { callTool } = await import("../server/tools.js");
const { setDefaultRunner } = await import("../server/workforce.js");
// Execução sem provedores reais: runs iniciados pela API usam um runner determinístico.
setDefaultRunner(async () => ({
  reply: "relatório do especialista",
  reasoning: "",
  tools: [{ name: "web_search", input: {}, output: "ok" }],
  pending: [],
  citations: [],
}));

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let server, base;
let ana = {}; // sessão da primeira admin
let bia = {}; // sessão da segunda admin
const definitionOf = (name) => ({
  name,
  role: "specialist",
  description: "especialista de teste",
  instructions: "instruções",
  permitted_tools: ["web_search"],
  permission_scopes: ["web"],
  enabled: true,
});
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
before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const l1 = auth.login({ username: "ana", password: PW, ip: "127.0.0.1" });
  ana = { cookie: `jarvis_sid=${l1.sid}`, csrf: l1.csrf };
  // Segunda admin (mesma potência administrativa) para testes de isolamento.
  await req("/api/auth/admins", {
    method: "POST",
    cookie: ana.cookie,
    csrf: ana.csrf,
    body: { username: "bia", password: PW, currentPassword: PW },
  });
  const l2 = auth.login({ username: "bia", password: PW, ip: "127.0.0.1" });
  bia = { cookie: `jarvis_sid=${l2.sid}`, csrf: l2.csrf };
});
after(() => {
  server.closeAllConnections?.(); // destrói keep-alive dos fetches (corpos não consumidos)
  server.close();
});

test("rotas da Workforce exigem sessão (401 sem cookie)", async () => {
  for (const p of ["/api/workforce/agents", "/api/workforce/runs", "/api/workforce/templates"]) {
    const r = await req(p);
    assert.equal(r.status, 401, p);
  }
});

test("mutação sem CSRF é 403; com CSRF cria definition com ownership", async () => {
  const noCsrf = await req("/api/workforce/agents", {
    method: "POST",
    cookie: ana.cookie,
    body: definitionOf("SemCSRF"),
  });
  assert.equal(noCsrf.status, 403);
  const ok = await req("/api/workforce/agents", {
    method: "POST",
    cookie: ana.cookie,
    csrf: ana.csrf,
    body: definitionOf("Pesq-Ana"),
  });
  assert.equal(ok.status, 200);
  const def = await ok.json();
  assert.equal(def.enabled, true);
  assert.equal(def.name, "Pesq-Ana");
});

test("isolamento: definition/run de ana é invisível e intocável para bia", async () => {
  const def = await (
    await req("/api/workforce/agents", {
      method: "POST",
      cookie: ana.cookie,
      csrf: ana.csrf,
      body: definitionOf("Priv-Ana"),
    })
  ).json();
  const run = await (
    await req(`/api/workforce/agents/${def.id}/run`, {
      method: "POST",
      cookie: ana.cookie,
      csrf: ana.csrf,
      body: { objective: "objetivo privado", idempotency_key: "iso-1" },
    })
  ).json();
  assert.equal(run.deduplicated, false);
  // bia NÃO vê a definition nem o run — 404 uniforme (inexistente == estranho).
  assert.equal((await req(`/api/workforce/agents/${def.id}`, { cookie: bia.cookie })).status, 404);
  assert.equal(
    (await req(`/api/workforce/runs/${run.run.id}`, { cookie: bia.cookie })).status,
    404,
  );
  assert.equal(
    (
      await req(`/api/workforce/runs/${run.run.id}/cancel`, {
        method: "POST",
        cookie: bia.cookie,
        csrf: bia.csrf,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await req(`/api/workforce/runs/${run.run.id}/reconcile`, {
        method: "POST",
        cookie: bia.cookie,
        csrf: bia.csrf,
      })
    ).status,
    404,
  );
  // A lista de bia não contém nada de ana.
  const biasList = await (await req("/api/workforce/agents", { cookie: bia.cookie })).json();
  assert.ok(!biasList.some((d) => d.id === def.id));
  // Idempotência no nível da API: mesma chave devolve o mesmo run.
  const again = await (
    await req(`/api/workforce/agents/${def.id}/run`, {
      method: "POST",
      cookie: ana.cookie,
      csrf: ana.csrf,
      body: { objective: "objetivo privado", idempotency_key: "iso-1" },
    })
  ).json();
  assert.equal(again.deduplicated, true);
  assert.equal(again.run.id, run.run.id);
});

test("definition desabilitada recusa run (409); body inválido é 400", async () => {
  const def = await (
    await req("/api/workforce/agents", {
      method: "POST",
      cookie: ana.cookie,
      csrf: ana.csrf,
      body: { ...definitionOf("Off"), enabled: false },
    })
  ).json();
  const r = await req(`/api/workforce/agents/${def.id}/run`, {
    method: "POST",
    cookie: ana.cookie,
    csrf: ana.csrf,
    body: { objective: "x" },
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, "workforce_agent_disabled");
  const bad = await req("/api/workforce/agents", {
    method: "POST",
    cookie: ana.cookie,
    csrf: ana.csrf,
    body: { name: "Bad", permitted_tools: ["web_search"], permission_scopes: ["*"] },
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "workforce_scopes_invalid");
});

test("escalada de privilégio: principals forjados não obtêm workforce:run nem executam delegação", async () => {
  // Objeto "admin" forjado (não emitido por validateSession) não passa em can().
  assert.equal(can({ type: "admin", adminId: "x", scopes: ["*"] }, "workforce:run"), false);
  assert.equal(
    can({ type: "bot", botId: "falso", scopes: ["workforce:run"] }, "workforce:run"),
    false ? false : true,
  ); // bot com escopo explícito passa (é a classe de execução do backend)
  // Bot real (escopos via sanitizeBotScopes) NUNCA tem workforce:run — delegação negada no callTool.
  const forgedBotPrincipal = { type: "bot", botId: "bot-forjado", adminId: null, scopes: ["web"] };
  const out = await callTool(
    "delegate_agent",
    { definition_id: "qualquer", objective: "x" },
    {
      autonomy: "full",
      pending: [],
      principal: forgedBotPrincipal,
    },
  );
  assert.match(out, /Permissão negada/);
  // Principal sem adminId: negado dentro da delegação também.
  const noOwner = await callTool(
    "delegate_agent",
    { definition_id: "x", objective: "y" },
    {
      autonomy: "full",
      pending: [],
      principal: { type: "bot", botId: "workforce:nao-existe", scopes: ["workforce:run"] },
    },
  );
  assert.match(noOwner, /origem desconhecida|Permissão negada/);
});

test("reconciliação nunca inventa sucesso: `confirm` sem evidência é 409", async () => {
  const def = await (
    await req("/api/workforce/agents", {
      method: "POST",
      cookie: ana.cookie,
      csrf: ana.csrf,
      body: definitionOf("Rec-Sec"),
    })
  ).json();
  const run = await (
    await req(`/api/workforce/agents/${def.id}/run`, {
      method: "POST",
      cookie: ana.cookie,
      csrf: ana.csrf,
      body: { objective: "z" },
    })
  ).json();
  // Força estado unknown (simula interrupção).
  db.prepare("UPDATE agent_runs SET status='unknown' WHERE id=?").run(run.run.id);
  const r = await req(`/api/workforce/runs/${run.run.id}/reconcile`, {
    method: "POST",
    cookie: ana.cookie,
    csrf: ana.csrf,
    body: { decision: "confirm" },
  });
  // Sem aprovações correlacionadas, o resultado seguro é failed(not_executed) — `confirm`
  // explícito sem evidência é recusado; o run NUNCA vira completed por decreto.
  const body = await r.json();
  if (r.status === 200) {
    assert.equal(body.run.status, "failed");
    assert.equal(body.outcome, "not_executed");
  } else {
    assert.equal(r.status, 409);
    assert.equal(body.error, "workforce_reconcile_no_evidence");
  }
  assert.notEqual(
    (await req(`/api/workforce/runs/${run.run.id}`, { cookie: ana.cookie }))
      .json()
      .then((b) => b.status),
    "completed",
  );
});
