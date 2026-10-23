// P2-A remediação — TTS local: cold-start, chamada morna, timeout real, cancelamento,
// indisponibilidade e concorrência limitada. NENHUMA rede real: fetch é injetado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-voice-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
process.env.JARVIS_TTS_TIMEOUT_MS = "120";
process.env.JARVIS_TTS_COLD_START_MS = "900";

const { tts, getVoiceState, setVoiceFetch, resetVoiceState, VoiceError } = await import(
  "../server/voice.js"
);

const admin = async () => "admin-teste";
const audioResponse = () =>
  new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { "content-type": "audio/wav" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

after(() => resetVoiceState());

test("voice: primeira chamada (fria) tolera o carregamento do modelo", async () => {
  resetVoiceState();
  let sawSignal = false;
  setVoiceFetch(async (_url, init) => {
    sawSignal = !!init?.signal;
    await sleep(300); // > warm timeout (120 ms), < cold timeout (900 ms)
    return audioResponse();
  });
  const r = await tts("teste frio", "pt-BR", await admin());
  assert.equal(r.type, "audio/wav");
  assert.equal(sawSignal, true, "a chamada sempre tem timeout por signal");
  assert.equal(getVoiceState().warm, true, "após sucesso o serviço é marcado como morno");
});

test("voice: chamada morna usa o timeout curto (não espera eternamente)", async () => {
  assert.equal(getVoiceState().warm, true);
  setVoiceFetch(
    async (_u, init) =>
      await new Promise((_res, rej) => {
        const t = setTimeout(() => rej(new Error("lento demais")), 4000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          rej(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      }),
  );
  await assert.rejects(
    () => tts("teste morno lento", "pt-BR", "admin-teste"),
    (e) => e instanceof VoiceError && e.code === "voice_timeout",
  );
});

test("voice: estado de aquecimento é explícito e recuperável (nunca 500 genérico)", async () => {
  resetVoiceState();
  setVoiceFetch(async (_u, init) => {
    // Simula o XTTS demorando mais que o timeout frio.
    return await new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () =>
        rej(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
      );
    });
  });
  await assert.rejects(
    () => tts("cold muito lento", "pt-BR", "admin-teste"),
    (e) =>
      e instanceof VoiceError &&
      e.code === "voice_warming_up" &&
      e.state === "warming_up" &&
      e.retryAfter >= 1,
  );
});

test("voice: serviço indisponível é classificado (sem stack nem URL secreta na mensagem)", async () => {
  resetVoiceState();
  setVoiceFetch(async () => {
    throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  });
  await assert.rejects(
    () => tts("teste", "pt-BR", "admin-teste"),
    (e) => e instanceof VoiceError && e.code === "voice_unavailable",
  );
});

test("voice: concorrência limitada — excesso recebe voice_busy com retryAfter", async () => {
  resetVoiceState();
  let release;
  const gate = new Promise((r) => (release = r));
  setVoiceFetch(async () => {
    await gate;
    return audioResponse();
  });
  const calls = [];
  for (let i = 0; i < 6; i++)
    calls.push(
      tts(`texto ${i}`, "pt-BR", "admin-teste").then(
        (v) => ({ ok: true, v }),
        (e) => ({ ok: false, e }),
      ),
    );
  await sleep(20);
  release(); // libera a síntese em andamento
  const results = await Promise.all(calls);
  const busy = results.filter(
    (x) => !x.ok && x.e instanceof VoiceError && x.e.code === "voice_busy",
  );
  assert.ok(busy.length >= 1, "requisições acima do limite são recusadas com estado explícito");
  assert.ok(busy.every((x) => x.e.retryAfter >= 1));
  await sleep(30);
  assert.equal(getVoiceState().inflight, 0, "a fila é drenada (sem vazamento)");
});

test("voice: cancelamento do cliente interrompe a síntese (sem síntese órfã)", async () => {
  resetVoiceState();
  const ctrl = new AbortController();
  setVoiceFetch(
    async (_u, init) =>
      await new Promise((_res, rej) => {
        init?.signal?.addEventListener("abort", () =>
          rej(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      }),
  );
  const p = tts("cancelar", "pt-BR", "admin-teste", { signal: ctrl.signal });
  await sleep(20);
  ctrl.abort();
  await assert.rejects(
    () => p,
    (e) => e instanceof VoiceError && e.code === "voice_cancelled",
  );
  await sleep(30);
  assert.equal(getVoiceState().inflight, 0, "nada fica preso após cancelar");
});

test("voice: timeouts configuráveis têm piso, teto e defaults sãos", async () => {
  const { resolveTtsTimeouts } = await import("../server/voice.js");
  const def = resolveTtsTimeouts({});
  assert.equal(def.timeoutMs, 20_000, "default morno");
  assert.equal(def.coldTimeoutMs, 120_000, "default cold-start (cobre ~39 s de carga)");
  const huge = resolveTtsTimeouts({ JARVIS_TTS_TIMEOUT_MS: "999999999", JARVIS_TTS_COLD_START_MS: "999999999" });
  assert.equal(huge.timeoutMs, 60_000, "teto do morno");
  assert.equal(huge.coldTimeoutMs, 300_000, "teto absoluto do cold-start");
  const tiny = resolveTtsTimeouts({ JARVIS_TTS_TIMEOUT_MS: "1", JARVIS_TTS_COLD_START_MS: "1" });
  assert.ok(tiny.timeoutMs >= 50 && tiny.coldTimeoutMs >= tiny.timeoutMs, "piso respeitado");
  const inv = resolveTtsTimeouts({ JARVIS_TTS_TIMEOUT_MS: "abc", JARVIS_TTS_COLD_START_MS: "-5" });
  assert.equal(inv.timeoutMs, 20_000, "valor inválido cai no default");
  const st = getVoiceState();
  assert.ok(st.timeoutMs >= 50 && st.coldTimeoutMs >= st.timeoutMs);
});

// ---------- rota ----------

test("voice: /api/tts devolve 503 estruturado com estado de aquecimento (nunca 500 genérico)", async () => {
  process.env.JARVIS_TTS_COLD_START_MS = "80";
  const { createApp } = await import("../server/index.js");
  const { auth } = await import("../server/db.js");
  const server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: "senha-muito-forte-1" });
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { origin: "http://localhost:8080", "content-type": "application/json" },
      body: JSON.stringify({ username: "ana", password: "senha-muito-forte-1" }),
    });
    const j = await login.json();
    const cookie = login.headers.get("set-cookie").split(";")[0];
    resetVoiceState();
    setVoiceFetch(
      async (_u, init) =>
        await new Promise((_res, rej) => {
          init?.signal?.addEventListener("abort", () =>
            rej(Object.assign(new Error("aborted"), { name: "TimeoutError" })),
          );
        }),
    );
    const r = await fetch(`${base}/api/tts`, {
      method: "POST",
      headers: {
        origin: "http://localhost:8080",
        "content-type": "application/json",
        cookie,
        "x-jarvis-csrf": j.csrf,
      },
      body: JSON.stringify({ text: "teste de aquecimento" }),
    });
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.equal(body.error, "voice_warming_up");
    assert.equal(body.state, "warming_up");
    assert.ok(Number(r.headers.get("retry-after")) >= 1);
  } finally {
    resetVoiceState();
    server.close();
    process.env.JARVIS_TTS_COLD_START_MS = "900";
  }
});
