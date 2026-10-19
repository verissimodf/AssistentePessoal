// Security gate for third-party Agent Skills. The candidate is never executed here.
//
// CONTRATO (Etapa 4 — gate de validação pré-instalação):
//  • Recebe a candidata SEM ativá-la: opera sobre cópia descartável em quarentena; nunca escreve
//    em skills/ nem em enabled.json; não concede permissões, ativação ou execução.
//  • Hash sha256 do artefato (ficheiro ou árvore determinística) + versão exata (manifesto ou
//    scanner) — o veredito fica vinculado ao hash; artefato alterado após a análise ⇒ bloqueado.
//  • Inspeção estática pelo SkillSpector (NVIDIA) isolado: sem shell, sem credenciais do processo
//    JARVIS, HOME/TMP temporários, tempo e saída limitados, `--no-llm --fail-on-incomplete`.
//  • Resultados distintos: passed | failed | incomplete | blocked. Ausência do scanner, falha de
//    processo, timeout, relatório malformado ou veredito desconhecido falham FECHADOS (blocked).
//  • Veredicto é evidência limitada ao método/versão/artefato: nunca prova segurança por si só.
//    Revisão humana independente (PR + enabled.json) continua obrigatória.
//  • Sem segredos nos registos: o veredito preservado guarda estrutura dos achados
//    (id/severidade/local), nunca trechos de conteúdo da candidata. O relatório bruto do scanner
//    só é preservado por pedido explícito (keepRawReport) e deve ser tratado como sensível.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync,
  mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { basename, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { validateSkill, SkillValidationError } from "./skill-registry.js";

const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024; // espelha o teto de ingestão do próprio scanner
const SCAN_TIMEOUT_MS = 120_000;
const VERDICT_VERSION = 1;

// Diretório ativo de skills do JARVIS: candidato algum pode ser recebido daí dentro
// (a barreira recebe candidatos em quarentena, nunca o catálogo ativo).
const ACTIVE_SKILLS_DIR = realpathSync(fileURLToPath(new URL("../skills/", import.meta.url)));

const blocked = (reason, details = {}) => ({
  decision: "blocked",
  safeToInstall: false,
  reviewRequired: true,
  reason,
  issues: [],
  ...details,
});

// Scan completou com achados/risco (CAUTION ou DO_NOT_INSTALL): falha da candidata, não do scanner.
const failed = (reason, details = {}) => ({
  decision: "failed",
  safeToInstall: false,
  reviewRequired: true,
  reason,
  issues: [],
  ...details,
});

export function scannerArgs(target) {
  // Nota: `--min-coverage` NÃO existe no SkillSpector 2.13.0 (o uso fazia scan algum correr
  // ⇒ exit 2 ⇒ tudo bloqueado). A cobertura integral é exigida por `--fail-on-incomplete` e
  // re-verificada no corpo do relatório (analysis_completeness).
  return ["scan", target, "--no-llm", "--fail-on-incomplete", "--format", "json"];
}

function validateCandidatePath(candidatePath) {
  if (typeof candidatePath !== "string" || !candidatePath.trim()) {
    throw new Error("caminho da Skill obrigatório");
  }
  // This gate accepts local staged content only. Remote URLs must be acquired into quarantine first.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidatePath)) {
    throw new Error("a análise exige um pacote local em quarentena; URLs remotas não são aceites diretamente");
  }
  const resolved = realpathSync(candidatePath);
  if (resolved === ACTIVE_SKILLS_DIR || resolved.startsWith(ACTIVE_SKILLS_DIR)) {
    throw new Error("candidato não pode vir do diretório ativo de skills (skills/) — use quarentena");
  }
  const stat = statSync(resolved);
  const name = basename(resolved).toLowerCase();
  const isManifestJson = stat.isFile() && name.endsWith(".json");
  if (stat.isFile() && name !== "skill.md" && !isManifestJson) {
    throw new Error("o ficheiro candidato tem de se chamar SKILL.md (ou ser um manifesto .json do registro)");
  }
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error("o candidato tem de ser um ficheiro SKILL.md, manifesto .json ou diretório");
  }
  if (stat.isDirectory()) {
    // readdirSync (não statSync dos dois nomes): em sistemas de ficheiros case-insensitive
    // (Windows/macOS) "SKILL.md" e "skill.md" resolvem para o MESMO ficheiro e o nome duplicado
    // bloqueava toda a instalação no Windows — a falha do CI do PR.
    const found = readdirSync(resolved).filter((n) => n.toLowerCase() === "skill.md");
    if (found.length !== 1) throw new Error("o diretório deve conter exatamente um SKILL.md");
  }
  return resolved;
}

/**
 * Hash determinístico do artefato. Ficheiro: sha256 dos bytes. Diretório: caminho relativo POSIX
 * ordenado + tamanho + sha256 por ficheiro, tudo sob sha256. Excede o teto ⇒ falha (fail closed).
 */
export function hashArtifact(resolvedPath) {
  const stat = statSync(resolvedPath);
  const hash = createHash("sha256");
  const feed = (rel, bytes) => {
    hash.update(`${rel}\n${bytes.length}\n${createHash("sha256").update(bytes).digest("hex")}\n`);
  };
  if (stat.isFile()) {
    const bytes = readFileSync(resolvedPath);
    if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error(`artefato excede ${MAX_ARTIFACT_BYTES} bytes`);
    feed(basename(resolvedPath), bytes);
    return { algorithm: "sha256", digest: hash.digest("hex"), kind: "file", files: 1, bytes: bytes.length };
  }
  let files = 0, total = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const s = statSync(abs);
      if (s.isDirectory()) { walk(abs); continue; }
      if (!s.isFile()) throw new Error(`tipo de ficheiro não suportado no artefato: ${abs}`);
      const bytes = readFileSync(abs);
      total += bytes.length;
      if (total > MAX_ARTIFACT_BYTES) throw new Error(`artefato excede ${MAX_ARTIFACT_BYTES} bytes`);
      feed(relative(resolvedPath, abs).split("\\").join("/"), bytes);
      files++;
    }
  };
  walk(resolvedPath);
  if (files === 0) throw new Error("artefato diretório está vazio");
  return { algorithm: "sha256", digest: hash.digest("hex"), kind: "directory", files, bytes: total };
}

function summarizeReport(report) {
  const assessment = report?.risk_assessment;
  const recommendation = assessment?.recommendation;
  const allowed = ["SAFE", "CAUTION", "DO_NOT_INSTALL"];
  if (!assessment || !allowed.includes(recommendation)) {
    throw new Error("relatório SkillSpector sem risk_assessment.recommendation reconhecida");
  }
  const completeness = report.analysis_completeness;
  const issues = Array.isArray(report.issues) ? report.issues.map((issue) => ({
    id: typeof issue.id === "string" ? issue.id : null,
    category: typeof issue.category === "string" ? issue.category : null,
    severity: typeof issue.severity === "string" ? issue.severity : null,
    file: typeof issue.location?.file === "string" ? issue.location.file : null,
    line: Number.isInteger(issue.location?.start_line) ? issue.location.start_line : null,
  })) : [];
  return {
    recommendation,
    riskScore: Number.isFinite(assessment.score) ? assessment.score : null,
    severity: typeof assessment.severity === "string" ? assessment.severity : null,
    issues,
    // Estrutura dos achados apenas — nunca trechos de conteúdo da candidata (higiene de segredos).
    analysisComplete: completeness ? completeness.is_complete === true : null,
    coveragePercent: Number.isFinite(completeness?.coverage_percent) ? completeness.coverage_percent : null,
    scannerVersion: typeof report.metadata?.skillspector_version === "string" ? report.metadata.skillspector_version : null,
  };
}

/**
 * Corre o scanner sobre o ALVO e classifica o resultado:
 *  - passed:     saída 0, SAFE e análise completa (is_complete true no relatório);
 *  - failed:     scan completo com achados/risco (CAUTION ou DO_NOT_INSTALL);
 *  - incomplete: scan correu mas a análise ficou parcial (`--fail-on-incomplete` ou
 *                analysis_completeness.is_complete false) — falha fechada para instalação;
 *  - blocked:    scanner indisponível, erro de processo, timeout, relatório malformado ou
 *                veredito desconhecido.
 */
export function scanSkillCandidate(candidatePath, options = {}) {
  let target;
  try {
    target = validateCandidatePath(candidatePath);
  } catch (error) {
    return blocked(error.message);
  }

  const command = options.command || process.env.JARVIS_SKILLSPECTOR_BIN || "skillspector";
  const args = options.args || scannerArgs(target);
  const timeoutMs = options.timeoutMs || SCAN_TIMEOUT_MS;
  let result;
  let tempHome;
  try {
    if (options.runScanner) {
      result = options.runScanner(command, args, { timeout: timeoutMs, maxBuffer: MAX_REPORT_BYTES });
    } else {
      tempHome = mkdtempSync(join(tmpdir(), "jarvis-skillspector-"));
      const env = {
        PATH: process.env.PATH || "",
        HOME: tempHome,
        USERPROFILE: tempHome,
        TMPDIR: tempHome,
        TEMP: tempHome,
        TMP: tempHome,
        LANG: "C.UTF-8",
      };
      if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
      result = spawnSync(command, args, {
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: MAX_REPORT_BYTES,
        shell: false,
        windowsHide: true,
        env,
      });
    }
  } catch (error) {
    return blocked("não foi possível executar o SkillSpector", { diagnostic: error.message });
  } finally {
    if (tempHome) {
      try { rmSync(tempHome, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    }
  }

  if (result?.error) {
    const timedOut = result.error.code === "ETIMEDOUT" || result.error.code === "ETIME";
    return blocked(timedOut ? "SkillSpector excedeu o tempo limite" : "SkillSpector indisponível ou falhou ao executar", {
      diagnostic: result.error.code ? `${result.error.code}: ${result.error.message}` : result.error.message,
    });
  }
  let report;
  try {
    report = JSON.parse(result?.stdout || "");
  } catch {
    return blocked("SkillSpector não devolveu um relatório JSON válido", {
      exitCode: Number.isInteger(result?.status) ? result.status : null,
    });
  }

  let summary;
  try {
    summary = summarizeReport(report);
  } catch (error) {
    return blocked(error.message, {
      exitCode: Number.isInteger(result?.status) ? result.status : null,
    });
  }
  // Relatório bruto (pode conter trechos da candidata): apenas para preservação explícita
  // (keepRawReport) — nunca entra em logs nem no veredito estruturado.
  summary.rawReport = report;

  // SkillSpector: exit 0 = SAFE/CAUTION sem strict gate; exit 1 = risco alto OU análise parcial
  // (`--fail-on-incomplete`); exit 2 = erro. Qualquer saída ≠ 0 com recomendação "segura" é
  // incompletude, nunca aprovação — e saída ≠ 0 com DO_NOT_INSTALL é falha com achados.
  if (result.status !== 0 && summary.recommendation === "DO_NOT_INSTALL") {
    return failed("SkillSpector recomendou não instalar", { ...summary, exitCode: result.status });
  }
  if (result.status !== 0 || summary.analysisComplete === false) {
    return blocked("análise incompleta — cobertura parcial do artefato (fail closed)", {
      decision: "incomplete",
      recommendation: summary.recommendation,
      safeToInstall: false,
      reviewRequired: true,
      ...summary,
      exitCode: Number.isInteger(result?.status) ? result.status : null,
    });
  }
  if (summary.recommendation === "DO_NOT_INSTALL") {
    return failed("SkillSpector recomendou não instalar", { ...summary, exitCode: result.status });
  }
  if (summary.recommendation === "CAUTION") {
    return failed("SkillSpector emitiu CAUTION: achados de risco médio exigem revisão humana antes de qualquer instalação", { ...summary, exitCode: result.status });
  }
  return {
    decision: "passed",
    safeToInstall: true,
    reviewRequired: true,
    reason: "SkillSpector emitiu SAFE e a análise foi completa — evidência limitada a este método, versão e artefato",
    ...summary,
    exitCode: result.status,
  };
}

/**
 * Verifica a integridade do artefato contra um veredito anterior: a instalação só pode prosseguir
 * se o hash atual for IGUAL ao hash analisado. Artefato alterado ⇒ bloqueado (reeanálise obrigatória).
 */
export function verifyArtifactAgainstVerdict(candidatePath, verdict) {
  try {
    const resolved = validateCandidatePath(candidatePath);
    const current = hashArtifact(resolved);
    const bound = verdict?.artifact?.hash;
    if (!bound || bound.algorithm !== current.algorithm || bound.digest !== current.digest) {
      return blocked("o artefato mudou desde a análise — veredito inválido, reanálise obrigatória", {
        artifact: { hash: current },
      });
    }
    return { decision: "passed", safeToInstall: true, artifact: { hash: current } };
  } catch (error) {
    return blocked(`não foi possível verificar o artefato: ${error.message}`);
  }
}

/**
 * Gate completo de inspeção (o ponto do fluxo onde uma candidata é recebida e validada sem
 * entrar nos mecanismos ativos). Devolve SEMPRE a mesma forma de veredito:
 *  1. valida caminho (local, quarentena, nunca skills/ ativo);
 *  2. calcula o hash do artefato;
 *  3. valida o manifesto (JSON do registro via validateSkill, quando aplicável);
 *  4. copia para quarentena descartável e confere que a cópia é idêntica ao original;
 *  5. corre o scanner estático sobre a CÓPIA (a candidata nunca é executada);
 *  6. devolve veredito vinculado ao hash, preservado em reportsDir quando indicado.
 * O veredito NÃO concede permissões, ativação ou execução — nem `passed` ativa algo.
 */
export function inspectCandidate(candidatePath, options = {}) {
  const verdict = (result, artifact = null) => ({
    verdictVersion: VERDICT_VERSION,
    finishedAt: new Date().toISOString(),
    artifact: artifact ?? { hash: null, kind: null, manifest: null },
    scan: null,
    result,
    constraints: {
      grantsPermissions: false,
      grantsActivation: false,
      allowsExecution: false,
      requiresHumanReview: true,
      boundToArtifactHash: artifact?.hash?.digest ?? null,
      validity: "evidência limitada a este método, versão do scanner e hash do artefato",
    },
  });
  const vereditoBloqueado = (reason, { issues = [], artifact = null } = {}) =>
    verdict({ decision: "blocked", safeToInstall: false, reviewRequired: true, reason, issues }, artifact);

  const manifestRead = (resolved) => {
    if (!resolved.toLowerCase().endsWith(".json")) return { manifest: null, validation: null };
    try {
      const manifest = JSON.parse(readFileSync(resolved, "utf8"));
      validateSkill(manifest);
      return { manifest: { id: manifest.id, version: manifest.version }, validation: null };
    } catch (error) {
      const issues = error instanceof SkillValidationError ? error.issues : [String(error?.message || error)];
      return { manifest: null, validation: issues };
    }
  };

  let resolved, hash, manifestInfo;
  try {
    resolved = validateCandidatePath(candidatePath);
    hash = hashArtifact(resolved);
    manifestInfo = manifestRead(resolved);
    if (manifestInfo.validation) {
      return vereditoBloqueado("manifesto da candidata inválido (schema fechado do registro)", {
        issues: manifestInfo.validation,
        artifact: { hash },
      });
    }
  } catch (error) {
    return vereditoBloqueado(error.message);
  }

  // Cópia descartável: o scanner analisa a cópia, nunca o original (nem o catálogo ativo).
  const quarantine = mkdtempSync(join(tmpdir(), "jarvis-skill-quarantine-"));
  let scan;
  try {
    // Cópia com o MESMO nome base: um candidato-ficheiro (SKILL.md ou manifesto .json) mantém o
    // nome pelo qual o scanner/gate o valida — nunca um nome anónimo.
    const copyPath = join(quarantine, basename(resolved));
    cpSync(resolved, copyPath, { recursive: true });
    const copyHash = hashArtifact(copyPath);
    if (copyHash.digest !== hash.digest) {
      return vereditoBloqueado("artefato alterado durante a preparação da análise", { artifact: { hash } });
    }
    scan = scanSkillCandidate(copyPath, { ...options });
  } catch (error) {
    return vereditoBloqueado(`falha ao preparar a cópia de quarentena: ${error.message}`, { artifact: { hash } });
  } finally {
    try { rmSync(quarantine, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  const full = {
    ...verdict({
      decision: scan.decision,
      safeToInstall: scan.safeToInstall === true,
      reviewRequired: true, // revisão humana independente é SEMPRE obrigatória
      reason: scan.reason,
      issues: scan.issues,
    }, { hash, manifest: manifestInfo.manifest }),
    scan: {
      scanner: "skillspector",
      version: scan.scannerVersion,
      mode: "static-only",
      flags: ["--no-llm", "--fail-on-incomplete"],
      exitCode: Number.isInteger(scan.exitCode) ? scan.exitCode : null,
      coveragePercent: scan.coveragePercent,
      analysisComplete: scan.analysisComplete,
    },
  };

  if (options.reportsDir) {
    try {
      mkdirSync(options.reportsDir, { recursive: true });
      const digest = hash.digest;
      if (/^[a-f0-9]{64}$/.test(digest)) {
        writeFileSync(join(options.reportsDir, `${digest}.verdict.json`), JSON.stringify(full, null, 2), { mode: 0o600 });
        if (options.keepRawReport) {
          // Pode conter trechos da candidata: ficheiro sensível, 0600, nunca registado em logs.
          writeFileSync(join(options.reportsDir, `${digest}.scanner-report.json`), JSON.stringify(scan.rawReport ?? null, null, 2), { mode: 0o600 });
        }
      }
    } catch { /* preservação é best-effort: não altera o veredito */ }
  }
  return full;
}

// ---------------------------------------------------------------- histórico (leitura)

/** Limite máximo explícito de registros por resposta (o mais recente primeiro). */
export const MAX_VERDICT_LIST = 200;
const VERDICT_DECISIONS = new Set(["passed", "failed", "incomplete", "blocked"]);

/**
 * Lê o histórico de vereditos persistidos em `reportsDir` (<sha256>.verdict.json, escritos pelo
 * próprio gate). SOMENTE LEITURA: não corre o scanner, não instala/ativa nada, sem efeitos.
 *
 * Contrato de registros inválidos (decisão documentada): um ficheiro individual inválido — nome
 * fora do padrão, JSON quebrado, campos ausentes/tipos errados, hash divergente entre nome e
 * `constraints.boundToArtifactHash`, ou link simbólico — é IGNORADO (contado em `skipped`),
 * preservando os demais. Falha real de leitura do DIRETÓRIO (ex.: permissão) NÃO é silenciada:
 * lança `Error("verdicts_unreadable")` — a rota converte em 500 estruturado.
 *
 * Projeção explícita: cada item contém `hash` (do nome do ficheiro, 64-hex), `finishedAt`
 * (ISO válido), `decision` (conjunto fechado) e, SÓ SE presentes e válidos, `scannerVersion`
 * (string ≤64) e `issueCount` (inteiro 0..1e6). Nunca devolve o objeto persistido completo,
 * conteúdo de Skill, caminhos internos ou `*.scanner-report.json`.
 */
export function listSkillVerdicts(reportsDir, { limit = MAX_VERDICT_LIST } = {}) {
  let entries;
  try {
    // withFileTypes usa lstat: link simbólico NÃO é seguido (nem para fora do diretório).
    entries = readdirSync(reportsDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { verdicts: [], truncated: false, skipped: 0 }; // inexistente = vazio
    throw new Error("verdicts_unreadable"); // falha real de leitura — nunca sucesso silencioso
  }
  const items = [];
  let skipped = 0;
  for (const entry of entries) {
    // Apenas ficheiros regulares nomeados <64-hex>.verdict.json; symlinks e demais são ignorados.
    if (entry.isSymbolicLink() || !entry.isFile()) { skipped++; continue; }
    const match = entry.name.match(/^([a-f0-9]{64})\.verdict\.json$/);
    if (!match) { skipped++; continue; }
    let record;
    try {
      record = JSON.parse(readFileSync(join(reportsDir, entry.name), "utf8"));
    } catch { skipped++; continue; } // JSON inválido: ignora o registro, preserva os demais
    const { finishedAt, result } = record ?? {};
    const decision = result?.decision;
    if (typeof finishedAt !== "string" || Number.isNaN(Date.parse(finishedAt)) || !VERDICT_DECISIONS.has(decision)) {
      skipped++; continue;
    }
    // Identidade: o nome do ficheiro é o hash analisado; divergência com o veredito = corrompido.
    const bound = record?.constraints?.boundToArtifactHash;
    if (typeof bound === "string" && bound !== match[1]) { skipped++; continue; }
    const item = { hash: match[1], finishedAt, decision };
    const scannerVersion = record?.scan?.version;
    if (typeof scannerVersion === "string" && scannerVersion.trim()) item.scannerVersion = scannerVersion.slice(0, 64);
    const issueCount = result?.issueCount;
    if (Number.isInteger(issueCount) && issueCount >= 0 && issueCount <= 1_000_000) item.issueCount = issueCount;
    items.push(item);
  }
  items.sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt));
  return { verdicts: items.slice(0, limit), truncated: items.length > limit, skipped };
}
