// Navegador (browser_action) — testes NOVOS e estritamente da capacidade.
// Sem navegador real, sem rede externa: driver remoto é um worker falso em loopback (endereço de
// configuração do operador) e o destino navegado é sempre um nome público.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-browser-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const {
  BROWSER_OPS,
  BROWSER_LIMITS,
  resolveBrowserConfig,
  browserStatus,
  validateBrowserRequest,
  assertPublicHost,
  runBrowserAction,
  cancelBrowserRun,
  BrowserError,
} = await import("../server/browser.js");
const { normalizeBrowserHosts } = await import("../server/browser-approval.js");
const { createApp } = await import("../server/index.js");
const { callTool, resolveApproval } = await import("../server/tools.js");
const { auth, db } = await import("../server/db.js");
const { updateSettings } = await import("../server/settings.js");

const PW = "senha-muito-forte-1";
const TOKEN = "token-de-worker-para-teste-123456";
const PUBLIC = "https://example.com/";

const ORIGIN = "http://localhost:8080";
let adminA, adminB, principalA, principalB, app, base;
const agentCtx = (principal) => ({
  autonomy: "confirm",
  pending: [],
  principal,
  correlation: "3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607",
});
/** Sessão REAL: só `validateSession` produz principal verificado (anti-forja por WeakMap). */
async function sourcePrincipal(username) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  assert.equal(r.status, 200);
  const sid = r.headers.get("set-cookie").split(";")[0].split("=")[1];
  const principal = auth.validateSession(sid);
  assert.ok(principal, "sessão válida");
  return principal;
}

// ---- worker falso (contrato remoto) — loopback é o ENDEREÇO configurado, não o destino ----
const worker = { hits: [], mode: "ok" };
let workerBase = "";
const wserver = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, engine: "fake", mode: "remote" }));
      return;
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (req.url === "/cancel") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ cancelled: true }));
      return;
    }
    const parsed = JSON.parse(body || "{}");
    worker.hits.push(parsed);
    if (worker.mode === "hang") return; // nunca responde (timeout do cliente decide)
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        state: "completed",
        title: "Titulo",
        finalUrl: PUBLIC,
        host: "example.com",
        text: "trecho de texto",
        // Segredos que NÃO podem chegar ao chamador:
        cookies: [{ name: "sid", value: "SEGREDO_COOKIE" }],
        authorization: `Bearer ${TOKEN}`,
      }),
    );
  });
});

before(async () => {
  workerBase = await new Promise((r) => {
    wserver.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${wserver.address().port}`));
  });
  app = createApp();
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${app.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  principalA = await sourcePrincipal("ana");
  adminA = principalA.adminId;
  principalB = null; // isolamento provado com identidade estrangeira inexistente (404 uniforme)
});
after(async () => {
  // Fecha handles de forma determinística (o worker falso pode ter socket pendente do teste de timeout).
  wserver.closeAllConnections?.();
  await new Promise((r) => wserver.close(r));
  app?.closeAllConnections?.();
  if (app) await new Promise((r) => app.close(r));
});

// ---------- contrato e política ----------

test("navegador: lista FECHADA de operações — sem eval, shell ou download", () => {
  assert.deepEqual(BROWSER_OPS, ["navigate", "extract", "click", "fill", "wait_for", "screenshot"]);
  for (const op of ["eval", "shell", "run_command", "download", "upload", ""]) {
    const v = validateBrowserRequest({ op });
    assert.equal(v.ok, false, `${op} deve ser recusada`);
    assert.equal(v.code, "unsupported_op");
  }
});

test("navegador: destino literal barrado (loopback, metadados, rede privada, esquema, credenciais)", () => {
  const blocked = [
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/",
    "http://192.168.2.40:7777/api/health",
    "file:///etc/passwd",
    "http://user:senha@example.com/",
  ];
  for (const url of blocked) {
    const v = validateBrowserRequest({ op: "navigate", url });
    assert.equal(v.ok, false, `${url} deve ser recusada`);
    assert.equal(v.code, "blocked_destination");
  }
  const ok = validateBrowserRequest({ op: "navigate", url: PUBLIC });
  assert.equal(ok.ok, true);
  assert.equal(ok.request.url, PUBLIC);
});

test("navegador: nome público que resolve para endereço interno é recusado (barreira DNS)", async () => {
  await assert.rejects(
    () =>
      assertPublicHost("https://aparenta-ser-publico.example/", {
        resolve: async () => [{ address: "127.0.0.1" }],
      }),
    (e) => e instanceof BrowserError && e.code === "blocked_destination",
  );
  await assert.rejects(
    () =>
      assertPublicHost("https://metadados.example/", {
        resolve: async () => [{ address: "169.254.169.254" }],
      }),
    (e) => e.code === "blocked_destination",
  );
  await assert.doesNotReject(() =>
    assertPublicHost("https://publico.example/", {
      resolve: async () => [{ address: "93.184.216.34" }],
    }),
  );
  await assert.rejects(
    () =>
      assertPublicHost("https://sem-dns.example/", {
        resolve: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    (e) => e.code === "blocked_destination",
  );
});

test("navegador: limites de seletor/texto/timeout com piso e teto", () => {
  assert.equal(
    validateBrowserRequest({
      op: "click",
      url: PUBLIC,
      selector: "a".repeat(BROWSER_LIMITS.maxSelectorChars + 1),
    }).code,
    "selector_too_long",
  );
  assert.equal(
    validateBrowserRequest({
      op: "fill",
      url: PUBLIC,
      selector: "#x",
      text: "t".repeat(BROWSER_LIMITS.maxTextInputChars + 1),
    }).code,
    "text_too_long",
  );
  assert.equal(validateBrowserRequest({ op: "click", url: PUBLIC }).code, "selector_required");
  assert.equal(validateBrowserRequest({ op: "navigate" }).code, "url_required");
  const cfg = resolveBrowserConfig(null);
  assert.equal(cfg.timeoutMs, BROWSER_LIMITS.defaultTimeoutMs);
  updateSettings(
    { integrations: { browser: { enabled: true, timeoutMs: 999_999 } } },
    { adminId: null, allowGlobal: true },
  );
  assert.equal(
    resolveBrowserConfig(null).timeoutMs,
    BROWSER_LIMITS.maxTimeoutMs,
    "teto de 60 s aplicado",
  );
  updateSettings(
    { integrations: { browser: { enabled: true, timeoutMs: 5 } } },
    { adminId: null, allowGlobal: true },
  );
  assert.equal(
    resolveBrowserConfig(null).timeoutMs,
    BROWSER_LIMITS.minTimeoutMs,
    "piso de 1 s aplicado",
  );
});

test("navegador: allowlist aceita hosts exatos, rejeita hosts externos e sintaxe ampla", async () => {
  assert.deepEqual(normalizeBrowserHosts("Example.com, docs.example.com,example.com."), [
    "example.com",
    "docs.example.com",
  ]);
  assert.equal(
    validateBrowserRequest(
      { op: "navigate", url: "https://evil.example/" },
      {
        allowedHosts: ["example.com"],
      },
    ).code,
    "blocked_destination",
  );
  assert.equal(
    validateBrowserRequest(
      { op: "navigate", url: "https://sub.example.com/" },
      {
        allowedHosts: ["example.com"],
      },
    ).ok,
    false,
    "subdomínio não herda permissão",
  );
  assert.throws(() => normalizeBrowserHosts("*.example.com"), /browser_host_invalid/);
  assert.throws(() => normalizeBrowserHosts("example.com:443"), /browser_host_invalid/);
  assert.equal(
    validateBrowserRequest({ op: "navigate", url: PUBLIC }, { allowedHosts: [] }).ok,
    true,
  );
  updateSettings(
    { integrations: { browser: { allowedHosts: "example.com" } } },
    { adminId: null, allowGlobal: true },
  );
  assert.equal(resolveBrowserConfig(null).allowedHosts[0], "example.com");
  assert.throws(
    () =>
      updateSettings(
        { integrations: { browser: { allowedHosts: ["*.example.com"] } } },
        { allowGlobal: false },
      ),
    (error) => error.status === 403,
    "identidade sem privilégio administrativo não altera a política global",
  );
  const serviceToken = auth.createServiceToken(principalA, {
    name: "browser-settings-test",
    scopes: ["settings:write"],
  }).token;
  const response = await fetch(`${base}/api/settings`, {
    method: "PUT",
    headers: { authorization: `Bearer ${serviceToken}`, "content-type": "application/json" },
    body: JSON.stringify({ integrations: { browser: { allowedHosts: ["evil.example"] } } }),
  });
  assert.equal(response.status, 403, "token não modifica a política global do navegador");
});

test("navegador: resolução de modo por CONFIGURAÇÃO (off · local · remote) sem expor token", () => {
  updateSettings(
    {
      integrations: {
        browser: {
          enabled: false,
          command: "",
          apiKey: "",
          timeoutMs: BROWSER_LIMITS.defaultTimeoutMs,
        },
      },
    },
    { adminId: null, allowGlobal: true },
  );
  assert.equal(resolveBrowserConfig(null).mode, "off");
  assert.deepEqual(browserStatus(null), {
    mode: "off",
    endpoint: null,
    hasToken: false,
    timeoutMs: BROWSER_LIMITS.defaultTimeoutMs,
  });

  updateSettings(
    { integrations: { browser: { enabled: true, command: "", apiKey: "" } } },
    { adminId: null, allowGlobal: true },
  );
  assert.equal(resolveBrowserConfig(null).mode, "local");

  updateSettings(
    {
      integrations: {
        browser: { enabled: true, command: "http://browser-worker:7788", apiKey: TOKEN },
      },
    },
    { adminId: null, allowGlobal: true },
  );
  const st = browserStatus(null);
  assert.equal(st.mode, "remote");
  assert.equal(st.endpoint, "http://browser-worker:7788");
  assert.equal(st.hasToken, true);
  assert.equal(JSON.stringify(st).includes(TOKEN), false, "status nunca contém o token");
  assert.equal(
    JSON.stringify(resolveBrowserConfig(null)).includes(TOKEN),
    true,
    "(sanidade) a config interna carrega o token para autenticar",
  );
});

test("navegador: desligado responde browser_disabled com resultado estruturado", async () => {
  updateSettings(
    { integrations: { browser: { enabled: false } } },
    { adminId: null, allowGlobal: true },
  );
  const r = await runBrowserAction(null, { op: "navigate", url: PUBLIC });
  assert.equal(r.state, "error");
  assert.equal(r.error.code, "browser_disabled");
  assert.equal(r.exitCode, null);
});

// ---------- driver remoto (contrato) ----------

test("navegador remoto: sucesso estruturado + redação de cookie/token", async () => {
  const cfg = {
    mode: "remote",
    endpoint: workerBase,
    token: TOKEN,
    timeoutMs: 5_000,
    executablePath: null,
  };
  const r = await runBrowserAction(null, { op: "navigate", url: PUBLIC }, { config: cfg });
  assert.equal(r.state, "completed");
  assert.equal(r.host, "example.com");
  assert.match(r.output, /Titulo/);
  const raw = JSON.stringify(r);
  assert.equal(raw.includes("SEGREDO_COOKIE"), false, "cookie nunca propagado");
  assert.equal(raw.includes(TOKEN), false, "token do worker nunca propagado");
});

test("navegador remoto: 401, host inacessível e resposta fora do contrato são classificados", async () => {
  const bad = {
    mode: "remote",
    endpoint: workerBase,
    token: "token-errado-mas-longo-123456",
    timeoutMs: 5_000,
    executablePath: null,
  };
  const unauthorized = await runBrowserAction(
    null,
    { op: "navigate", url: PUBLIC },
    { config: bad },
  );
  assert.equal(unauthorized.error.code, "browser_unauthorized");

  const unreachable = await runBrowserAction(
    null,
    { op: "navigate", url: PUBLIC },
    {
      config: { ...bad, endpoint: "http://127.0.0.1:1", token: TOKEN },
      fetchFn: async () => {
        throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      },
    },
  );
  assert.equal(unreachable.error.code, "browser_unreachable");

  const offContract = await runBrowserAction(
    null,
    { op: "navigate", url: PUBLIC },
    {
      config: { ...bad, token: TOKEN },
      fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ nada: true }) }),
    },
  );
  assert.equal(offContract.error.code, "browser_protocol_error");
});

test("navegador remoto: tempo limite é respeitado (sem espera ilimitada)", async () => {
  const hanging = async (_url, init) =>
    await new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () =>
        rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    });
  const r = await runBrowserAction(
    null,
    { op: "navigate", url: PUBLIC, timeoutMs: BROWSER_LIMITS.minTimeoutMs },
    {
      config: {
        mode: "remote",
        endpoint: workerBase,
        token: TOKEN,
        timeoutMs: 60_000,
        executablePath: null,
      },
      fetchFn: hanging,
    },
  );
  assert.equal(r.state, "timeout");
  assert.equal(r.error.code, "browser_timeout");
  assert.ok(
    r.durationMs >= BROWSER_LIMITS.minTimeoutMs - 50 && r.durationMs < 5_000,
    `duração limitada (${r.durationMs} ms)`,
  );
});

test("navegador: cancelamento cooperativo é explícito (id desconhecido não cancela nada)", async () => {
  assert.equal(await cancelBrowserRun("run-inexistente", { config: { mode: "off" } }), false);
});

test("navegador local: sem Playwright instalado falha com instrução acionável (nunca silencioso)", async () => {
  const r = await runBrowserAction(
    null,
    { op: "navigate", url: PUBLIC },
    {
      config: { mode: "local", endpoint: "", token: "", timeoutMs: 5_000, executablePath: null },
      loadPlaywright: async () => {
        throw new BrowserError("browser_unavailable", "instale playwright-core");
      },
      resolveHost: async () => [{ address: "93.184.216.34" }],
    },
  );
  assert.equal(r.state, "error");
  assert.equal(r.error.code, "browser_unavailable");
  assert.match(r.error.message, /playwright|worker/i);
});

// ---------- fluxo de aprovação (pipeline existente, preservado) ----------

test("aprovação: integração desligada recusa antes de criar aprovação", async () => {
  updateSettings(
    { integrations: { browser: { enabled: false, command: workerBase, apiKey: TOKEN } } },
    { adminId: null, allowGlobal: true },
  );
  const before = db.prepare("SELECT COUNT(*) n FROM approvals").get().n;
  const hitsBefore = worker.hits.length;
  const out = await callTool(
    "browser_action",
    { op: "navigate", url: PUBLIC },
    agentCtx(principalA),
  );
  assert.match(String(out), /não está habilitada/i);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM approvals").get().n,
    before,
    "nenhuma aprovação criada",
  );
  assert.equal(worker.hits.length, hitsBefore, "nada navegou");
});

test("aprovação: pedido válido vira aprovação PENDENTE e nada executa antes da decisão", async () => {
  updateSettings(
    { integrations: { browser: { enabled: true, command: workerBase, apiKey: TOKEN } } },
    { adminId: null, allowGlobal: true },
  );
  const hitsBefore = worker.hits.length;
  const ctx = agentCtx(principalA);
  const out = await callTool("browser_action", { op: "navigate", url: PUBLIC }, ctx);
  assert.match(String(out), /aprovação/i);
  assert.equal(ctx.pending.length, 1, "apresentado ao humano");
  const id = ctx.pending[0].id;
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id = ?").get(id).status, "pending");
  assert.equal(worker.hits.length, hitsBefore, "nada executa enquanto pendente");

  // Negar: efeito nenhum, auditoria registrada.
  const denied = await resolveApproval(id, false, principalA);
  assert.equal(denied.status, "denied");
  assert.equal(worker.hits.length, hitsBefore, "negado não executa");
  const kinds = db
    .prepare("SELECT kind FROM audit WHERE detail LIKE ?")
    .all(`%${id}%`)
    .map((r) => r.kind);
  assert.ok(kinds.includes("browser_action(requested)"));
  assert.ok(kinds.includes("browser_action(denied)"));
  assert.equal(
    kinds.some((k) => /\(started\)/.test(k)),
    false,
    "nada iniciou",
  );
});

test("aprovação: aprovado executa UMA vez, com evidência; replay e terceiros são recusados", async () => {
  updateSettings(
    { integrations: { browser: { enabled: true, command: workerBase, apiKey: TOKEN } } },
    { adminId: null, allowGlobal: true },
  );
  const ctx = agentCtx(principalA);
  await callTool("browser_action", { op: "navigate", url: PUBLIC }, ctx);
  const id = ctx.pending[0].id;

  // Terceiro (id de administrador inexistente) não decide: 404 uniforme, nada executa.
  const stranger = {
    type: "session",
    adminId: "00000000-0000-4000-8000-000000000000",
    scopes: ["*"],
  };
  const hitsBeforeStranger = worker.hits.length;
  await assert.rejects(
    () => resolveApproval(id, true, stranger),
    (e) => e.status === 404,
  );
  assert.equal(worker.hits.length, hitsBeforeStranger, "decisão estrangeira não executa");

  const hitsBefore = worker.hits.length;
  const done = await resolveApproval(id, true, principalA);
  assert.equal(done.status, "done");
  assert.equal(worker.hits.length, hitsBefore + 1, "exatamente UMA execução");
  assert.equal(worker.hits.at(-1).op, "navigate");
  assert.equal(worker.hits.at(-1).url, PUBLIC);

  // Replay: mesma decisão de novo (ou invertida) é recusada — single-claim.
  await assert.rejects(
    () => resolveApproval(id, true, principalA),
    (e) => e.status === 409,
  );
  await assert.rejects(
    () => resolveApproval(id, false, principalA),
    (e) => e.status === 409,
  );
  assert.equal(worker.hits.length, hitsBefore + 1, "sem execução duplicada");

  const kinds = db.prepare("SELECT kind, detail FROM audit WHERE detail LIKE ?").all(`%${id}%`);
  const names = kinds.map((r) => r.kind);
  for (const k of [
    "browser_action(requested)",
    "browser_action(approved)",
    "browser_action(started)",
    "browser_action(done)",
  ]) {
    assert.ok(names.includes(k), `auditoria contém ${k}`);
  }
  const evidence = db
    .prepare("SELECT state, verification, input_hash FROM execution_evidence WHERE approval_id = ?")
    .all(id);
  assert.equal(evidence.length, 1, "uma evidência por execução");
  assert.equal(evidence[0].state, "completed");
  const auditText = JSON.stringify(kinds);
  assert.equal(auditText.includes(TOKEN), false, "token nunca na auditoria");
  assert.equal(auditText.includes("SEGREDO_COOKIE"), false, "cookie nunca na auditoria");
  const doneDetail = JSON.parse(kinds.find((r) => r.kind === "browser_action(done)").detail);
  assert.equal(doneDetail.approvalId, id);
  assert.equal(doneDetail.principal, `admin:${adminA}`);
});

test("aprovação: portão reavaliado — integração desligada após o pedido impede a execução", async () => {
  updateSettings(
    { integrations: { browser: { enabled: true, command: workerBase, apiKey: TOKEN } } },
    { adminId: null, allowGlobal: true },
  );
  const ctx = agentCtx(principalA);
  await callTool("browser_action", { op: "navigate", url: PUBLIC }, ctx);
  const id = ctx.pending[0].id;
  updateSettings(
    { integrations: { browser: { enabled: false } } },
    { adminId: null, allowGlobal: true },
  );
  const hitsBefore = worker.hits.length;
  const r = await resolveApproval(id, true, principalA);
  assert.equal(r.status, "denied", "aprovar não basta: o portão é reavaliado");
  assert.equal(worker.hits.length, hitsBefore, "nada executou após desligar a integração");
  const denied = db
    .prepare("SELECT detail FROM audit WHERE kind = 'browser_action(denied)' AND detail LIKE ?")
    .all(`%${id}%`);
  assert.match(String(denied.at(-1).detail), /integration_disabled/);
});

test("aprovação: pedido inválido não chega a virar aprovação (destino recusado)", async () => {
  updateSettings(
    { integrations: { browser: { enabled: true, command: workerBase, apiKey: TOKEN } } },
    { adminId: null, allowGlobal: true },
  );
  const before = db.prepare("SELECT COUNT(*) n FROM approvals").get().n;
  const hitsBefore = worker.hits.length;
  const out = await callTool(
    "browser_action",
    { op: "navigate", url: "http://169.254.169.254/latest/meta-data" },
    agentCtx(principalA),
  );
  assert.match(String(out), /recusad/i);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM approvals").get().n,
    before,
    "nenhuma aprovação criada",
  );
  assert.equal(worker.hits.length, hitsBefore, "recusa não navega");
  const refused = db
    .prepare("SELECT detail FROM audit WHERE kind = 'browser_action(refused)'")
    .all();
  assert.ok(refused.length >= 1, "recusa auditada");
  assert.match(String(refused.at(-1).detail), /blocked_destination/);
});

test("browser fill stores ciphertext and executes only with the reviewed fingerprint and confirmation", async () => {
  updateSettings(
    { integrations: { browser: { enabled: true, command: workerBase, apiKey: TOKEN } } },
    { adminId: null, allowGlobal: true },
  );
  const secretText = "valor confidencial do formulario";
  const ctx = agentCtx(principalA);
  await callTool(
    "browser_action",
    { op: "fill", url: PUBLIC, selector: "#email", text: secretText },
    ctx,
  );
  const id = ctx.pending[0].id;
  const stored = JSON.parse(
    db.prepare("SELECT action FROM approval_actions WHERE approval_id = ?").get(id).action,
  );
  assert.equal(stored.params.text, undefined, "texto em claro não persiste na ação");
  assert.match(stored.params.encryptedText, /^enc:/, "texto protegido em repouso");
  assert.equal(stored.fingerprint.length, 32);

  const before = worker.hits.length;
  const service = {
    type: "service",
    adminId: adminA,
    tokenId: "test-writer",
    scopes: ["web:write"],
  };
  await assert.rejects(
    () =>
      resolveApproval(id, true, service, { confirmWrite: true, fingerprint: stored.fingerprint }),
    (error) => error.status === 403,
    "token de serviço não pode fornecer confirmação humana",
  );
  await assert.rejects(() => resolveApproval(id, true, principalA), /review|fingerprint/i);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id = ?").get(id).status, "pending");
  assert.equal(worker.hits.length, before, "falta de confirmação não consome nem executa");

  await assert.rejects(
    () => resolveApproval(id, true, principalA, { confirmWrite: true, fingerprint: "stale" }),
    /review|fingerprint/i,
  );
  assert.equal(worker.hits.length, before, "fingerprint divergente não executa");
  const done = await resolveApproval(id, true, principalA, {
    confirmWrite: true,
    fingerprint: stored.fingerprint,
  });
  assert.equal(done.status, "done");
  assert.equal(worker.hits.at(-1).text, secretText, "texto é descriptografado apenas na execução");
});

test("browser click e fill não são autorizados pelo escopo web somente leitura", async () => {
  updateSettings(
    { integrations: { browser: { enabled: true, command: workerBase, apiKey: TOKEN } } },
    { adminId: null, allowGlobal: true },
  );
  const service = { type: "service", adminId: adminA, tokenId: "test-token", scopes: ["web"] };
  for (const input of [
    { op: "click", url: PUBLIC, selector: "button" },
    { op: "fill", url: PUBLIC, selector: "#email", text: "x@y.test" },
  ]) {
    const ctx = agentCtx(service);
    const before = db.prepare("SELECT COUNT(*) n FROM approvals").get().n;
    const result = await callTool("browser_action", input, ctx);
    assert.match(String(result), /permissão negada/i);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM approvals").get().n, before);
    assert.equal(ctx.pending.length, 0);
  }
});
