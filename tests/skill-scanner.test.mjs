import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSkillCandidate } from "../server/skill-scanner.js";

const bundle = () => {
  const root = mkdtempSync(join(tmpdir(), "jarvis-skill-candidate-"));
  writeFileSync(join(root, "SKILL.md"), "---\nname: test-skill\ndescription: A test skill\n---\nDo not execute this content.\n");
  return root;
};
const report = (recommendation = "SAFE", score = 0) => JSON.stringify({
  risk_assessment: { score, severity: score > 50 ? "HIGH" : score > 20 ? "MEDIUM" : "LOW", recommendation },
  issues: [],
  metadata: { skillspector_version: "test" },
});
const fake = (stdout, status = 0) => (_command, args) => {
  assert.ok(args.includes("--no-llm"), "não envia conteúdo para análise semântica externa");
  assert.ok(args.includes("--fail-on-incomplete"), "análise incompleta deve falhar fechada");
  assert.ok(args.includes("--min-coverage") && args.includes("100"), "exige cobertura integral");
  return { stdout, status, error: null };
};

test("SAFE com saída zero permite avançar para a etapa seguinte", () => {
  const root = bundle();
  try {
    const result = scanSkillCandidate(root, { runScanner: fake(report("SAFE")) });
    assert.equal(result.decision, "approved");
    assert.equal(result.safeToInstall, true);
    assert.equal(result.recommendation, "SAFE");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CAUTION exige revisão humana e não permite instalação automática", () => {
  const root = bundle();
  try {
    const result = scanSkillCandidate(root, { runScanner: fake(report("CAUTION", 35)) });
    assert.equal(result.decision, "review_required");
    assert.equal(result.safeToInstall, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("DO_NOT_INSTALL bloqueia mesmo com saída zero", () => {
  const root = bundle();
  try {
    const result = scanSkillCandidate(root, { runScanner: fake(report("DO_NOT_INSTALL", 80)) });
    assert.equal(result.decision, "blocked");
    assert.equal(result.safeToInstall, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("código de saída não zero bloqueia mesmo se o relatório disser SAFE", () => {
  const root = bundle();
  try {
    const result = scanSkillCandidate(root, { runScanner: fake(report("SAFE"), 1) });
    assert.equal(result.decision, "blocked");
    assert.equal(result.safeToInstall, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scanner indisponível, JSON inválido e veredito desconhecido falham fechados", () => {
  const root = bundle();
  try {
    assert.equal(scanSkillCandidate(root, { runScanner: () => ({ error: new Error("ENOENT") }) }).decision, "blocked");
    assert.equal(scanSkillCandidate(root, { runScanner: fake("não-json") }).decision, "blocked");
    assert.equal(scanSkillCandidate(root, { runScanner: fake(report("MAYBE")) }).decision, "blocked");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("só aceita conteúdo local em quarentena com SKILL.md", () => {
  assert.equal(scanSkillCandidate("https://example.invalid/skill").decision, "blocked");
  const root = mkdtempSync(join(tmpdir(), "jarvis-skill-empty-"));
  try {
    assert.equal(scanSkillCandidate(root, { runScanner: fake(report("SAFE")) }).decision, "blocked");
    const nested = join(root, "nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "README.md"), "not a skill manifest");
    assert.equal(scanSkillCandidate(nested, { runScanner: fake(report("SAFE")) }).decision, "blocked");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
