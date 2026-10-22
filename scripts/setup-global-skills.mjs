#!/usr/bin/env node
// scripts/setup-global-skills.mjs
// Hub Global de Skills Multi-Agente (%USERPROFILE%\.agent-skills)
// Provisiona, clona, cataloga e indexa repositórios de skills de forma idempotente e segura.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, copyFileSync } from "node:fs";
import { join, resolve, relative, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const BASE_DIR = process.env.JARVIS_GLOBAL_SKILLS_DIR || join(os.homedir(), ".agent-skills");
const REPOS_DIR = join(BASE_DIR, "repos");
const SKILLS_CONSOLIDATED = join(BASE_DIR, "skills");
const MCP_CATALOG = join(BASE_DIR, "mcp-catalog");
const CATALOG_PATH = join(BASE_DIR, "catalog.json");

const GIT_EXECUTABLE = process.env.GIT_BIN || (
  existsSync("C:\\Users\\layte\\.antigravity\\tools\\git\\cmd\\git.exe")
    ? "C:\\Users\\layte\\.antigravity\\tools\\git\\cmd\\git.exe"
    : "git"
);

/**
 * Sanitiza e normaliza o frontmatter YAML de um arquivo SKILL.md.
 * Corrige valores escalares não escapados contendo ': ', '#', '[', ']', '{', '}',
 * '@', '&', '*', crases ou quebras de linha espúrias em plain scalars.
 * Se o arquivo não possuir frontmatter, injeta um padrão limpo.
 */
export function sanitizeSkillFrontmatter(rawMarkdown) {
  if (typeof rawMarkdown !== "string") return rawMarkdown;

  // Remove UTF-8 BOM se presente
  if (rawMarkdown.charCodeAt(0) === 0xFEFF) {
    rawMarkdown = rawMarkdown.slice(1);
  }

  const fmMatch = rawMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    const titleMatch = rawMarkdown.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "custom-skill";
    const name = title.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "custom-skill";

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
        const cleanVal = fullVal.replace(/^["']+|["']+$/g, "").trim().replace(/\s+/g, " ");
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
    { name: "agent-skills", url: "https://github.com/addyosmani/agent-skills.git", defaultBranch: "main" },
    { name: "google-skills", url: "https://github.com/google/skills.git", defaultBranch: "main" },
    { name: "threejs-skills", url: "https://github.com/CloudAI-X/threejs-skills.git", defaultBranch: "main" },
    { name: "gsap-skills", url: "https://github.com/greensock/gsap-skills.git", defaultBranch: "main" },
    { name: "design-dna", url: "https://github.com/zanwei/design-dna.git", defaultBranch: "main" },
    { name: "motion-design-skill", url: "https://github.com/LottieFiles/motion-design-skill.git", defaultBranch: "main" },
    { name: "genjutsu", url: "https://github.com/AThevon/genjutsu.git", defaultBranch: "main" },
    { name: "emilkowalski-skills", url: "https://github.com/emilkowalski/skills.git", defaultBranch: "main" },
    { name: "hyperframes", url: "https://github.com/heygen-com/hyperframes.git", defaultBranch: "main" },
  ];

  function runGit(args, cwd = process.cwd()) {
    try {
      const res = spawnSync(GIT_EXECUTABLE, args, { cwd, encoding: "utf8", timeout: 60000, shell: true });
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
        console.warn(`  [aviso] Falha ao atualizar ${repo.name}: ${pull.err || "erro desconhecido"}. Mantendo cópia local.`);
      } else {
        console.log(`  -> Atualizado com sucesso.`);
      }
    } else {
      console.log(`  -> Clonando shallow (--depth 1)...`);
      const clone = runGit(["clone", "--depth", "1", repo.url, dest]);
      if (!clone.ok) {
        console.warn(`  [aviso] Falha ao clonar ${repo.name}: ${clone.err || "repositório inacessível"}. Continuando...`);
      } else {
        console.log(`  -> Clonado com sucesso em ${dest}.`);
      }
    }
  }

  // 2. Catálogo MCP / Schemas de Frameworks (Goose & Dyad)
  console.log("\n[MCP Catalog] Indexando esquemas de ferramentas para Goose e Dyad...");

  const gooseCatalog = {
    name: "goose",
    description: "Block Goose open-source extensible agent framework with Model Context Protocol (MCP) tool support.",
    repo: "https://github.com/block/goose",
    protocols: ["mcp", "acp", "stdio", "sse"],
    skills: [
      { name: "developer-workflows", description: "Automated test execution, git operations, shell task execution." },
      { name: "memory-learning", description: "Continuous learning and persistent state management." },
      { name: "mcp-extensions", description: "Dynamic plugin and extension loading via MCP configuration." },
    ],
  };
  writeFileSync(join(MCP_CATALOG, "goose-mcp.json"), JSON.stringify(gooseCatalog, null, 2) + "\n");

  const dyadCatalog = {
    name: "dyad",
    description: "Dyad local AI development environment with IPC bridge, git worktree isolation, and code synthesis.",
    repo: "https://github.com/dyad-sh/dyad",
    protocols: ["ipc", "mcp"],
    skills: [
      { name: "worktree-sandbox", description: "Isolated git worktree sandbox creation for safe code refactoring." },
      { name: "chat-stream-protocol", description: "State machine streaming protocol with live progress updates." },
      { name: "playwright-e2e-runner", description: "Automated browser validation and verification harness." },
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
        const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("---"));
        if (lines.length) description = lines[0].slice(0, 300);
        else description = `Especialização em ${name}`;
      }

      if (!tags.length) {
        const parts = relativeBase.toLowerCase().split(/[/\\]/);
        tags = [...new Set(parts.filter((p) => p && p !== "repos" && p !== "skills" && p !== "skill.md"))];
      }

      const relPath = relative(BASE_DIR, filePath).replace(/\\/g, "/");
      const id = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");

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
    console.log("  [aviso] Nenhum SKILL.md externo encontrado; gerando catálogo essencial local...");
    const essentials = [
      {
        id: "threejs-expert",
        name: "Three.js & WebGL 3D Expert",
        description: "Construção de cenas 3D, WebGL/WebGPU, shaders TSL/GLSL, controle de ciclo de vida e descarte de recursos de GPU.",
        tags: ["threejs", "webgl", "webgpu", "3d", "r3f"],
        category: "graphics",
      },
      {
        id: "gsap-motion",
        name: "GSAP High-Performance Animation",
        description: "Animações fluidas de interface com GSAP Timeline, ScrollTrigger, interpolações SVG e otimização de composite layers.",
        tags: ["gsap", "animation", "motion", "frontend"],
        category: "motion",
      },
      {
        id: "design-dna",
        name: "Design DNA & Interface Polish",
        description: "Padrões de design visual refinado, tipografia proporcional, paletas HUD ciano/âmbar, espaçamentos consistentes e UX moderna.",
        tags: ["design", "ui", "ux", "tailwind", "hud"],
        category: "design",
      },
      {
        id: "karpathy-engineering",
        name: "Karpathy Lean Engineering",
        description: "Engenharia ágil com foco em simplicidade radical, inspeção de dados brutos antes de abstrações e modificações cirúrgicas.",
        tags: ["engineering", "architecture", "clean-code"],
        category: "engineering",
      },
    ];

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
  runSetup();
}
