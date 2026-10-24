// Cancelamento cooperativo: `cancelRun` precisa interromper a chamada de provedor EM VOO, não
// apenas sinalizar entre passos. Sem isso, o usuário cancela e a execução continua até o timeout.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-cancel-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db } = await import("../server/db.js");
const { runAgent, cancelRun, runActive } = await import("../server/llm.js");

const PW = "senha-muito-forte-1";
let principal;
const realFetch = globalThis.fetch;

before(() => {
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const admin = db.prepare("SELECT id FROM admins WHERE active=1").get();
  principal = { adminId: admin.id, role: "admin", scopes: ["*"] };
});
after(() => {
  globalThis.fetch = realFetch;
});

/** Provedor que nunca responde, mas honra o abort (inclui o sinal de cancelamento). */
const hang = (init) =>
  new Promise((_, reject) => {
    const fail = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (init?.signal?.aborted) return fail();
    init?.signal?.addEventListener("abort", fail, { once: true });
  });

async function withKeepAlive(fn, guardMs = 8000) {
  const keep = setInterval(() => {}, 250);
  try {
    return await Promise.race([
      fn(),
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error(`run não respondeu ao cancelamento (${guardMs}ms)`)),
          guardMs,
        ),
      ),
    ]);
  } finally {
    clearInterval(keep);
  }
}

test("cancelRun interrompe a chamada em voo e a execução termina como cancelada", async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/chat/completions")) return hang(init);
    return realFetch(url, init);
  };
  const runId = "run-cancel-1";
  const t0 = Date.now();
  const p = withKeepAlive(() =>
    runAgent({
      messages: [{ role: "user", content: "tarefa longa" }],
      autonomy: "confirm",
      principal,
      runId,
      deadlineMs: 120_000,
    }),
  );
  // Só cancela depois que a execução está registrada e a chamada começou.
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(runActive(runId), true, "run deveria estar ativo antes do cancelamento");
  assert.equal(cancelRun(runId), true);
  const out = await p;
  const elapsed = Date.now() - t0;
  assert.match(out.reply, /cancelada/i);
  assert.ok(elapsed < 5000, `cancelamento deveria ser imediato, levou ${elapsed}ms`);
  assert.equal(runActive(runId), false, "run deveria sair do registro ativo");
});

test("cancelRun devolve false para execução desconhecida", () => {
  assert.equal(cancelRun("run-inexistente"), false);
});
