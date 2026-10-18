import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateSkill, computeSkillState, loadSkillDir, readEnabledList,
  KNOWN_PERMISSIONS, SKILL_RISKS, SkillValidationError,
} from "../server/skill-registry.js";

// Fase 1 (E) — núcleo do Skill Registry: validação + estado. Sem execução.

const SKILLS_DIR = fileURLToPath(new URL("../skills/", import.meta.url));

const valido = () => ({
  id: "smoke-painel-sem-sessao",
  version: "0.1.0",
  description: "Smoke de leitura do painel sem sessão; não escreve nem envia nada.",
  inputs: [{ name: "base_url", type: "string", required: true }],
  outputs: [{ name: "evidencia", type: "json" }],
  dependencies: [],
  permissions: [],
  allowedNetworkDestinations: [],
  tools: [],
  mcps: [],
  execLimits: { timeoutMs: 60000, maxCalls: 10, maxOutputBytes: 262144 },
  tests: [{ name: "rotas-anonimas-401", path: "tests/http-auth.test.mjs" }],
  successCriteria: "Painel 200 e /api/auth/me 401 sem sessão; evidência com passed ou blocked.",
  risk: "low",
  reviewState: "draft",
});
const expectIssue = (mut, re) =>
  assert.throws(() => validateSkill(mut()), (e) => {
    assert.ok(e instanceof SkillValidationError, `esperado SkillValidationError, veio ${e.name}`);
    assert.ok(e.issues.some((i) => re.test(i)), `questões: ${JSON.stringify(e.issues)} — procurado ${re}`);
    return true;
  }, `devia falhar com ${re}`);

test("manifesto válido passa", () => {
  assert.equal(validateSkill(valido()), true);
});

test("campos obrigatórios: cada um em falta falha", () => {
  for (const f of ["id", "version", "description", "inputs", "outputs", "dependencies",
    "permissions", "allowedNetworkDestinations", "tools", "mcps", "execLimits", "tests",
    "successCriteria", "risk", "reviewState"]) {
    const m = valido(); delete m[f];
    assert.throws(() => validateSkill(m), (e) => {
      assert.ok(e instanceof SkillValidationError);
      assert.ok(e.issues.some((i) => i.includes(`em falta: ${f}`)),
        `questões ${JSON.stringify(e.issues)} deviam mencionar ${f}`);
      return true;
    }, `faltando ${f} devia falhar`);
  }
});

test("schema fechado: campo desconhecido rejeitado (sem contrabando de poder)", () => {
  expectIssue(() => ({ ...valido(), shell: "rm -rf /" }), /campo desconhecido/);
  expectIssue(() => ({ ...valido(), superuser: true }), /campo desconhecido/);
});

test("permissões: só as da allowlist do servidor", () => {
  assert.ok(KNOWN_PERMISSIONS.includes("memories:read"));
  for (const p of ["admin:*", "conversations:write", "host:shell", ""]) {
    expectIssue(() => ({ ...valido(), permissions: [p] }), /permission não permitida/);
  }
  // permissão legítima passa
  assert.equal(validateSkill({ ...valido(), permissions: ["memories:read"] }), true);
});

test("ferramentas: só as que existem no servidor (TOOL_DEFS)", () => {
  assert.equal(validateSkill({ ...valido(), tools: ["recall"] }), true);
  for (const t of ["rm_rf", "send_message_bypass", ""]) {
    expectIssue(() => ({ ...valido(), tools: [t] }), /tool inexistente no servidor/);
  }
});

test("rede: http(s) público ok; privado/metadados/ftp/portas erradas rejeitados", () => {
  assert.equal(validateSkill({ ...valido(), allowedNetworkDestinations: ["https://mozilla.github.io"] }), true);
  for (const d of ["http://169.254.169.254/latest/meta-data/", "ftp://arquivo.test/x",
    "https://user:pass@x.test/", "https://x.test:8443/", "javascript:alert(1)"]) {
    expectIssue(() => ({ ...valido(), allowedNetworkDestinations: [d] }), /destino de rede rejeitado/);
  }
});

test("mcps: rejeitados enquanto não houver gateway de conectores (Fase F)", () => {
  expectIssue(() => ({ ...valido(), mcps: ["servidor-remoto-qualquer"] }), /conector MCP não registado/);
});

test("limites de execução obrigatórios e dentro dos bounds", () => {
  for (const bad of [
    { timeoutMs: 500 }, { timeoutMs: 700000 }, { maxCalls: 0 }, { maxCalls: 5000 },
    { maxOutputBytes: 10 }, { maxOutputBytes: 9_000_000 },
  ]) {
    expectIssue(() => ({ ...valido(), execLimits: { timeoutMs: 60000, maxCalls: 10, maxOutputBytes: 262144, ...bad } }),
      /execLimits/);
  }
});

test("risk e reviewState: valores válidos; enabled autoconcedido rejeitado", () => {
  assert.ok(SKILL_RISKS.includes("high"));
  for (const r of ["critical", "", "low-ish"]) expectIssue(() => ({ ...valido(), risk: r }), /risk/);
  for (const s of [" Enabled", "live", ""]) expectIssue(() => ({ ...valido(), reviewState: s }), /reviewState/);
  // auto-ativação no manifesto nunca é aceite (a ativação é externa e humana)
  expectIssue(() => ({ ...valido(), reviewState: "enabled" }), /reviewState não pode ser 'enabled'/);
});

test("bloco review: obrigatório a partir de reviewed; revisão humana nunca de agente", () => {
  const m = valido();
  expectIssue(() => ({ ...m, reviewState: "reviewed" }), /review: bloco/);
  expectIssue(() => ({ ...m, reviewState: "approved" }), /review: bloco/);
  const rev = { reviewed_by: "dono", approved_at: "2026-10-18T00:00:00Z", approval_ref: "PR #99" };
  assert.equal(validateSkill({ ...m, reviewState: "reviewed", review: rev }), true);
  assert.equal(validateSkill({ ...m, reviewState: "approved", review: rev }), true);
  for (const who of ["opencode-agent", "claude", "LLM Bot", "gpt-5"]) {
    expectIssue(() => ({ ...m, reviewState: "approved", review: { ...rev, reviewed_by: who } }), /identidade de agente/);
  }
  expectIssue(() => ({ ...m, reviewState: "approved", review: { ...rev, approved_at: "ontem" } }), /approved_at/);
  expectIssue(() => ({ ...m, reviewState: "approved", review: { ...rev, approval_ref: "" } }), /approval_ref/);
  expectIssue(() => ({ ...m, review: rev }), /review só existe/);
});

test("id e version: formato rígido", () => {
  expectIssue(() => ({ ...valido(), id: "Com Espaços" }), /id/);
  expectIssue(() => ({ ...valido(), id: "x" }), /id/);
  expectIssue(() => ({ ...valido(), version: "1.0" }), /version/);
  expectIssue(() => ({ ...valido(), version: "v1.0.0" }), /version/);
});

test("estado: draft nunca ativo; approved sem ativação humana fica inativo", () => {
  const m = valido();
  assert.equal(computeSkillState(m, ["smoke-painel-sem-sessao"]).active, false,
    "draft não fica ativo mesmo com o id na lista de ativação");
  const aprovada = {
    ...m, reviewState: "approved",
    review: { reviewed_by: "dono", approved_at: "2026-10-18T00:00:00Z", approval_ref: "PR #99" },
  };
  const s1 = computeSkillState(aprovada, []);
  assert.equal(s1.active, false);
  assert.match(s1.blockedReason, /aguarda ativação humana/);
  const s2 = computeSkillState(aprovada, [m.id]);
  assert.equal(s2.active, true, "approved + lista humana de ativação = ativa");
});

test("loadSkillDir: devolve skills válidas e erros por ficheiro (não lança)", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"));
  writeFileSync(join(dir, "ok.json"), JSON.stringify(valido()));
  writeFileSync(join(dir, "quebrada.json"), JSON.stringify({ id: "x" }));
  writeFileSync(join(dir, "_nota.json"), JSON.stringify({ ignora: true }));
  writeFileSync(join(dir, "enabled.json"), JSON.stringify({ enabled: ["ok"] }));
  const { skills, errors } = loadSkillDir(dir);
  assert.equal(skills.length, 1, "só a válida (_ e enabled.json ignorados)");
  assert.equal(errors.length, 1, "a quebrada reportada, não lança");
  assert.equal(errors[0].file, "quebrada.json");
});

test("readEnabledList: ausente/quebrado = [] (nada ativo por omissão)", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-en-"));
  assert.deepEqual(readEnabledList(dir), []);
  writeFileSync(join(dir, "enabled.json"), "{ não é json");
  assert.deepEqual(readEnabledList(dir), []);
  writeFileSync(join(dir, "enabled.json"), JSON.stringify({ enabled: ["a", 1, "b"] }));
  assert.deepEqual(readEnabledList(dir), ["a", "b"]);
});

test("skills/ do projeto: exemplo carrega sem erros e não está ativo", () => {
  const { skills, errors } = loadSkillDir(SKILLS_DIR);
  assert.deepEqual(errors, [], "nenhum manifesto inválido no repositório");
  assert.ok(skills.some((s) => s.id === "smoke-painel-sem-sessao"));
  const enabled = readEnabledList(SKILLS_DIR);
  assert.deepEqual(enabled, [], "nenhuma skill ativada por omissão");
  for (const s of skills) {
    assert.equal(computeSkillState(s, enabled).active, false, `${s.id} não pode estar ativa por omissão`);
  }
});
