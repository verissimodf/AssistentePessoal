// server/skills.js
// Dynamic Skill Injector & Catalog Bridge for J.A.R.V.I.S.
// Loads, searches, and injects agent skills on demand from the Global Skills Hub (%USERPROFILE%\.agent-skills).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep, normalize } from "node:path";
import os from "node:os";

export const GLOBAL_SKILLS_DIR = process.env.JARVIS_GLOBAL_SKILLS_DIR || join(os.homedir(), ".agent-skills");
// Cache per catalog location prevents concurrent/serial tests from cross-contaminating fixtures.
const catalogCache = new Map();


/**
 * Lê o catálogo mestre de skills indexadas.
 * Faz cache com invalidação baseada no mtime de catalog.json.
 */
export function getCatalog(baseDir = GLOBAL_SKILLS_DIR) {
  const catalogPath = join(baseDir, "catalog.json");
  const key = resolve(catalogPath);
  if (!existsSync(catalogPath)) {
    catalogCache.delete(key);
    return { version: "1.2.0", totalSkills: 0, skills: [] };
  }

  try {
    const stat = statSync(catalogPath);
    const cached = catalogCache.get(key);
    if (cached && stat.mtimeMs === cached.mtimeMs && stat.size === cached.size) {
      return cached.value;
    }
    const value = JSON.parse(readFileSync(catalogPath, "utf8"));
    catalogCache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  } catch {
    return { version: "1.2.0", totalSkills: 0, skills: [] };
  }
}

/**
 * Retorna a lista de todas as skills disponíveis, com suporte a filtros por tag ou categoria.
 */
export function listSkills({ category, tag, baseDir = GLOBAL_SKILLS_DIR } = {}) {
  const catalog = getCatalog(baseDir);
  let list = Array.isArray(catalog?.skills) ? catalog.skills : [];

  if (category) {
    const catLower = category.toLowerCase();
    list = list.filter((s) => s.category?.toLowerCase() === catLower);
  }

  if (tag) {
    const tagLower = tag.toLowerCase();
    list = list.filter((s) => Array.isArray(s.tags) && s.tags.some((t) => t.toLowerCase() === tagLower));
  }

  return list.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    tags: s.tags || [],
    category: s.category || "general",
    path: s.path,
  }));
}

const STOP_WORDS = new Set([
  "com", "para", "que", "por", "sem", "uma", "uns", "das", "dos", "como", "sobre", "qual",
  "the", "and", "for", "with", "from", "that", "this", "about", "how", "what", "where"
]);

/**
 * Busca e pontua skills do catálogo relevantes para o prompt ou tarefa do usuário.
 */
export function matchSkillsForPrompt(prompt, limit = 5, baseDir = GLOBAL_SKILLS_DIR) {
  if (!prompt || typeof prompt !== "string") return [];
  const text = prompt.toLowerCase();
  const words = text.split(/\W+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  if (!words.length) return [];

  const catalog = getCatalog(baseDir);
  const skills = Array.isArray(catalog?.skills) ? catalog.skills : [];

  const scored = [];
  for (const s of skills) {
    let score = 0;
    const nameStr = (s.name || "").toLowerCase();
    const idStr = (s.id || "").toLowerCase();
    const descStr = (s.description || "").toLowerCase();
    const tagsArr = Array.isArray(s.tags) ? s.tags.map((t) => t.toLowerCase()) : [];

    // Correspondência exata ou substring em ID ou Nome
    if (idStr === text || nameStr === text) score += 20;
    else if (idStr.includes(text) || nameStr.includes(text) || text.includes(idStr) || text.includes(nameStr)) score += 10;

    for (const w of words) {
      if (idStr.includes(w)) score += 5;
      if (nameStr.includes(w)) score += 4;
      if (tagsArr.some((t) => t.includes(w))) score += 3;
      if (descStr.includes(w)) score += 1;
    }

    if (score >= 3) {
      scored.push({
        id: s.id,
        name: s.name,
        description: s.description,
        tags: s.tags || [],
        path: s.path,
        score,
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Validação rigorosa contra Path Traversal.
 * Garante que o arquivo solicitado resida estritamente dentro do diretório base do Hub.
 */
export function assertSafePath(targetPath, baseDir = GLOBAL_SKILLS_DIR) {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    throw new Error("caminho_invalido");
  }
  let clean = targetPath;
  try {
    clean = decodeURIComponent(clean);
  } catch {}

  // Reject NUL and traversal components before resolving; normalize separators on Windows too.
  if (clean.includes("\0")) {
    throw new Error("path_traversal_detected");
  }
  const portable = clean.replace(/\\/g, "/");
  if (portable.split("/").includes("..")) {
    throw new Error("path_traversal_detected");
  }

  const root = resolve(baseDir);
  const target = resolve(root, clean);
  const fold = (value) => process.platform === "win32" ? value.toLowerCase() : value;
  const rootFold = fold(root);
  const targetFold = fold(target);

  // Only relative paths within the catalog root are valid. POSIX absolute, drive and UNC
  // paths must not be accepted as identifiers, regardless of host platform.
  if (portable.startsWith("/") || /^[a-zA-Z]:\//.test(portable) || portable.startsWith("//")) {
    throw new Error("path_traversal_detected");
  }
  if (!(targetFold === rootFold || targetFold.startsWith(rootFold.endsWith(sep) ? rootFold : rootFold + sep))) {
    throw new Error("path_traversal_detected");
  }
  return target;
}

/**
 * Carrega com segurança o conteúdo de um SKILL.md dado um ID, nome ou caminho relativo.
 */
export function loadSkill(identifier, baseDir = GLOBAL_SKILLS_DIR) {
  if (!identifier || typeof identifier !== "string") {
    throw new Error("skill_identifier_required");
  }

  let clean = identifier.trim();
  try {
    clean = decodeURIComponent(clean).trim();
  } catch {}

  const isPathLike = clean.includes("..") || clean.includes("\0") || clean.startsWith("/") || clean.startsWith("\\") || clean.includes("/") || clean.includes("\\");

  // Verifica proativamente tentativas de Path Traversal antes de qualquer busca
  if (isPathLike) {
    assertSafePath(clean, baseDir);
  }

  const catalog = getCatalog(baseDir);
  const skills = Array.isArray(catalog?.skills) ? catalog.skills : [];

  // 1. Busca por ID exato ou nome
  let skill = skills.find(
    (s) => s.id?.toLowerCase() === clean.toLowerCase() || s.name?.toLowerCase() === clean.toLowerCase()
  );

  // 1.1 Se não encontrou exato e não é um caminho com separadores, busca por prefixo/início do ID ou substring
  if (!skill && !isPathLike) {
    skill = skills.find((s) => s.id?.toLowerCase().startsWith(clean.toLowerCase()));
  }
  if (!skill && !isPathLike) {
    skill = skills.find((s) => s.id?.toLowerCase().includes(clean.toLowerCase()));
  }

  // 2. Se não encontrou por ID, tenta por caminho de arquivo relativo
  let resolvedFilePath = "";
  if (skill) {
    resolvedFilePath = assertSafePath(skill.path || `skills/${skill.id}/SKILL.md`, baseDir);
  } else if (isPathLike) {
    try {
      const candidate = clean.endsWith(".md") ? clean : `skills/${clean}/SKILL.md`;
      resolvedFilePath = assertSafePath(candidate, baseDir);
    } catch (e) {
      if (e.message === "path_traversal_detected") throw e;
      throw new Error("skill_not_found");
    }
  } else {
    // Trata como identificador ou busca parcial
    const matches = matchSkillsForPrompt(clean, 1, baseDir);
    if (matches.length > 0 && matches[0].score >= 4) {
      skill = matches[0];
      resolvedFilePath = assertSafePath(skill.path, baseDir);
    } else {
      // Tenta carregar como caminho relativo explícito dentro do repositório
      try {
        const candidate = clean.endsWith(".md") ? clean : `skills/${clean}/SKILL.md`;
        resolvedFilePath = assertSafePath(candidate, baseDir);
      } catch (e) {
        if (e.message === "path_traversal_detected") throw e;
        throw new Error("skill_not_found");
      }
    }
  }


  if (!existsSync(resolvedFilePath)) {
    throw new Error("skill_not_found");
  }

  const content = readFileSync(resolvedFilePath, "utf8");
  return {
    id: skill?.id || clean,
    name: skill?.name || clean,
    description: skill?.description || "",
    tags: skill?.tags || [],
    path: skill?.path || resolvedFilePath,
    content,
  };
}

export { sanitizeSkillFrontmatter } from "../scripts/setup-global-skills.mjs";
export {
  getRouterStatus,
  classifyTaskIntent,
  ROUTING_PROFILES,
  recordProviderMetric,
  recordVoiceMetric,
  getProviderTelemetry,
  resetProviderTelemetry,
  compactConversationContext,
} from "./llm.js";


