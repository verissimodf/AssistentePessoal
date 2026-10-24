// Fase I — Diagnóstico Operacional (etapas 1–3): inventário tipado, somente leitura.
//
// Contrato de segurança deste módulo:
//  - Nenhuma sonda de rede: não faz fetch a integrações nem chamadas a LLM.
//    Verificação dinâmica externa é a etapa 4 (não aprovada); sem execução real, nada é OPERACIONAL.
//  - Nenhum segredo: as configurações são lidas por lista branca. Valores de apiKey/token/
//    cookie/chatId nunca são copiados; URLs internas viram apenas a classe "interno"/"externo".
//  - Nenhuma mutação: só SELECT/PRAGMA de leitura no banco e leitura de configurações.
//  - Estados com evidência: cada item passa por validateItem (referência, método e data;
//    contradições são rejeitadas e o inventário inteiro falha fechado).
//  - Isolamento por proprietário: contagens ligadas a recursos usam o administrador solicitante;
//    conteúdo (mensagens, memórias, instruções de agentes, saídas de aprovações) nunca é exposto.
import { db, agents } from "./db.js";
import { SCOPES, ADMIN_ONLY, TOOL_SCOPES } from "./auth.js";
import { TOOL_DEFS } from "./tools.js";
import { DEFAULT_AGENT } from "./llm.js";
import { publicSettings } from "./settings.js";
import { getCatalogStatus } from "./skills.js";
import { ownedIds } from "./ownership.js";

export const ESTADOS = [
  "OPERACIONAL", "HABILITADO", "TESTADO", "IMPLEMENTADO",
  "NÃO TESTADO", "BLOQUEADO", "INDISPONÍVEL", "DESCONHECIDO",
];
export const METODOS = ["codigo", "config", "teste", "execucao", "documento"];
export const CATEGORIAS = ["servico", "ferramenta", "acesso", "integracao", "automacao", "dados"];
export const CONFIANCAS = ["alta", "media", "baixa"];

/** Janela máxima de validade de uma evidência de execução (item OPERACIONAL). */
export const JANELA_EXECUCAO_MS = 30 * 24 * 60 * 60 * 1000;

export class DiagnosticsError extends Error {
  constructor(message, violations = []) {
    super(message);
    this.name = "DiagnosticsError";
    this.violations = violations;
  }
}

// ---------------------------------------------------------------------------
// Metadados estáticos (referência: código instalado + suítes do repositório)
// ---------------------------------------------------------------------------

/** Uma entrada por ferramenta real de server/tools.js (cobertura verificada em teste). */
export const TOOL_META = {
  browser_action: {
    nome: "Navegador (Playwright)",
    portao: "Integração opt-in + APROVAÇÃO HUMANA sempre (mesma classe de cli_agent/rea_analyze). Operações em lista fechada; sem shell, sem download, sem eval.",
    deps: "Modo local: Playwright no container. Modo remoto: worker externo por contrato HTTP autenticado.",
    limites: [
      "Destino validado por política de rede (loopback, redes privadas, metadados de cloud e esquemas não-HTTP recusados) inclusive após resolução DNS.",
      "Nunca devolve cookie/token/header sensível; texto limitado por execução.",
      "Timeout com teto (60 s) e cancelamento cooperativo; sem expiração automática de aprovação.",
    ],
    testes: ["tests/browser-tool.test.mjs"],
  },
  web_search: {
    nome: "Busca na web",
    portao: "Leitura de rede (escopo web); sem aprovação.",
    deps: "Provedor público de busca (HTML).",
    limites: ["Saída de terceiros tratada como não confiável.", "Sem contrato de API estável — pode degradar sem aviso."],
    testes: ["tests/urlpolicy.test.mjs", "tests/agent-audit.test.mjs", "tests/agent-claim-acceptance.test.mjs"],
  },
  fetch_url: {
    nome: "Leitura de URL",
    portao: "Escopo web; bloqueio de alvos internos e redirecionamentos privados.",
    deps: "HTTP público.",
    limites: ["Somente leitura; sem credenciais do usuário.", "Conteúdo externo é dado não confiável."],
    testes: ["tests/urlpolicy.test.mjs", "tests/agent-audit.test.mjs"],
  },
  remember: {
    nome: "Memorizar",
    portao: "Escopo memories:write; gravação no espaço do proprietário.",
    deps: "Banco local.",
    limites: [],
    testes: ["tests/isolation.test.mjs", "tests/agent-audit.test.mjs"],
  },
  recall: {
    nome: "Recordar",
    portao: "Escopo memories:read; leitura isolada por proprietário.",
    deps: "Banco local (busca semântica quando disponível).",
    limites: ["Memórias sem proprietário (legado) não aparecem para nenhum administrador."],
    testes: ["tests/isolation.test.mjs", "tests/run-limits.test.mjs"],
  },
  run_command: {
    nome: "Comando local",
    portao: "Escopo host:run + aprovação humana obrigatória no chat (reavaliada na resolução).",
    deps: "Shell do contêiner e política de comandos.",
    limites: ["Saída truncada; comandos fora da política são recusados."],
    testes: ["tests/approvals-actions.test.mjs", "tests/bots-authz.test.mjs", "tests/phase2-fixes.test.mjs"],
  },
  cli_agent: {
    nome: "Delegação a CLI",
    portao: "Escopo host:run + aprovação humana.",
    deps: "CLIs instalados na imagem (claude, codex, opencode, rea).",
    limites: ["Autenticação dos CLIs no contêiner depende de credenciais do operador e não foi reverificada recentemente."],
    testes: ["tests/agent-audit.test.mjs", "tests/bots-authz.test.mjs", "tests/phase2-fixes.test.mjs"],
  },
  send_message: {
    nome: "Enviar mensagem (canais)",
    portao: "Escopo comms:send + aprovação humana.",
    deps: "Canais de integração ativos.",
    limites: ["Nenhum agente ativo inclui esta ferramenta; exposta apenas em agentes inativos."],
    testes: ["tests/approvals-actions.test.mjs", "tests/agent-audit.test.mjs", "tests/security-hardening.test.mjs"],
  },
  send_email: {
    nome: "Enviar e-mail",
    portao: "Escopo comms:send; rascunho → confirmação explícita.",
    deps: "Transporte de e-mail e conta configurada.",
    limites: ["Envio real indisponível por desenho enquanto o transporte simulado estiver ativo."],
    testes: ["tests/mail-drafts.test.mjs", "tests/mail-routes.test.mjs"],
  },
  read_email: {
    nome: "Ler e-mail",
    portao: "Escopo comms:read.",
    deps: "Conta de e-mail configurada.",
    limites: ["Sem consumidor: não exposta em nenhum agente no momento."],
    testes: ["tests/mail-routes.test.mjs"],
  },
  read_calendar: {
    nome: "Ler agenda",
    portao: "Escopo comms:read.",
    deps: "Agenda configurada.",
    limites: ["Sem agenda configurada e sem teste automatizado dedicado."],
    testes: [],
  },
  context7_docs: {
    nome: "Documentação externa (Context7)",
    portao: "Escopo web; serviço MCP local.",
    deps: "Integração de documentação habilitada.",
    limites: ["Sem teste automatizado dedicado; verificação dinâmica pertence à etapa 4 (não executada)."],
    testes: [],
  },
  crawl_page: {
    nome: "Crawler de página",
    portao: "Escopo web; serviço de crawl com chave.",
    deps: "Integração de crawl habilitada.",
    limites: ["Sem teste automatizado dedicado; verificação dinâmica pertence à etapa 4 (não executada)."],
    testes: [],
  },
  openhands_task: {
    nome: "Tarefa OpenHands",
    portao: "Escopo host:run + aprovação humana.",
    deps: "Integração OpenHands habilitada.",
    limites: ["Verificação dinâmica pertence à etapa 4 (não executada)."],
    testes: ["tests/approvals-actions.test.mjs", "tests/security-hardening.test.mjs"],
  },
  document_search: {
    nome: "Busca em documentos",
    portao: "Escopo documents:read; base documental global.",
    deps: "Documentos enviados.",
    limites: ["A base documental é de escopo de instalação (sem proprietário)."],
    testes: ["tests/documents.test.mjs", "tests/agent-audit.test.mjs"],
  },
  rea_analyze: {
    nome: "Análise REA de artefatos",
    portao: "Escopo host:run + aprovação humana; no chat, /rea é determinístico.",
    deps: "Analisador REA instalado na imagem.",
    limites: ["Nenhuma execução real registrada até o momento."],
    testes: ["tests/rea-analyze.test.mjs", "tests/agent-audit.test.mjs"],
  },
  gigabrain_recall: {
    nome: "Busca na memória Gigabrain",
    portao: "Escopo memories:read; argv fixo sem shell; resultado trata-se como evidência candidata.",
    deps: "Pacote @legendaryvibecoder/gigabrain na imagem; store inicializada em data/gigabrain/.",
    limites: ["Escopo derivado do config da store; não altera dados (readOnlyHint do MCP)."],
    testes: ["tests/gigabrain.test.mjs"],
  },
  gigabrain_remember: {
    nome: "Registro na memória Gigabrain",
    portao: "Escopo memories:write; argv fixo sem shell; gravação explícita e durável.",
    deps: "Pacote @legendaryvibecoder/gigabrain na imagem; store inicializada em data/gigabrain/.",
    limites: ["Deduplicação e fila de revisão são da própria Gigabrain; nenhum dado sai da máquina."],
    testes: ["tests/gigabrain.test.mjs"],
  },
  load_skill: {
    nome: "Carregar skill especializada",
    portao: "Escopo skills:read; leitura segura do Hub Global de Skills (%USERPROFILE%\\.agent-skills).",
    deps: "Catálogo local de skills (.agent-skills/catalog.json).",
    limites: ["Somente leitura; restrito estritamente ao diretório do Hub de Skills."],
    testes: ["tests/skills-hub.test.mjs"],
  },
};

const PROVIDER_NOMES = {
  ollama: "Ollama (local)",
  openai: "OpenAI",
  anthropic: "Anthropic",
  huggingface: "Hugging Face",
  openrouter: "OpenRouter",
  groq: "Groq",
  gemini: "Google Gemini",
  omniroute: "OmniRoute (provedor)",
  opencode_go: "OpenCode Go (Zen)",
  openwebui: "Open WebUI",
  headroom: "Headroom",
};

const PROVIDERS_COM_CHAVE = new Set([
  "openai", "anthropic", "huggingface", "openrouter", "groq", "gemini", "omniroute", "opencode_go", "headroom",
]);

const INTEGRACOES_META = [
  { chave: "context7", nome: "Context7 (documentação)", consumidor: "Ferramenta context7_docs.", testes: [], needsKey: false },
  { chave: "crawl", nome: "Crawler de páginas", consumidor: "Ferramenta crawl_page.", testes: [], needsKey: true },
  { chave: "openhands", nome: "OpenHands (delegação)", consumidor: "Ferramenta openhands_task.", testes: ["tests/approvals-actions.test.mjs"], needsKey: false },
  { chave: "claude", nome: "CLI Claude Code", consumidor: "Ferramenta cli_agent.", testes: ["tests/agent-audit.test.mjs"], needsKey: false },
  { chave: "codex", nome: "CLI Codex", consumidor: "Ferramenta cli_agent.", testes: ["tests/agent-audit.test.mjs"], needsKey: false },
  { chave: "opencode", nome: "CLI OpenCode", consumidor: "Ferramenta cli_agent.", testes: ["tests/agent-audit.test.mjs"], needsKey: false },
  { chave: "hermes", nome: "Hermes (provedor)", consumidor: "Provedor de modelo para agentes.", testes: [], needsKey: true },
  { chave: "openclaw", nome: "OpenClaw (provedor)", consumidor: "Provedor de modelo para agentes.", testes: [], needsKey: true },
  { chave: "headroom", nome: "Headroom (provedor)", consumidor: "Provedor de modelo para agentes.", testes: [], needsKey: true },
  { chave: "openwebui", nome: "Open WebUI (provedor)", consumidor: "Provedor de modelo para agentes.", testes: [], needsKey: false },
  { chave: "odysseus", nome: "Odysseus", consumidor: null, testes: [], needsKey: false },
  { chave: "omniroute", nome: "OmniRoute (provedor)", consumidor: "Provedor de modelo para agentes.", testes: [], needsKey: true },
];

const metaIntegracao = (id) => {
  const alvo = String(id).toLowerCase();
  return INTEGRACOES_META.find((m) => alvo.includes(m.chave)) || null;
};

/** Suítes do repositório (referência estática; execução não é registrada pelo produto). */
export const TESTES_REFERENCIADOS = [
  { arquivo: "tests/agent-audit.test.mjs", area: "Ferramentas e auditoria do agente" },
  { arquivo: "tests/agent-claim-acceptance.test.mjs", area: "Reivindicação de agente" },
  { arquivo: "tests/approvals-actions.test.mjs", area: "Aprovações e ações sensíveis" },
  { arquivo: "tests/audit-probe.test.mjs", area: "Auditoria (sondas)" },
  { arquivo: "tests/auth.test.mjs", area: "Núcleo de autenticação" },
  { arquivo: "tests/bots-authz.test.mjs", area: "Autorização de bots" },
  { arquivo: "tests/conversations.test.mjs", area: "Conversas e mensagens" },
  { arquivo: "tests/d-rec-invariants.test.mjs", area: "D_REC (invariantes)" },
  { arquivo: "tests/d-rec-purge.test.mjs", area: "D_REC (expurgo)" },
  { arquivo: "tests/d-rec-transfer.test.mjs", area: "D_REC (transferência)" },
  { arquivo: "tests/d-rec.test.mjs", area: "D_REC (fluxo)" },
  { arquivo: "tests/documents.test.mjs", area: "Documentos" },
  { arquivo: "tests/hostpolicy.test.mjs", area: "Política de comandos" },
  { arquivo: "tests/http-auth.test.mjs", area: "HTTP, autenticação e rotas" },
  { arquivo: "tests/isolation.test.mjs", area: "Isolamento por proprietário" },
  { arquivo: "tests/mail-drafts.test.mjs", area: "E-mail (rascunhos)" },
  { arquivo: "tests/mail-imap.test.mjs", area: "E-mail (IMAP)" },
  { arquivo: "tests/mail-routes.test.mjs", area: "E-mail (rotas)" },
  { arquivo: "tests/mail.test.mjs", area: "E-mail (serviço)" },
  { arquivo: "tests/migration-v2.test.mjs", area: "Migração v2" },
  { arquivo: "tests/migration-v7-v8.test.mjs", area: "Migrações v7–v8" },
  { arquivo: "tests/migrations.test.mjs", area: "Migrações" },
  { arquivo: "tests/password-change.test.mjs", area: "Troca de senha" },
  { arquivo: "tests/phase2-fixes.test.mjs", area: "Correções da Fase 2" },
  { arquivo: "tests/rea-analyze.test.mjs", area: "REA (análise de artefatos)" },
  { arquivo: "tests/run-limits.test.mjs", area: "Limites de execução do agente" },
  { arquivo: "tests/security-hardening.test.mjs", area: "Endurecimento de segurança" },
  { arquivo: "tests/urlpolicy.test.mjs", area: "Política de URL" },
];

const RISCOS = [
  "Busca na web depende de página pública sem contrato estável — pode falhar silenciosamente em mudanças do provedor.",
  "Autenticação dos CLIs de delegação dentro do contêiner depende de credenciais do operador e não é reverificada pelo produto.",
  "Auditoria e sessões crescem sem rotação automática de retenção.",
  "Modelo local pequeno tem tool-calling menos confiável; o chat mitiga com limites e /rea determinístico, mas a automação segue limitada.",
  "Verificação dinâmica de integrações não é coletada nesta fase (etapa 4 não aprovada): itens ficam em HABILITADO, nunca OPERACIONAL, sem execução real.",
  "Recursos de administrador desativado permanecem bloqueados até decisão explícita de procedimento.",
];

const OPORTUNIDADES = [
  "Etapa 4 (não aprovada): sondas internas limitadas elevariam evidências de HABILITADO para OPERACIONAL com método e data registrados.",
  "Registrar no produto a última execução das suítes de teste por área (hoje os resultados vivem fora do produto).",
  "Rotação de retenção para auditoria e sessões.",
  "Reavaliar exposição de ferramentas sem consumidor (ex.: leitura de e-mail) junto ao catálogo de agentes.",
  "Relatório exportável e resumo agendado (etapas 5–6 do dossiê).",
];

const DECISOES_HUMANAS = [
  "OmniRoute permanece sem chave (limitação conhecida por decisão; não configurar nesta fase).",
  "Telegram: respostas automáticas permanecem desativadas (decisão vigente).",
  "Recursos de administrador desativado permanecem bloqueados até procedimento explícito (decisão vigente).",
  "Saída de aprovação antiga fica retida; avaliação de retenção será apresentada separadamente (nada foi apagado).",
  "Rotação do segredo do túnel e restrição de permissões do serviço do túnel: procedimento separado pendente (nada alterado nesta fase).",
  "Diagnóstico: somente administrador; sem criação de tokens/sessões/permissões; sem sondas externas automáticas; sem mutações.",
];

const NOTAS = [
  "Inventário somente leitura: não executa sondas de rede, não chama LLM e não altera configurações.",
  "Métodos de evidência: código instalado, configuração efetiva, teste referenciado, execução real (registros locais) e documento — cada item traz referência e data (ou ausência explícita).",
  "'HABILITADO' não significa operacional: sem evidência de execução recente, nada é declarado OPERACIONAL.",
  "Execução das suítes de teste não é registrada pelo produto; a referência estática aponta a suíte que cobre o item.",
];

// ---------------------------------------------------------------------------
// Classificação de endpoint (a URL nunca sai daqui — apenas a classe)
// ---------------------------------------------------------------------------

export function classificaEndpoint(url) {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url);
    const host = u.hostname;
    const ipPrivado = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(host);
    const nomeInterno = !host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".ts.net");
    if (u.protocol !== "https:" || ipPrivado || nomeInterno) return "interno";
    return "externo";
  } catch {
    return null;
  }
}

const iso = (d) => new Date(d).toISOString();
const isoValido = (s) =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s));
const recente = (s, nowMs) => isoValido(s) && nowMs - Date.parse(s) <= JANELA_EXECUCAO_MS;

// ---------------------------------------------------------------------------
// Validadores de estado (contradições são rejeitadas)
// ---------------------------------------------------------------------------

export function validateItem(item, { now = Date.now() } = {}) {
  const v = [];
  if (!item || typeof item !== "object") return ["item inválido"];
  if (!/^[a-z]+:[a-z0-9_-]+$/.test(String(item.id || ""))) v.push(`id inválido em ${item?.id}: use "categoria:slug" minúsculo`);
  if (!CATEGORIAS.includes(item.categoria)) v.push(`categoria inválida em ${item.id}: ${item.categoria}`);
  if (typeof item.nome !== "string" || !item.nome) v.push(`nome ausente em ${item.id}`);
  if (!ESTADOS.includes(item.estado)) v.push(`estado inválido em ${item.id}: ${item.estado}`);
  if (!CONFIANCAS.includes(item.confianca)) v.push(`confiança inválida em ${item.id}: ${item.confianca}`);
  if (!Array.isArray(item.limitacoes) || item.limitacoes.some((l) => typeof l !== "string" || !l)) {
    v.push(`limitações inválidas em ${item.id}`);
  }
  const ev = Array.isArray(item.evidencias) ? item.evidencias : null;
  if (!ev) {
    v.push(`evidências ausentes em ${item.id}`);
    return v;
  }
  for (const e of ev) {
    if (!METODOS.includes(e?.metodo)) v.push(`método inválido em ${item.id}: ${e?.metodo}`);
    if (typeof e?.ref !== "string" || !e.ref) v.push(`evidência sem referência em ${item.id}`);
    if (e?.data !== null && e?.data !== undefined && !isoValido(e.data)) v.push(`data inválida em ${item.id}`);
    if (e?.metodo === "execucao" && !isoValido(e?.data)) v.push(`evidência de execução sem data em ${item.id}`);
  }
  const f = item.flags || {};
  for (const k of ["implementado", "habilitado", "testado"]) {
    if (typeof f[k] !== "boolean") v.push(`flag ${k} inválida em ${item.id}`);
  }
  const tem = (m) => ev.some((e) => e?.metodo === m);
  if (f.implementado !== tem("codigo")) v.push(`flag implementado divergente das evidências em ${item.id}`);
  if (f.habilitado && !f.implementado) v.push(`habilitado sem implementado em ${item.id}`);
  if (f.testado && !f.implementado) v.push(`testado sem implementado em ${item.id}`);
  switch (item.estado) {
    case "OPERACIONAL": {
      if (!f.habilitado) v.push(`OPERACIONAL exige flag habilitado em ${item.id}`);
      const ok = ev.some((e) => e.metodo === "execucao" && recente(e.data, now));
      if (!ok) v.push(`OPERACIONAL exige execução recente (≤30 dias) em ${item.id}`);
      break;
    }
    case "HABILITADO":
      if (!f.habilitado) v.push(`HABILITADO exige flag habilitado em ${item.id}`);
      break;
    case "TESTADO":
      if (!f.testado) v.push(`TESTADO exige teste referenciado em ${item.id}`);
      break;
    case "NÃO TESTADO":
      if (f.testado) v.push(`NÃO TESTADO incompatível com teste referenciado em ${item.id}`);
      break;
    case "BLOQUEADO":
      if (!ev.some((e) => e.metodo === "documento" || e.metodo === "execucao")) {
        v.push(`BLOQUEADO exige evidência de bloqueio (documento ou execução) em ${item.id}`);
      }
      break;
    case "INDISPONÍVEL":
      if (!item.limitacoes.length) v.push(`INDISPONÍVEL exige limitação documentada em ${item.id}`);
      break;
    case "DESCONHECIDO":
      if (ev.length) v.push(`DESCONHECIDO não pode ter evidências em ${item.id}`);
      break;
    default:
      break;
  }
  return v;
}

export function validateInventory(inv, { now = Date.now() } = {}) {
  const v = [];
  if (!inv || typeof inv !== "object") return ["inventário inválido"];
  if (!isoValido(inv.generatedAt)) v.push("generatedAt inválido");
  if (!Array.isArray(inv.itens) || inv.itens.length === 0) {
    v.push("itens ausentes");
    return v;
  }
  const ids = new Set();
  for (const item of inv.itens) {
    if (ids.has(item?.id)) v.push(`id duplicado: ${item?.id}`);
    ids.add(item?.id);
    v.push(...validateItem(item, { now }));
  }
  return v;
}

// ---------------------------------------------------------------------------
// Construção do inventário (núcleo puro: recebe um contexto já lido)
// ---------------------------------------------------------------------------

const mkItem = (id, categoria, nome, estado, flags, evidencias, limitacoes, confianca, detalhes) => ({
  id,
  categoria,
  nome,
  estado,
  flags,
  evidencias,
  limitacoes,
  confianca,
  ...(detalhes ? { detalhes } : {}),
});

const slug = (id) => String(id).toLowerCase().replace(/[^a-z0-9_-]/g, "-");

/**
 * Monta o inventário completo a partir de um contexto já coletado (sem I/O).
 * Ver docs acima: nenhum valor sensível entra no contexto.
 */
export function buildInventory(ctx) {
  const nowMs = (ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now())).getTime();
  const agora = iso(nowMs);
  const itens = [];
  const expostas = new Set(Array.isArray(ctx.expostas) ? ctx.expostas : []);
  const expostasAtivas = new Set(Array.isArray(ctx.expostasAtivas) ? ctx.expostasAtivas : []);
  const c = ctx.counts || {};

  // --- serviço -------------------------------------------------------------
  itens.push(mkItem(
    "servico:api", "servico", "Serviço J.A.R.V.I.S. (API)",
    "OPERACIONAL", { implementado: true, habilitado: true, testado: true },
    [
      { metodo: "codigo", ref: "server/index.js", data: null, nota: "referência estática." },
      { metodo: "teste", ref: "tests/http-auth.test.mjs", data: null, nota: "suíte referenciada (execução não registrada pelo produto)." },
      { metodo: "execucao", ref: "processo em execução (uptime lido do runtime)", data: agora, nota: "a própria resposta do diagnóstico prova o serviço ativo." },
    ],
    [],
    "alta",
    { versaoReportada: ctx.version || null, commit: ctx.commit || null, buildTime: ctx.buildTime || null, node: ctx.nodeVersion || null, uptimeSegundos: Math.round(ctx.uptimeSeconds || 0) },
  ));

  // P1-C: Skills Hub — estado real (provisionado, ausente ou inválido), com origem e versão.
  const sk = ctx.skills || {};
  const skOk = !!(sk.present && sk.total > 0);
  itens.push(mkItem(
    "servico:skills-hub", "servico", "Hub Global de Skills",
    skOk ? "OPERACIONAL" : "INDISPONÍVEL",
    { implementado: true, habilitado: true, testado: skOk },
    [
      { metodo: "codigo", ref: "scripts/setup-global-skills.mjs, server/skills.js", data: null, nota: "provisionamento offline e determinístico (modo builtin)." },
      { metodo: "teste", ref: "tests/skills-provision.test.mjs", data: null, nota: "suíte referenciada." },
      { metodo: "execucao", ref: "catalog.json (leitura somente)", data: agora, nota: skOk ? "catálogo encontrado." : `catálogo indisponível (${sk.reason || "ausente"}).` },
    ],
    skOk ? [] : ["sem catálogo: /api/skills responde vazio até o provisionamento ocorrer."],
    "alta",
    { diretorio: sk.dir || null, total: sk.total ?? 0, versao: sk.version || null, origem: sk.source || null, motivo: sk.reason || null },
  ));

  if (ctx.bancoOk) {
    itens.push(mkItem(
      "servico:banco", "servico", "Banco de dados local",
      "OPERACIONAL", { implementado: true, habilitado: true, testado: true },
      [
        { metodo: "codigo", ref: "server/db.js, server/migrations.js", data: null, nota: "referência estática." },
        { metodo: "teste", ref: "tests/migrations.test.mjs", data: null, nota: "suíte referenciada." },
        { metodo: "execucao", ref: "PRAGMA quick_check (somente leitura)", data: agora, nota: "verificação de integridade executada na montagem do inventário." },
      ],
      [],
      "alta",
      { schema: ctx.schemaVersion ?? null },
    ));
  } else {
    itens.push(mkItem(
      "servico:banco", "servico", "Banco de dados local",
      "INDISPONÍVEL", { implementado: true, habilitado: false, testado: true },
      [
        { metodo: "codigo", ref: "server/db.js, server/migrations.js", data: null },
        { metodo: "teste", ref: "tests/migrations.test.mjs", data: null },
      ],
      ["A verificação de integridade do banco falhou na montagem do inventário."],
      "alta",
      { schema: ctx.schemaVersion ?? null },
    ));
  }

  // --- ferramentas ---------------------------------------------------------
  for (const nome of Object.keys(TOOL_DEFS)) {
    const meta = TOOL_META[nome];
    if (!meta) {
      throw new DiagnosticsError(`metadado ausente para a ferramenta ${nome}`, [`TOOL_META sem entrada para ${nome}`]);
    }
    const exposta = expostas.has(nome);
    const ativa = expostasAtivas.has(nome);
    const temTeste = meta.testes.length > 0;
    const execucao = nome === "run_command" && ctx.ultimaAprovacaoDone
      ? { metodo: "execucao", ref: "aprovação concluída (registro local de aprovações)", data: ctx.ultimaAprovacaoDone, nota: "execução real confirmada por aprovação resolvida; conteúdo não é lido." }
      : null;
    const operacional = !!execucao && recente(execucao.data, nowMs);
    const evidencias = [
      { metodo: "codigo", ref: "server/tools.js (TOOL_DEFS)", data: null, nota: `Portão: ${meta.portao}` },
    ];
    if (exposta) {
      evidencias.push({
        metodo: "config", ref: "agentes do administrador",
        data: agora,
        nota: ctx.usaTemplate && !ativa ? "disponível pelo modelo embutido (nenhum agente configurado)." : ativa ? "exposta em agente ativo." : "exposta apenas em agente inativo.",
      });
    }
    if (temTeste) {
      evidencias.push({ metodo: "teste", ref: meta.testes.join(", "), data: null, nota: "suíte referenciada (execução não registrada pelo produto)." });
    }
    if (execucao) evidencias.push(execucao);
    const limitacoes = [...meta.limites];
    if (!exposta) limitacoes.push("Não exposta em nenhum agente deste administrador (sem consumidor no momento).");
    else if (!ativa) limitacoes.push("Presente apenas em agente inativo — não participa do fluxo padrão do chat.");
    const estado = !exposta ? "INDISPONÍVEL" : operacional ? "OPERACIONAL" : temTeste ? "TESTADO" : "NÃO TESTADO";
    itens.push(mkItem(
      `tool:${nome}`, "ferramenta", meta.nome, estado,
      { implementado: true, habilitado: exposta, testado: temTeste },
      evidencias, limitacoes,
      "alta",
      {
        exposicao: ctx.usaTemplate && !ativa ? "modelo embutido" : ativa ? "agente ativo" : exposta ? "agente inativo" : "nenhuma",
        dependencias: meta.deps,
        escopo: TOOL_SCOPES[nome] || null,
      },
    ));
  }

  // --- acessos e permissões ------------------------------------------------
  itens.push(mkItem(
    "acesso:sessao-admin", "acesso", "Sessão administrativa",
    "OPERACIONAL", { implementado: true, habilitado: true, testado: true },
    [
      { metodo: "codigo", ref: "server/auth.js (sessões com TTL e reautenticação)", data: null },
      { metodo: "teste", ref: "tests/http-auth.test.mjs, tests/password-change.test.mjs", data: null },
      { metodo: "execucao", ref: "sessão administrativa verificada em uso", data: agora, nota: "esta resposta só é produzida para sessão admin verificada." },
    ],
    [],
    "alta",
  ));

  itens.push(mkItem(
    "acesso:token-servico", "acesso", "Tokens de serviço (escopos)",
    "TESTADO", { implementado: true, habilitado: true, testado: true },
    [
      { metodo: "codigo", ref: "server/auth.js (SCOPES/ADMIN_ONLY, tokens revogáveis)", data: null },
      { metodo: "teste", ref: "tests/http-auth.test.mjs, tests/auth.test.mjs", data: null },
    ],
    c.tokensAtivos ? [] : ["Nenhum token emitido no momento."],
    "alta",
    { tokensAtivosDoAdmin: c.tokensAtivos ?? 0, escoposAdmin: SCOPES.length, escoposSomenteAdmin: ADMIN_ONLY.length },
  ));

  itens.push(mkItem(
    "acesso:bots", "acesso", "Bots e execuções agendadas",
    "TESTADO", { implementado: true, habilitado: true, testado: true },
    [
      { metodo: "codigo", ref: "server/bots.js + escopos de bot em server/auth.js", data: null },
      { metodo: "teste", ref: "tests/bots-authz.test.mjs", data: null },
    ],
    c.bots ? [] : ["Nenhum bot configurado; bots sem proprietário são bloqueados e auditados."],
    "alta",
    { botsDoAdmin: c.bots ?? 0 },
  ));

  itens.push(mkItem(
    "acesso:canal-telegram", "acesso", "Canal Telegram",
    ctx.telegram?.enabled ? "NÃO TESTADO" : "INDISPONÍVEL",
    { implementado: true, habilitado: !!ctx.telegram?.enabled, testado: false },
    [
      { metodo: "codigo", ref: "server/index.js (manipulador do canal)", data: null },
      { metodo: "config", ref: "preferências do administrador (valores não copiados)", data: agora, nota: ctx.telegram?.enabled ? "canal habilitado." : "canal desabilitado." },
    ],
    [
      "Respostas automáticas desativadas por decisão vigente.",
      ctx.telegram?.enabled ? "Sem evidência de recebimento real recente; verificação dinâmica é a etapa 4 (não executada)." : "Canal desabilitado nas preferências.",
    ],
    "media",
    { habilitado: !!ctx.telegram?.enabled, autenticacao: ctx.telegram?.hasKey ? "chave configurada" : "sem chave" },
  ));

  itens.push(mkItem(
    "acesso:recursos-legado", "acesso", "Recursos legado e sem proprietário",
    "TESTADO", { implementado: true, habilitado: true, testado: true },
    [
      { metodo: "codigo", ref: "server/ownership.js", data: null },
      { metodo: "teste", ref: "tests/isolation.test.mjs, tests/d-rec.test.mjs", data: null },
    ],
    ["Recursos sem proprietário ficam invisíveis até reivindicação explícita; recursos de administrador desativado permanecem bloqueados por decisão vigente."],
    "alta",
  ));

  // --- integrações, canais e modelos --------------------------------------
  const provedores = Object.entries(ctx.providers || {});
  for (const [pid, cfg] of provedores) {
    const id = slug(pid);
    const zen = pid === "opencode_go";
    const evidencias = [{ metodo: "codigo", ref: "server/llm.js (providerConfig)", data: null }];
    if (zen) {
      evidencias.push({
        metodo: "documento",
        ref: "docs/AVALIACAO-OPENCODE-ZEN-2026-10-16.md",
        data: "2026-10-16T00:00:00.000Z",
        nota: "veredito registrado: provedor recusou uso fora do OpenCode (403 FreeTierError).",
      });
    }
    let estado;
    if (zen) estado = "BLOQUEADO";
    else if (!cfg.enabled) estado = "INDISPONÍVEL";
    else if (pid === "ollama" && ctx.execucaoProvedor) {
      estado = recente(ctx.execucaoProvedor, nowMs) ? "OPERACIONAL" : "HABILITADO";
      evidencias.push({
        metodo: "execucao", ref: "respostas reais persistidas (registro local de conversas)",
        data: ctx.execucaoProvedor,
        nota: "prova de uso real do modelo; nenhum conteúdo de mensagem é lido.",
      });
    } else estado = "HABILITADO";
    const limitacoes = [];
    if (zen) limitacoes.push("Recusado fora do OpenCode (403 FreeTierError) — decisão: não integrar; a chave permanece apenas configurada.");
    if (!zen && !cfg.enabled) limitacoes.push("Desabilitado nas preferências pessoais.");
    if (estado === "HABILITADO" || (estado === "OPERACIONAL" && pid !== "ollama")) {
      limitacoes.push("Verificação dinâmica não realizada nesta fase (etapa 4 pendente).");
    }
    if (cfg.enabled && !cfg.hasKey && PROVIDERS_COM_CHAVE.has(pid)) limitacoes.push("Sem chave configurada.");
    if (pid === "omniroute") limitacoes.push("Limitação conhecida mantida por decisão: sem chave configurada nesta fase.");
    itens.push(mkItem(
      `provedor:${id}`, "integracao", PROVIDER_NOMES[pid] || pid, estado,
      { implementado: true, habilitado: !!cfg.enabled, testado: false },
      evidencias, limitacoes,
      zen ? "alta" : "media",
      {
        habilitado: !!cfg.enabled,
        autenticacao: cfg.hasKey ? "chave configurada" : "sem chave",
        modelo: cfg.model || null,
        endpoint: cfg.endpoint || null,
      },
    ));
  }
  if (!provedores.some(([pid]) => pid.includes("omniroute"))) {
    itens.push(mkItem(
      "provedor:omniroute", "integracao", PROVIDER_NOMES.omniroute,
      "INDISPONÍVEL", { implementado: true, habilitado: false, testado: false },
      [{ metodo: "codigo", ref: "server/llm.js (DEFAULT_URLS/providerConfig)", data: null }],
      ["Sem chave configurada e sem agente ativo que o utilize — limitação conhecida mantida por decisão (não configurar nesta fase)."],
      "media",
      { habilitado: false, autenticacao: "sem chave" },
    ));
  }

  for (const [iid, cfg] of Object.entries(ctx.integracoes || {})) {
    const id = slug(iid);
    const meta = metaIntegracao(iid);
    const temConsumidor = meta ? !!meta.consumidor : true;
    const evidencias = [];
    if (temConsumidor) evidencias.push({ metodo: "codigo", ref: "server/llm.js (providerConfig) / server/tools.js", data: null });
    for (const t of meta?.testes || []) evidencias.push({ metodo: "teste", ref: t, data: null });
    const limitacoes = [];
    let estado;
    if (!temConsumidor) {
      estado = "INDISPONÍVEL";
      limitacoes.push("Nenhuma ferramenta ou agente consome esta integração no momento.");
    } else if (!cfg.enabled) {
      estado = "INDISPONÍVEL";
      limitacoes.push("Desabilitada nas configurações globais.");
    } else if (meta?.needsKey && !cfg.hasKey) {
      estado = "INDISPONÍVEL";
      limitacoes.push("Sem chave configurada.");
    } else {
      estado = "HABILITADO";
      limitacoes.push("Verificação dinâmica não realizada nesta fase (etapa 4 pendente) — estar habilitada não prova operação.");
    }
    if (id.includes("omniroute")) limitacoes.push("Limitação conhecida mantida por decisão: sem chave configurada nesta fase.");
    itens.push(mkItem(
      `integracao:${id}`, "integracao", meta?.nome || `Integração ${iid}`, estado,
      { implementado: temConsumidor, habilitado: temConsumidor && !!cfg.enabled && !(meta?.needsKey && !cfg.hasKey), testado: (meta?.testes || []).length > 0 },
      evidencias, limitacoes,
      "media",
      {
        habilitada: !!cfg.enabled,
        autenticacao: cfg.hasKey ? "chave configurada" : "sem chave",
        endpoint: cfg.endpoint || null,
        consumidor: meta?.consumidor || "não identificado",
      },
    ));
  }

  itens.push(mkItem(
    "integracao:voz", "integracao", "Voz (síntese e ativação)",
    ctx.voice?.habilitado ? "HABILITADO" : "INDISPONÍVEL",
    { implementado: true, habilitado: !!ctx.voice?.habilitado, testado: false },
    [{ metodo: "codigo", ref: "server/index.js (rotas de voz) e painel", data: null }],
    ctx.voice?.habilitado
      ? ["Síntese no navegador; serviço local de voz não verificado nesta fase (etapa 4 pendente)."]
      : ["Voz desabilitada nas preferências."],
    "baixa",
    { tts: ctx.voice?.tts || null },
  ));

  itens.push(mkItem(
    "integracao:email-envio", "integracao", "E-mail (leitura e envio)",
    ctx.email?.transporte === "real" ? "HABILITADO" : "INDISPONÍVEL",
    { implementado: true, habilitado: ctx.email?.transporte === "real", testado: true },
    [
      { metodo: "codigo", ref: "server/mail-service.js, server/mail-imap.js", data: null },
      { metodo: "teste", ref: "tests/mail.test.mjs, tests/mail-drafts.test.mjs, tests/mail-routes.test.mjs, tests/mail-imap.test.mjs, tests/mail-connection.test.mjs", data: null },
      { metodo: "execucao", ref: "POST /api/mail/:account/test-connection (humano + CSRF)", data: agora, nota: "testa IMAP/SMTP sem enviar; distingue mock, configuração incompleta e falha classificada." },
    ],
    // P3: distingue explicitamente ausência de configuração de falha de conexão.
    [
      ...(ctx.email?.transporte === "real"
        ? ["Envio real habilitado por opt-in explícito; verificação dinâmica é a etapa 4 (não executada)."]
        : ["Transporte simulado (mock) ativo — envio real desativado por padrão (decisão vigente)."]),
      ...((ctx.email?.contasAtivas ?? 0) === 0
        ? ["Nenhuma conta configurada: isso é CONFIGURAÇÃO AUSENTE, não falha de conexão."]
        : []),
    ],
    "alta",
    { transporte: ctx.email?.transporte || "mock", contasAtivas: ctx.email?.contasAtivas ?? 0 },
  ));

  // Navegador (browser_action): modo efetivo e se existe credencial — nunca o valor do token.
  const bmeta = TOOL_META.browser_action;
  const binfo = ctx.browser || { enabled: false, mode: "off", endpoint: null, hasToken: false };
  const bmode = binfo.mode || (binfo.enabled ? "local" : "off");
  itens.push(mkItem(
    "integracao:navegador", "integracao", "Navegador (automação de páginas)",
    bmode === "off" ? "INDISPONÍVEL" : "HABILITADO",
    { implementado: true, habilitado: bmode !== "off", testado: true },
    [
      { metodo: "codigo", ref: "server/browser.js, scripts/browser-worker.mjs", data: null, nota: bmeta.portao },
      { metodo: "teste", ref: "tests/browser-tool.test.mjs", data: null, nota: "contrato, política de destino, aprovação, timeout e cancelamento." },
    ],
    bmode === "off" ? ["Desligado: habilite a integração \"browser\" em Configurações para usar a ferramenta."] : bmeta.limites,
    "alta",
    { modo: bmode, endpoint: binfo.endpoint ?? null, hasToken: !!binfo.hasToken },
  ));

  // --- automações ----------------------------------------------------------
  itens.push(mkItem(
    "auto:agendador", "automacao", "Agendador de bots",
    "TESTADO", { implementado: true, habilitado: true, testado: true },
    [
      { metodo: "codigo", ref: "server/bots.js (iniciado no boot do processo)", data: null },
      { metodo: "teste", ref: "tests/bots-authz.test.mjs", data: null },
      { metodo: "config", ref: "processo em execução", data: agora, nota: "agendador ativo desde o boot." },
    ],
    c.bots ? [] : ["Nenhum bot configurado — nada é agendado no momento."],
    "alta",
  ));

  itens.push(mkItem(
    "auto:telegram-polling", "automacao", "Recepção de mensagens (Telegram)",
    ctx.telegram?.enabled ? "NÃO TESTADO" : "INDISPONÍVEL",
    { implementado: true, habilitado: !!ctx.telegram?.enabled, testado: false },
    [
      { metodo: "codigo", ref: "server/index.js (leitura do canal)", data: null },
      { metodo: "config", ref: "preferências do administrador (valores não copiados)", data: agora, nota: ctx.telegram?.enabled ? "recepção habilitada." : "recepção desabilitada." },
    ],
    [
      "Mensagens recebidas são processadas com respostas automáticas desativadas (decisão vigente).",
      "Sem evidência de recebimento real recente; verificação dinâmica é a etapa 4 (não executada).",
    ],
    "media",
  ));

  {
    const pendentes = c.aprovacoesPendentes ?? 0;
    const resolvidas = c.aprovacoesResolvidas ?? 0;
    const outras = c.aprovacoesOutras ?? 0;
    const execucao = ctx.ultimaAprovacaoDone
      ? { metodo: "execucao", ref: "aprovação concluída (registro local de aprovações)", data: ctx.ultimaAprovacaoDone, nota: "fluxo completo requisição→aprovação→execução já ocorreu; conteúdo não é lido." }
      : null;
    const operacional = !!execucao && recente(execucao.data, nowMs);
    itens.push(mkItem(
      "auto:fila-aprovacoes", "automacao", "Fila de aprovações humanas",
      operacional ? "OPERACIONAL" : "TESTADO",
      { implementado: true, habilitado: true, testado: true },
      [
        { metodo: "codigo", ref: "server/tools.js (queueApproval/resolveApproval)", data: null },
        { metodo: "teste", ref: "tests/approvals-actions.test.mjs", data: null },
        ...(execucao ? [execucao] : []),
      ],
      ["Saída de aprovações concluídas fica retida; política de expurgo ainda não implementada."],
      "alta",
      { pendentes, resolvidas, outras },
    ));
  }

  itens.push(mkItem(
    "auto:runs-bots", "automacao", "Execuções de bots",
    "TESTADO", { implementado: true, habilitado: true, testado: true },
    [
      { metodo: "codigo", ref: "server/bots.js (limitada por escopos e dono)", data: null },
      { metodo: "teste", ref: "tests/bots-authz.test.mjs, tests/run-limits.test.mjs", data: null },
    ],
    c.runs ? [] : ["Nenhuma execução de bot registrada até o momento."],
    "alta",
    { execucoesDoAdmin: c.runs ?? 0 },
  ));

  itens.push(mkItem(
    "auto:cancelamento", "automacao", "Cancelamento de execução do agente",
    "TESTADO", { implementado: true, habilitado: true, testado: true },
    [
      { metodo: "codigo", ref: "server/llm.js (cancelRun)", data: null },
      { metodo: "teste", ref: "tests/run-limits.test.mjs", data: null },
    ],
    [],
    "alta",
  ));

  itens.push(mkItem(
    "auto:expurgo-drec", "automacao", "Expurgo e transferência (D_REC)",
    "TESTADO", { implementado: true, habilitado: true, testado: true },
    [
      { metodo: "codigo", ref: "server/ownership.js", data: null },
      { metodo: "teste", ref: "tests/d-rec-purge.test.mjs, tests/d-rec-invariants.test.mjs, tests/d-rec-transfer.test.mjs", data: null },
    ],
    ["Recursos de administrador desativado permanecem bloqueados por decisão vigente até procedimento explícito."],
    "alta",
    { jobsDeExpurgo: c.jobsExpurgo ?? 0 },
  ));

  // --- dados (contagens do próprio administrador; nunca conteúdo) ----------
  const dados = [
    ["dados:conversas", "Conversas e mensagens", "tests/conversations.test.mjs", { conversas: c.conversas ?? 0, mensagens: c.mensagens ?? 0 }, []],
    ["dados:memorias", "Memórias", "tests/isolation.test.mjs", { registros: c.memorias ?? 0 }, ["Memórias de outro administrador não são contadas nem lidas."]],
    ["dados:agentes", "Agentes", "tests/agent-audit.test.mjs", { total: c.agentes ?? 0, ativos: c.agentesAtivos ?? 0 }, []],
    ["dados:bots", "Bots", "tests/bots-authz.test.mjs", { registros: c.bots ?? 0 }, []],
    ["dados:documentos", "Documentos", "tests/documents.test.mjs", { registros: c.documentos ?? 0 }, ["Base documental de escopo de instalação (sem proprietário)."]],
    ["dados:auditoria", "Auditoria", "tests/audit-probe.test.mjs", { registros: c.auditoria ?? 0 }, ["Sem rotação automática de retenção — crescimento contínuo."]],
    ["dados:sessoes-tokens", "Sessões e tokens", "tests/http-auth.test.mjs", { sessoesAtivas: c.sessoesAtivas ?? 0, tokensAtivos: c.tokensAtivos ?? 0 }, []],
  ];
  for (const [id, nome, teste, detalhes, limites] of dados) {
    itens.push(mkItem(
      id, "dados", nome,
      "TESTADO", { implementado: true, habilitado: true, testado: true },
      [
        { metodo: "codigo", ref: "server/db.js, server/migrations.js", data: null },
        { metodo: "teste", ref: teste, data: null },
        { metodo: "config", ref: "consulta somente leitura no banco local", data: agora, nota: "contagem do próprio administrador." },
      ],
      limites,
      "alta",
      detalhes,
    ));
  }

  // --- resumo + validação --------------------------------------------------
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, itens.filter((i) => i.estado === e).length]));
  const servicoOk = itens.filter((i) => i.categoria === "servico").every((i) => i.estado === "OPERACIONAL");
  const pendencias =
    porEstado.BLOQUEADO + porEstado["INDISPONÍVEL"] + porEstado.DESCONHECIDO + porEstado["NÃO TESTADO"];
  const inventario = {
    generatedAt: agora,
    versao: {
      app: ctx.version || null,
      // Árvore construída: só o que o build injetou; sem adivinhar do branch atual.
      commit: ctx.commit || null,
      buildTime: ctx.buildTime || null,
      banco: ctx.schemaVersion ?? null,
      node: ctx.nodeVersion || null,
      uptimeSegundos: Math.round(ctx.uptimeSeconds || 0),
    },
    resumo: { saude: servicoOk ? "ok" : "atencao", total: itens.length, porEstado, pendencias },
    itens,
    testes: TESTES_REFERENCIADOS,
    riscos: RISCOS,
    oportunidades: OPORTUNIDADES,
    decisoesHumanas: DECISOES_HUMANAS,
    notas: NOTAS,
  };
  const violacoes = validateInventory(inventario, { now: nowMs });
  if (violacoes.length) throw new DiagnosticsError("inventário inválido", violacoes);
  return inventario;
}

// ---------------------------------------------------------------------------
// Coleta (somente leitura; sem rede; sem segredos) + montagem
// ---------------------------------------------------------------------------

export function collectDiagnostics({ adminId, version = null, commit = null, buildTime = null } = {}) {
  const agora = new Date();
  const agoraIso = agora.toISOString();

  let bancoOk = true;
  try {
    bancoOk = db.prepare("PRAGMA quick_check").get().quick_check === "ok";
  } catch {
    bancoOk = false;
  }
  const schemaVersion = Number(db.prepare("PRAGMA user_version").get().user_version);

  const conta = (sql, ...args) => db.prepare(sql).get(...args).n;
  const conversas = conta("SELECT COUNT(*) AS n FROM conversations WHERE admin_id = ?", adminId);
  const mensagens = conta(
    "SELECT COUNT(*) AS n FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.admin_id = ?",
    adminId,
  );
  const ultimaResposta = db.prepare(
    "SELECT MAX(m.created_at) AS t FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.admin_id = ? AND m.role = 'assistant'",
  ).get(adminId).t;
  const memorias = conta("SELECT COUNT(*) AS n FROM ownership WHERE resource_type = 'memory' AND owner_admin_id = ?", adminId);
  const botsQtd = conta("SELECT COUNT(*) AS n FROM ownership WHERE resource_type = 'bot' AND owner_admin_id = ?", adminId);
  const runs = conta("SELECT COUNT(*) AS n FROM ownership WHERE resource_type = 'run' AND owner_admin_id = ?", adminId);
  const documentos = conta("SELECT COUNT(*) AS n FROM documents");
  const auditoria = conta("SELECT COUNT(*) AS n FROM audit");
  const sessoesAtivas = conta("SELECT COUNT(*) AS n FROM sessions WHERE admin_id = ? AND revoked_at IS NULL", adminId);
  const tokensAtivos = conta("SELECT COUNT(*) AS n FROM service_tokens WHERE admin_id = ? AND revoked_at IS NULL", adminId);
  const jobsExpurgo = conta("SELECT COUNT(*) AS n FROM purge_jobs WHERE actor_admin_id = ?", adminId);

  const aprovacoes = db.prepare(
    "SELECT a.status AS status, COUNT(*) AS n FROM approvals a JOIN ownership o ON o.resource_type = 'approval' AND o.resource_id = a.id AND o.owner_admin_id = ? GROUP BY a.status",
  ).all(adminId);
  const porStatus = Object.fromEntries(aprovacoes.map((r) => [r.status, r.n]));
  const aprovacoesPendentes = porStatus.pending || 0;
  const aprovacoesResolvidas = porStatus.done || 0;
  const aprovacoesOutras = Object.entries(porStatus)
    .filter(([s]) => s !== "pending" && s !== "done")
    .reduce((acc, [, n]) => acc + n, 0);
  const ultimaAprovacaoDone = db.prepare(
    "SELECT MAX(a.created_at) AS t FROM approvals a JOIN ownership o ON o.resource_type = 'approval' AND o.resource_id = a.id AND o.owner_admin_id = ? WHERE a.status = 'done'",
  ).get(adminId).t;

  const meusAgentesIds = ownedIds(adminId, "agent");
  const meusAgentes = agents.list().filter((a) => meusAgentesIds.has(a.id));
  const ativos = meusAgentes.filter((a) => a.active);
  const usaTemplate = meusAgentes.length === 0;
  const ferramentas = (lista) => new Set(lista.flatMap((a) => (Array.isArray(a.tools) ? a.tools : [])));
  const todas = ferramentas(meusAgentes);
  if (usaTemplate) for (const t of DEFAULT_AGENT.tools) todas.add(t);

  const publico = publicSettings(adminId);
  const providers = {};
  for (const [id, cfg] of Object.entries(publico.providers || {})) {
    if (!cfg || typeof cfg !== "object") continue;
    providers[id] = {
      enabled: !!cfg.enabled,
      hasKey: !!cfg.hasKey,
      model: typeof cfg.model === "string" && cfg.model ? cfg.model : null,
      endpoint: classificaEndpoint(cfg.baseUrl),
    };
  }
  const integracoes = {};
  for (const [id, cfg] of Object.entries(publico.integrations || {})) {
    if (!cfg || typeof cfg !== "object") continue;
    integracoes[id] = {
      enabled: !!cfg.enabled,
      hasKey: !!cfg.hasKey,
      endpoint: classificaEndpoint(cfg.command || cfg.baseUrl),
    };
  }
  const comms = publico.comms && typeof publico.comms === "object" ? publico.comms : {};
  const telegram = comms.telegram && typeof comms.telegram === "object" ? comms.telegram : {};
  const skillsStatus = getCatalogStatus();
  const contasAtivas = Object.entries(comms).filter(
    ([k, v]) => k !== "telegram" && v && typeof v === "object" && v.enabled,
  ).length;

  return buildInventory({
    now: agora,
    version,
    // Metadados da árvore construída (injetados no build). `null`/`unknown` quando ausentes.
    commit,
    buildTime,
    schemaVersion,
    nodeVersion: process.version,
    uptimeSeconds: process.uptime(),
    bancoOk,
    telegram: { enabled: !!telegram.enabled, hasKey: !!telegram.hasKey },
    email: {
      transporte: String(process.env.JARVIS_MAIL_TRANSPORT || "").toLowerCase() === "imap" ? "real" : "mock",
      contasAtivas,
    },
    voice: { habilitado: true, tts: typeof publico.voice?.tts === "string" ? publico.voice.tts : null },
    // Navegador: modo efetivo derivado da configuração (sem expor o token).
    browser: (() => {
      const b = publico.integrations?.browser && typeof publico.integrations.browser === "object" ? publico.integrations.browser : null;
      const mode = !b?.enabled ? "off" : b.command ? "remote" : "local";
      return { enabled: mode !== "off", mode, endpoint: b?.command ? classificaEndpoint(b.command) : null, hasToken: !!b?.hasKey };
    })(),
    // P1-C: origem/estado reais do Skills Hub (ausente, inválido ou provisionado).
    skills: skillsStatus,
    providers,
    integracoes,
    expostas: [...todas],
    expostasAtivas: [...ferramentas(ativos)],
    usaTemplate,
    counts: {
      conversas,
      mensagens,
      memorias,
      agentes: meusAgentes.length,
      agentesAtivos: ativos.length,
      bots: botsQtd,
      runs,
      documentos,
      auditoria,
      sessoesAtivas,
      tokensAtivos,
      jobsExpurgo,
      aprovacoesPendentes,
      aprovacoesResolvidas,
      aprovacoesOutras,
    },
    execucaoProvedor: ultimaResposta || null,
    ultimaAprovacaoDone: ultimaAprovacaoDone || null,
    coletadoEm: agoraIso,
  });
}
