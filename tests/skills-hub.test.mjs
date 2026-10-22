// tests/skills-hub.test.mjs
// Validação do Hub Global de Skills, Dynamic Skill Injector, Path Traversal, Tool load_skill
// e Resiliência Multi-Provider (Auto-Fallback & Circuit Breaker) em server/llm.js.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import yaml from "js-yaml";

import {
  listSkills,
  matchSkillsForPrompt,
  loadSkill,
  assertSafePath,
  getCatalog,
  GLOBAL_SKILLS_DIR,
  sanitizeSkillFrontmatter,
  getRouterStatus,
} from "../server/skills.js";
import { routeTable, createApp } from "../server/index.js";
import { AuthError } from "../server/auth.js";
import { callTool, TOOL_DEFS } from "../server/tools.js";
import { TOOL_SCOPES } from "../server/auth.js";
import { runAgent } from "../server/llm.js";
import { db, auth } from "../server/db.js";
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

test("sanitizador de frontmatter: corrige colons não escapados, escalares multilinhas, BOM e ausência de frontmatter", () => {
  // Caso 1: Dois-pontos não escapados no valor escalar
  const rawWithColon = `---
name: google-ads-api-account-diagnostics
description: Diagnostic tool for account: issues, recommendations and metrics
compatibility: Google Ads MCP Server (tools: search, list)
---
# Diagnostics
Instruções aqui...`;

  const sanitized1 = sanitizeSkillFrontmatter(rawWithColon);
  assert.ok(sanitized1.startsWith("---"));
  const fm1 = sanitized1.split(/---\r?\n/)[1];
  const parsed1 = yaml.load(fm1);
  assert.equal(parsed1.name, "google-ads-api-account-diagnostics");
  assert.equal(parsed1.description, "Diagnostic tool for account: issues, recommendations and metrics");
  assert.equal(parsed1.compatibility, "Google Ads MCP Server (tools: search, list)");

  // Caso 2: Linha de continuação em escalar plain com dois pontos
  const rawMultiline = `---
name: google-mobile-ads-android-migrate-to-next-gen
description: Migrates from Google Mobile Ads (GMA) SDK v23 to Next-Gen SDK v24
  for Android: covers dependency changes, initialization, and format migrations
tags: [google, ads, android]
---
# Content`;

  const sanitized2 = sanitizeSkillFrontmatter(rawMultiline);
  const fm2 = sanitized2.split(/---\r?\n/)[1];
  const parsed2 = yaml.load(fm2);
  assert.ok(parsed2.description.includes("for Android: covers dependency changes"));
  assert.deepEqual(parsed2.tags, ["google", "ads", "android"]);

  // Caso 3: Arquivo com UTF-8 BOM
  const rawWithBom = "\uFEFF---\nname: bom-skill\ndescription: Teste com BOM\n---\n# BOM Test";
  const sanitized3 = sanitizeSkillFrontmatter(rawWithBom);
  assert.equal(sanitized3.charCodeAt(0), 0x2d, "Não deve conter BOM inicial");
  const fm3 = sanitized3.split(/---\r?\n/)[1];
  const parsed3 = yaml.load(fm3);
  assert.equal(parsed3.name, "bom-skill");

  // Caso 4: Sem frontmatter inicial
  const rawNoFm = "# Skill Sem Frontmatter\nEsta skill foi criada sem bloco YAML.";
  const sanitized4 = sanitizeSkillFrontmatter(rawNoFm);
  assert.ok(sanitized4.startsWith("---"));
  const fm4 = sanitized4.split(/---\r?\n/)[1];
  const parsed4 = yaml.load(fm4);
  assert.ok(parsed4.name);
  assert.ok(parsed4.description);
});

test("multi-provider router: getRouterStatus reporta primário e contingências ativas", () => {
  const status = getRouterStatus();
  assert.ok(status.primary, "Deve retornar o provedor primário");
  assert.ok(typeof status.primary.provider === "string");
  assert.ok(Array.isArray(status.fallbacks), "Deve listar fallbacks");
  assert.equal(typeof status.totalProviders, "number");
  assert.equal(status.resilientFallbackEnabled, true);
});

test("rotas de api /api/skills: inventário, buscas, filtros e proteção de caminho", async () => {
  const routes = routeTable();
  const skillsListRoute = routes.find((r) => r.method === "GET" && r.pattern === "/api/skills");
  const skillGetRoute = routes.find((r) => r.method === "GET" && r.pattern === "/api/skills/:id");

  assert.ok(skillsListRoute, "Rota GET /api/skills deve existir");
  assert.equal(skillsListRoute.access, "skills:read");
  assert.ok(skillGetRoute, "Rota GET /api/skills/:id deve existir");
  assert.equal(skillGetRoute.access, "skills:read");

  // Garante admin existente e cria uma sessão válida para autenticação da API
  let adminRow = db.prepare("SELECT id FROM admins WHERE active = 1").get();
  if (!adminRow) {
    const adminId = "admin-skills-" + Date.now();
    const uname = "skills_adm_" + Date.now();
    db.prepare("INSERT INTO admins (id, username, password_hash, created_at, active) VALUES (?,?,?,?,1)").run(
      adminId,
      uname,
      "dummyhash",
      new Date().toISOString()
    );
    adminRow = { id: adminId };
  }

  const sid = "jss_test_" + Math.random().toString(36).slice(2);
  const sidHash = (await import("node:crypto")).createHash("sha256").update(sid).digest("hex");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id_hash, admin_id, csrf, created_at, last_seen, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(sidHash, adminRow.id, "csrf-test", now, now, now + 12 * 3600 * 1000, "test-runner");

  const server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const apiReq = (path) =>
    fetch(`${base}${path}`, {
      headers: {
        cookie: `jarvis_sid=${sid}`,
      },
    });


  try {
    // 1. Listagem completa
    const listResp = await apiReq("/api/skills");
    assert.equal(listResp.status, 200);
    const listRes = await listResp.json();
    assert.ok(typeof listRes.total === "number");
    assert.ok(typeof listRes.totalCatalog === "number");
    assert.ok(Array.isArray(listRes.categories));
    assert.ok(Array.isArray(listRes.skills));
    assert.ok(listRes.routerStatus);

    // 2. Busca por termo
    const searchResp = await apiReq("/api/skills?q=threejs");
    assert.equal(searchResp.status, 200);
    const searchRes = await searchResp.json();
    assert.ok(searchRes.skills.length > 0);
    assert.ok(searchRes.skills.some((s) => s.id.toLowerCase().includes("threejs")));

    // 3. Obter skill existente
    const firstSkillId = searchRes.skills[0].id;
    const detailResp = await apiReq(`/api/skills/${encodeURIComponent(firstSkillId)}`);
    assert.equal(detailResp.status, 200);
    const detailRes = await detailResp.json();
    assert.equal(detailRes.id, firstSkillId);
    assert.ok(typeof detailRes.content === "string");
    assert.ok(detailRes.content.length > 0);

    // 4. Skill inexistente retorna 404
    const notFoundResp = await apiReq("/api/skills/skill_completamente_inexistente_9999");
    assert.equal(notFoundResp.status, 404);
    const notFoundJson = await notFoundResp.json();
    assert.equal(notFoundJson.error, "skill_not_found");

    // 5. Tentativa de Path Traversal retorna 400
    const traversalResp = await apiReq("/api/skills/..%2F..%2Fwin.ini");
    assert.equal(traversalResp.status, 400);
    const traversalJson = await traversalResp.json();
    assert.equal(traversalJson.error, "invalid_skill_path");
  } finally {
    await new Promise((r) => server.close(r));
  }
});


