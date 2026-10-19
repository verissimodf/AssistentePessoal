// Histórico de vereditos de Skills — leitura autenticada do que o gate persistiu.
// Unitário: listSkillVerdicts (projeção mínima, ordenação, limite, inválidos ignorados,
// symlinks não seguidos, falha real de leitura não silenciada).
// HTTP: 401 sem sessão; lista projetada com sessão; sem conteúdo/caminhos/relatório bruto.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const H = (hash) => hash ?? "a".repeat(64);
// O gate real grava boundToArtifactHash = hash do artefato = nome do ficheiro; o helper mantém
// essa consistência (o caso "hash divergente" passa bound explícito diferente).
const gravar = (dir, hash, body) =>
  writeFileSync(join(dir, `${H(hash)}.verdict.json`), typeof body === "string" ? body : JSON.stringify(vereditoValido(hash, body ?? {})));

const vereditoValido = (hash, over = {}) => ({
  verdictVersion: 1,
  finishedAt: "2026-10-19T03:00:00.000Z",
  artifact: { hash: { algorithm: "sha256", digest: H(hash) }, kind: "file", manifest: null },
  scan: { scanner: "skillspector", version: "2.13.0", mode: "static-only", flags: [], exitCode: 0, coveragePercent: 100, analysisComplete: true },
  result: { decision: "passed", safeToInstall: true, reviewRequired: true, reason: "ok", issueCount: 0 },
  constraints: { grantsPermissions: false, grantsActivation: false, allowsExecution: false, requiresHumanReview: true, boundToArtifactHash: H(hash), validity: "v" },
  ...over,
});

// ---------------------------------------------------------------- unitário

test("unit: diretório inexistente = lista vazia (sem erro)", async (t) => {
  const { listSkillVerdicts } = await import("../server/skill-scanner.js");
  const out = listSkillVerdicts(join(tmpdir(), "nao-existe-skills-verdicts-xyz"));
  assert.deepEqual(out, { verdicts: [], truncated: false, skipped: 0 });
});

test("unit: vazio, projeção mínima, ordenação desc e limite", async (t) => {
  const { listSkillVerdicts, MAX_VERDICT_LIST } = await import("../server/skill-scanner.js");
  const dir = mkdtempSync(join(tmpdir(), "jarvis-verdicts-"));
  try {
    assert.equal(listSkillVerdicts(dir).verdicts.length, 0, "vazio");
    // três vereditos com datas diferentes + campos opcionais variados
    gravar(dir, "a".repeat(64), { finishedAt: "2026-10-19T01:00:00.000Z", result: { decision: "failed", safeToInstall: false, reviewRequired: true, reason: "r", issueCount: 3 } });
    gravar(dir, "b".repeat(64), { finishedAt: "2026-10-19T03:00:00.000Z" });
    gravar(dir, "c".repeat(64), { finishedAt: "2026-10-19T02:00:00.000Z", scan: { scanner: "s", mode: "m", flags: [], exitCode: 0 }, result: { decision: "passed", safeToInstall: true, reviewRequired: true, reason: "ok" } }); // sem version/issueCount
    const out = listSkillVerdicts(dir);
    assert.equal(out.verdicts.length, 3);
    assert.equal(out.truncated, false);
    assert.deepEqual(out.verdicts.map((v) => v.hash[0]), ["b", "c", "a"], "mais recente primeiro");
    const [b, c] = out.verdicts;
    assert.deepEqual(Object.keys(b).sort(), ["decision", "finishedAt", "hash", "issueCount", "scannerVersion"], "projeção");
    assert.equal(b.issueCount, 0);
    assert.ok(!("scannerVersion" in c) && !("issueCount" in c), "campos opcionais ausentes NÃO são inventados");
    assert.equal(c.decision, "passed");
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // limite: MAX+1 registros ⇒ 200 + truncated
  const big = mkdtempSync(join(tmpdir(), "jarvis-verdicts-big-"));
  try {
    for (let i = 0; i <= MAX_VERDICT_LIST; i++) {
      const h = i.toString(16).padStart(64, "0");
      gravar(big, h, { finishedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() });
    }
    const out = listSkillVerdicts(big);
    assert.equal(out.verdicts.length, MAX_VERDICT_LIST, "limite respeitado");
    assert.equal(out.truncated, true);
  } finally { rmSync(big, { recursive: true, force: true }); }
});

test("unit: registros inválidos são ignorados individualmente (contados), preservando os demais", async (t) => {
  const { listSkillVerdicts } = await import("../server/skill-scanner.js");
  const dir = mkdtempSync(join(tmpdir(), "jarvis-verdicts-inv-"));
  try {
    gravar(dir, "a".repeat(64), "{ json quebrado"); // JSON inválido
    writeFileSync(join(dir, "nao-e-hash.txt"), "x"); // nome fora do padrão
    writeFileSync(join(dir, `${"d".repeat(64)}.scanner-report.json`), "{}"); // relatório bruto NUNCA entra
    gravar(dir, "b".repeat(64), { result: { safeToInstall: true, reviewRequired: true, reason: "r" } }); // sem decision
    gravar(dir, "c".repeat(64), { result: { decision: "talvez" } }); // decisão desconhecida
    gravar(dir, "e".repeat(64), { finishedAt: "não é data" }); // data inválida
    gravar(dir, "f".repeat(64), { constraints: { boundToArtifactHash: "0".repeat(64) } }); // hash divergente do nome
    gravar(dir, "9".repeat(64)); // válido
    const out = listSkillVerdicts(dir);
    assert.equal(out.verdicts.length, 1, "só o válido entra");
    assert.equal(out.verdicts[0].hash[0], "9");
    assert.equal(out.skipped, 7, "inválidos contados, nunca silenciados");
    const bruto = JSON.stringify(out);
    assert.ok(!bruto.includes("json quebrado") && !bruto.includes("{}"), "sem conteúdo bruto na resposta");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("unit: link simbólico não é seguido (POSIX)", { skip: process.platform === "win32" && "symlink restrito" }, async (t) => {
  if (process.platform === "win32") return t.skip("symlinks exigem privilégio no Windows");
  const { listSkillVerdicts } = await import("../server/skill-scanner.js");
  const dir = mkdtempSync(join(tmpdir(), "jarvis-verdicts-sym-"));
  const fora = mkdtempSync(join(tmpdir(), "jarvis-verdicts-fora-"));
  try {
    // alvo FORA do diretório autorizado, com o nome de um veredito plausível
    const alvo = join(fora, "alvo.json");
    writeFileSync(alvo, JSON.stringify(vereditoValido("e".repeat(64))));
    symlinkSync(alvo, join(dir, `${"e".repeat(64)}.verdict.json`));
    gravar(dir, "9".repeat(64));
    const out = listSkillVerdicts(dir);
    assert.equal(out.verdicts.length, 1, "symlink ignorado, não seguido");
    assert.equal(out.verdicts[0].hash[0], "9");
    assert.equal(out.skipped, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(fora, { recursive: true, force: true });
  }
});

test("unit: falha de leitura é MARCADA; erro inesperado de programação NÃO é mascarado", async (t) => {
  const { listSkillVerdicts, isVerdictsReadFailure } = await import("../server/skill-scanner.js");
  // A decisão é plataforma-agnóstica: erro de programação ≠ falha de leitura.
  assert.equal(isVerdictsReadFailure(Object.assign(new Error("verdicts_unreadable"), { code: "verdicts_unreadable" })), true);
  assert.equal(isVerdictsReadFailure(new TypeError("bug de programação")), false);
  assert.equal(isVerdictsReadFailure("401: x"), false);
  assert.equal(isVerdictsReadFailure(undefined), false);
  // A provocação por chmod só faz sentido em POSIX (no Windows chmod não bloqueia leitura);
  // como root, chmod também não bloqueia — skip honesto, sem simulação.
  if (process.platform === "win32") return t.skip("chmod não bloqueia leitura no Windows");
  if (typeof process.getuid === "function" && process.getuid() === 0) return t.skip("como root, chmod não bloqueia leitura");
  const dir = mkdtempSync(join(tmpdir(), "jarvis-verdicts-deny-"));
  try {
    writeFileSync(join(dir, `${"a".repeat(64)}.verdict.json`), "{}");
    const { chmodSync } = await import("node:fs");
    chmodSync(dir, 0o000); // sem permissão de leitura nem listagem
    try {
      assert.throws(() => listSkillVerdicts(dir), (e) =>
        isVerdictsReadFailure(e) && e.message === "verdicts_unreadable",
      "falha de leitura vem MARCADA (code) — a rota a converte; qualquer outro erro NÃO é mascarado");
    } finally { chmodSync(dir, 0o700); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- HTTP (rota session)

const dir = mkdtempSync(join(tmpdir(), "jarvis-verdicts-http-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth } = await import("../server/db.js");

const ORIGIN = "http://localhost:8080";
let server, base, session;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const token = auth.ensureBootstrap().token;
  await fetch(base + "/api/auth/setup", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ token, username: "adminverdicts", password: "senha-muito-forte-1" }),
  });
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ username: "adminverdicts", password: "senha-muito-forte-1" }),
  });
  assert.equal(login.status, 200);
  session = {
    cookie: login.headers.get("set-cookie").split(";")[0],
    csrf: (await login.json()).csrf,
  };
});

after(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  // fecha o SQLite antes de limpar o diretório (requisito do Windows — padrão do repo)
  try { (await import("../server/db.js")).db.close(); } catch { /* já fechado */ }
  rmSync(dir, { recursive: true, force: true });
});

test("http: sem sessão ⇒ 401 (rota nunca pública)", async () => {
  const r = await fetch(base + "/api/skills/verdicts", { headers: { origin: ORIGIN } });
  assert.equal(r.status, 401);
});

test("http: com sessão ⇒ lista projetada; sem conteúdo, caminhos ou relatório bruto", async () => {
  const vdir = join(dir, "skill-verdicts");
  mkdirSync(vdir, { recursive: true });
  const CANARIO = "JARVIS-CANARIO-SEGREDO-9f2c";
  gravar(vdir, "a".repeat(64), {
    result: { decision: "failed", safeToInstall: false, reviewRequired: true, reason: `motivo com ${CANARIO}`, issueCount: 2 },
  });
  writeFileSync(join(vdir, `${"b".repeat(64)}.scanner-report.json`), JSON.stringify({ raw: CANARIO }));
  gravar(vdir, "c".repeat(64), "{quebrado");

  const r = await fetch(base + "/api/skills/verdicts", { headers: { origin: ORIGIN, cookie: session.cookie, "x-jarvis-csrf": session.csrf } });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.verdicts.length, 1, "só o veredito válido (inválido ignorado)");
  const v = out.verdicts[0];
  assert.deepEqual(Object.keys(v).sort(), ["decision", "finishedAt", "hash", "issueCount", "scannerVersion"], "projeção mínima — sem objeto completo");
  const texto = JSON.stringify(out);
  assert.ok(!texto.includes(CANARIO), "sem conteúdo da Skill nem de registro malformado");
  assert.ok(!texto.includes("scanner-report"), "relatório bruto nunca aparece");
  assert.ok(!texto.includes(process.tmpdir?.() ?? tmpdir()), "sem caminhos internos");
  assert.equal(v.decision, "failed");
  assert.equal(v.issueCount, 2);
  assert.equal(out.truncated, false);
  assert.equal(out.skipped, 2, "inválidos contados (JSON quebrado + relatório bruto fora do padrão), não silenciados");
});

test("http: diretório inexistente ⇒ lista vazia (200, não erro)", async () => {
  rmSync(join(dir, "skill-verdicts"), { recursive: true, force: true });
  const r = await fetch(base + "/api/skills/verdicts", { headers: { origin: ORIGIN, cookie: session.cookie, "x-jarvis-csrf": session.csrf } });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.deepEqual(out.verdicts, []);
  assert.equal(out.truncated, false);
});

test("http: skill-verdicts como ARQUIVO (ENOTDIR = falha de leitura) ⇒ 500 {error: verdicts_unreadable}", async () => {
  writeFileSync(join(dir, "skill-verdicts"), "não é diretório");
  const r = await fetch(base + "/api/skills/verdicts", { headers: { origin: ORIGIN, cookie: session.cookie, "x-jarvis-csrf": session.csrf } });
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: "verdicts_unreadable" }, "500 estruturado, sem stack/caminhos no corpo");
});
