#!/usr/bin/env node
// Verifica que o ambiente Python da ferramenta SkillSpector instalada no CI corresponde
// exatamente ao arquivo de constraints (versões fixadas a partir do uv.lock do upstream).
//
// Uso: node scripts/verify-skillspector-deps.mjs <constraints.txt> <python-do-tool> [python-minor]
//
// Falha explícita (exit 1) quando: algo instalado está fora do lock, versão diverge do pin,
// pin incondicional (ou aplicável ao Linux) está ausente, o arquivo não é pin exato `==`,
// ou o Python do ambiente não é o esperado. Usa anotações ::error:: do GitHub Actions.
// Não lê nem imprime relatórios do scanner ou conteúdo de Skills.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [constraintsPath, toolPython, expectedMinor] = process.argv.slice(2);
if (!constraintsPath || !toolPython) {
  console.error("uso: node scripts/verify-skillspector-deps.mjs <constraints.txt> <python-do-tool> [python-minor]");
  process.exit(2);
}

const uv = process.env.UV_BIN || "uv";

function fail(msg) {
  console.error(`::error::${msg}`);
  process.exit(1);
}

// ---- constraints: name==version [; marcador]
const entries = [];
for (const rawLine of readFileSync(constraintsPath, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const noContinuation = line.replace(/\\+$/, "").trim();
  const [reqPart, ...markerParts] = noContinuation.split(" ; ");
  const marker = markerParts.join(" ; ").trim();
  const m = /^([A-Za-z0-9._-]+)==([^=;\s]+)$/.exec(reqPart.trim());
  if (!m) fail(`constraint não é um pin exato name==version: ${reqPart.trim()}`);
  entries.push({ name: m[1].toLowerCase(), version: m[2], marker });
}
if (entries.length === 0) fail("arquivo de constraints sem entradas");

// ---- ambiente instalado (via uv, sem depender do pip dentro do venv)
const list = spawnSync(uv, ["pip", "list", "--python", toolPython, "--format", "freeze"], { encoding: "utf8" });
if (list.status !== 0) fail(`não foi possível listar o ambiente da ferramenta (uv pip list): ${(list.stderr || "").trim()}`);
const installed = new Map();
for (const rawLine of list.stdout.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line) continue;
  const sep = line.lastIndexOf("==");
  if (sep < 0) continue;
  installed.set(line.slice(0, sep).toLowerCase(), line.slice(sep + 2));
}
if (installed.size === 0) fail("ambiente da ferramenta sem pacotes instalados");

// ---- 1) nada instalado fora do lock; toda versão igual ao pin
const byName = new Map(entries.map((e) => [e.name, e]));
const divergences = [];
for (const [name, version] of [...installed].sort()) {
  if (name === "skillspector") continue; // a ferramenta vem do commit fixado, não do lock de deps
  const pinned = byName.get(name);
  if (!pinned) divergences.push(`${name}==${version} (ausente do lock)`);
  else if (pinned.version !== version) divergences.push(`${name}==${version} (lock exige ${pinned.version})`);
}
if (divergences.length) fail(`pacote(s) instalado(s) fora do lock fixado: ${divergences.join(", ")}`);

// ---- 2) todo pin incondicional (ou aplicável ao Linux) tem de estar instalado
const missing = [];
const skippedConditional = [];
for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
  if (installed.has(e.name)) continue;
  if (!e.marker) missing.push(`${e.name}==${e.version} (incondicional)`);
  else if (/linux/i.test(e.marker)) missing.push(`${e.name}==${e.version} (marcador aplicável ao Linux: ${e.marker})`);
  else skippedConditional.push(`${e.name}==${e.version} ; ${e.marker}`);
}
if (missing.length) fail(`pin(s) do lock ausente(s) do ambiente: ${missing.join(", ")}`);

// ---- 3) Python do ambiente (minor fixado no job)
let pythonMinor = "?";
const py = spawnSync(toolPython, ["-c", "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"], { encoding: "utf8" });
if (py.status === 0) pythonMinor = py.stdout.trim();
if (expectedMinor && pythonMinor !== expectedMinor) fail(`Python do ambiente é ${pythonMinor}, esperado ${expectedMinor}`);

console.log(`ok: ${entries.length} pins conferidos; ${installed.size - 1} dependências instaladas; Python ${pythonMinor}`);
if (skippedConditional.length) console.log(`condicionais não aplicáveis (esperado): ${skippedConditional.join(", ")}`);
