// Minimal MCP server (stdio, JSON-RPC 2.0) so Claude Desktop, Claude Code, Codex, Goose,
// OpenCode or Antigravity can use Jarvis memory, RAG documents, skills and ask questions.
// Add to claude_desktop_config.json:
//   { "mcpServers": { "jarvis": { "command": "node", "args": ["<caminho>/server/mcp.js"],
//       "env": { "JARVIS_URL": "http://127.0.0.1:7777", "JARVIS_SERVICE_TOKEN": "jst_..." } } } }
// The token is created in the panel (Configurações → Segurança) with only the scopes needed,
// and can be revoked there at any time. Authorization is enforced by the local service on
// every call (route scope + tool scope at execution time), not by this stdio process.
import { createInterface } from "node:readline";

export const BASE = process.env.JARVIS_URL || "http://127.0.0.1:7777";
export const TOKEN = process.env.JARVIS_SERVICE_TOKEN || "";

export const TOOLS = [
  {
    name: "jarvis_ask",
    description: "Ask the local Jarvis assistant (uses its tools and memory).",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string", description: "Prompt to ask Jarvis" } },
      required: ["prompt"],
    },
  },
  {
    name: "jarvis_remember",
    description: "Save a fact to Jarvis long-term memory.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Fact or note content to remember" },
        tags: { type: "string", description: "Comma-separated tags" },
      },
      required: ["content"],
    },
  },
  {
    name: "jarvis_recall",
    description: "Search Jarvis long-term memory.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Query to search memories" } },
      required: ["query"],
    },
  },
  {
    name: "document_search",
    description: "Search the user's indexed documents using hybrid semantic and lexical retrieval.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Search query or concept" } },
      required: ["query"],
    },
  },
  {
    name: "reindex_document",
    description:
      "Reindex a document to generate vector embeddings for semantic RAG (promotes lexical_only to hybrid).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Document ID to reindex" } },
      required: ["id"],
    },
  },
  {
    name: "load_skill",
    description:
      "Load instructions and guidelines of a specialized skill from the Global Hub (.agent-skills) on demand.",
    inputSchema: {
      type: "object",
      properties: {
        skill: {
          type: "string",
          description: "Skill identifier (e.g. threejs-expert, gsap-motion, karpathy-engineering)",
        },
      },
      required: ["skill"],
    },
  },
  {
    name: "list_skills",
    description: "List or search specialized skills in the Global Skills Hub by query or category.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional query or keyword to filter skills" },
        category: { type: "string", description: "Optional category filter" },
        limit: { type: "number", description: "Max number of skills to return" },
      },
    },
  },
];

export const RESOURCES = [
  {
    uri: "jarvis://router/status",
    name: "Multi-Provider Router Status",
    description: "Current status of primary and fallback LLM providers and active agent",
    mimeType: "application/json",
  },
  {
    uri: "jarvis://documents/indexed",
    name: "Indexed Documents",
    description: "List of indexed documents and their RAG status for the authenticated admin",
    mimeType: "application/json",
  },
];

export const PROMPTS = [
  {
    name: "jarvis_context",
    description: "Prompt with J.A.R.V.I.S. system context, memories, and skills guidance",
    arguments: [
      {
        name: "task",
        description: "The task you want to execute with J.A.R.V.I.S.",
        required: true,
      },
    ],
  },
];

export const call = async (path, init = {}, { base = BASE, token = TOKEN } = {}) => {
  const r = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      r.status === 401
        ? "token inválido ou revogado"
        : r.status === 403
          ? `sem permissão (${body.need || "escopo"})`
          : `erro ${r.status}${body.error ? `: ${body.error}` : ""}`,
    );
  }
  return body;
};

export async function handle(msg, { base = BASE, token = TOKEN } = {}) {
  switch (msg.method) {
    case "initialize":
      return {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        serverInfo: { name: "jarvis", version: "1.4.0" },
      };

    case "tools/list":
      return { tools: TOOLS };

    case "tools/call": {
      const { name, arguments: a = {} } = msg.params || {};
      let text = "";

      if (name === "jarvis_ask") {
        const res = await call(
          "/api/chat",
          {
            method: "POST",
            body: JSON.stringify({ messages: [{ role: "user", content: a.prompt }] }),
          },
          { base, token },
        );
        text = res.reply || "";
      } else if (name === "jarvis_remember") {
        await call("/api/memories", { method: "POST", body: JSON.stringify(a) }, { base, token });
        text = "ok";
      } else if (name === "jarvis_recall") {
        const list = await call(
          `/api/memories?q=${encodeURIComponent(a.query || "")}`,
          {},
          { base, token },
        );
        text =
          Array.isArray(list) && list.length
            ? list.map((m) => `- ${m.content}`).join("\n")
            : "nada";
      } else if (name === "document_search") {
        const results = await call(
          `/api/documents/search?q=${encodeURIComponent(a.query || "")}`,
          {},
          { base, token },
        );
        if (!Array.isArray(results) || results.length === 0) {
          text = "Nenhum documento encontrado para a consulta.";
        } else {
          text = results
            .map(
              (d) =>
                `- [${d.name || d.filename}] (modo: ${d.search_mode || "lexical"}, score: ${d.score})\n  ${
                  d.snippet || (d.content ? d.content.slice(0, 300) : "")
                }`,
            )
            .join("\n\n");
        }
      } else if (name === "reindex_document") {
        const res = await call(
          `/api/documents/${encodeURIComponent(a.id)}/reindex`,
          { method: "POST" },
          { base, token },
        );
        if (res && res.ok) {
          text = `Documento ${res.id} reindexado com sucesso para RAG Semântico (${res.vectorizedChunks || 0} blocos vetorizados). Status: ${res.rag_status}.`;
        } else {
          text = `Falha ao reindexar: ${res?.reason || "erro_desconhecido"}`;
        }
      } else if (name === "load_skill") {
        const skill = await call(`/api/skills/${encodeURIComponent(a.skill)}`, {}, { base, token });
        text = skill.content || "";
        if (Array.isArray(skill.references) && skill.references.length) {
          text += `\n\n[REFERÊNCIAS DISPONÍVEIS — carregue com load_skill usando o caminho completo]\n${skill.references
            .map((r) => `- ${r}`)
            .join("\n")}`;
        }
      } else if (name === "list_skills") {
        const params = new URLSearchParams();
        if (a.query) params.set("q", a.query);
        if (a.category) params.set("category", a.category);
        if (a.limit) params.set("limit", String(a.limit));
        const res = await call(`/api/skills?${params.toString()}`, {}, { base, token });
        const skills = Array.isArray(res?.skills) ? res.skills : [];
        if (!skills.length) {
          text = "Nenhuma skill encontrada.";
        } else {
          text = skills
            .map(
              (s) =>
                `- ${s.id}: ${s.name} [categoria: ${s.category || "geral"}]\n  ${s.description || ""}`,
            )
            .join("\n\n");
        }
      } else {
        throw new Error(`Ferramenta desconhecida: ${name}`);
      }

      return { content: [{ type: "text", text }] };
    }

    case "resources/list":
      return { resources: RESOURCES };

    case "resources/read": {
      const { uri } = msg.params || {};
      if (uri === "jarvis://router/status") {
        const res = await call("/api/skills", {}, { base, token });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(res?.routerStatus || {}, null, 2),
            },
          ],
        };
      } else if (uri === "jarvis://documents/indexed") {
        const docs = await call("/api/documents", {}, { base, token });
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(docs || [], null, 2),
            },
          ],
        };
      }
      throw new Error(`Recurso não encontrado: ${uri}`);
    }

    case "prompts/list":
      return { prompts: PROMPTS };

    case "prompts/get": {
      const { name, arguments: a = {} } = msg.params || {};
      if (name === "jarvis_context") {
        return {
          description: "J.A.R.V.I.S. Context Prompt",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Você está conectado ao J.A.R.V.I.S. via Model Context Protocol (MCP).\nTarefa: ${a.task || ""}\nUse as ferramentas document_search, load_skill, jarvis_remember e jarvis_recall quando necessário.`,
              },
            },
          ],
        };
      }
      throw new Error(`Prompt não encontrado: ${name}`);
    }

    default:
      return null;
  }
}

// Inicia stdio listener apenas quando executado como script principal
const isDirectCli =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("mcp.js") || process.argv[1].endsWith("mcp.mjs"));

if (isDirectCli) {
  if (!TOKEN.startsWith("jst_")) {
    process.stderr.write(
      "[jarvis-mcp] JARVIS_SERVICE_TOKEN ausente ou inválido. Crie um service token em " +
        "Configurações → Segurança (escopos mínimos) e defina-o no ambiente deste servidor MCP.\n",
    );
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id === undefined) return; // notification
    try {
      const result = await handle(msg);
      process.stdout.write(
        JSON.stringify(
          result === null
            ? { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } }
            : { jsonrpc: "2.0", id: msg.id, result },
        ) + "\n",
      );
    } catch (e) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: e.message },
        }) + "\n",
      );
    }
  });
}
