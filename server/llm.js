// Model access for every provider plus the agent tool loop.
// Anthropic uses its native Messages API; all other providers use the OpenAI-compatible API.
import { getSettings } from "./settings.js";
import { agents } from "./db.js";

const DEFAULT_URLS = {
  ollama: "http://localhost:11434/v1", openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com",
  huggingface: "https://router.huggingface.co/v1", openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1", gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  omniroute: "http://localhost:20128/v1", opencode_go: "https://opencode.ai/zen/v1", openwebui: "http://localhost:3000/api",
};

export function providerConfig(id) {
  const s = getSettings();
  const p = s.providers?.[id] || s.integrations?.[id] || {};
  return { id, baseUrl: (p.baseUrl || p.command || DEFAULT_URLS[id] || "").replace(/\/$/, ""), apiKey: p.apiKey || "", model: p.model || "" };
}

function toolSchemas(names, defs) {
  return names.filter((n) => defs[n]).map((n) => ({
    name: n,
    description: defs[n].description,
    parameters: { type: "object", properties: Object.fromEntries(Object.keys(defs[n].params).map((k) => [k, { type: "string" }])), required: Object.keys(defs[n].params) },
  }));
}

async function callOpenAI(cfg, model, system, messages, tools) {
  // stream: false explícito — gateways compatíveis com OpenAI (ex.: Omniroute) podem responder
  // em text/event-stream por padrão, e aí o r.json() abaixo quebra com
  // "Unexpected token 'd', \"data: {...\" is not valid JSON".
  const body = { model, stream: false, messages: [{ role: "system", content: system }, ...messages] };
  if (tools.length) body.tools = tools.map((t) => ({ type: "function", function: t }));
  const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
    signal: AbortSignal.timeout(300000),
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify(body),
  }).catch((e) => { throw new Error(`Não consegui conectar ao provedor "${cfg.id}" em ${cfg.baseUrl} (${e.cause?.code || e.message}). Verifique se ele está rodando ou ajuste em Configurações.`); });
  if (!r.ok) throw new Error(`${cfg.id} ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const msg = j.choices?.[0]?.message || {};
  return {
    text: msg.content || "",
    reasoning: msg.reasoning_content || msg.reasoning || "",
    calls: (msg.tool_calls || []).map((c) => ({ id: c.id, name: c.function.name, input: safeJson(c.function.arguments) })),
    raw: msg,
  };
}

async function callAnthropic(cfg, model, system, messages, tools) {
  const body = { model, max_tokens: 4096, system, messages, thinking: undefined };
  if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const r = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return {
    text: j.content.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
    reasoning: j.content.filter((b) => b.type === "thinking").map((b) => b.thinking).join("\n"),
    calls: j.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input })),
    raw: j,
  };
}

const safeJson = (s) => { try { return typeof s === "string" ? JSON.parse(s || "{}") : s || {}; } catch { return {}; } };

/**
 * Run an agent: model ↔ tools loop.
 * @returns {{reply, reasoning, tools, pending}}
 */
export async function runAgent({ agentId, messages, autonomy = "confirm", maxSteps = 12, extraSystem = "" }) {
  const { TOOL_DEFS, callTool, recall } = await import("./tools.js");
  const s = getSettings();
  const agent = (agentId && agents.get(agentId)) || agents.list().find((a) => a.active) || agents.list()[0];
  const cfg = providerConfig(agent.provider);
  const model = agent.model || cfg.model;
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const mem = await recall(lastUser, 5).catch(() => []);
  const system = [
    agent.instructions,
    `Seu nome é ${s.general?.agentName || agent.name}. Idioma padrão: ${s.general?.language || "pt"}. Data/hora local: ${new Date().toLocaleString()}. Sistema: ${process.platform}.`,
    mem.length ? `Memórias relevantes:\n${mem.map((m) => `- ${m.content}`).join("\n")}` : "",
    extraSystem,
  ].filter(Boolean).join("\n\n");
  const tools = toolSchemas(agent.tools || [], TOOL_DEFS);
  const isAnthropic = agent.provider === "anthropic";
  const convo = messages.map((m) => ({ role: m.role, content: m.content }));
  const used = [], pending = [], reasoning = [];
  const ctx = { autonomy, pending };

  for (let step = 0; step < maxSteps; step++) {
    const out = isAnthropic ? await callAnthropic(cfg, model, system, convo, tools) : await callOpenAI(cfg, model, system, convo, tools);
    if (out.reasoning) reasoning.push(out.reasoning);
    if (!out.calls.length) return { reply: out.text, reasoning: reasoning.join("\n\n"), tools: used, pending };
    if (isAnthropic) convo.push({ role: "assistant", content: out.raw.content });
    else convo.push(out.raw);
    const results = [];
    for (const c of out.calls) {
      let output;
      try { output = await callTool(c.name, c.input, ctx); } catch (e) { output = `Erro: ${e.message}`; }
      used.push({ name: c.name, input: c.input, output });
      results.push({ c, output });
    }
    if (isAnthropic) convo.push({ role: "user", content: results.map(({ c, output }) => ({ type: "tool_result", tool_use_id: c.id, content: output })) });
    else results.forEach(({ c, output }) => convo.push({ role: "tool", tool_call_id: c.id, content: output }));
  }
  return { reply: "Limite de passos atingido.", reasoning: reasoning.join("\n\n"), tools: used, pending };
}

// ---------- embeddings for semantic memory (Ollama → OpenAI → none) ----------
export async function embed(text) {
  const s = getSettings();
  if (s.providers?.ollama?.enabled) {
    const base = providerConfig("ollama").baseUrl.replace(/\/v1$/, "");
    const r = await fetch(`${base}/api/embed`, { method: "POST", body: JSON.stringify({ model: s.providers.ollama.embedModel || "nomic-embed-text", input: text }), signal: AbortSignal.timeout(8000) });
    if (r.ok) return (await r.json()).embeddings?.[0];
  }
  if (s.providers?.openai?.enabled && s.providers.openai.apiKey) {
    const r = await fetch("https://api.openai.com/v1/embeddings", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${s.providers.openai.apiKey}` }, body: JSON.stringify({ model: "text-embedding-3-small", input: text }) });
    if (r.ok) return (await r.json()).data[0].embedding;
  }
  return null;
}
export function cosine(a, b) {
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; x += a[i] ** 2; y += b[i] ** 2; }
  return d / (Math.sqrt(x) * Math.sqrt(y) || 1);
}

export async function testProvider(id) {
  const cfg = providerConfig(id);
  try {
    if (id === "anthropic") {
      const r = await fetch(`${cfg.baseUrl}/v1/models`, { headers: { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" } });
      return { ok: r.ok, detail: r.ok ? "Anthropic OK" : `${r.status} ${await r.text()}` };
    }
    if (id === "elevenlabs") {
      const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": cfg.apiKey } });
      return { ok: r.ok, detail: r.ok ? "ElevenLabs OK" : `${r.status}` };
    }
    const r = await fetch(`${cfg.baseUrl}/models`, { headers: cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {} });
    const j = r.ok ? await r.json() : null;
    return { ok: r.ok, detail: r.ok ? `${id}: ${j?.data?.length ?? "?"} modelos` : `${r.status} ${await r.text()}` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}
