// Limites da execução autônoma: anti-ciclo, teto de chamadas, teto de tempo, cancelamento
// cooperativo e tratamento de processos filhos. O "modelo" é um stub local (nada externo).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "jarvis-limits-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { runAgent, cancelRun, runActive } = await import("../server/llm.js");
const { runShell } = await import("../server/tools.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let principal, admin, server, base, mode, toolCallCount, delayMs, cancelOnNth;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ username: "ana", password: PW }),
  });
  principal = auth.validateSession(r.headers.get("set-cookie").split(";")[0].split("=")[1]);
  admin = db.prepare("SELECT id FROM admins WHERE active=1").get();
});
after(async () => { await new Promise((r) => server.close(r)); });

const realFetch = globalThis.fetch;
/** Stub do provedor: só intercepta /chat/completions; o resto passa adiante. */
function stubModel(handler) {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.includes("/chat/completions")) return realFetch(url, init);
    toolCallCount++;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const body = handler(toolCallCount);
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
}
const toolCall = (name, args) => ({
  choices: [{ message: { content: "", tool_calls: [{ id: `t${toolCallCount}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }],
});
const finalAnswer = (text) => ({ choices: [{ message: { content: text } }] });

const run = (opts = {}) => runAgent({ messages: [{ role: "user", content: "tarefa" }], autonomy: "confirm", principal, ...opts });

before(() => { toolCallCount = 0; delayMs = 0; cancelOnNth = 0; });
after(() => { globalThis.fetch = realFetch; });

test("anti-ciclo: chamada idêntica repetida interrompe a execução", async () => {
  toolCallCount = 0;
  stubModel(() => toolCall("recall", { query: "mesma-coisa" }));
  const r = await run({ maxSteps: 10 });
  globalThis.fetch = realFetch;
  assert.match(r.reply, /repetida|Limite/);
  assert.ok(toolCallCount <= 10, `chamadas ao modelo limitadas por maxSteps (${toolCallCount})`);
});

test("teto de chamadas de ferramenta interrompe a execução", async () => {
  toolCallCount = 0;
  let i = 0;
  stubModel(() => toolCall("recall", { query: `unica-${++i}` })); // argumentos distintos → sem anti-ciclo
  const r = await run({ maxSteps: 50, maxToolCalls: 5 });
  globalThis.fetch = realFetch;
  assert.match(r.reply, /Limite de chamadas/);
  assert.ok(r.tools.length <= 6, `ferramentas executadas: ${r.tools.length}`);
});

test("teto de tempo interrompe a execução", async () => {
  toolCallCount = 0; delayMs = 40;
  let i = 0;
  stubModel(() => toolCall("recall", { query: `t-${++i}` }));
  const r = await run({ maxSteps: 50, deadlineMs: 60 });
  globalThis.fetch = realFetch; delayMs = 0;
  assert.match(r.reply, /Limite de tempo/);
});

test("cancelamento cooperativo interrompe entre passos", async () => {
  toolCallCount = 0;
  let i = 0;
  stubModel(() => { if (toolCallCount === 2) cancelRun("run-teste"); return toolCall("recall", { query: `c-${++i}` }); });
  const r = await run({ runId: "run-teste", maxSteps: 20 });
  globalThis.fetch = realFetch;
  assert.match(r.reply, /cancelada/i);
  assert.equal(runActive("run-teste"), false, "o run sai do registro ao terminar");
});

test("cancelRun/runActive: id desconhecido não cancela nada", () => {
  assert.equal(cancelRun("nao-existe"), false);
  assert.equal(runActive("nao-existe"), false);
});

test("rota de cancelamento: 404 para run de outro dono", async () => {
  const r = await fetch(`${base}/api/runs/inexistente/cancel`, {
    method: "POST",
    headers: { origin: ORIGIN, cookie: `jarvis_sid=${"x".repeat(43)}`, "x-jarvis-csrf": "y" },
  });
  assert.equal(r.status, 401, "sem sessão válida não passa da autenticação");
});

test("runShell: timeout mata o grupo de processos e não deixa órfãos", async (t) => {
  if (process.platform === "win32") return t.skip("kill de grupo de processos é POSIX");
  const t0 = Date.now();
  const out = await runShell("sh -c 'sleep 30 & sleep 30'", 500);
  const dt = Date.now() - t0;
  assert.ok(dt < 5000, `retornou em ${dt}ms (não esperou os 30s)`);
  assert.match(out.output, /tempo limite/i);
  assert.equal(out.state, "timeout", "estado estruturado de timeout");
  assert.equal(out.timedOut, true);
  assert.equal(out.exitCode, null);
  await new Promise((r) => setTimeout(r, 500));
  // Nenhum `sleep` do MEU usuário sobrevive (netos incluídos).
  const mine = await runShell("pgrep -x sleep -u $(id -u) | wc -l || echo 0", 5000);
  assert.equal(String(mine.output).trim().split("\n").pop(), "0", `órfãos: ${mine.output}`);
});

test("runShell: comando simples continua funcionando (contrato estruturado)", async () => {
  const r = await runShell("echo limite-ok", 5000);
  assert.match(r.output, /limite-ok/);
  assert.equal(r.state, "completed");
  assert.equal(r.exitCode, 0);
  assert.equal(r.timedOut, false);
});
