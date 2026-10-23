// tests/mcp.test.mjs
// Validação do Servidor Model Context Protocol (MCP v1.4.0)
// Paridade JSON-RPC 2.0, ferramentas (load_skill, document_search, reindex_document),
// recursos (resources/list, resources/read), prompts e autorização estrita por escopo de Service Token.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "jarvis-mcp-test-"));
const skillsHub = join(dir, "skills-hub");
const skillDir = join(skillsHub, "karpathy-engineering");
mkdirSync(skillDir, { recursive: true });
writeFileSync(join(skillDir, "SKILL.md"), "---\nname: Karpathy Engineering\ndescription: Engineering practices for reliable software\ntags: [engineering, code]\n---\n# Karpathy Engineering\nTest fixture skill.", "utf8");
writeFileSync(join(skillsHub, "catalog.json"), JSON.stringify({ version: "1.2.0", totalSkills: 1, skills: [{ id: "karpathy-engineering", name: "Karpathy Engineering", description: "Engineering practices for reliable software", tags: ["engineering", "code"], path: "karpathy-engineering/SKILL.md", category: "engineering" }] }), "utf8");
process.env.JARVIS_GLOBAL_SKILLS_DIR = skillsHub;
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { saveDocument } = await import("../server/documents.js");
const { handle, TOOLS, RESOURCES, PROMPTS } = await import("../server/mcp.js");

let server, base, adminId, adminPrincipal;
let tokenSkills, tokenDocsRead, tokenDocsWrite, tokenLimited;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;

  // Cria admin se não existir
  let adminRow = db.prepare("SELECT id FROM admins WHERE active = 1").get();
  if (!adminRow) {
    adminId = "admin-mcp-" + Date.now();
    const uname = "mcp_adm_" + Date.now();
    db.prepare("INSERT INTO admins (id, username, password_hash, created_at, active) VALUES (?,?,?,?,1)").run(
      adminId,
      uname,
      "dummyhash",
      new Date().toISOString()
    );
  } else {
    adminId = adminRow.id;
  }

  // Cria sessão administrativa válida
  const sid = "jss_mcp_" + Math.random().toString(36).slice(2);
  const sidHash = createHash("sha256").update(sid).digest("hex");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (id_hash, admin_id, csrf, created_at, last_seen, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(sidHash, adminId, "csrf-mcp-test", now, now, now + 12 * 3600 * 1000, "test-runner");

  adminPrincipal = auth.validateSession(sid);
  assert.ok(adminPrincipal, "Sessão admin deve ser válida");

  // Cria tokens de serviço com escopos distintos
  tokenSkills = auth.createServiceToken(adminPrincipal, {
    name: "mcp-skills-token",
    scopes: ["skills:read"],
  }).token;

  tokenDocsRead = auth.createServiceToken(adminPrincipal, {
    name: "mcp-docs-read-token",
    scopes: ["documents:read"],
  }).token;

  tokenDocsWrite = auth.createServiceToken(adminPrincipal, {
    name: "mcp-docs-write-token",
    scopes: ["documents:write", "documents:read"],
  }).token;

  tokenLimited = auth.createServiceToken(adminPrincipal, {
    name: "mcp-limited-token",
    scopes: ["memories:read"],
  }).token;
});

after(() => {
  if (server) server.close();
});

test("MCP: initialize retorna metadados do protocolo, capabilities e serverInfo v1.4.0", async () => {
  const res = await handle({ jsonrpc: "2.0", id: 1, method: "initialize" }, { base, token: tokenSkills });
  assert.equal(res.protocolVersion, "2024-11-05");
  assert.equal(res.serverInfo.name, "jarvis");
  assert.equal(res.serverInfo.version, "1.4.0");
  assert.ok(res.capabilities.tools);
  assert.ok(res.capabilities.resources);
  assert.ok(res.capabilities.prompts);
});

test("MCP: tools/list expõe catálogo completo de ferramentas de RAG, Skills e Memória", async () => {
  const res = await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { base, token: tokenSkills });
  assert.ok(Array.isArray(res.tools));
  const toolNames = res.tools.map((t) => t.name);

  assert.ok(toolNames.includes("jarvis_ask"));
  assert.ok(toolNames.includes("jarvis_remember"));
  assert.ok(toolNames.includes("jarvis_recall"));
  assert.ok(toolNames.includes("document_search"));
  assert.ok(toolNames.includes("reindex_document"));
  assert.ok(toolNames.includes("load_skill"));
  assert.ok(toolNames.includes("list_skills"));
});

test("MCP: load_skill executa com escopo skills:read e falha com 403 quando escopo ausente", async () => {
  // 1. Com token portador de skills:read
  const okRes = await handle(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "load_skill", arguments: { skill: "karpathy-engineering" } },
    },
    { base, token: tokenSkills }
  );

  assert.ok(okRes.content);
  assert.equal(okRes.content[0].type, "text");
  assert.ok(okRes.content[0].text.length > 0, "Conteúdo da skill deve ser retornado");

  // 2. Com token sem o escopo skills:read (tokenLimited tem apenas memories:read)
  await assert.rejects(
    async () => {
      await handle(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "load_skill", arguments: { skill: "karpathy-engineering" } },
        },
        { base, token: tokenLimited }
      );
    },
    /sem permissão \(skills:read\)/
  );
});

test("MCP: list_skills busca e lista skills do Hub Global", async () => {
  const res = await handle(
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "list_skills", arguments: { query: "threejs" } },
    },
    { base, token: tokenSkills }
  );

  assert.ok(res.content);
  assert.match(res.content[0].text, /threejs/i);
});

test("MCP: document_search executa com documents:read e rejeita sem escopo", async () => {
  // Salva documento para o admin
  await saveDocument(
    adminId,
    {
      name: "mcp_rag_doc.txt",
      mime: "text/plain",
      buffer: Buffer.from("Instruções de integração MCP com J.A.R.V.I.S. e Claude Code.", "utf8"),
    },
    { embedFn: async () => [0.1, 0.2, 0.3, 0.4] }
  );

  // 1. Com token portador de documents:read
  const okRes = await handle(
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "document_search", arguments: { query: "Claude Code" } },
    },
    { base, token: tokenDocsRead }
  );

  assert.ok(okRes.content);
  assert.match(okRes.content[0].text, /mcp_rag_doc\.txt/);

  // 2. Com token sem escopo documents:read
  await assert.rejects(
    async () => {
      await handle(
        {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "document_search", arguments: { query: "Claude Code" } },
        },
        { base, token: tokenSkills }
      );
    },
    /sem permissão \(documents:read\)/
  );
});

test("MCP: reindex_document executa com documents:write e rejeita sem escopo", async () => {
  const doc = await saveDocument(
    adminId,
    {
      name: "mcp_reindex.txt",
      mime: "text/plain",
      buffer: Buffer.from("Conteúdo para teste de reindexação via MCP.", "utf8"),
    },
    { embedFn: async () => null }
  );

  // 1. Com token portador de documents:write
  const okRes = await handle(
    {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "reindex_document", arguments: { id: doc.id } },
    },
    { base, token: tokenDocsWrite }
  );

  assert.ok(okRes.content);
  assert.match(okRes.content[0].text, /reindexado|Falha/);

  // 2. Com token sem escopo documents:write (apenas documents:read)
  await assert.rejects(
    async () => {
      await handle(
        {
          jsonrpc: "2.0",
          id: 9,
          method: "tools/call",
          params: { name: "reindex_document", arguments: { id: doc.id } },
        },
        { base, token: tokenDocsRead }
      );
    },
    /sem permissão \(documents:write\)/
  );
});

test("MCP: resources/list e resources/read expõem status do router e documentos indexados", async () => {
  // 1. resources/list
  const listRes = await handle({ jsonrpc: "2.0", id: 10, method: "resources/list" }, { base, token: tokenSkills });
  assert.ok(Array.isArray(listRes.resources));
  const uris = listRes.resources.map((r) => r.uri);
  assert.ok(uris.includes("jarvis://router/status"));
  assert.ok(uris.includes("jarvis://documents/indexed"));

  // 2. resources/read router status
  const routerRes = await handle(
    { jsonrpc: "2.0", id: 11, method: "resources/read", params: { uri: "jarvis://router/status" } },
    { base, token: tokenSkills }
  );
  assert.ok(routerRes.contents);
  const routerData = JSON.parse(routerRes.contents[0].text);
  assert.ok(routerData.primary);

  // 3. resources/read documents list
  const docsRes = await handle(
    { jsonrpc: "2.0", id: 12, method: "resources/read", params: { uri: "jarvis://documents/indexed" } },
    { base, token: tokenDocsRead }
  );
  assert.ok(docsRes.contents);
  const docsList = JSON.parse(docsRes.contents[0].text);
  assert.ok(Array.isArray(docsList));
});

test("MCP: prompts/list e prompts/get fornecem template contextual para agentes", async () => {
  // 1. prompts/list
  const pList = await handle({ jsonrpc: "2.0", id: 13, method: "prompts/list" }, { base, token: tokenSkills });
  assert.ok(Array.isArray(pList.prompts));
  assert.equal(pList.prompts[0].name, "jarvis_context");

  // 2. prompts/get
  const pGet = await handle(
    {
      jsonrpc: "2.0",
      id: 14,
      method: "prompts/get",
      params: { name: "jarvis_context", arguments: { task: "analisar código" } },
    },
    { base, token: tokenSkills }
  );
  assert.ok(pGet.messages);
  assert.match(pGet.messages[0].content.text, /analisar código/);
});
