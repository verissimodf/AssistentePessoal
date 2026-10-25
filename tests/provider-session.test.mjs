// Hermes serializa turnos por sessão (lease em `turn_facade_lease.py`). Sem um id por execução,
// chats independentes entram na mesma fila: medido 91s+31s em vez de ~15s em paralelo.
// O diretório de dados é isolado ANTES de qualquer import do serviço (llm.js abre o banco).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-session-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { providerHeaders } = await import("../server/llm.js");
const { auth, db, agents } = await import("../server/db.js");
const { assignNew } = await import("../server/ownership.js");
const { runAgent } = await import("../server/llm.js");

test("hermes recebe um id de sessão derivado da execução", () => {
  const h = providerHeaders("hermes", "run-abc");
  assert.equal(h["x-hermes-session-id"], "jarvis-run-abc");
});

test("outros provedores não recebem o cabeçalho", () => {
  for (const id of ["ollama", "headroom", "omniroute", "openai", "anthropic"]) {
    assert.deepEqual(providerHeaders(id, "run-abc"), {}, id);
  }
});

test("sem correlação não inventa sessão", () => {
  assert.deepEqual(providerHeaders("hermes", ""), {});
  assert.deepEqual(providerHeaders("hermes", undefined), {});
});

test("execuções distintas geram sessões distintas (paralelismo)", () => {
  const a = providerHeaders("hermes", "run-1")["x-hermes-session-id"];
  const b = providerHeaders("hermes", "run-2")["x-hermes-session-id"];
  assert.notEqual(a, b);
});

test("o cabeçalho não carrega segredo nem prompt", () => {
  const h = providerHeaders("hermes", "run-abc");
  const valor = h["x-hermes-session-id"];
  assert.match(valor, /^jarvis-[a-z0-9-]+$/i);
  assert.ok(valor.length <= 120);
});

test("runAgent envia a sessão do Hermes derivada do run", async () => {
  auth.setupFirstAdmin({
    token: auth.ensureBootstrap().token,
    username: "ana",
    password: "senha-muito-forte-1",
  });
  const adminId = db.prepare("SELECT id FROM admins WHERE active=1").get().id;
  const agente = agents.save({
    id: "hermes-sessao",
    name: "Hermes sessão",
    provider: "hermes",
    model: "hermes-agent",
    active: true,
    instructions: "teste",
    tools: [],
  });
  assignNew("agent", agente.id, adminId);

  const realFetch = globalThis.fetch;
  const vistos = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/chat/completions")) {
      vistos.push({ url: String(url), headers: init.headers || {} });
      const body = { choices: [{ message: { content: "ok" } }] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }
    return realFetch(url, init);
  };
  try {
    const out = await runAgent({
      agentId: agente.id,
      messages: [{ role: "user", content: "oi" }],
      autonomy: "confirm",
      principal: { adminId, role: "admin", scopes: ["*"] },
      runId: "run-sessao-1",
      deadlineMs: 30_000,
    });
    assert.match(out.reply, /ok/);
    assert.equal(vistos.length, 1);
    assert.equal(vistos[0].headers["x-hermes-session-id"], "jarvis-run-sessao-1");
  } finally {
    globalThis.fetch = realFetch;
  }
});
