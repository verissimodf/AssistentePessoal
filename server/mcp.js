// Minimal MCP server (stdio, JSON-RPC 2.0) so Claude Desktop, Claude Code, Codex or OpenCode
// can use Jarvis memory and ask Jarvis questions. Add to claude_desktop_config.json:
//   { "mcpServers": { "jarvis": { "command": "node", "args": ["<caminho>/server/mcp.js"] } } }
import { createInterface } from "node:readline";

const BASE = process.env.JARVIS_URL || "http://127.0.0.1:7777";
const TOOLS = [
  { name: "jarvis_ask", description: "Ask the local Jarvis assistant (uses its tools and memory).", inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] } },
  { name: "jarvis_remember", description: "Save a fact to Jarvis long-term memory.", inputSchema: { type: "object", properties: { content: { type: "string" }, tags: { type: "string" } }, required: ["content"] } },
  { name: "jarvis_recall", description: "Search Jarvis long-term memory.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
];

const call = async (path, init) => (await fetch(`${BASE}${path}`, { headers: { "content-type": "application/json" }, ...init })).json();

async function handle(msg) {
  switch (msg.method) {
    case "initialize":
      return { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "jarvis", version: "1.0.0" } };
    case "tools/list":
      return { tools: TOOLS };
    case "tools/call": {
      const { name, arguments: a } = msg.params;
      let text;
      if (name === "jarvis_ask") text = (await call("/api/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: a.prompt }] }) })).reply;
      else if (name === "jarvis_remember") { await call("/api/memories", { method: "POST", body: JSON.stringify(a) }); text = "ok"; }
      else if (name === "jarvis_recall") text = (await call(`/api/memories?q=${encodeURIComponent(a.query)}`)).map((m) => `- ${m.content}`).join("\n") || "nada";
      return { content: [{ type: "text", text }] };
    }
    default:
      return null;
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return; // notification
  try {
    const result = await handle(msg);
    process.stdout.write(JSON.stringify(result === null ? { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } } : { jsonrpc: "2.0", id: msg.id, result }) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: e.message } }) + "\n");
  }
});
