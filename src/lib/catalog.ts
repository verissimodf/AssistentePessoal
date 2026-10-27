export const PROVIDERS = [
  { id: "ollama", name: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:7b", needsKey: false },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-5", needsKey: true },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o", needsKey: true },
  { id: "huggingface", name: "HuggingFace", baseUrl: "https://router.huggingface.co/v1", model: "meta-llama/Llama-3.1-8B-Instruct", needsKey: true },
  { id: "omniroute", name: "Omniroute", baseUrl: "http://localhost:20128/v1", model: "auto", needsKey: true },
  { id: "opencode_go", name: "OpenCode Go", baseUrl: "https://opencode.ai/zen/v1", model: "", needsKey: true },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto", needsKey: true },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", needsKey: true },
  { id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash", needsKey: true },
  { id: "openwebui", name: "OpenWebUI", baseUrl: "http://localhost:3000/api", model: "", needsKey: true },
  { id: "headroom", name: "Headroom (proxy local)", baseUrl: "http://127.0.0.1:8787/v1", model: "qwen2.5:7b", needsKey: true },
  { id: "elevenlabs", name: "ElevenLabs (voz)", baseUrl: "https://api.elevenlabs.io", model: "eleven_multilingual_v2", needsKey: true },
  { id: "custom", name: "Compatível com OpenAI", baseUrl: "", model: "", needsKey: false },
] as const;

export const CHAT_PROVIDERS = PROVIDERS.filter((p) => p.id !== "elevenlabs");

export const AGENT_INTEGRATIONS = [
  { id: "claude_code", name: "Claude Code", kind: "cli", command: "claude -p {prompt} --output-format text" },
  { id: "codex", name: "Codex", kind: "cli", command: "codex exec {prompt}" },
  { id: "opencode", name: "OpenCode", kind: "cli", command: "opencode run {prompt}" },
  { id: "hermes", name: "Hermes Agent", kind: "cli", command: "hermes chat -q {prompt}" },
  { id: "openclaw", name: "OpenClaw", kind: "http", command: "http://localhost:18789/v1" },
  { id: "odysseus", name: "Odysseus", kind: "http", command: "http://localhost:8000/v1" },
  { id: "openwebui", name: "OpenWebUI", kind: "http", command: "http://localhost:3000/api" },
  { id: "context7", name: "Context7 (MCP)", kind: "mcp", command: "http://127.0.0.1:8000/mcp" },
  { id: "openhands", name: "OpenHands", kind: "http", command: "http://127.0.0.1:8085" },
  { id: "headroom", name: "Headroom (proxy)", kind: "http", command: "http://127.0.0.1:8787/v1" },
  { id: "crawl4ai", name: "crawl4ai", kind: "http", command: "http://192.168.2.29:11235" },
  // AgentMail (server/agentmail.js): e-mail API-first para agentes — webhook message.received
  // verificado (Svix) em /api/integrations/agentmail/webhook e ferramentas agentmail_read_email
  // (comms:read) / agentmail_send_email (comms:send, D9 — envio só após aprovação humana).
  // A API key (am_...) é campo de segredo do painel (criptografada) ou env AGENTMAIL_API_KEY.
  { id: "agentmail", name: "AgentMail (e-mail p/ agentes)", kind: "http", command: "https://api.agentmail.to/v0" },
  { id: "claude_desktop", name: "Claude Desktop (MCP)", kind: "mcp", command: "node server/mcp.js" },
  // REA: análise estática de artefatos (mandar {path} não é editável do lado do agente —
  // o executor usa argv fixo; o campo comando é apenas documental e divergência é recusada).
  { id: "rea", name: "REA (engenharia reversa)", kind: "cli", command: "rea analyze-javascript-application {path} --json" },
  // Gigabrain: memória local persistente compartilhada — store no volume data/gigabrain/,
  // ferramentas gigabrain_recall/gigabrain_remember no JARVIS (escopos memories:*).
  { id: "gigabrain", name: "Gigabrain (memória compartilhada)", kind: "cli", command: "gigabrain-mcp --config {config}" },
  // Navegador (browser_action): dois modos pela configuração —
  //  · habilitado SEM endereço  → navegador LOCAL dentro do container (Playwright);
  //  · habilitado COM endereço  → worker EXTERNO por contrato HTTP autenticado (apiKey = token).
  // Toda navegação exige aprovação humana; destino é validado por política de rede.
  { id: "browser", name: "Navegador (Playwright)", kind: "http", command: "" },
] as const;

export const COMMS = [
  { id: "telegram", name: "Telegram", fields: ["botToken", "chatId"] },
  { id: "whatsapp", name: "WhatsApp Cloud API", fields: ["token", "phoneNumberId", "to"] },
  { id: "signal", name: "Signal (signal-cli)", fields: ["number", "to"] },
  { id: "gmail", name: "Gmail (IMAP/SMTP)", fields: ["user", "appPassword"] },
  { id: "outlook", name: "Outlook (IMAP/SMTP)", fields: ["user", "appPassword"] },
  { id: "calendar", name: "Agenda (ICS / CalDAV)", fields: ["icsUrl"] },
] as const;

export const TOOLS = ["web_search", "fetch_url", "remember", "recall", "run_command", "cli_agent", "send_message", "send_email", "read_calendar", "context7_docs", "crawl_page", "openhands_task", "rea_analyze", "gigabrain_recall", "gigabrain_remember", "agentmail_read_email", "agentmail_send_email"] as const;

export const TEMPLATES = [
  { name: "J.A.R.V.I.S. clássico", text: "Você é J.A.R.V.I.S., assistente pessoal leal, preciso e levemente espirituoso. Trate o usuário por 'senhor' ou 'senhora'. Seja breve ao falar." },
  { name: "Pesquisador", text: "Você pesquisa na internet antes de responder, cita as fontes com links e separa fatos de opiniões." },
  { name: "DevOps do host", text: "Você administra este computador. Antes de qualquer comando, explique o que fará. Prefira comandos não destrutivos." },
  { name: "Secretária executiva", text: "Você organiza agenda, e-mails e mensagens. Resuma, priorize e proponha respostas." },
  { name: "Programador", text: "Você delega tarefas de código ao Claude Code, Codex ou OpenCode e revisa o resultado antes de responder." },
];
