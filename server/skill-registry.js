// Skill Registry — núcleo mínimo (Fase 1, E) — J.A.R.V.I.S.
//
// REGISTRO E VALIDAÇÃO de skills, sem execução. NÃO existe mecanismo geral de execução de
// código arbitrário: este módulo apenas (1) valida manifestos, (2) decide o estado de revisão,
// (3) decide se uma skill está ativada. A execução real de uma skill é trabalho futuro e terá de
// reutilizar as allowlists do servidor (TOOL_DEFS, hostpolicy, urlpolicy) — nunca a interface.
//
// PRINCÍPIOS (contrato):
//  • Desativadas por padrão: enabled=false salvo lista explícita e explícita revisão.
//  • Manifesto versionado por ficheiro em skills/<id>.json; id+version são a identidade.
//  • Criação, revisão, aprovação e ativação são ESTADOS DISTINTOS (draft → reviewed → approved →
//    enabled). Só `approved` pode ser candidato a `enabled`.
//  • Conteúdo gerado por LLM não concede permissões a si próprio: as permissões/ferramentas/
//    destinos de rede do manifesto têm de caber nas allowlists do SERVIDOR (TOOL_DEFS, origins
//    http(s) sem metadados). Um manifesto não pode declarar uma ferramenta que não existe no
//    servidor nem um destino que urlpolicy bloquearia.
//  • Risco explícito: `risk` ∈ {low,medium,high}; alto bloqueia ativação sem revisão humana.
//  • Limites de execução obrigatórios e dentro dos bounds; sem eles a validação falha.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TOOL_DEFS } from "./tools.js";
import { assertSafeUrl } from "./urlpolicy.js";

export class SkillValidationError extends Error {
  constructor(msg, issues = []) { super(msg); this.name = "SkillValidationError"; this.issues = issues; }
}

export const SKILL_STATES = Object.freeze(["draft", "reviewed", "approved", "enabled"]);
export const SKILL_RISKS = Object.freeze(["low", "medium", "high"]);

export const EXEC_LIMIT_BOUNDS = Object.freeze({
  timeoutMs: [1000, 600000],     // 1s .. 10min
  maxCalls: [1, 1000],
  maxOutputBytes: [1024, 5_000_000],
});

/** Ferramentas que uma skill pode declarar. Derivada do servidor (fonte única de verdade). */
export const KNOWN_TOOLS = Object.freeze(Object.keys(TOOL_DEFS).sort());

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const REQUIRED = Object.freeze([
  "id", "version", "description", "inputs", "outputs", "dependencies",
  "permissions", "allowedNetworkDestinations", "tools", "mcps",
  "execLimits", "tests", "successCriteria", "risk", "reviewState",
]);
// Schema fechado: campos desconhecidos rejeitados (não há "contrabando" de poder via extras).
const ALLOWED_KEYS = new Set([...REQUIRED, "review"]);
// Heurística de defesa adicional: revisão/aprovação é humana. Identidades de agente no
// reviewed_by são recusadas (não prova de identidade — o controle real é o PR + enabled.json).
const AGENT_LIKE = /agent|llm|bot|claude|codex|opencode|gemini|openai|anthropic|copilot|gpt/i;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function checkExecLimits(l, issues) {
  if (!isObj(l)) { issues.push("execLimits tem de ser um objeto"); return; }
  for (const [k, [lo, hi]] of Object.entries(EXEC_LIMIT_BOUNDS)) {
    if (!Number.isInteger(l[k]) || l[k] < lo || l[k] > hi) {
      issues.push(`execLimits.${k} tem de ser inteiro em [${lo}, ${hi}]`);
    }
  }
}

/**
 * Valida um manifesto de skill. Lança SkillValidationError com TODAS as questões (não só a
 * primeira) para o autor corrigir de uma vez.
 */
export function validateSkill(raw) {
  const issues = [];
  if (!isObj(raw)) throw new SkillValidationError("manifesto tem de ser um objeto", ["tipo"]);

  for (const f of REQUIRED) if (!(f in raw)) issues.push(`campo obrigatório em falta: ${f}`);
  for (const k of Object.keys(raw)) if (!ALLOWED_KEYS.has(k)) issues.push(`campo desconhecido: ${k} (schema fechado — sem contrabando de poder)`);

  if ("id" in raw && (typeof raw.id !== "string" || !ID_RE.test(raw.id))) {
    issues.push("id: minúsculas/dígitos/._- , 2..64 caracteres");
  }
  if ("version" in raw && (typeof raw.version !== "string" || !VERSION_RE.test(raw.version))) {
    issues.push("version: semver (ex.: 1.0.0)");
  }
  if ("description" in raw && (typeof raw.description !== "string" || raw.description.trim().length < 8)) {
    issues.push("description: frase explicativa (>= 8 chars)");
  }
  for (const arr of ["inputs", "outputs", "dependencies", "permissions", "allowedNetworkDestinations", "tools", "mcps", "tests"]) {
    if (arr in raw && !Array.isArray(raw[arr])) issues.push(`${arr}: tem de ser uma lista`);
  }

  // Permissões: só as que existem no servidor (allowlist). Nomes desconhecidos = tentativa de
  // conceder poder novo → falha. (A lista de permissões do servidor é uma allowlist explícita.)
  if (Array.isArray(raw.permissions)) {
    const known = KNOWN_PERMISSIONS;
    for (const p of raw.permissions) {
      if (typeof p !== "string" || !known.includes(p)) issues.push(`permission não permitida: ${JSON.stringify(p)}`);
    }
  }

  // Ferramentas: só ferramentas que o servidor expõe (TOOL_DEFS).
  if (Array.isArray(raw.tools)) {
    for (const t of raw.tools) {
      if (typeof t !== "string" || !KNOWN_TOOLS.includes(t)) issues.push(`tool inexistente no servidor: ${JSON.stringify(t)}`);
    }
  }

  // MCPs: o gateway de conectores (Fase F) ainda NÃO existe — qualquer conector declarado é
  // rejeitado. Um servidor MCP remoto nunca recebe autorização automática por nome/descrição.
  if (Array.isArray(raw.mcps)) {
    for (const m of raw.mcps) {
      issues.push(`conector MCP não registado: ${JSON.stringify(m)} (gateway de conectores por implementar — Fase F)`);
    }
  }

  // Rede: só http(s), sem metadados de cloud, validado pela urlpolicy do servidor.
  if (Array.isArray(raw.allowedNetworkDestinations)) {
    for (const d of raw.allowedNetworkDestinations) {
      if (typeof d !== "string") { issues.push(`destino não é string: ${JSON.stringify(d)}`); continue; }
      try { assertSafeUrl(d); } catch (e) { issues.push(`destino de rede rejeitado (${d}): ${e.message}`); }
    }
  }

  checkExecLimits(raw.execLimits, issues);

  if ("risk" in raw && !SKILL_RISKS.includes(raw.risk)) issues.push(`risk: tem de ser ${SKILL_RISKS.join("|")}`);
  if ("reviewState" in raw && !SKILL_STATES.includes(raw.reviewState)) {
    issues.push(`reviewState: tem de ser ${SKILL_STATES.join("|")}`);
  }

  // Bloco de revisão: obrigatório a partir de "reviewed" (separação criação ↔ revisão ↔
  // aprovação). approved exige referência humana verificável (PR/commit) + data.
  if (["reviewed", "approved"].includes(raw.reviewState)) {
    const r = raw.review;
    if (!isObj(r)) {
      issues.push("review: bloco {reviewed_by, approved_at, approval_ref} obrigatório a partir de reviewed");
    } else {
      if (typeof r.reviewed_by !== "string" || !r.reviewed_by.trim()) issues.push("review.reviewed_by obrigatório (humano)");
      else if (AGENT_LIKE.test(r.reviewed_by)) {
        issues.push("review.reviewed_by não pode ser identidade de agente/LLM — revisão e aprovação são humanas");
      }
      if (typeof r.approved_at !== "string" || Number.isNaN(Date.parse(r.approved_at))) {
        issues.push("review.approved_at: data ISO8601 obrigatória");
      }
      if (typeof r.approval_ref !== "string" || r.approval_ref.trim().length < 4) {
        issues.push("review.approval_ref: referência humana (PR/commit) obrigatória");
      }
    }
  } else if (raw.review != null) {
    issues.push("review só existe a partir de reviewState reviewed");
  }

  // Alto risco nunca pode estar "enabled" direto no manifesto: a ativação é sempre decisão
  // humana separada (lista enabled por ficheiro), por isso o manifesto não pode auto-ativar-se.
  if (raw.reviewState === "enabled") {
    issues.push("reviewState não pode ser 'enabled' no manifesto — a ativação é externa e humana");
  }

  if (issues.length) throw new SkillValidationError(`manifesto inválido: ${issues.length} questão(ões)`, issues);
  return true;
}

/**
 * Estado efetivo de uma skill, combinando manifesto + decisão humana de ativação.
 * enabled só quando: manifesto válido + reviewState "approved" + id presente na allowlist de
 * ativação. "approved" sozinho NÃO ativa (defesa em profundidade).
 */
export function computeSkillState(manifest, enabledIds) {
  validateSkill(manifest);
  const humanEnabled = Array.isArray(enabledIds) && enabledIds.includes(manifest.id);
  const approved = manifest.reviewState === "approved";
  return {
    id: manifest.id,
    version: manifest.version,
    reviewState: manifest.reviewState,
    risk: manifest.risk,
    active: approved && humanEnabled,
    blockedReason: approved ? (humanEnabled ? null : "aguarda ativação humana (não está na lista de ativação)")
      : `estado de revisão insuficiente: ${manifest.reviewState} (precisa de approved)`,
  };
}

export const KNOWN_PERMISSIONS = Object.freeze([
  // Allowlist de permissões do servidor. Uma skill só pode pedir estas. Adicionar uma nova é
  // alteração de servidor (revisão humana), nunca conteúdo gerado.
  "memories:read", "memories:write",
  "documents:read", "documents:write",
  "conversations:read",
  "audit:read",
  "mail:drafts:read", "mail:drafts:write",
  "bots:read",
  "settings:read",
]);

/**
 * Lê o diretório de skills (skills/*.json). Ignora enabled.json e ficheiros que comecem por
 * "_" (ex.: _schema.json, notas). Nunca lança por manifesto inválido: devolve erros por ficheiro
 * para o CI mostrar tudo de uma vez.
 */
export function loadSkillDir(dir) {
  const skills = [];
  const errors = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_") || f === "enabled.json") continue;
    try {
      const m = JSON.parse(readFileSync(join(dir, f), "utf8"));
      validateSkill(m);
      skills.push(m);
    } catch (e) {
      errors.push({ file: f, error: e.message, issues: e.issues ?? [] });
    }
  }
  return { skills, errors };
}

/**
 * Lê a lista humana de ativação (skills/enabled.json = { "enabled": ["id", ...] }).
 * Lista vazia ou ausente = nada ativo (defesa: nada é ativado por omissão).
 */
export function readEnabledList(dir) {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "enabled.json"), "utf8"));
    return Array.isArray(raw.enabled) ? raw.enabled.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
