// P1-C remediação — provisionamento do Skills Hub: determinístico, offline e idempotente.
// Nenhuma rede, nenhum clone, nenhum socket. Diretórios temporários por teste.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "jarvis-skills-"));
const skillsDir = join(root, "hub");
process.env.JARVIS_GLOBAL_SKILLS_DIR = skillsDir;
process.env.JARVIS_DATA_DIR = join(root, "data");
process.env.JARVIS_NO_LISTEN = "1";

const { runEssentialsSetup, ESSENTIAL_SKILLS } = await import("../scripts/setup-global-skills.mjs");
const { getCatalog, getCatalogStatus, listSkills, matchSkillsForPrompt, loadSkill } =
  await import("../server/skills.js");

const quiet = () => {};
// Limpeza best-effort: no Windows o arquivo SQLite pode estar com handle aberto (EBUSY) e o
// unlink falha — a limpeza do temp dir não é requisito do teste.
after(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* Windows: jarvis.db aberto pelo módulo de banco; o temp dir fica para o SO limpar */
  }
});

test("skills: catálogo ausente é reportado com a causa (nunca 'vazio silencioso')", () => {
  const status = getCatalogStatus(skillsDir);
  assert.equal(status.present, false);
  assert.equal(status.total, 0);
  assert.equal(status.reason, "catalog_missing");
  assert.deepEqual(listSkills({ baseDir: skillsDir }), []);
});

test("skills: provisionamento offline cria catálogo determinístico com versão e origem explícitas", () => {
  const r = runEssentialsSetup({ baseDir: skillsDir, log: quiet });
  assert.equal(r.ok, true);
  assert.equal(r.totalSkills, ESSENTIAL_SKILLS.length);
  assert.ok(existsSync(r.catalogPath));
  const catalog = JSON.parse(readFileSync(r.catalogPath, "utf8"));
  assert.equal(catalog.source, "builtin");
  assert.ok(catalog.version, "versão explícita");
  assert.equal(catalog.skills.length, ESSENTIAL_SKILLS.length);
  // Cada SKILL.md consolidado existe e é legível.
  for (const s of catalog.skills) {
    const p = join(skillsDir, s.path);
    assert.ok(existsSync(p), `${s.id} materializado`);
    assert.match(readFileSync(p, "utf8"), /^---/);
  }
});

test("skills: /api/skills passa a refletir o catálogo real (não finge hub vazio)", () => {
  const status = getCatalogStatus(skillsDir);
  assert.equal(status.present, true);
  assert.equal(status.total, ESSENTIAL_SKILLS.length);
  assert.equal(status.source, "builtin");
  assert.equal(status.reason, null);
  const list = listSkills({ baseDir: skillsDir });
  assert.equal(list.length, ESSENTIAL_SKILLS.length);
  assert.ok(list.every((s) => s.id && s.name && s.description));
  const catalog = getCatalog(skillsDir);
  assert.equal(catalog.totalSkills, ESSENTIAL_SKILLS.length);
});

test("skills: provisionamento é idempotente — duas execuções não duplicam nem corrompem", () => {
  const first = JSON.parse(readFileSync(join(skillsDir, "catalog.json"), "utf8"));
  const r2 = runEssentialsSetup({ baseDir: skillsDir, log: quiet });
  const second = JSON.parse(readFileSync(join(skillsDir, "catalog.json"), "utf8"));
  assert.equal(r2.ok, true);
  assert.equal(second.skills.length, first.skills.length, "sem duplicação");
  const ids = second.skills.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "ids únicos");
  assert.equal(second.version, first.version);
  assert.equal(second.source, "builtin");
  assert.deepEqual(second.skills.map((s) => s.id).sort(), first.skills.map((s) => s.id).sort());
});

test("skills: não depende de git/rede — funciona com GIT_BIN inexistente", () => {
  const dir2 = join(root, "hub-nogit");
  const prevGit = process.env.GIT_BIN;
  process.env.GIT_BIN = "/caminho/que/nao/existe/git";
  try {
    const r = runEssentialsSetup({ baseDir: dir2, log: quiet });
    assert.equal(r.ok, true);
    assert.equal(getCatalogStatus(dir2).total, ESSENTIAL_SKILLS.length);
  } finally {
    if (prevGit === undefined) delete process.env.GIT_BIN;
    else process.env.GIT_BIN = prevGit;
  }
});

test("skills: catálogo inválido é reportado como inválido, não como vazio", () => {
  const dir3 = join(root, "hub-invalido");
  mkdirSync(dir3, { recursive: true });
  writeFileSync(join(dir3, "catalog.json"), "{ isto nao e json");
  const status = getCatalogStatus(dir3);
  assert.equal(status.reason, "catalog_invalid");
  assert.deepEqual(listSkills({ baseDir: dir3 }), [], "sem skills inventadas");
});

test("skills: permissão negada não lança — devolve falha explícita e preserva o catálogo anterior", () => {
  const dir4 = join(root, "hub-readonly");
  runEssentialsSetup({ baseDir: dir4, log: quiet }); // cria catálogo válido
  const catalogPath = join(dir4, "catalog.json");
  const before = readFileSync(catalogPath, "utf8");
  chmodSync(catalogPath, 0o400); // catálogo somente-leitura: a próxima escrita deve falhar
  try {
    const r = runEssentialsSetup({ baseDir: dir4, log: quiet });
    if (process.getuid && process.getuid() === 0) return; // root ignora permissões
    assert.equal(r.ok, false, "falha explícita (não silenciosa)");
    assert.match(String(r.reason), /provision_failed/);
    assert.equal(readFileSync(catalogPath, "utf8"), before, "catálogo anterior preservado");
  } finally {
    chmodSync(catalogPath, 0o600);
  }
});

test("skills: busca, matching e carregamento usam apenas o catálogo real", () => {
  const list = listSkills({ baseDir: skillsDir, category: "graphics" });
  assert.ok(list.length >= 1, "filtro por categoria funciona");
  const matched = matchSkillsForPrompt("quero animar a interface com gsap", 3, skillsDir);
  assert.ok(matched.length >= 1, "matching retorna skills reais");
  const loaded = loadSkill(list[0].id, skillsDir);
  assert.match(loaded.content, /^---/);
  assert.throws(() => loadSkill("../../etc/passwd", skillsDir), /path_traversal/);
});
