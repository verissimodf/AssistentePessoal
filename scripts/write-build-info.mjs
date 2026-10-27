#!/usr/bin/env node
// Grava `server/build-info.json` com a identidade da árvore de código construída.
//
// Chamado pelo Dockerfile com `APP_VERSION`/`GIT_SHA`/`BUILD_TIME` via `--build-arg`. O commit
// vem EXCLUSIVAMENTE do argumento de build: este script não executa git nem infere do branch.
// Sem valores, escreve "unknown" — e o painel mostra "Não registrado" em vez de adivinhar.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const clean = (v, fallback = "unknown") =>
  typeof v === "string" && v.trim() ? v.trim() : fallback;
const SHA = /^[0-9a-f]{7,40}$/i;

const commit = clean(process.env.GIT_SHA);
// Rejeita qualquer coisa que não pareça um SHA: evita gravar um branch/tag como "commit".
const safeCommit = SHA.test(commit) ? commit : "unknown";

// Versão do schema SQLite (PRAGMA user_version) e estado do commit na árvore oficial.
// Ambos são metadados de BUILD: o processo em runtime não tem git nem deve adivinhar.
const rawSchema = clean(process.env.SCHEMA_VERSION);
const schemaVersion = /^\d+$/.test(rawSchema) ? Number(rawSchema) : "unknown";
const normalizeCommitStatus = (value) => {
  const v = clean(value).toLowerCase();
  if (["registrado", "registered", "official"].includes(v)) return "Registrado";
  if (["local", "não registrado (local)", "nao registrado (local)", "unregistered"].includes(v)) {
    return "Não registrado (local)";
  }
  return "unknown";
};
const commitStatus = normalizeCommitStatus(process.env.BUILD_COMMIT_STATUS);

// Manifesto do repositório: `.app-version` gravado no build a partir do package.json. O caminho
// segue a mesma regra do serviço — `JARVIS_DATA_DIR` → cwd, que no build resolve para `/app`.
const readManifest = () => {
  try {
    const base = process.env.JARVIS_DATA_DIR || process.cwd();
    return readFileSync(resolve(base, ".app-version"), "utf8").trim() || "unknown";
  } catch {
    return "unknown"; // build fora do Dockerfile (ex.: teste local) — sem manifesto, sem versão.
  }
};

// Versão: um `--build-arg APP_VERSION` vence; sem ele (ou com o marcador vazio/"sem-build"), cai no
// manifesto do repositório (`.app-version`, extraído do package.json no build). O manifesto é a
// fonte versionada do código — reportá-lo não é adivinhar. Sem manifesto, "unknown".
// A ordem importa: "sem-build" é um literal, não uma string vazia, então é tratado à parte.
const explicit = typeof process.env.APP_VERSION === "string" ? process.env.APP_VERSION.trim() : "";
const version = explicit && explicit !== "sem-build" ? explicit : readManifest();

const info = {
  appVersion: version,
  commit: safeCommit,
  buildTime: clean(process.env.BUILD_TIME),
  mode: clean(process.env.NODE_ENV),
  schemaVersion,
  commitStatus,
};

// Validação estrita de release (P0.3.1): `RELEASE_BUILD=1` exige identidade COMPLETA e válida.
// Um release sem SHA/versão/instante verificáveis é FALHA de build — nunca um "unknown" silencioso
// que só se descobre em produção. Builds de desenvolvimento continuam tolerantes (fallbacks honestos).
if (process.env.RELEASE_BUILD === "1") {
  const problems = [];
  if (!/^[0-9a-f]{40}$/.test(info.commit))
    problems.push(
      `GIT_SHA inválido ("${info.commit}") — tem de ser o SHA completo (40 hex) do commit efetivamente construído`,
    );
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(info.buildTime))
    problems.push(
      `BUILD_TIME inválido ("${info.buildTime}") — tem de ser UTC em RFC3339 (ex.: 2026-10-18T17:40:00Z)`,
    );
  if (!info.appVersion || info.appVersion === "unknown" || info.appVersion === "sem-build")
    problems.push("APP_VERSION ausente — tem de vir do manifesto (package.json) ou de --build-arg");
  if (!/^\d+$/.test(String(info.schemaVersion)))
    problems.push(
      `SCHEMA_VERSION inválido ("${info.schemaVersion}") — tem de ser o user_version numérico do SQLite`,
    );
  if (info.commitStatus === "unknown")
    problems.push("BUILD_COMMIT_STATUS ausente — use 'Registrado' ou 'Não registrado (local)'");
  if (problems.length) {
    console.error(
      `[build-info] RELEASE_BUILD com metadados inválidos:\n - ${problems.join("\n - ")}`,
    );
    process.exit(1);
  }
}

// Mesma regra do serviço: `JARVIS_DATA_DIR` → cwd. Assim o `server/build-info.json` vai para onde
// `server/build-info.js` procura, e nunca deixa artefactos fora do diretório de dados.
const out = resolve(process.env.JARVIS_DATA_DIR || process.cwd(), "server", "build-info.json");
// O build tem cwd=/app e o `server/` já existe, mas o diretório é criado para não depender disso.
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(info, null, 2) + "\n");
console.log(
  `[build-info] versão=${info.appVersion} commit=${info.commit} status=${info.commitStatus} schema=${info.schemaVersion} build=${info.buildTime} modo=${info.mode}`,
);
