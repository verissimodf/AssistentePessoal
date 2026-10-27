#!/usr/bin/env node
// scripts/setup-global-skills.mjs
// Hub Global de Skills Multi-Agente (%USERPROFILE%\.agent-skills)
// Provisiona, clona, cataloga e indexa repositórios de skills de forma idempotente e segura.

import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  lstatSync,
  copyFileSync,
  chmodSync,
  renameSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, relative, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const BASE_DIR = process.env.JARVIS_GLOBAL_SKILLS_DIR || join(os.homedir(), ".agent-skills");
const REPOS_DIR = join(BASE_DIR, "repos");
const SKILLS_CONSOLIDATED = join(BASE_DIR, "skills");
const MCP_CATALOG = join(BASE_DIR, "mcp-catalog");
const CATALOG_PATH = join(BASE_DIR, "catalog.json");

const GIT_EXECUTABLE =
  process.env.GIT_BIN ||
  (existsSync("C:\\Users\\layte\\.antigravity\\tools\\git\\cmd\\git.exe")
    ? "C:\\Users\\layte\\.antigravity\\tools\\git\\cmd\\git.exe"
    : "git");

/**
 * Sanitiza e normaliza o frontmatter YAML de um arquivo SKILL.md.
 * Corrige valores escalares não escapados contendo ': ', '#', '[', ']', '{', '}',
 * '@', '&', '*', crases ou quebras de linha espúrias em plain scalars.
 * Se o arquivo não possuir frontmatter, injeta um padrão limpo.
 */
export function sanitizeSkillFrontmatter(rawMarkdown) {
  if (typeof rawMarkdown !== "string") return rawMarkdown;

  // Remove UTF-8 BOM se presente
  if (rawMarkdown.charCodeAt(0) === 0xfeff) {
    rawMarkdown = rawMarkdown.slice(1);
  }

  const fmMatch = rawMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    const titleMatch = rawMarkdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "custom-skill";
    const name =
      title
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-|-$/g, "") || "custom-skill";

    const lines = rawMarkdown
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("---"));
    const description = lines.length ? lines[0].slice(0, 300) : `Especialização em ${title}`;

    const cleanFrontmatter = [
      "---",
      `name: ${JSON.stringify(name)}`,
      `description: ${JSON.stringify(description)}`,
      "---",
      "",
    ].join("\n");

    return cleanFrontmatter + rawMarkdown.trimStart();
  }

  const rawFrontmatter = fmMatch[1];
  const body = rawMarkdown.slice(fmMatch[0].length);

  const sanitizedLines = [];
  const lines = rawFrontmatter.split(/\r?\n/);
  let inBlockScalar = false;
  let blockScalarIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inBlockScalar) {
      const currentIndent = line.search(/\S/);
      if (currentIndent > blockScalarIndent || line.trim() === "") {
        sanitizedLines.push(line);
        continue;
      } else {
        inBlockScalar = false;
      }
    }

    if (!line.trim() || line.trim().startsWith("#")) {
      sanitizedLines.push(line);
      continue;
    }

    const keyMatch = line.match(/^(\s*)([a-zA-Z0-9_-]+):(\s*.*)$/);
    if (keyMatch) {
      const indent = keyMatch[1];
      const key = keyMatch[2];
      const rest = keyMatch[3].trim();

      // Indicadores de block scalar (>-, |, etc.)
      if (/^[>|][+-]?\s*$/.test(rest)) {
        inBlockScalar = true;
        blockScalarIndent = indent.length;
        sanitizedLines.push(line);
        continue;
      }

      // Chave sem valor imediato (ex.: metadata:, tags:)
      if (!rest) {
        sanitizedLines.push(line);
        continue;
      }

      // Array inline válido [a, b, c]
      if (rest.startsWith("[") && rest.endsWith("]")) {
        sanitizedLines.push(line);
        continue;
      }

      // Verifica se há linhas de continuação indentadas sem chave
      let fullVal = rest;
      let nextIdx = i + 1;
      while (nextIdx < lines.length) {
        const nextLine = lines[nextIdx];
        if (!nextLine.trim() || nextLine.trim().startsWith("#")) break;
        const nextIndent = nextLine.search(/\S/);
        if (nextIndent > indent.length && !nextLine.trim().match(/^[a-zA-Z0-9_-]+:\s/)) {
          fullVal += " " + nextLine.trim();
          nextIdx++;
        } else {
          break;
        }
      }

      if (nextIdx > i + 1) {
        i = nextIdx - 1;
        const cleanVal = fullVal
          .replace(/^["']+|["']+$/g, "")
          .trim()
          .replace(/\s+/g, " ");
        sanitizedLines.push(`${indent}${key}: ${JSON.stringify(cleanVal)}`);
        continue;
      }

      const isAlreadyQuoted =
        (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) ||
        (rest.startsWith("'") && rest.endsWith("'") && rest.length >= 2);

      if (isAlreadyQuoted) {
        sanitizedLines.push(line);
        continue;
      }

      const needsQuoting =
        rest.includes(": ") ||
        rest.includes("#") ||
        rest.includes("{") ||
        rest.includes("}") ||
        rest.includes("[") ||
        rest.includes("]") ||
        rest.includes("@") ||
        rest.includes("&") ||
        rest.includes("*") ||
        rest.includes("`") ||
        rest.startsWith('"') ||
        rest.startsWith("'") ||
        key === "description" ||
        key === "compatibility" ||
        (key === "name" && /[^a-zA-Z0-9_-]/.test(rest));

      if (needsQuoting) {
        const cleanVal = rest.replace(/^["']+|["']+$/g, "").trim();
        sanitizedLines.push(`${indent}${key}: ${JSON.stringify(cleanVal)}`);
      } else {
        sanitizedLines.push(line);
      }
    } else {
      sanitizedLines.push(line);
    }
  }

  const cleanFrontmatter = ["---", ...sanitizedLines, "---"].join("\n");
  return cleanFrontmatter + body;
}

/** Versão do catálogo determinístico local (modo offline). */
export const ESSENTIALS_VERSION = "1.2.1-builtin";

/**
 * Catálogo determinístico embutido: sem rede, sem clones, sem origem não verificada (P1-C).
 * É a fonte padrão do runtime e o fallback quando nenhum repositório externo foi indexado.
 */
export const ESSENTIAL_SKILLS = [
  {
    id: "threejs-expert",
    name: "Three.js & WebGL 3D Expert",
    description:
      "Construção de cenas 3D, WebGL/WebGPU, shaders TSL/GLSL, controle de ciclo de vida e descarte de recursos de GPU.",
    tags: ["threejs", "webgl", "webgpu", "3d", "r3f"],
    category: "graphics",
  },
  {
    id: "gsap-motion",
    name: "GSAP High-Performance Animation",
    description:
      "Animações fluidas de interface com GSAP Timeline, ScrollTrigger, interpolações SVG e otimização de composite layers.",
    tags: ["gsap", "animation", "motion", "frontend"],
    category: "motion",
  },
  {
    id: "design-dna",
    name: "Design DNA & Interface Polish",
    description:
      "Padrões de design visual refinado, tipografia proporcional, paletas HUD ciano/âmbar, espaçamentos consistentes e UX moderna.",
    tags: ["design", "ui", "ux", "tailwind", "hud"],
    category: "design",
  },
  {
    id: "karpathy-engineering",
    name: "Karpathy Lean Engineering",
    description:
      "Engenharia ágil com foco em simplicidade radical, inspeção de dados brutos antes de abstrações e modificações cirúrgicas.",
    tags: ["engineering", "architecture", "clean-code"],
    category: "engineering",
  },
];

/**
 * Provisionamento OFFLINE e deterministico do Skills Hub (P1-C).
 * - não faz rede, não clona repositórios e não executa código de terceiros;
 * - idempotente: repetir a execução não duplica nem corrompe entradas;
 * - NUNCA lança: devolve `{ ok, reason }` para que a falha seja explícita e diagnosticável.
 * `bridges: true` é opt-in e cria pontes em ~/.claude|.gemini|.antigravity (fora do container por padrão).
 */
export function runEssentialsSetup({
  baseDir = BASE_DIR,
  bridges = false,
  log = console.log,
} = {}) {
  try {
    const consolidated = join(baseDir, "skills");
    const catalogPath = join(baseDir, "catalog.json");
    mkdirSync(consolidated, { recursive: true });

    const skills = [];
    for (const item of ESSENTIAL_SKILLS) {
      const dir = join(consolidated, item.id);
      mkdirSync(dir, { recursive: true });
      const content = `# ${item.name}\n\n${item.description}\n\nTags: ${item.tags.join(", ")}\n`;
      const clean = sanitizeSkillFrontmatter(content);
      const fullPath = join(dir, "SKILL.md");
      writeFileSync(fullPath, clean, "utf8");
      skills.push({
        ...item,
        source: "builtin",
        path: `skills/${item.id}/SKILL.md`,
        fullPath,
        size: clean.length,
      });
    }

    const catalog = {
      version: ESSENTIALS_VERSION,
      generatedAt: new Date().toISOString(),
      baseDir,
      source: "builtin",
      totalSkills: skills.length,
      skills,
    };
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
    log(
      `assistente-pessoal: skills hub (builtin) provisionado em ${baseDir} (${skills.length} skills)`,
    );

    if (bridges) {
      for (const bridgeDir of [
        join(os.homedir(), ".claude", "skills"),
        join(os.homedir(), ".gemini", "skills"),
        join(os.homedir(), ".antigravity", "skills"),
      ]) {
        try {
          mkdirSync(bridgeDir, { recursive: true });
          for (const s of skills) {
            mkdirSync(join(bridgeDir, s.id), { recursive: true });
            writeFileSync(
              join(bridgeDir, s.id, "SKILL.md"),
              readFileSync(s.fullPath, "utf8"),
              "utf8",
            );
          }
        } catch {
          /* pontes são best-effort e nunca derrubam o provisionamento */
        }
      }
    }
    return {
      ok: true,
      reason: null,
      baseDir,
      catalogPath,
      totalSkills: skills.length,
      source: "builtin",
    };
  } catch (e) {
    return {
      ok: false,
      reason: `provision_failed: ${e?.code ?? e?.message ?? "erro"}`,
      baseDir,
      totalSkills: 0,
    };
  }
}

/**
 * Skills externas vendorizadas: fonte fixada por commit, com manifesto e SHA256SUMS.
 * O runtime NUNCA executa nada desse diretório; apenas copia Markdown/Documentação para o hub.
 */
export const BUNDLED_SKILLS_SOURCE =
  process.env.JARVIS_BUNDLED_SKILLS_DIR ||
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "skills",
    "vendor",
    "addyosmani-agent-skills",
  );

const BUNDLED_SOURCE_PREFIX = "addyosmani/agent-skills@";

function insideRoot(root, target) {
  const fold = (v) => (process.platform === "win32" ? v.toLowerCase() : v);
  const r = fold(resolve(root));
  const t = fold(resolve(target));
  return (
    t === r ||
    t.startsWith(
      r.endsWith("/") || r.endsWith("\\") ? r : r + (process.platform === "win32" ? "\\" : "/"),
    )
  );
}

function isSafeRelativeFile(rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\0")) return false;
  const portable = rel.replace(/\\/g, "/");
  if (portable.startsWith("/") || /^[a-zA-Z]:\//.test(portable) || portable.startsWith("//"))
    return false;
  return !portable.split("/").includes("..");
}

function sha256OfFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** Lê e valida o manifesto. Qualquer divergência é erro — nunca "corrige" em silêncio. */
function readBundledManifest(sourceDir) {
  const manifestPath = join(sourceDir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("manifest_missing");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("manifest_invalid");
  }
  const upstream = manifest?.upstream;
  if (
    manifest?.schema !== 1 ||
    !upstream ||
    typeof upstream.repo !== "string" ||
    !/^[0-9a-f]{40}$/i.test(String(upstream.commit || "")) ||
    !Array.isArray(manifest.skills) ||
    manifest.skills.length === 0
  ) {
    throw new Error("manifest_invalid");
  }
  const ids = new Set();
  for (const skill of manifest.skills) {
    if (typeof skill?.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(skill.id)) {
      throw new Error("skill_id_invalid");
    }
    if (ids.has(skill.id)) throw new Error(`skill_id_duplicate:${skill.id}`);
    ids.add(skill.id);
    if (typeof skill.name !== "string" || !skill.name.trim() || /[\r\n]/.test(skill.name)) {
      throw new Error(`skill_name_invalid:${skill.id}`);
    }
    if (
      !isSafeRelativeFile(skill.path) ||
      !skill.path.startsWith(`${skill.id}/`) ||
      !skill.path.endsWith("/SKILL.md")
    ) {
      throw new Error(`skill_path_invalid:${skill.id}`);
    }
    if (
      !Array.isArray(skill.tags) ||
      !skill.tags.every((t) => typeof t === "string" && t.trim() && !/[\r\n]/.test(t))
    ) {
      throw new Error(`skill_tags_invalid:${skill.id}`);
    }
    if (
      skill.category !== undefined &&
      (typeof skill.category !== "string" || /[\r\n]/.test(skill.category))
    ) {
      throw new Error(`skill_category_invalid:${skill.id}`);
    }
    const refs = skill.references ?? [];
    if (!Array.isArray(refs)) throw new Error(`skill_references_invalid:${skill.id}`);
    for (const ref of refs) {
      if (!isSafeRelativeFile(ref) || !/^references\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(ref)) {
        throw new Error(`skill_reference_invalid:${skill.id}`);
      }
    }
  }
  return manifest;
}

/** Confere TODO arquivo do SHA256SUMS; retorna o conjunto verificado. */
function verifyBundledChecksums(sourceDir) {
  const sumsPath = join(sourceDir, "SHA256SUMS");
  if (!existsSync(sumsPath)) throw new Error("checksums_missing");
  const lines = readFileSync(sumsPath, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const verified = new Set();
  for (const line of lines) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (!m) throw new Error("checksums_invalid");
    const rel = m[2].replace(/^\.\//, "").trim();
    if (!isSafeRelativeFile(rel)) throw new Error(`checksum_path_invalid:${rel}`);
    const full = resolve(sourceDir, rel);
    if (!insideRoot(sourceDir, full)) throw new Error(`checksum_path_invalid:${rel}`);
    if (!existsSync(full) || !lstatSync(full).isFile())
      throw new Error(`checksum_file_missing:${rel}`);
    if (sha256OfFile(full) !== m[1].toLowerCase()) throw new Error(`checksum_mismatch:${rel}`);
    verified.add(rel);
  }
  if (!verified.size) throw new Error("checksums_empty");
  return verified;
}

/** Extrai descrição do frontmatter sem depender de parser YAML externo. */
function readSkillDescription(content, id) {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const raw = fm?.[1]?.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  const description = raw
    ?.replace(/^["']|["']$/g, "")
    .replace(/\\"/g, '"')
    .trim();
  if (!description) throw new Error(`skill_description_missing:${id}`);
  return description;
}

/**
 * Sincroniza as skills vendorizadas para o Hub Global.
 * - valida manifesto, cobertura e checksums ANTES de tocar no catálogo;
 * - preserva skills de terceiros; substitui apenas entradas com origem `addyosmani/agent-skills@`;
 * - não usa rede, não executa scripts do upstream e nunca apaga skill de terceiros.
 * Falha com `{ ok: false, reason }`; o catálogo anterior permanece intacto.
 */
export function syncBundledSkills({
  baseDir = BASE_DIR,
  sourceDir = BUNDLED_SKILLS_SOURCE,
  log = console.log,
} = {}) {
  const staging = [];
  try {
    // 0. Recusa hub com symlink nas raízes graváveis: evita escrever fora do diretório do hub.
    const lstatSafe = (p) => {
      try {
        return lstatSync(p);
      } catch {
        return null;
      }
    };
    const catalogPath = join(baseDir, "catalog.json");
    const catalogStat = lstatSafe(catalogPath);
    if (catalogStat?.isSymbolicLink()) return { ok: false, reason: "catalog_symlink", baseDir };
    const skillsRoot = join(baseDir, "skills");
    if (lstatSafe(skillsRoot)?.isSymbolicLink()) {
      return { ok: false, reason: "skills_dir_symlink", baseDir };
    }

    // 1. Baseline embutida primeiro: uma falha nas skills vendorizadas não deixa o hub vazio.
    if (!catalogStat) {
      const r = runEssentialsSetup({ baseDir, log: () => {} });
      if (!r.ok) return { ok: false, reason: r.reason || "builtin_provision_failed", baseDir };
    }
    let catalog;
    try {
      catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    } catch {
      return { ok: false, reason: "catalog_invalid", baseDir };
    }
    if (!catalog || !Array.isArray(catalog.skills))
      return { ok: false, reason: "catalog_invalid", baseDir };

    // 2. Validação completa (manifesto, cobertura e checksums) antes de qualquer escrita.
    const manifest = readBundledManifest(sourceDir);
    const verified = verifyBundledChecksums(sourceDir);
    const requiredFiles = ["manifest.json"];
    if (manifest.upstream.licenseFile)
      requiredFiles.push(String(manifest.upstream.licenseFile).replace(/^\.\//, ""));
    for (const skill of manifest.skills) {
      requiredFiles.push(skill.path);
      for (const ref of skill.references ?? []) requiredFiles.push(`${skill.id}/${ref}`);
    }
    for (const rel of requiredFiles) {
      if (!verified.has(rel)) throw new Error(`checksum_coverage_incomplete:${rel}`);
    }

    // 3. Conflitos: nunca sobrescrever skill local/terceira nem diretório sem catálogo.
    const managed = (s) =>
      typeof s.source === "string" && s.source.startsWith(BUNDLED_SOURCE_PREFIX);
    const legacyUpstream = (s) =>
      !s.source && typeof s.path === "string" && s.path.startsWith("repos/");
    const existingById = new Map(catalog.skills.map((s) => [s.id, s]));
    for (const skill of manifest.skills) {
      const entry = existingById.get(skill.id);
      if (entry && !managed(entry) && !legacyUpstream(entry)) {
        return { ok: false, reason: `skill_id_conflict:${skill.id}`, baseDir };
      }
      if (!entry && existsSync(join(baseDir, "skills", skill.id))) {
        return { ok: false, reason: `skill_dir_conflict:${skill.id}`, baseDir };
      }
    }

    // 4. Metadados (incluindo descrição) calculados ANTES de remover/copiar qualquer arquivo.
    const prepared = manifest.skills.map((skill) => {
      const content = readFileSync(join(sourceDir, skill.path), "utf8");
      const description = readSkillDescription(content, skill.id);
      const destDir = join(baseDir, "skills", skill.id);
      return {
        skill,
        destDir,
        entry: {
          id: skill.id,
          name: skill.name,
          description,
          tags: skill.tags,
          category: skill.category || "engineering",
          source: `${BUNDLED_SOURCE_PREFIX}${manifest.upstream.commit}`,
          path: `skills/${skill.id}/SKILL.md`,
          references: (skill.references ?? []).map((ref) => `skills/${skill.id}/${ref}`),
          fullPath: join(destDir, "SKILL.md"),
          size: content.length,
        },
        files: [
          { sourceRel: skill.path, destSub: "SKILL.md" },
          ...(skill.references ?? []).map((ref) => ({
            sourceRel: `${skill.id}/${ref}`,
            destSub: ref,
          })),
        ],
      };
    });

    // 5. Copia para staging e troca por rename; erro de cópia não destrói o diretório anterior.
    try {
      for (const item of prepared) {
        const stageDir = join(baseDir, "skills", `.sync-${item.skill.id}-${process.pid}`);
        rmSync(stageDir, { recursive: true, force: true });
        staging.push(stageDir);
        for (const file of item.files) {
          if (!isSafeRelativeFile(file.destSub))
            throw new Error(`skill_path_invalid:${item.skill.id}`);
          const dest = join(stageDir, file.destSub);
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(join(sourceDir, file.sourceRel), dest);
          chmodSync(dest, 0o644);
        }
      }
      for (let i = 0; i < prepared.length; i++) {
        const item = prepared[i];
        const stageDir = staging[i];
        const backup = `${item.destDir}.old-${process.pid}`;
        const hadDest = existsSync(item.destDir);
        rmSync(backup, { recursive: true, force: true });
        if (hadDest) renameSync(item.destDir, backup);
        try {
          renameSync(stageDir, item.destDir);
        } catch (e) {
          if (hadDest && existsSync(backup)) renameSync(backup, item.destDir);
          throw e;
        }
        if (hadDest) rmSync(backup, { recursive: true, force: true });
      }
    } finally {
      for (const dir of staging) rmSync(dir, { recursive: true, force: true });
    }

    // 6. Catálogo só é trocado depois de todos os arquivos estarem no lugar.
    const ids = new Set(prepared.map((p) => p.skill.id));
    const kept = catalog.skills.filter((s) => !ids.has(s.id));
    const next = [...kept, ...prepared.map((p) => p.entry)];
    catalog.skills = next;
    catalog.totalSkills = next.length;
    catalog.bundled = {
      repo: manifest.upstream.repo,
      commit: manifest.upstream.commit,
      license: manifest.upstream.license || null,
      syncedAt: new Date().toISOString(),
    };
    const tmp = `${catalogPath}.tmp-${process.pid}`;
    try {
      writeFileSync(tmp, JSON.stringify(catalog, null, 2) + "\n", "utf8");
      renameSync(tmp, catalogPath);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
    log(
      `assistente-pessoal: skills vendorizadas sincronizadas em ${baseDir} (${prepared.length} de ${manifest.upstream.repo}@${manifest.upstream.commit.slice(0, 7)})`,
    );
    return {
      ok: true,
      reason: null,
      baseDir,
      installed: prepared.map((p) => p.skill.id),
      totalSkills: next.length,
      upstream: { repo: manifest.upstream.repo, commit: manifest.upstream.commit },
    };
  } catch (e) {
    return { ok: false, reason: e?.message || "sync_failed", baseDir };
  }
}

export function runSetup() {
  console.log("==================================================================");
  console.log(" Hub Global de Skills Multi-Agente — Provisionamento v1.2.1");
  console.log(` Diretório Base: ${BASE_DIR}`);
  console.log("==================================================================");

  // Cria diretórios base
  mkdirSync(REPOS_DIR, { recursive: true });
  mkdirSync(SKILLS_CONSOLIDATED, { recursive: true });
  mkdirSync(MCP_CATALOG, { recursive: true });

  // Repositórios de Skills a clonar
  const SKILL_REPOS = [
    {
      name: "agent-skills",
      url: "https://github.com/addyosmani/agent-skills.git",
      defaultBranch: "main",
    },
    { name: "google-skills", url: "https://github.com/google/skills.git", defaultBranch: "main" },
    {
      name: "threejs-skills",
      url: "https://github.com/CloudAI-X/threejs-skills.git",
      defaultBranch: "main",
    },
    {
      name: "gsap-skills",
      url: "https://github.com/greensock/gsap-skills.git",
      defaultBranch: "main",
    },
    { name: "design-dna", url: "https://github.com/zanwei/design-dna.git", defaultBranch: "main" },
    {
      name: "motion-design-skill",
      url: "https://github.com/LottieFiles/motion-design-skill.git",
      defaultBranch: "main",
    },
    { name: "genjutsu", url: "https://github.com/AThevon/genjutsu.git", defaultBranch: "main" },
    {
      name: "emilkowalski-skills",
      url: "https://github.com/emilkowalski/skills.git",
      defaultBranch: "main",
    },
    {
      name: "hyperframes",
      url: "https://github.com/heygen-com/hyperframes.git",
      defaultBranch: "main",
    },
  ];

  function runGit(args, cwd = process.cwd()) {
    try {
      const res = spawnSync(GIT_EXECUTABLE, args, {
        cwd,
        encoding: "utf8",
        timeout: 60000,
        shell: true,
      });
      return { ok: res.status === 0, out: res.stdout, err: res.stderr };
    } catch (e) {
      return { ok: false, out: "", err: e.message };
    }
  }

  // 1. Clona ou atualiza repositórios de skills
  for (const repo of SKILL_REPOS) {
    const dest = join(REPOS_DIR, repo.name);
    console.log(`\n[Repo] ${repo.name} (${repo.url})...`);

    if (existsSync(dest) && existsSync(join(dest, ".git"))) {
      console.log(`  -> Já existe em ${dest}. Atualizando via git pull...`);
      const pull = runGit(["pull", "--ff-only"], dest);
      if (!pull.ok) {
        console.warn(
          `  [aviso] Falha ao atualizar ${repo.name}: ${pull.err || "erro desconhecido"}. Mantendo cópia local.`,
        );
      } else {
        console.log(`  -> Atualizado com sucesso.`);
      }
    } else {
      console.log(`  -> Clonando shallow (--depth 1)...`);
      const clone = runGit(["clone", "--depth", "1", repo.url, dest]);
      if (!clone.ok) {
        console.warn(
          `  [aviso] Falha ao clonar ${repo.name}: ${clone.err || "repositório inacessível"}. Continuando...`,
        );
      } else {
        console.log(`  -> Clonado com sucesso em ${dest}.`);
      }
    }
  }

  // 2. Catálogo MCP / Schemas de Frameworks (Goose & Dyad)
  console.log("\n[MCP Catalog] Indexando esquemas de ferramentas para Goose e Dyad...");

  const gooseCatalog = {
    name: "goose",
    description:
      "Block Goose open-source extensible agent framework with Model Context Protocol (MCP) tool support.",
    repo: "https://github.com/block/goose",
    protocols: ["mcp", "acp", "stdio", "sse"],
    skills: [
      {
        name: "developer-workflows",
        description: "Automated test execution, git operations, shell task execution.",
      },
      {
        name: "memory-learning",
        description: "Continuous learning and persistent state management.",
      },
      {
        name: "mcp-extensions",
        description: "Dynamic plugin and extension loading via MCP configuration.",
      },
    ],
  };
  writeFileSync(join(MCP_CATALOG, "goose-mcp.json"), JSON.stringify(gooseCatalog, null, 2) + "\n");

  const dyadCatalog = {
    name: "dyad",
    description:
      "Dyad local AI development environment with IPC bridge, git worktree isolation, and code synthesis.",
    repo: "https://github.com/dyad-sh/dyad",
    protocols: ["ipc", "mcp"],
    skills: [
      {
        name: "worktree-sandbox",
        description: "Isolated git worktree sandbox creation for safe code refactoring.",
      },
      {
        name: "chat-stream-protocol",
        description: "State machine streaming protocol with live progress updates.",
      },
      {
        name: "playwright-e2e-runner",
        description: "Automated browser validation and verification harness.",
      },
    ],
  };
  writeFileSync(join(MCP_CATALOG, "dyad-mcp.json"), JSON.stringify(dyadCatalog, null, 2) + "\n");
  console.log("  -> Esquemas de MCP salvos em mcp-catalog/ (goose-mcp.json, dyad-mcp.json).");

  // 3. Parser de Frontmatter e Conteúdo de Skills
  function parseSkillMetadata(filePath, relativeBase) {
    try {
      const raw = readFileSync(filePath, "utf8");
      const sanitized = sanitizeSkillFrontmatter(raw);
      let name = "";
      let description = "";
      let tags = [];

      // Tenta YAML frontmatter sanitizado
      const frontmatterMatch = sanitized.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (frontmatterMatch) {
        const yaml = frontmatterMatch[1];
        const nameMatch = yaml.match(/^name:\s*(.+)$/m);
        if (nameMatch) name = nameMatch[1].replace(/["']/g, "").trim();

        const descMatch = yaml.match(/^description:\s*(.+)$/m);
        if (descMatch) description = descMatch[1].replace(/["']/g, "").trim();

        const tagsMatch = yaml.match(/^tags:\s*\[?(.*?)\]?$/m);
        if (tagsMatch) {
          tags = tagsMatch[1]
            .split(",")
            .map((t) => t.replace(/["'\[\]]/g, "").trim())
            .filter(Boolean);
        }
      }

      // Fallbacks
      if (!name) {
        const titleMatch = raw.match(/^#\s+(.+)$/m);
        if (titleMatch) name = titleMatch[1].trim();
        else name = basename(dirname(filePath));
      }

      if (!description) {
        const lines = raw
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#") && !l.startsWith("---"));
        if (lines.length) description = lines[0].slice(0, 300);
        else description = `Especialização em ${name}`;
      }

      if (!tags.length) {
        const parts = relativeBase.toLowerCase().split(/[/\\]/);
        tags = [
          ...new Set(parts.filter((p) => p && p !== "repos" && p !== "skills" && p !== "skill.md")),
        ];
      }

      const relPath = relative(BASE_DIR, filePath).replace(/\\/g, "/");
      const id = name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-|-$/g, "");

      return {
        id,
        name,
        description,
        tags,
        path: relPath,
        fullPath: filePath,
        category: tags[0] || "general",
        size: raw.length,
      };
    } catch (e) {
      return null;
    }
  }

  // 4. Scanner Recursivo de Skills
  function findSkillFiles(dir) {
    const results = [];
    if (!existsSync(dir)) return results;

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        results.push(...findSkillFiles(fullPath));
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (lower === "skill.md" || lower.endsWith(".skill.md") || lower === ".cursorrules") {
          results.push(fullPath);
        }
      }
    }
    return results;
  }

  console.log("\n[Indexador] Varrrendo repositórios e compilando catalog.json...");
  const allFiles = findSkillFiles(REPOS_DIR);
  const skills = [];
  const seenIds = new Set();

  for (const f of allFiles) {
    const meta = parseSkillMetadata(f, relative(REPOS_DIR, f));
    if (meta && !seenIds.has(meta.id)) {
      seenIds.add(meta.id);
      skills.push(meta);

      // Cria cópia consolidada e sanitizada em .agent-skills/skills/<id>/SKILL.md
      const targetDir = join(SKILLS_CONSOLIDATED, meta.id);
      mkdirSync(targetDir, { recursive: true });
      try {
        const rawContent = readFileSync(meta.fullPath, "utf8");
        const cleanContent = sanitizeSkillFrontmatter(rawContent);
        writeFileSync(join(targetDir, "SKILL.md"), cleanContent, "utf8");
      } catch {}
    }
  }

  // Se nenhum repo foi clonado ainda ou para garantir catálogo mínimo robusto:
  if (skills.length === 0) {
    console.log(
      "  [aviso] Nenhum SKILL.md externo encontrado; gerando catálogo essencial local...",
    );
    const essentials = ESSENTIAL_SKILLS;

    for (const item of essentials) {
      const dir = join(SKILLS_CONSOLIDATED, item.id);
      mkdirSync(dir, { recursive: true });
      const content = `# ${item.name}\n\n${item.description}\n\nTags: ${item.tags.join(", ")}\n`;
      const fPath = join(dir, "SKILL.md");
      const cleanContent = sanitizeSkillFrontmatter(content);
      writeFileSync(fPath, cleanContent, "utf8");
      skills.push({
        ...item,
        path: `skills/${item.id}/SKILL.md`,
        fullPath: fPath,
        size: cleanContent.length,
      });
    }
  }

  const catalog = {
    version: "1.2.1",
    generatedAt: new Date().toISOString(),
    baseDir: BASE_DIR,
    // Origem explícita: clones de repositórios externos não fixados por commit (modo opt-in).
    source: "github-unpinned",
    totalSkills: skills.length,
    skills,
  };

  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  console.log(`\n  -> Catálogo compilado com sucesso!`);
  console.log(`  -> Total de skills indexadas: ${skills.length}`);
  console.log(`  -> Manifesto: ${CATALOG_PATH}`);

  // 5. Pontes Globais para Agentes do Usuário (Claude, Gemini, Antigravity)
  console.log("\n[Pontes Globais] Conectando com agentes locais...");
  const agentBridges = [
    join(os.homedir(), ".claude", "skills"),
    join(os.homedir(), ".gemini", "skills"),
    join(os.homedir(), ".antigravity", "skills"),
  ];

  for (const bridgeDir of agentBridges) {
    try {
      mkdirSync(bridgeDir, { recursive: true });
      for (const s of skills) {
        const destSkillDir = join(bridgeDir, s.id);
        mkdirSync(destSkillDir, { recursive: true });
        if (existsSync(s.fullPath)) {
          const rawContent = readFileSync(s.fullPath, "utf8");
          const cleanContent = sanitizeSkillFrontmatter(rawContent);
          writeFileSync(join(destSkillDir, "SKILL.md"), cleanContent, "utf8");
        }
      }
      console.log(`  -> Ponte sincronizada: ${bridgeDir} (${skills.length} skills)`);
    } catch (e) {
      console.warn(`  [aviso] Não foi possível sincronizar ponte em ${bridgeDir}: ${e.message}`);
    }
  }

  console.log("\n==================================================================");
  console.log(" Provisionamento do Hub Global Concluído com Sucesso!");
  console.log("==================================================================\n");
}

const isCLI =
  process.argv[1] &&
  (process.argv[1].endsWith("setup-global-skills.mjs") ||
    fileURLToPath(import.meta.url) === resolve(process.argv[1]));

if (isCLI) {
  const args = new Set(process.argv.slice(2));
  // Sincronização das skills vendorizadas (offline, idempotente, falha fechada). É o modo usado
  // pelo entrypoint do container a cada boot: preserva skills de terceiros e o catálogo anterior.
  const wantSync = args.has("--sync-bundled");
  // Padrão SEGURO: catálogo determinístico offline (sem clones de origem não verificada).
  // O modo de rede depende de opt-in explícito: --full ou JARVIS_SKILLS_SOURCE=full.
  const wantFull = args.has("--full") || process.env.JARVIS_SKILLS_SOURCE === "full";
  if (wantSync) {
    const r = syncBundledSkills();
    if (!r.ok) {
      console.error(
        `assistente-pessoal: AVISO — sincronização das skills vendorizadas falhou (${r.reason}); baseline embutida e catálogo anterior preservados.`,
      );
      process.exitCode = 1;
    }
  } else if (wantFull) {
    runSetup();
  } else {
    const r = runEssentialsSetup({ bridges: process.env.JARVIS_SKILLS_BRIDGES === "1" });
    if (!r.ok) {
      console.error(`assistente-pessoal: AVISO — provisionamento de skills falhou (${r.reason}).`);
      process.exitCode = 1;
    }
  }
}
