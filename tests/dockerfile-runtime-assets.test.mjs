// Contrato da IMAGEM: o estágio de runtime do Dockerfile tem de copiar TODOS os
// diretórios de topo que o servidor lê em runtime.
//
// Motivo (regressão real): `server/skill-scanner.js` resolve `../skills/`
// (=> /app/skills) no TOPO do módulo, e `server/index.js` importa esse módulo.
// A imagem construída sem `skills/` no estágio de runtime morre no arranque com
// `ENOENT ... lstat '/app/skills'` — o contentor nunca fica healthy. O CI não
// constrói a imagem, portanto este teste é a barreira.
//
// Teste ESTÁTICO: não constrói nem arranca a imagem (o CI não tem job de build).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dockerfile = readFileSync(join(repo, "Dockerfile"), "utf8");

/** Diretórios de topo que o servidor precisa em runtime (/app/<dir>). */
const REQUIRED_RUNTIME_ASSETS = ["skills"];

/** Estágio de runtime = último bloco `FROM ... AS <stage>`. */
function runtimeStage() {
  const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/gm)];
  assert.ok(froms.length > 0, "Dockerfile sem FROM");
  const last = froms[froms.length - 1];
  const start = last.index + last[0].length;
  const rest = dockerfile.slice(start);
  const nextFrom = rest.search(/^FROM\s+/m);
  return nextFrom === -1 ? rest : rest.slice(0, nextFrom);
}

function copySources(stage) {
  const out = new Set();
  for (const m of stage.matchAll(/^\s*COPY\s+(.+)$/gm)) {
    const line = m[1].replace(/\s*#.*$/, "").trim();
    if (!line) continue;
    // Formas suportadas: "src dest" e "src1 src2 ... dest" (com ou sem --from=).
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    for (const token of parts.slice(0, -1)) {
      if (token.startsWith("--from=")) continue; // origem = outro estágio, não o contexto
      out.add(token.replace(/^\.\//, "").replace(/\/$/, ""));
    }
  }
  return out;
}

test("a imagem de runtime copia os diretórios de topo exigidos pelo servidor", () => {
  const stage = runtimeStage();
  const copied = copySources(stage);
  const missing = REQUIRED_RUNTIME_ASSETS.filter((d) => !copied.has(d));
  assert.deepEqual(
    missing,
    [],
    `a imagem de runtime nao copia: ${missing.join(", ")} — o contentor morre no arranque com ENOENT`,
  );
});

test(".dockerignore nao exclui os assets de runtime do contexto de build", () => {
  const ignore = readFileSync(join(repo, ".dockerignore"), "utf8");
  for (const asset of REQUIRED_RUNTIME_ASSETS) {
    const excluded = ignore
      .split("\n")
      .map((l) => l.trim())
      .some(
        (l) =>
          l &&
          !l.startsWith("#") &&
          (l === asset || l === `${asset}/` || l === `**/${asset}` || l === `**/${asset}/`),
      );
    assert.equal(
      excluded,
      false,
      `.dockerignore exclui "${asset}": o COPY seria vazio e a imagem voltaria a nao arrancar`,
    );
  }
});

test("o catalogo de Skills existe no repositorio (origem da COPY)", () => {
  for (const asset of REQUIRED_RUNTIME_ASSETS) {
    assert.ok(existsSync(join(repo, asset)), `diretorio ausente no repositorio: ${asset}`);
  }
});

test("o servidor resolve skills/ no topo do modulo (a razao do requisito)", () => {
  const scanner = readFileSync(join(repo, "server", "skill-scanner.js"), "utf8");
  assert.match(
    scanner,
    /new URL\("\.\.\/skills\/"/,
    "server/skill-scanner.js deixou de resolver ../skills/ — reveja se este requisito ainda se aplica",
  );
});
