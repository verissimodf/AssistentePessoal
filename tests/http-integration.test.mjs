// Abstração de integração HTTP (integrações `kind: "http"` sem consumidor, ex.: Odysseus).
// Todos os casos usam fetch injetado: nenhuma rede real, nenhum segredo real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// O módulo importa db.js (auditoria padrão), que abre o banco: isolar ANTES do import.
process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), "jarvis-httpint-"));
const { resolveHttpIntegration, callHttpIntegration, extractText, HTTP_AGENT_MAX_PROMPT } =
  await import("../server/http-integration.js");

const settings = {
  integrations: {
    odysseus: { enabled: true, kind: "http", command: "http://odysseus:7000/" },
    comchave: {
      enabled: true,
      kind: "http",
      command: "http://servico:9000",
      apiKey: "chave-de-teste",
    },
    desabilitada: { enabled: false, kind: "http", command: "http://x:1" },
    cli: { enabled: true, kind: "cli", command: "claude -p {prompt}" },
    semurl: { enabled: true, kind: "http", command: "nao-e-url" },
  },
};

const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });

test("allowlist: aceita apenas integração http habilitada e configurada", () => {
  assert.equal(resolveHttpIntegration("odysseus", settings).baseUrl, "http://odysseus:7000");
  for (const [id, code] of [
    ["desconhecida", "unknown_integration"],
    ["desabilitada", "integration_disabled"],
    ["cli", "wrong_kind"],
    ["semurl", "invalid_integration_url"],
    ["../etc", "invalid_integration"],
    ["", "invalid_integration"],
  ]) {
    assert.throws(
      () => resolveHttpIntegration(id, settings),
      (e) => e.code === code,
      `${id} → ${code}`,
    );
  }
});

test("chama o contrato OpenAI com autenticação da configuração (nunca do argumento)", async () => {
  let visto = null;
  const fetchImpl = async (url, init) => {
    visto = { url, init };
    return okJson({ choices: [{ message: { content: "olá" } }] });
  };
  const r = await callHttpIntegration("comchave", {
    prompt: "oi",
    settings,
    fetchImpl,
    audit: () => {},
  });
  assert.equal(r.text, "olá");
  assert.equal(visto.url, "http://servico:9000/chat/completions");
  assert.equal(visto.init.headers.authorization, "Bearer chave-de-teste");
  assert.equal(visto.init.method, "POST");
  assert.equal(JSON.parse(visto.init.body).messages[0].content, "oi");
});

test("sem chave configurada não envia authorization", async () => {
  let headers = null;
  await callHttpIntegration("odysseus", {
    prompt: "oi",
    settings,
    fetchImpl: async (_u, init) => {
      headers = init.headers;
      return okJson({ choices: [{ message: { content: "ok" } }] });
    },
    audit: () => {},
  });
  assert.equal(headers.authorization, undefined);
});

test("validação de entrada: prompt vazio ou acima do limite", async () => {
  let chamou = 0;
  const fetchImpl = async () => {
    chamou++;
    return okJson({});
  };
  await assert.rejects(
    () => callHttpIntegration("odysseus", { prompt: "   ", settings, fetchImpl, audit: () => {} }),
    (e) => e.code === "empty_prompt",
  );
  await assert.rejects(
    () =>
      callHttpIntegration("odysseus", {
        prompt: "x".repeat(HTTP_AGENT_MAX_PROMPT + 1),
        settings,
        fetchImpl,
        audit: () => {},
      }),
    (e) => e.code === "prompt_too_long",
  );
  assert.equal(chamou, 0, "nada deve ser enviado com entrada inválida");
});

test("validação de saída: formato inesperado, JSON inválido e truncamento", async () => {
  await assert.rejects(
    () =>
      callHttpIntegration("odysseus", {
        prompt: "oi",
        settings,
        fetchImpl: async () => okJson({ nada: true }),
        audit: () => {},
      }),
    (e) => e.code === "invalid_response",
  );
  await assert.rejects(
    () =>
      callHttpIntegration("odysseus", {
        prompt: "oi",
        settings,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("json inválido");
          },
        }),
        audit: () => {},
      }),
    (e) => e.code === "invalid_response",
  );
  assert.equal(extractText({ choices: [{ message: { content: "a".repeat(20) } }] }, 5), "aaaaa");
  assert.equal(
    extractText({
      choices: [{ message: { content: [{ type: "text", text: "par" }, { text: "tes" }] } }],
    }),
    "partes",
  );
});

test("timeout e indisponibilidade viram códigos distintos, sem vazar detalhe", async () => {
  const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
  await assert.rejects(
    () =>
      callHttpIntegration("odysseus", {
        prompt: "oi",
        settings,
        fetchImpl: async () => Promise.reject(timeout),
        audit: () => {},
      }),
    (e) => e.code === "timeout" && !/odysseus:7000/.test(e.message),
  );
  await assert.rejects(
    () =>
      callHttpIntegration("odysseus", {
        prompt: "oi",
        settings,
        fetchImpl: async () => Promise.reject(new Error("ECONNREFUSED")),
        audit: () => {},
      }),
    (e) => e.code === "unreachable",
  );
});

test("erro do upstream não repassa corpo bruto", async () => {
  await assert.rejects(
    () =>
      callHttpIntegration("odysseus", {
        prompt: "oi",
        settings,
        fetchImpl: async () => ({
          ok: false,
          status: 503,
          json: async () => ({ detalhe: "stack interna" }),
        }),
        audit: () => {},
      }),
    (e) => e.code === "upstream_error" && e.message === "Integração respondeu 503.",
  );
});

test("auditoria registra apenas ids e códigos (nunca prompt ou resposta)", async () => {
  const eventos = [];
  await callHttpIntegration("odysseus", {
    prompt: "segredo do usuário",
    settings,
    fetchImpl: async () => okJson({ choices: [{ message: { content: "resposta confidencial" } }] }),
    audit: (kind, detail) => eventos.push({ kind, detail }),
  });
  assert.equal(eventos.length, 1);
  const serializado = JSON.stringify(eventos[0]);
  assert.doesNotMatch(serializado, /segredo do usuário|resposta confidencial/);
  assert.equal(eventos[0].detail.agent, "odysseus");

  const falhas = [];
  await assert.rejects(() =>
    callHttpIntegration("odysseus", {
      prompt: "oi",
      settings,
      fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
      audit: (kind, detail) => falhas.push({ kind, detail }),
    }),
  );
  assert.match(falhas[0].kind, /failed/);
  assert.equal(falhas[0].detail.reason, "upstream_error");
});
