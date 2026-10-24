// Um provedor morto não pode consumir o orçamento inteiro da execução: cada tentativa é
// limitada pelo tempo restante do `deadlineMs`. Sem isso, um provedor que aceita a conexão e
// nunca responde bloqueia o fallback por até 5 minutos (o teto do próprio run).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-deadline-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db } = await import("../server/db.js");
const { runAgent, attemptTimeoutMs } = await import("../server/llm.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let principal;

before(() => {
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const admin = db.prepare("SELECT id FROM admins WHERE active=1").get();
  principal = { adminId: admin.id, role: "admin", scopes: ["*"] };
});
after(() => {
  globalThis.fetch = realFetch;
});

const realFetch = globalThis.fetch;

/** Provedor que aceita a conexão e nunca responde, mas respeita o abort. */
const hang = (init) =>
  new Promise((_, reject) => {
    const fail = () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    if (init?.signal?.aborted) return fail();
    init?.signal?.addEventListener("abort", fail, { once: true });
  });

/**
 * `AbortSignal.timeout` usa timer unref: sem outro handle o processo encerraria antes do abort.
 * O keep-alive mantém o loop vivo e o guard faz a regressão falhar rápido em vez de esperar 300s.
 */
async function withKeepAlive(fn, guardMs = 8000) {
  const keep = setInterval(() => {}, 250);
  try {
    return await Promise.race([
      fn(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`run não respeitou o deadline (${guardMs}ms)`)), guardMs),
      ),
    ]);
  } finally {
    clearInterval(keep);
  }
}

test("attemptTimeoutMs limita cada tentativa ao tempo restante e a um teto", () => {
  assert.equal(attemptTimeoutMs(1200), 1200, "usa o restante quando ele é menor que o teto");
  assert.equal(attemptTimeoutMs(60_000), 60_000, "usa o restante quando há orçamento");
  assert.equal(attemptTimeoutMs(10 * 60_000), 300_000, "nunca passa do teto de 5 minutos");
  assert.equal(attemptTimeoutMs(0), 1000, "nunca fica abaixo do piso de 1s");
  assert.equal(attemptTimeoutMs(-5), 1000, "restante negativo ainda tenta uma vez com o piso");
  assert.equal(attemptTimeoutMs(Number.NaN), 300_000, "valor inválido cai no teto, não em 0");
});

test("provedor que nunca responde não estoura o deadline da execução", async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/chat/completions")) return hang(init);
    return realFetch(url, init);
  };
  const t0 = Date.now();
  const out = await withKeepAlive(() =>
    runAgent({
      messages: [{ role: "user", content: "oi" }],
      autonomy: "confirm",
      principal,
      deadlineMs: 1200,
    }),
  );
  const elapsed = Date.now() - t0;
  assert.match(out.reply, /Limite de tempo/i);
  assert.ok(elapsed < 8000, `execução deveria parar perto do deadline, levou ${elapsed}ms`);
});

test("provedor lento mas vivo ainda responde quando há orçamento", async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/chat/completions")) {
      await new Promise((r) => setTimeout(r, 250));
      const body = { choices: [{ message: { content: "ok do provedor lento" } }] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }
    return realFetch(url, init);
  };
  const out = await withKeepAlive(() =>
    runAgent({
      messages: [{ role: "user", content: "oi" }],
      autonomy: "confirm",
      principal,
      deadlineMs: 30_000,
    }),
  );
  assert.match(out.reply, /ok do provedor lento/);
});
