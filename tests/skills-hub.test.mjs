// tests/skills-hub.test.mjs
// Validação do Hub Global de Skills, Dynamic Skill Injector, Path Traversal, Tool load_skill
// e Resiliência Multi-Provider (Auto-Fallback & Circuit Breaker) em server/llm.js.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

import {
  listSkills,
  matchSkillsForPrompt,
  loadSkill,
  assertSafePath,
  getCatalog,
  GLOBAL_SKILLS_DIR,
} from "../server/skills.js";
import { callTool, TOOL_DEFS } from "../server/tools.js";
import { TOOL_SCOPES } from "../server/auth.js";
import { runAgent } from "../server/llm.js";
import { db } from "../server/db.js";
import { updateSettings } from "../server/settings.js";

// Cria fixture temporária isolada para testes herméticos
function createTempSkillsHub() {
  const tmpDir = mkdtempSync(join(os.tmpdir(), "jarvis-skills-test-"));
  const skillsDir = join(tmpDir, "skills");
  const reposDir = join(tmpDir, "repos");
  mkdirSync(skillsDir, { recursive: true });
  mkdirSync(reposDir, { recursive: true });

  // Cria skill 1: threejs
  const threeDir = join(skillsDir, "threejs-expert");
  mkdirSync(threeDir, { recursive: true });
  writeFileSync(
    join(threeDir, "SKILL.md"),
    "---\nname: Three.js 3D Expert\ndescription: Criação de cenas 3D e shaders WebGL\ntags: [threejs, webgl, 3d]\n---\n# Three.js Expert\n\nDiretrizes de Three.js...",
    "utf8"
  );

  // Cria skill 2: gsap
  const gsapDir = join(skillsDir, "gsap-motion");
  mkdirSync(gsapDir, { recursive: true });
  writeFileSync(
    join(gsapDir, "SKILL.md"),
    "---\nname: GSAP Animation\ndescription: Animações de alto desempenho com ScrollTrigger e timelines\ntags: [gsap, motion, animation]\n---\n# GSAP Motion\n\nDiretrizes de animação GSAP...",
    "utf8"
  );

  // Cria catalog.json
  const catalog = {
    version: "1.2.0",
    generatedAt: new Date().toISOString(),
    baseDir: tmpDir,
    totalSkills: 2,
    skills: [
      {
        id: "threejs-expert",
        name: "Three.js 3D Expert",
        description: "Criação de cenas 3D e shaders WebGL",
        tags: ["threejs", "webgl", "3d"],
        path: "skills/threejs-expert/SKILL.md",
        category: "graphics",
      },
      {
        id: "gsap-motion",
        name: "GSAP Animation",
        description: "Animações de alto desempenho com ScrollTrigger e timelines",
        tags: ["gsap", "motion", "animation"],
        path: "skills/gsap-motion/SKILL.md",
        category: "motion",
      },
    ],
  };
  writeFileSync(join(tmpDir, "catalog.json"), JSON.stringify(catalog, null, 2), "utf8");

  return { tmpDir, cleanup: () => rmSync(tmpDir, { recursive: true, force: true }) };
}

test("skills hub: declaração da ferramenta load_skill e escopo em auth", () => {
  assert.ok(TOOL_DEFS.load_skill, "load_skill deve estar registrada em TOOL_DEFS");
  assert.equal(TOOL_DEFS.load_skill.params.skill, "string");
  assert.equal(TOOL_SCOPES.load_skill, "skills:read");
});

test("skills hub: listSkills lista e filtra por categoria e tag", () => {
  const { tmpDir, cleanup } = createTempSkillsHub();
  try {
    const all = listSkills({ baseDir: tmpDir });
    assert.equal(all.length, 2);
    assert.ok(all.some((s) => s.id === "threejs-expert"));
    assert.ok(all.some((s) => s.id === "gsap-motion"));

    const graphics = listSkills({ category: "graphics", baseDir: tmpDir });
    assert.equal(graphics.length, 1);
    assert.equal(graphics[0].id, "threejs-expert");

    const motionTag = listSkills({ tag: "motion", baseDir: tmpDir });
    assert.equal(motionTag.length, 1);
    assert.equal(motionTag[0].id, "gsap-motion");
  } finally {
    cleanup();
  }
});

test("skills hub: matchSkillsForPrompt pontua e ranqueia relevância", () => {
  const { tmpDir, cleanup } = createTempSkillsHub();
  try {
    const matches3D = matchSkillsForPrompt("Como renderizar um cubo 3D usando webgl e shaders?", 5, tmpDir);
    assert.ok(matches3D.length > 0);
    assert.equal(matches3D[0].id, "threejs-expert");

    const matchesMotion = matchSkillsForPrompt("Crie uma timeline suave com gsap para meu menu", 5, tmpDir);
    assert.ok(matchesMotion.length > 0);
    assert.equal(matchesMotion[0].id, "gsap-motion");

    const noMatches = matchSkillsForPrompt("Receita de bolo de chocolate com morango", 5, tmpDir);
    assert.equal(noMatches.length, 0);
  } finally {
    cleanup();
  }
});

test("segurança: assertSafePath bloqueia tentativas de Path Traversal", () => {
  const { tmpDir, cleanup } = createTempSkillsHub();
  try {
    // Tentativa relativa com ..
    assert.throws(() => assertSafePath("../../../windows/win.ini", tmpDir), /path_traversal_detected/);
    assert.throws(() => assertSafePath("..\\..\\etc\\passwd", tmpDir), /path_traversal_detected/);

    // Tentativa com bytes NUL
    assert.throws(() => assertSafePath("skills/threejs\0/secret.txt", tmpDir), /path_traversal_detected/);

    // Tentativa de caminho absoluto externo
    const externalPath = os.platform() === "win32" ? "C:\\Windows\\System32\\calc.exe" : "/etc/shadow";
    assert.throws(() => assertSafePath(externalPath, tmpDir), /path_traversal_detected/);

    // Caminho seguro dentro da base
    const safe = assertSafePath("skills/threejs-expert/SKILL.md", tmpDir);
    assert.ok(safe.startsWith(tmpDir));
  } finally {
    cleanup();
  }
});

test("skills hub: loadSkill carrega conteúdo legítimo e rejeita skills inexistentes", () => {
  const { tmpDir, cleanup } = createTempSkillsHub();
  try {
    const loaded = loadSkill("threejs-expert", tmpDir);
    assert.equal(loaded.id, "threejs-expert");
    assert.ok(loaded.content.includes("Diretrizes de Three.js"));

    assert.throws(() => loadSkill("skill-que-nao-existe-xyz", tmpDir), /skill_not_found/);
  } finally {
    cleanup();
  }
});

test("ferramenta load_skill: integração com callTool e auditoria", async () => {
  const principal = { type: "bot", adminId: "admin-test", scopes: ["chat", "skills:read"] };
  const ctx = { autonomy: "full", pending: [], principal };

  // Chamada de skill válida do Hub Global existente
  const res = await callTool("load_skill", { skill: "threejs" }, ctx);
  assert.ok(typeof res === "string");
  assert.ok(res.includes("[SKILL ESPECIALIZADA:"));

  // Chamada de skill inexistente com sugestão
  const notFound = await callTool("load_skill", { skill: "nao_existe_mesmo_123" }, ctx);
  assert.ok(notFound.includes("não encontrada no Hub Global"));

  // Tentativa maliciosa de Path Traversal
  const traversal = await callTool("load_skill", { skill: "../../../../etc/passwd" }, ctx);
  assert.ok(traversal.includes("Erro de segurança: tentativa de acesso fora do diretório de skills bloqueada."));
});

test("resiliência multi-provider: runAgent realiza fallback transparente e audita eventos", async (t) => {
  const originalFetch = globalThis.fetch;
  let chatAttempts = 0;

  globalThis.fetch = async (url, opts) => {
    const urlStr = String(url);
    // Para chamadas de chat completion:
    if (urlStr.includes("chat/completions") || urlStr.includes("/v1/messages")) {
      chatAttempts++;
      // Simula falha no provedor primário (ex.: erro de rede/timeout/503)
      if (chatAttempts === 1) {
        throw new Error("Falha temporária de conexão com o provedor primário (503 Service Unavailable)");
      }
      // Provedor secundário / fallback responde com sucesso
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "Resposta entregue com sucesso pelo provedor secundário de fallback.",
                tool_calls: [],
              },
            },
          ],
        }),
      };
    }
    // Outras requisições (embeds, etc)
    return {
      ok: true,
      json: async () => ({ embeddings: [[]] }),
    };
  };

  try {
    const existingAdmin = db.prepare("SELECT id FROM admins WHERE active = 1").get();
    let adminId = existingAdmin?.id;
    if (!adminId) {
      adminId = "admin-fb-" + Date.now();
      const uniqueUser = "fb_admin_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
      db.prepare(
        "INSERT INTO admins (id, username, password_hash, created_at, active) VALUES (?,?,?,?,1)"
      ).run(adminId, uniqueUser, "hash", new Date().toISOString());
    }

    const principal = { type: "bot", adminId, scopes: ["chat", "web", "memories:read"] };
    updateSettings({ providers: { openai: { enabled: true, apiKey: "sk-mock-key" } } }, { adminId });
    const res = await runAgent({
      messages: [{ role: "user", content: "Olá Jarvis" }],
      principal,
      maxSteps: 2,
    });

    assert.ok(chatAttempts >= 2, "Deveria ter tentado o primário e realizado fallback para o secundário");
    assert.equal(res.reply, "Resposta entregue com sucesso pelo provedor secundário de fallback.");

    // Verifica que os eventos de telemetria/auditoria foram gravados no banco
    const events = db.prepare("SELECT kind FROM audit WHERE kind LIKE 'provider_fallback%'").all();
    assert.ok(events.some((e) => e.kind === "provider_fallback_attempt"), "Deve registrar tentativa de fallback");
    assert.ok(events.some((e) => e.kind === "provider_fallback_success"), "Deve registrar sucesso do fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
