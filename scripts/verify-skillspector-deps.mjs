#!/usr/bin/env node
// Verifica que o ambiente Python da ferramenta SkillSpector instalada no CI corresponde
// exatamente ao arquivo de constraints (versões fixadas a partir do uv.lock do upstream).
//
// Uso: node scripts/verify-skillspector-deps.mjs <constraints.txt> <python-do-tool> [python-minor]
//
// Falha explícita (exit 1) quando: algo instalado está fora do lock, versão diverge do pin,
// pin incondicional (ou aplicável ao Linux) está ausente, o pacote principal `skillspector`
// não está instalado, o Python do ambiente não é o esperado, ou há linha/nome malformado ou
// duplicado (após normalização PEP 503) no arquivo de constraints ou na listagem do ambiente.
// Usa anotações ::error:: do GitHub Actions. Não lê nem imprime relatórios do scanner ou
// conteúdo de Skills.
//
// As funções puras de parsing/análise são exportadas para testes unitários
// (tests/verify-skillspector-deps.test.mjs); o main só roda na execução direta.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const UV = process.env.UV_BIN || "uv";
const MAIN_PACKAGE = "skillspector";

// Normalização PEP 503: minúsculas e runs de [-_.] viram um único "-".
export function normalizeName(name) {
  return name.trim().toLowerCase().replace(/[-_.]+/g, "-");
}

// Constraints: `name==version` opcionalmente seguido de `; marcador`. Comentários e linhas
// vazias são ignorados; nome duplicado (após normalização) falha em vez de sobrescrever.
export function parseConstraints(text) {
  const entries = [];
  const seen = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const noContinuation = line.replace(/\\+$/, "").trim();
    const [reqPart, ...markerParts] = noContinuation.split(" ; ");
    const marker = markerParts.join(" ; ").trim();
    const m = /^([A-Za-z0-9._-]+)==([^=;\s]+)$/.exec(reqPart.trim());
    if (!m) throw new Error(`constraint não é um pin exato name==version: ${reqPart.trim()}`);
    const name = normalizeName(m[1]);
    if (seen.has(name)) throw new Error(`constraint duplicada (após normalização): ${name}`);
    seen.add(name);
    entries.push({ name, version: m[2], marker });
  }
  if (entries.length === 0) throw new Error("arquivo de constraints sem entradas");
  return entries;
}

// Listagem de `uv pip list --format freeze`: cada linha não vazia tem de ser `name==version`;
// nome duplicado (após normalização) falha em vez de sobrescrever no Map.
export function parseFreezeOutput(text) {
  const installed = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sep = line.lastIndexOf("==");
    const name = sep >= 0 ? line.slice(0, sep) : "";
    const version = sep >= 0 ? line.slice(sep + 2) : "";
    if (!/^[A-Za-z0-9._-]+$/.test(name) || !version || /[\s=]/.test(version)) {
      throw new Error(`linha não interpretável como name==version em uv pip list: ${line}`);
    }
    const normalized = normalizeName(name);
    if (installed.has(normalized)) {
      throw new Error(`pacote duplicado (após normalização) em uv pip list: ${normalized}`);
    }
    installed.set(normalized, version);
  }
  if (installed.size === 0) throw new Error("ambiente da ferramenta sem pacotes instalados");
  return installed;
}

// Confere o conjunto instalado contra os pins e devolve o resumo (ou lança Error).
export function checkEnvironment(entries, installed, { pythonMinor, expectedMinor } = {}) {
  if (!installed.has(MAIN_PACKAGE)) {
    throw new Error(`pacote principal ausente do ambiente: ${MAIN_PACKAGE}`);
  }

  // 1) nada instalado fora do lock; toda versão igual ao pin
  const byName = new Map(entries.map((e) => [e.name, e]));
  const divergences = [];
  let depCount = 0;
  for (const [name, version] of [...installed].sort()) {
    if (name === MAIN_PACKAGE) continue; // a ferramenta vem do commit fixado, não do lock de deps
    depCount += 1;
    const pinned = byName.get(name);
    if (!pinned) divergences.push(`${name}==${version} (ausente do lock)`);
    else if (pinned.version !== version) divergences.push(`${name}==${version} (lock exige ${pinned.version})`);
  }
  if (divergences.length) throw new Error(`pacote(s) instalado(s) fora do lock fixado: ${divergences.join(", ")}`);

  // 2) todo pin incondicional (ou aplicável ao Linux) tem de estar instalado
  const missing = [];
  const skippedConditional = [];
  for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    if (installed.has(e.name)) continue;
    if (!e.marker) missing.push(`${e.name}==${e.version} (incondicional)`);
    else if (/linux/i.test(e.marker)) missing.push(`${e.name}==${e.version} (marcador aplicável ao Linux: ${e.marker})`);
    else skippedConditional.push(`${e.name}==${e.version} ; ${e.marker}`);
  }
  if (missing.length) throw new Error(`pin(s) do lock ausente(s) do ambiente: ${missing.join(", ")}`);

  // 3) Python do ambiente (minor fixado no job)
  if (expectedMinor && pythonMinor !== expectedMinor) {
    throw new Error(`Python do ambiente é ${pythonMinor}, esperado ${expectedMinor}`);
  }

  return { depCount, skippedConditional };
}

function readPythonMinor(toolPython) {
  const py = spawnSync(toolPython, ["-c", "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"], { encoding: "utf8" });
  return py.status === 0 ? py.stdout.trim() : "?";
}

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

function main() {
  const [constraintsPath, toolPython, expectedMinor] = process.argv.slice(2);
  if (!constraintsPath || !toolPython) {
    console.error("uso: node scripts/verify-skillspector-deps.mjs <constraints.txt> <python-do-tool> [python-minor]");
    process.exit(2);
  }
  try {
    const entries = parseConstraints(readFileSync(constraintsPath, "utf8"));
    const list = spawnSync(UV, ["pip", "list", "--python", toolPython, "--format", "freeze"], { encoding: "utf8" });
    if (list.status !== 0) {
      throw new Error(`não foi possível listar o ambiente da ferramenta (uv pip list): ${(list.stderr || "").trim()}`);
    }
    const installed = parseFreezeOutput(list.stdout);
    const pythonMinor = readPythonMinor(toolPython);
    const { depCount, skippedConditional } = checkEnvironment(entries, installed, { pythonMinor, expectedMinor });
    console.log(`ok: ${entries.length} pins conferidos; ${depCount} dependências instaladas; Python ${pythonMinor}`);
    if (skippedConditional.length) {
      console.log(`condicionais não aplicáveis (esperado): ${skippedConditional.join(", ")}`);
    }
  } catch (err) {
    fail(err.message);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
