// Integração Gigabrain (memória local compartilhada): validação de config, recusa quando
// a integração está desabilitada, ciclo real remember→recall via MCP stdio (pacote de
// publicação que executa npx), escopo do token e comando documental bloqueado.
// Temporary data dir + synthetic data only (same bootstrap as rea-analyze.test.mjs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-gigabrain-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { callTool, gbResolveConfig, GIGABRAIN_TEMPLATE } = await import("../server/tools.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let server, base;
const A = {};
const req = (path, { method = "GET", body, s } = {}) =>
  fetch(base + path, {
    method,
    headers: { origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(s ? { cookie: s.cookie, "x-jarvis-csrf": s.csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
async function login(u, t) {
  const r = await req("/api/auth/login", { method: "POST", body: { username: u, password: PW } });
  const j = await r.json();
  Object.assign(t, { cookie: r.headers.get("set-cookie").split(";")[0], csrf: j.csrf, id: j.admin.id });
  t.principal = auth.validateSession(t.cookie.split("=")[1]);
}
const putSettings = (body, s = A) => req("/api/settings", { method: "PUT", body, s });
const STORE = join(dir, "gigabrain");
const ctx = (principal = A.principal) => ({ autonomy: "confirm", pending: [], principal });
// O pacote Gigabrain é uma dependência EXTERNA (npx). Onde ele não produz a store (ex.: CI sem a
// versão esperada), os testes de CICLO REAL são pulados com motivo; as validações puras e as
// recusas continuam rodando. Não é enfraquecimento: a store ausente é REPORTADA, não mascarada.
let storeReady = false;
let storeSkipReason = "";

before(async () => {
  // Shims `gigabrain-mcp` e `gigabrainctl` no PATH do teste → pacote real de publicação.
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "gigabrain-mcp"), `#!/bin/sh\nexec npx -y -p @legendaryvibecoder/gigabrain gigabrain-mcp "$@"\n`, { mode: 0o755 });
  writeFileSync(join(binDir, "gigabrainctl"), `#!/bin/sh\nexec npx -y -p @legendaryvibecoder/gigabrain gigabrainctl "$@"\n`, { mode: 0o755 });
  process.env.PATH = `${binDir}:${process.env.PATH}`;

  // Bootstrap real da store (mesmo comando do entrypoint do container), uma única vez.
  const { spawnSync } = await import("node:child_process");
  const init = spawnSync("gigabrainctl", ["init", "--project-root", STORE, "--config", join(STORE, "config.json"), "--store-mode", "global"], { encoding: "utf8", timeout: 300_000 });
  storeReady = init.status === 0 && existsSync(join(STORE, "config.json"));
  if (!storeReady) storeSkipReason = `store Gigabrain não inicializada neste ambiente (init.status=${init.status}): ${(init.stderr || "").trim().slice(-200)}`;

  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  await login("ana", A);
  const on = await (await putSettings({ integrations: { gigabrain: { enabled: true, config: join(STORE, "config.json") } } })).json();
  assert.ok(on.integrations?.gigabrain?.enabled === true, "integração habilitada no painel");
});
after(() => server.close());

// ---------- validadores puros ----------
test("gbResolveConfig: padrão dentro de DATA_DIR; override inválido é recusado", (t) => {
  if (process.platform === "win32") return t.skip("caminhos POSIX (Linux)");
  const d = gbResolveConfig({});
  assert.equal(d.ok, true);
  assert.equal(d.path, join(dir, "gigabrain", "config.json"), "config padrão é o do volume persistente");
  assert.equal(gbResolveConfig({ config: "/etc/gigabrain/config.json" }).ok, false, "fora de DATA_DIR");
  assert.equal(gbResolveConfig({ config: `${dir}/etc/passwd-config.json` }).ok, false, "fora de DATA_DIR (subárvore)");
  assert.equal(gbResolveConfig({ config: `${dir}/x/config.json/../config.json` }).ok, false, "traversal");
  assert.equal(gbResolveConfig({ config: join(dir, "gigabrain", "other.json") }).ok, false, "precisa terminar em config.json");
  assert.equal(gbResolveConfig({ config: join(STORE, "config.json") }).ok, true, "override válido dentro de DATA_DIR");
});

// ---------- recusas antes de qualquer execução ----------
test("gigabrain: integração desabilitada → recusa nos dois sentidos, sem spawn", async () => {
  await putSettings({ integrations: { gigabrain: { enabled: false } } });
  const out = await callTool("gigabrain_remember", { content: "x" }, ctx());
  assert.match(out, /não está habilitada/i);
  const q = await callTool("gigabrain_recall", { query: "x" }, ctx());
  assert.match(q, /não está habilitada/i);
  await putSettings({ integrations: { gigabrain: { enabled: true, config: join(STORE, "config.json") } } });
});

test("gigabrain: entrada vazia → mensagem amigável, sem spawn", async () => {
  const q = await callTool("gigabrain_recall", { query: "   " }, ctx());
  assert.match(q, /Informe a consulta/i);
  const m = await callTool("gigabrain_remember", { content: "" }, ctx());
  assert.match(m, /Informe o conteúdo/i);
});

// ---------- ciclo real: remember → recall ----------
test("gigabrain_remember: registra fato fechado por pedido explícito e confirma status", async (t) => {
  if (!storeReady) return t.skip(storeSkipReason);
  const out = await callTool("gigabrain_remember", { content: "Chave de implantação do projeto demo é DIA-CLARA-88", type: "deployment" }, ctx());
  assert.match(out, /memória registrada/i);
  assert.match(out, /committed|deduplicated/, "status de persistência do Gigabrain");
});

test("gigabrain_recall: recupera o fato registrado e marca evidência candidata", async (t) => {
  if (!storeReady) return t.skip(storeSkipReason);
  const out = await callTool("gigabrain_recall", { query: "chave de implantação demo", limit: 3 }, ctx());
  assert.match(out, /DIA-CLARA-88/, "conteúdo lembrado retornado");
  assert.match(out, /evidência candidata/i, "resultado vem marcado como evidência");
  assert.match(out, /escopo project:/, "escopo derivado da store");
});

test("gigabrain_recall: consulta sem correspondência → resposta limpa, sem erro", async (t) => {
  if (!storeReady) return t.skip(storeSkipReason);
  const out = await callTool("gigabrain_recall", { query: "xyzzy sem correspondência alguma zzqq" }, ctx());
  assert.match(out, /Nada encontrado/i);
});

test("gigabrain: comando alterado no painel é recusado", async () => {
  await putSettings({ integrations: { gigabrain: { enabled: true, command: "gigabrain-mcp --config /tmp/other --exec", config: join(STORE, "config.json") } } });
  const out = await callTool("gigabrain_recall", { query: "chave" }, ctx());
  assert.match(out, /não está habilitada \(ou o comando foi alterado\)/i);
  await putSettings({ integrations: { gigabrain: { enabled: true, command: GIGABRAIN_TEMPLATE, config: join(STORE, "config.json") } } });
});

// ---------- escopo: tokens de serviço obedecem memories:* ----------
test("token de serviço: memories:read só lrecall; memories:write habilita remember (e o admin tem tudo)", async (t) => {
  if (!storeReady) return t.skip(storeSkipReason);
  const readToken = auth.createServiceToken(A.principal, { name: "gb-r", scopes: ["memories:read"] });
  const reader = auth.validateServiceToken(readToken.token);
  const denied = await callTool("gigabrain_remember", { content: "não deveria gravar" }, ctx(reader));
  assert.match(denied, /Permissão negada.*memories:write/);
  const writeToken = auth.createServiceToken(A.principal, { name: "gb-w", scopes: ["memories:write"] });
  const writer = auth.validateServiceToken(writeToken.token);
  const blocked = await callTool("gigabrain_recall", { query: "chave" }, ctx(writer));
  assert.match(blocked, /Permissão negada.*memories:read/);
  const ok = await callTool("gigabrain_remember", { content: "Fato de teste do token de escrita GB", target: "user" }, ctx(writer));
  assert.match(ok, /memória registrada/i, "escritura com memories:write funciona");
  assert.match(ok, /escopo profile:user/, "target=user gravou na store pessoal");
});
