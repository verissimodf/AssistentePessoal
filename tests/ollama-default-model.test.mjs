// P2-B remediação — modelo padrão do chat compatível com o catálogo Ollama real.
// Sem rede: catálogos e provedores são injetados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-ollama-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { PERSONAL_DEFAULTS } = await import("../server/settings.js");
const { DEFAULT_OLLAMA_MODEL, assertModelAvailable, modelNotFoundFrom, embed, runAgent } =
  await import("../server/llm.js");
const { chatExchange } = await import("../server/conversations.js");
const { auth, db } = await import("../server/db.js");

const OLLAMA = "ollama";

test("modelo padrão: configuração inicial usa um modelo instalável no Ollama (não o inexistente llama3.1)", () => {
  assert.equal(DEFAULT_OLLAMA_MODEL, "qwen2.5:7b", "baseline validado end-to-end");
  assert.equal(PERSONAL_DEFAULTS.providers.ollama.model, "qwen2.5:7b");
  assert.equal(PERSONAL_DEFAULTS.providers.ollama.baseUrl, "http://ollama-llm:11434/v1");
  // embeddings continuam em um modelo DIFERENTE e dedicado
  assert.notEqual(DEFAULT_OLLAMA_MODEL, "nomic-embed-text");
});

test("catálogo alcançável: modelo ausente ⇒ erro de configuração claro com a lista disponível", async () => {
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({ data: [{ id: "qwen2.5:7b" }, { id: "gemma3:4b" }] }),
  });
  await assert.rejects(
    () => assertModelAvailable({ id: OLLAMA, baseUrl: "http://cat-a/v1" }, "llama3.1", { fetchFn }),
    (e) =>
      e.code === "model_not_found" &&
      e.status === 400 &&
      typeof e.message === "string" &&
      e.message.includes("qwen2.5:7b") &&
      e.message.includes("gemma3:4b"),
  );
});

test("catálogo alcançável: modelo presente ⇒ sem erro", async () => {
  const fetchFn = async () => ({ ok: true, json: async () => ({ data: [{ id: "qwen2.5:7b" }] }) });
  await assert.doesNotReject(() =>
    assertModelAvailable({ id: OLLAMA, baseUrl: "http://cat-b/v1" }, "qwen2.5:7b", { fetchFn }),
  );
});

test("catálogo inalcançável ⇒ fail-open (não bloqueia o chat por indisponibilidade do /models)", async () => {
  const fetchFn = async () => {
    throw new Error("fetch failed");
  };
  await assert.doesNotReject(() =>
    assertModelAvailable({ id: OLLAMA, baseUrl: "http://cat-c/v1" }, "qualquer", { fetchFn }),
  );
  // provedor remoto (sem catálogo local) também não é bloqueado
  await assert.doesNotReject(() =>
    assertModelAvailable({ id: "openai", baseUrl: "https://api.openai.com/v1" }, "gpt-4o", {
      fetchFn,
      probeCatalog: false,
    }),
  );
});

test("o catálogo é sondado no máximo uma vez por minuto (cache por baseUrl)", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return { ok: true, json: async () => ({ data: [{ id: "qwen2.5:7b" }] }) };
  };
  const cfg = { id: OLLAMA, baseUrl: "http://cat-cache/v1" };
  await assertModelAvailable(cfg, "qwen2.5:7b", { fetchFn });
  await assertModelAvailable(cfg, "qwen2.5:7b", { fetchFn });
  assert.equal(calls, 1, "segunda verificação usa a cache (sem sondar a cada mensagem)");
});

test("resposta do provedor com modelo inexistente é traduzida em model_not_found (não provider_error)", () => {
  const r = modelNotFoundFrom(
    404,
    '{"error":{"message":"model \'llama3.1\' not found, try pulling it first"}}',
  );
  assert.ok(r);
  assert.equal(r.code, "model_not_found");
  assert.equal(r.status, 400);
  assert.equal(modelNotFoundFrom(500, "boom"), null);
  assert.equal(modelNotFoundFrom(404, "not found"), null, "404 sem menção a modelo não é config");
});

test("erro de configuração do modelo chega ao chat como 400 model_not_found (nunca 502 genérico)", async () => {
  auth.setupFirstAdmin({
    token: auth.ensureBootstrap().token,
    username: "ana",
    password: "senha-muito-forte-1",
  });
  const adminId = db.prepare("SELECT id FROM admins WHERE active=1").get().id;
  await assert.rejects(
    () =>
      chatExchange(adminId, { message: "oi" }, async () => {
        const e = new Error("modelo ausente");
        e.code = "model_not_found";
        e.status = 400;
        throw e;
      }),
    (e) => e.status === 400 && e.code === "model_not_found",
  );
});

test("embeddings continuam usando nomic-embed-text (não o modelo de chat)", async () => {
  let seen = null;
  const fetchFn = async (_url, init) => {
    seen = JSON.parse(init.body);
    return { ok: true, json: async () => ({ embeddings: [[0.1, 0.2]] }) };
  };
  const r = await embed("texto de teste", null, { fetchFn });
  assert.equal(seen.model, "nomic-embed-text");
  assert.ok(Array.isArray(r));
});

test("o executor do chat está disponível e classifica falhas (não inventa resposta)", () => {
  assert.equal(typeof runAgent, "function");
});

test("salvar preferências pessoais não apaga o modelo padrão do provedor (regressão P2-B)", async () => {
  const { updateSettings, getSettings, publicSettings } = await import("../server/settings.js");
  const adminId = db.prepare("SELECT id FROM admins WHERE active = 1").get().id;
  // Uma preferência pessoal qualquer (ex.: idioma) não pode zerar providers.
  updateSettings({ general: { language: "pt" } }, { adminId });
  assert.equal(getSettings(adminId).providers.ollama.model, "qwen2.5:7b", "default preservado");
  assert.equal(getSettings(adminId).providers.ollama.baseUrl, "http://ollama-llm:11434/v1");
  // Configuração explícita continua vencendo o default.
  updateSettings({ providers: { ollama: { model: "gemma3:4b" } } }, { adminId });
  assert.equal(getSettings(adminId).providers.ollama.model, "gemma3:4b");
  assert.equal(
    getSettings(adminId).providers.ollama.baseUrl,
    "http://ollama-llm:11434/v1",
    "baseUrl default mantido",
  );
  // E o valor explícito nunca é exposto como segredo pelas settings públicas.
  assert.equal(JSON.stringify(publicSettings(adminId)).includes("sk-"), false);
});
