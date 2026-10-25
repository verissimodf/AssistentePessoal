// O botão "Testar" do painel precisa validar o CONTRATO FUNCIONAL do provedor (uma completion),
// não só `/models`: um provedor pode listar modelos e travar/recusar em /chat/completions.
// Também precisa de limite de tempo — sem ele o clique fica pendurado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-testprovider-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db } = await import("../server/db.js");
const { testProvider } = await import("../server/llm.js");

const PW = "senha-muito-forte-1";
let adminId;

before(() => {
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  adminId = db.prepare("SELECT id FROM admins WHERE active=1").get().id;
});

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

/** Stub por rota: devolve o que o teste mandar para /models e /chat/completions. */
const stub = (rotas) => {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const rota = u.includes("/chat/completions")
      ? "chat"
      : u.includes("/models")
        ? "models"
        : "outro";
    const h = rotas[rota];
    if (!h) return realFetch(url, init);
    return h(init);
  };
};

test("ok=true só quando a completion responde de fato", async () => {
  stub({
    models: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{}, {}] }),
      text: async () => '{"data":[{},{}]}',
    }),
    chat: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
      text: async () => '{"choices":[{"message":{"content":"ok"}}]}',
    }),
  });
  const r = await testProvider("ollama", adminId);
  assert.equal(r.ok, true);
  assert.match(r.detail, /chat/i);
});

test("listar modelos não basta: /chat/completions com erro reprova o teste", async () => {
  stub({
    models: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{}] }),
      text: async () => '{"data":[{}]}',
    }),
    chat: async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => "upstream indisponível",
    }),
  });
  const r = await testProvider("hermes", adminId);
  assert.equal(r.ok, false, "provedor que lista modelos e falha no chat não pode passar");
  assert.match(r.detail, /503/);
});

test("resposta 200 sem 'choices' também reprova", async () => {
  stub({
    chat: async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{"object":"list"}',
    }),
  });
  const r = await testProvider("headroom", adminId);
  assert.equal(r.ok, false);
  assert.match(r.detail, /inesperada/i);
});

test("não envia max_tokens (evita loop de continuação em provedores de agente)", async () => {
  // Medido no Hermes: com max_tokens=1 a resposta trunca e o agente pede continuações
  // (até 4), transformando um "ping" em >10s. O teste deve espelhar a chamada real.
  let corpo = null;
  stub({
    chat: async (init) => {
      corpo = JSON.parse(init.body);
      const body = { choices: [{ message: { content: "ok" } }] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    },
  });
  const r = await testProvider("hermes", adminId);
  assert.equal(r.ok, true);
  assert.equal(corpo.max_tokens, undefined, "não deve limitar a saída do provedor");
  assert.equal(corpo.stream, false);
  assert.equal(corpo.messages.at(-1).content, "Responda apenas: ok");
});

test("o teste usa sessão própria (não herda a fila de um turno em andamento)", async () => {
  const vistos = [];
  stub({
    chat: async (init) => {
      vistos.push(init.headers || {});
      const body = { choices: [{ message: { content: "ok" } }] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    },
  });
  await testProvider("hermes", adminId);
  await testProvider("hermes", adminId);
  await testProvider("ollama", adminId);
  assert.match(String(vistos[0]["x-hermes-session-id"]), /^jarvis-[a-z0-9-]+$/i);
  assert.notEqual(
    vistos[0]["x-hermes-session-id"],
    vistos[1]["x-hermes-session-id"],
    "cada teste usa sessão própria",
  );
  assert.equal(
    vistos[2]["x-hermes-session-id"],
    undefined,
    "outros provedores não recebem a sessão",
  );
});

test("o timeout padrão do teste cobre o cold start de provedores de agente", async () => {
  const { TEST_PROVIDER_TIMEOUT_MS } = await import("../server/llm.js");
  assert.equal(TEST_PROVIDER_TIMEOUT_MS, 45_000);
  assert.ok(TEST_PROVIDER_TIMEOUT_MS > 25_000, "precisa exceder o cold start medido (~25 s)");
});

test("provedor que nunca responde respeita o limite de tempo", async () => {
  stub({
    chat: (init) =>
      new Promise((_, reject) => {
        const fail = () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
        if (init?.signal?.aborted) return fail();
        init?.signal?.addEventListener("abort", fail, { once: true });
      }),
  });
  const keep = setInterval(() => {}, 200);
  const t0 = Date.now();
  let r;
  try {
    r = await Promise.race([
      testProvider("hermes", adminId, { timeoutMs: 400 }),
      new Promise((res) => setTimeout(() => res({ ok: null, detail: "sem timeout" }), 5000)),
    ]);
  } finally {
    clearInterval(keep);
  }
  const elapsed = Date.now() - t0;
  assert.equal(r.ok, false);
  assert.match(r.detail, /tempo esgotado/i);
  assert.ok(elapsed < 4000, `deveria desistir perto de 400ms, levou ${elapsed}ms`);
});
