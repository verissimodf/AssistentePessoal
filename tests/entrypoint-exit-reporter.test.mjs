// O entrypoint encerra o conjunto quando QUALQUER filho termina (`wait -n`), mas não registra
// qual foi — foi exatamente o que impediu diagnosticar as duas reinicializações de 24/10.
// A função abaixo reporta o componente e o status, com fallback para bash sem `wait -n -p`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(RAIZ, "scripts", "lib", "exit-reporter.sh");

/** Executa a função com filhos de teste e devolve stderr + status. */
function executar(script) {
  const r = spawnSync("bash", ["-c", `set -u; . "${LIB}"; ${script}`], { encoding: "utf8" });
  return { stderr: r.stderr, stdout: r.stdout, status: r.status };
}

test("reporta o índice e o status do componente que terminou", () => {
  const { stderr, status } = executar(`
    sleep 2 & p1=$!
    (sleep 0.3; exit 0) & p2=$!
    wait_for_first_exit "$p1" "$p2"
  `);
  assert.equal(status, 0, "o status do filho deve ser propagado");
  assert.match(stderr, /componente 1/);
  assert.match(stderr, /status=0/);
  assert.match(stderr, /Docker reiniciar/);
});

test("propaga status de falha do filho", () => {
  const { stderr, status } = executar(`
    sleep 2 & p1=$!
    (sleep 0.3; exit 3) & p2=$!
    wait_for_first_exit "$p1" "$p2"
  `);
  assert.equal(status, 3);
  assert.match(stderr, /componente 1/);
  assert.match(stderr, /status=3/);
});

test("distingue término normal, encerramento solicitado e falha", () => {
  const casos = [
    ["0", /término normal/],
    ["143", /encerramento solicitado \(SIGTERM\)/],
    ["130", /interrompido \(SIGINT\)/],
    ["137", /morto à força \(SIGKILL\/OOM\)/],
    ["3", /falha/],
  ];
  for (const [codigo, esperado] of casos) {
    const { stderr, status } = executar(`
      sleep 2 & p1=$!
      (sleep 0.3; exit ${codigo}) & p2=$!
      wait_for_first_exit "$p1" "$p2"
    `);
    assert.equal(status, Number(codigo), `status ${codigo}`);
    assert.match(stderr, esperado, `motivo para ${codigo}`);
    assert.match(stderr, /componente 1/);
  }
});

test("não falha quando o bash não suporta wait -n -p", () => {
  // Simula a ausência do recurso forçando a variável de decisão usada pela função.
  const { stderr, status } = executar(`
    EXIT_REPORTER_FORCE_FALLBACK=1
    sleep 2 & p1=$!
    (sleep 0.3; exit 7) & p2=$!
    wait_for_first_exit "$p1" "$p2"
  `);
  assert.equal(status, 7);
  assert.match(stderr, /componente desconhecido|terminou/);
});
