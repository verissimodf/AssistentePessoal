// Testes das constraints de BUILD (PEP 517) do SkillSpector.
// O teste é estático (sem rede/build); a garantia em runtime é o passo do CI que instala com
// `--build-constraints ... --require-build-hashes` — se qualquer dependência de build não estiver
// pinada com hash, o uv falha explicitamente.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const buildConstraintsPath = join(root, ".github/skillspector-build-constraints.txt");
const workflowPath = join(root, ".github/workflows/ci.yml");

const EXPECTED = new Map([
  ["hatchling", "1.31.0"],
  ["packaging", "26.2"],
  ["pathspec", "1.1.1"],
  ["pluggy", "1.6.0"],
  ["trove-classifiers", "2026.6.1.19"],
]);

function normalizeName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

export function parseBuildConstraints(text) {
  const logical = [];
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const continues = trimmed.endsWith("\\");
    current += `${current ? " " : ""}${continues ? trimmed.slice(0, -1).trim() : trimmed}`;
    if (!continues) {
      logical.push(current);
      current = "";
    }
  }
  if (current) throw new Error("linha de continuação sem fim");

  const entries = new Map();
  for (const req of logical) {
    const m = req.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s]+)(?:\s+(.+))?$/);
    if (!m) throw new Error(`não é um pin exato name==version: ${req}`);
    const [, name, version, rest = ""] = m;
    const hashes = [...rest.matchAll(/--hash=sha256:([0-9a-f]{64})(?=\s|$)/g)].map((x) => x[1]);
    if (!hashes.length) throw new Error(`sem hash sha256: ${name}==${version}`);
    const normalized = normalizeName(name);
    if (entries.has(normalized)) throw new Error(`duplicado (após normalização): ${normalized}`);
    entries.set(normalized, { name, version, hashes });
  }
  return entries;
}

test("constraints de build pinam hatchling e transitivas com hashes", () => {
  const text = readFileSync(buildConstraintsPath, "utf8");
  const entries = parseBuildConstraints(text);

  assert.deepEqual([...entries.keys()].sort(), [...EXPECTED.keys()].sort());
  for (const [name, version] of EXPECTED) {
    const entry = entries.get(name);
    assert.equal(entry.version, version, `${name} com versão divergente`);
    assert.ok(entry.hashes.length >= 1, `${name} sem hash`);
  }
  assert.match(text, /091a509b3d6ba8ff5be528966e1f43c2e68cf214/);
  assert.match(text, /uv 0\.13\.1/);
});

test("workflow aplica build constraints e exige hashes de build", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /--build-constraints \.github\/skillspector-build-constraints\.txt/);
  assert.match(workflow, /--require-build-hashes/);
  assert.match(workflow, /--no-cache/);
});

test("workflow, constraints de runtime e de build apontam para o mesmo commit", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const build = readFileSync(buildConstraintsPath, "utf8");
  const runtime = readFileSync(join(root, ".github/skillspector-constraints.txt"), "utf8");

  const commit = workflow.match(/SkillSpector\.git@([0-9a-f]{40})/)?.[1];
  assert.ok(commit, "commit imutável do scanner ausente no workflow");
  assert.match(build, new RegExp(commit));
  assert.match(runtime, new RegExp(commit));
});

test("parser rejeita pin sem hash", () => {
  assert.throws(() => parseBuildConstraints("foo==1.0\n"), /sem hash/);
});

test("parser rejeita linha que não é pin exato", () => {
  assert.throws(() => parseBuildConstraints("foo>=1.0\n"), /pin exato/);
});

test("parser rejeita duplicata após normalização", () => {
  const h = "a".repeat(64);
  const text = [
    "Foo==1.0 \\",
    `    --hash=sha256:${h}`,
    "foo==1.0 \\",
    `    --hash=sha256:${h}`,
  ].join("\n");
  assert.throws(() => parseBuildConstraints(text), /duplicado/);
});
