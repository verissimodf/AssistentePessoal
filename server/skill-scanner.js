// Security gate for third-party Agent Skills. The candidate is never executed here.
import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

const MAX_REPORT_BYTES = 5 * 1024 * 1024;
const SCAN_TIMEOUT_MS = 120_000;

const blocked = (reason, details = {}) => ({
  decision: "blocked",
  safeToInstall: false,
  recommendation: "DO_NOT_INSTALL",
  reason,
  ...details,
});

function validateCandidatePath(candidatePath) {
  if (typeof candidatePath !== "string" || !candidatePath.trim()) {
    throw new Error("caminho da Skill obrigatório");
  }
  // This gate accepts local staged content only. Remote URLs must be acquired into quarantine first.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidatePath)) {
    throw new Error("a análise exige um pacote local em quarentena; URLs remotas não são aceites diretamente");
  }
  const resolved = realpathSync(candidatePath);
  const stat = statSync(resolved);
  if (stat.isFile() && basename(resolved).toLowerCase() !== "skill.md") {
    throw new Error("o ficheiro candidato tem de se chamar SKILL.md");
  }
  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error("o candidato tem de ser um ficheiro SKILL.md ou diretório");
  }
  if (stat.isDirectory()) {
    const manifests = ["SKILL.md", "skill.md"].filter((name) => {
      try { return statSync(join(resolved, name)).isFile(); } catch { return false; }
    });
    if (manifests.length !== 1) throw new Error("o diretório deve conter exatamente um SKILL.md");
  }
  return resolved;
}

function summarizeReport(report) {
  const assessment = report?.risk_assessment;
  const recommendation = assessment?.recommendation;
  const allowed = ["SAFE", "CAUTION", "DO_NOT_INSTALL"];
  if (!assessment || !allowed.includes(recommendation)) {
    throw new Error("relatório SkillSpector sem risk_assessment.recommendation reconhecida");
  }
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
    scannerVersion: typeof report.metadata?.skillspector_version === "string" ? report.metadata.skillspector_version : null,
  };
}

/**
 * Runs NVIDIA SkillSpector in static-only mode against a staged skill bundle.
 * Missing scanner, timeout, malformed output, incomplete analysis, or unknown verdicts fail closed.
 * The injected runScanner option exists for deterministic unit tests; production uses spawnSync.
 */
export function scanSkillCandidate(candidatePath, options = {}) {
  let target;
  try {
    target = validateCandidatePath(candidatePath);
  } catch (error) {
    return blocked(error.message);
  }

  const command = options.command || process.env.JARVIS_SKILLSPECTOR_BIN || "skillspector";
  const args = [
    "scan", target, "--no-llm", "--fail-on-incomplete", "--min-coverage", "100", "--format", "json",
  ];
  let result;
  let tempHome;
  try {
    if (options.runScanner) {
      result = options.runScanner(command, args, { timeout: SCAN_TIMEOUT_MS, maxBuffer: MAX_REPORT_BYTES });
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
        timeout: SCAN_TIMEOUT_MS,
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
    return blocked("SkillSpector indisponível ou falhou ao executar", { diagnostic: result.error.message });
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

  // SkillSpector uses exit code 1 for high risk or incomplete/strict-gate failures, 2 for errors.
  // Any non-zero exit is blocked even if the report's recommendation looks safe.
  if (result.status !== 0) {
    return blocked("SkillSpector terminou com código diferente de zero; instalação bloqueada", {
      ...summary,
      exitCode: Number.isInteger(result.status) ? result.status : null,
    });
  }
  if (summary.recommendation === "DO_NOT_INSTALL") {
    return blocked("SkillSpector recomendou não instalar", { ...summary, exitCode: result.status });
  }
  if (summary.recommendation === "CAUTION") {
    return {
      decision: "review_required",
      safeToInstall: false,
      reason: "SkillSpector emitiu CAUTION; exige revisão humana explícita antes da instalação",
      ...summary,
      exitCode: result.status,
    };
  }
  return {
    decision: "approved",
    safeToInstall: true,
    reason: "SkillSpector emitiu SAFE e a análise terminou sem falhas",
    ...summary,
    exitCode: result.status,
  };
}
