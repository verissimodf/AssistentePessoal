// Fase I — Diagnóstico Operacional (etapas 1–3): núcleo puro, rota admin-only e sigilo.
// Cobre: registro de ferramentas, coerência de permissões, ausência de segredos e URLs
// internas, estados desconhecidos, expiração de evidência, isolamento por proprietário,
// rejeição de estados contraditórios e a rota HTTP (anônimo/token/sessão).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-diag-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const {
  buildInventory, collectDiagnostics, validateItem, validateInventory,
  classificaEndpoint, TOOL_META, ESTADOS, METODOS,
} = await import("../server/diagnostics.js");
const { TOOL_DEFS } = await import("../server/tools.js");
const { TOOL_SCOPES, SCOPES, ADMIN_ONLY } = await import("../server/auth.js");
const { createApp, routeTable } = await import("../server/index.js");
const { db, auth } = await import("../server/db.js");
const { updateSettings } = await import("../server/settings.js");
const { assignNew } = await import("../server/ownership.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const DIA = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// Cópia exata do contexto que collectDiagnostics monta (núcleo puro, sem I/O).
function mkCtx(over = {}) {
  return {
    now: new Date(),
    version: "1.2.0",
    schemaVersion: 8,
    nodeVersion: process.version,
    uptimeSeconds: 42,
    bancoOk: true,
    telegram: { enabled: true, hasKey: true },
    email: { transporte: "mock", contasAtivas: 0 },
    voice: { habilitado: true, tts: "browser" },
    skills: { dir: "/tmp/hub", present: true, total: 4, version: "1.2.1-builtin", source: "builtin", reason: null },
    providers: { ollama: { enabled: true, hasKey: false, model: "qwen2.5:7b", endpoint: "interno" } },
    integracoes: { context7: { enabled: true, hasKey: false, endpoint: "interno" } },
    // Navegador habilitado em modo local: o inventário de referência deve refletir um sistema
    // operacional (o caso "desligado" tem teste próprio abaixo).
    browser: { enabled: true, mode: "local", endpoint: null, hasToken: false },
    expostas: [
      "web_search", "fetch_url", "remember", "recall", "run_command", "cli_agent",
      "document_search", "rea_analyze", "send_email", "context7_docs",
      "gigabrain_recall", "gigabrain_remember",
    ],
    expostasAtivas: [
      "web_search", "fetch_url", "remember", "recall", "run_command", "cli_agent",
      "document_search", "rea_analyze", "send_email", "context7_docs",
      "gigabrain_recall", "gigabrain_remember",
    ],
    usaTemplate: false,
    counts: {
      conversas: 1, mensagens: 2, memorias: 3, agentes: 1, agentesAtivos: 1,
      bots: 0, runs: 0, documentos: 0, auditoria: 10, sessoesAtivas: 1, tokensAtivos: 0,
      jobsExpurgo: 0, aprovacoesPendentes: 0, aprovacoesResolvidas: 0, aprovacoesOutras: 0,
    },
    execucaoProvedor: null,
    ultimaAprovacaoDone: null,
    ...over,
  };
}
const porId = (inv, id) => inv.itens.find((i) => i.id === id);
const clonaItem = (id) => JSON.parse(JSON.stringify(porId(buildInventory(mkCtx()), id)));

// ---------------------------------------------------------------------------
// Registro de ferramentas e coerência de permissões
// ---------------------------------------------------------------------------

test("registro de diagnóstico cobre exatamente as ferramentas reais de server/tools.js", () => {
  assert.deepEqual(Object.keys(TOOL_META).sort(), Object.keys(TOOL_DEFS).sort());
  assert.equal(Object.keys(TOOL_DEFS).length, 21); // + browser_action, agentmail_read_email, agentmail_send_email
});

test("permissões: TOOL_SCOPES coerente com TOOL_DEFS e nunca admin-only", () => {
  assert.deepEqual(Object.keys(TOOL_SCOPES).sort(), Object.keys(TOOL_DEFS).sort());
  for (const [ferramenta, escopo] of Object.entries(TOOL_SCOPES)) {
    assert.ok(SCOPES.includes(escopo), `${ferramenta} usa escopo inexistente ${escopo}`);
    assert.ok(!ADMIN_ONLY.includes(escopo), `${ferramenta} não pode exigir escopo admin-only`);
  }
});

test("inventário de referência valida e cobre ferramentas, acessos, automações e dados", () => {
  const inv = buildInventory(mkCtx());
  assert.deepEqual(validateInventory(inv), []);
  const ids = new Set(inv.itens.map((i) => i.id));
  for (const t of Object.keys(TOOL_DEFS)) assert.ok(ids.has(`tool:${t}`), `falta tool:${t}`);
  for (const id of [
    "servico:api", "servico:banco", "servico:skills-hub", "acesso:sessao-admin", "acesso:token-servico",
    "auto:fila-aprovacoes", "auto:expurgo-drec", "dados:memorias", "dados:auditoria",
    "integracao:email-envio", "integracao:voz", "integracao:navegador",
  ]) assert.ok(ids.has(id), `falta ${id}`);
  assert.equal(inv.resumo.saude, "ok");
});

test("navegador: desligado é reportado como INDISPONÍVEL com motivo (não finge capacidade)", () => {
  const inv = buildInventory(
    mkCtx({ browser: { enabled: false, mode: "off", endpoint: null, hasToken: false } }),
  );
  const item = porId(inv, "integracao:navegador");
  assert.equal(item.estado, "INDISPONÍVEL");
  assert.equal(item.detalhes.modo, "off");
  assert.ok(item.limitacoes.some((l) => /Desligado/i.test(l)));
});

test("skills hub: catálogo ausente marca INDISPONÍVEL com o motivo (transparência, não finge disponibilidade)", () => {
  const inv = buildInventory(
    mkCtx({ skills: { dir: "/x", present: false, total: 0, version: null, source: null, reason: "catalog_missing" } }),
  );
  const item = porId(inv, "servico:skills-hub");
  assert.equal(item.estado, "INDISPONÍVEL");
  assert.equal(item.detalhes.motivo, "catalog_missing");
  assert.ok(item.limitacoes.some((l) => /sem catálogo/i.test(l)));
  assert.notEqual(inv.resumo.saude, "ok", "hub vazio degrada a saúde do diagnóstico");
});

// ---------------------------------------------------------------------------
// Estados: derivação com evidência, desconhecidos e expiração
// ---------------------------------------------------------------------------

test("estado por evidência: exposta+teste=TESTADO; exposta sem teste=NÃO TESTADO; sem consumidor=INDISPONÍVEL", () => {
  const inv = buildInventory(mkCtx());
  assert.equal(porId(inv, "tool:run_command").estado, "TESTADO");
  assert.equal(porId(inv, "tool:context7_docs").estado, "NÃO TESTADO");
  assert.equal(porId(inv, "tool:read_email").estado, "INDISPONÍVEL");
  assert.ok(porId(inv, "tool:read_email").limitacoes.some((l) => l.includes("Não exposta")));
  assert.equal(porId(inv, "tool:send_message").flags.habilitado, false);
});

test("execução recente eleva a OPERACIONAL; evidência antiga NÃO (expira em 30 dias)", () => {
  const recenteInv = buildInventory(mkCtx({ ultimaAprovacaoDone: iso(Date.now() - 3 * DIA) }));
  assert.equal(porId(recenteInv, "tool:run_command").estado, "OPERACIONAL");
  assert.equal(porId(recenteInv, "auto:fila-aprovacoes").estado, "OPERACIONAL");

  const antigo = buildInventory(mkCtx({ ultimaAprovacaoDone: iso(Date.now() - 60 * DIA) }));
  assert.equal(porId(antigo, "tool:run_command").estado, "TESTADO");
  assert.equal(porId(antigo, "auto:fila-aprovacoes").estado, "TESTADO");
  assert.ok(porId(antigo, "tool:run_command").evidencias.some((e) => e.metodo === "execucao"), "evidência antiga permanece visível");
});

test("provedor local: OPERACIONAL só com resposta real recente; caso contrário HABILITADO", () => {
  const comUso = buildInventory(mkCtx({ execucaoProvedor: iso(Date.now() - 1 * DIA) }));
  assert.equal(porId(comUso, "provedor:ollama").estado, "OPERACIONAL");
  const semUso = buildInventory(mkCtx());
  assert.equal(porId(semUso, "provedor:ollama").estado, "HABILITADO");
  assert.equal(porId(semUso, "provedor:ollama").flags.habilitado, true);
});

test("Zen bloqueado exige evidência de bloqueio; OmniRoute sem chave é limitação registrada", () => {
  const inv = buildInventory(mkCtx({
    providers: { opencode_go: { enabled: true, hasKey: true, model: null, endpoint: "externo" } },
  }));
  const zen = porId(inv, "provedor:opencode_go");
  assert.equal(zen.estado, "BLOQUEADO");
  assert.ok(zen.evidencias.some((e) => e.metodo === "documento"));
  const omni = porId(inv, "provedor:omniroute");
  assert.equal(omni.estado, "INDISPONÍVEL");
  assert.ok(omni.limitacoes.some((l) => l.includes("limitação conhecida")));
});

// ---------------------------------------------------------------------------
// Validador: estados contraditórios são rejeitados
// ---------------------------------------------------------------------------

test("validador rejeita OPERACIONAL sem execução recente", () => {
  const it = clonaItem("tool:run_command");
  it.estado = "OPERACIONAL";
  assert.ok(validateItem(it).some((v) => v.includes("OPERACIONAL exige execução recente")));
  it.estado = "TESTADO";
  it.evidencias.push({ metodo: "execucao", ref: "x", data: iso(Date.now() - 60 * DIA) });
  it.estado = "OPERACIONAL";
  assert.ok(validateItem(it).some((v) => v.includes("OPERACIONAL exige execução recente")), "execução velha não vale como OPERACIONAL");
});

test("validador rejeita evidência sem referência e execução sem data", () => {
  const it = clonaItem("tool:run_command");
  it.evidencias.push({ metodo: "config", ref: "", data: null });
  assert.ok(validateItem(it).some((v) => v.includes("sem referência")));
  it.evidencias.push({ metodo: "execucao", ref: "registro", data: null });
  assert.ok(validateItem(it).some((v) => v.includes("execução sem data")));
});

test("validador rejeita flag habilitado/testado sem implementado e divergência de código", () => {
  const divergente = clonaItem("tool:run_command");
  divergente.flags.implementado = false;
  assert.ok(validateItem(divergente).some((v) => v.includes("divergente")));

  const semCodigo = clonaItem("tool:run_command");
  semCodigo.evidencias = semCodigo.evidencias.filter((e) => e.metodo !== "codigo");
  semCodigo.flags.implementado = false;
  semCodigo.estado = "IMPLEMENTADO";
  const v = validateItem(semCodigo);
  assert.ok(v.some((x) => x.includes("habilitado sem implementado")));
  assert.ok(v.some((x) => x.includes("testado sem implementado")));
});

test("validador rejeita DESCONHECIDO com evidência e NÃO TESTADO com teste", () => {
  const desconhecido = clonaItem("tool:run_command");
  desconhecido.estado = "DESCONHECIDO";
  assert.ok(validateItem(desconhecido).some((v) => v.includes("DESCONHECIDO não pode ter evidências")));

  const naoTestado = clonaItem("tool:run_command");
  naoTestado.estado = "NÃO TESTADO";
  assert.ok(validateItem(naoTestado).some((v) => v.includes("NÃO TESTADO incompatível")));

  const semLimitacao = clonaItem("tool:read_email");
  semLimitacao.limitacoes = [];
  assert.ok(validateItem(semLimitacao).some((v) => v.includes("INDISPONÍVEL exige limitação")));
});

test("validador de inventário rejeita ids duplicados", () => {
  const inv = buildInventory(mkCtx());
  inv.itens.push(JSON.parse(JSON.stringify(inv.itens[0])));
  assert.ok(validateInventory(inv).some((v) => v.includes("id duplicado")));
});

test("estados e métodos permitidos são os aprovados no dossiê", () => {
  assert.deepEqual(ESTADOS, ["OPERACIONAL", "HABILITADO", "TESTADO", "IMPLEMENTADO", "NÃO TESTADO", "BLOQUEADO", "INDISPONÍVEL", "DESCONHECIDO"]);
  assert.deepEqual(METODOS, ["codigo", "config", "teste", "execucao", "documento"]);
  assert.equal(classificaEndpoint("http://servico-interno:8080/v1"), "interno");
  assert.equal(classificaEndpoint("http://192.168.2.40:8090"), "interno");
  assert.equal(classificaEndpoint("https://api.exemplo.com/v1"), "externo");
  assert.equal(classificaEndpoint(""), null);
});

// ---------------------------------------------------------------------------
// Segredos, URLs internas e isolamento por proprietário (banco real, isolado)
// ---------------------------------------------------------------------------

let adminId = null;
let adminB = null;

test("sem segredos, tokens, chatId ou URLs internas no inventário real", async () => {
  const { token } = auth.ensureBootstrap();
  const a = auth.setupFirstAdmin({ token, username: "ana", password: PW });
  adminId = a.id;
  updateSettings({
    providers: { opencode_go: { enabled: true, apiKey: "sk-FAKE-SECRET-999", model: "zen-max" } },
    comms: { telegram: { enabled: true, botToken: "9999:FAKE-TOKEN", chatId: 987654321 } },
  }, { adminId });
  updateSettings({
    integrations: { context7: { enabled: true, command: "http://internal-secr3t-host:9999/rpc", kind: "http" } },
  }, { adminId, allowGlobal: true });

  const inv = collectDiagnostics({ adminId, version: "1.2.0" });
  assert.deepEqual(validateInventory(inv), []);
  const txt = JSON.stringify(inv);
  for (const proibido of ["sk-FAKE-SECRET-999", "9999:FAKE-TOKEN", "987654321", "internal-secr3t-host", "9999"]) {
    assert.ok(!txt.includes(proibido), `vazou para o inventário: ${proibido}`);
  }
  assert.ok(txt.includes("chave configurada"), "booleano seguro de chave ausente");
  assert.equal(porId(inv, "provedor:opencode_go").estado, "BLOQUEADO");
  assert.equal(porId(inv, "acesso:canal-telegram").flags.habilitado, true);
  // nenhuma sonda automática: nada fica OPERACIONAL sem execução local real
  assert.ok(!porId(inv, "integracao:context7").estado.includes("OPERACIONAL"));
});

test("diagnóstico não faz nenhuma chamada de rede", () => {
  const original = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = () => {
    chamadas += 1;
    throw new Error("rede proibida no diagnóstico");
  };
  try {
    const inv = collectDiagnostics({ adminId, version: "1.2.0" });
    assert.ok(inv.itens.length >= 15);
    assert.equal(chamadas, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("inventário não contém URL, e-mail nem ciphertext (invariante geral)", () => {
  const txt = JSON.stringify(collectDiagnostics({ adminId, version: "1.2.0" }));
  assert.doesNotMatch(txt, /https?:\/\//i, "nenhuma URL pode aparecer no payload");
  assert.doesNotMatch(txt, /enc:/, "nenhum valor cifrado pode aparecer no payload");
  assert.doesNotMatch(txt, /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i, "nenhum e-mail pode aparecer no payload");
});

test("isolamento: contagens do próprio administrador e nenhum dado do outro", () => {
  const b = auth.createAdmin({ adminId }, { username: "bia", password: "outra-senha-bem-forte-2", currentPassword: PW });
  adminB = b.id;
  const t = iso(Date.now() - 2 * DIA);

  db.prepare("INSERT INTO memories (id, content, created_at) VALUES (?, ?, ?)").run("mem-ana-1", "nota da ana um", t);
  db.prepare("INSERT INTO memories (id, content, created_at) VALUES (?, ?, ?)").run("mem-ana-2", "nota da ana dois", t);
  assignNew("memory", "mem-ana-1", adminId);
  assignNew("memory", "mem-ana-2", adminId);

  db.prepare("INSERT INTO memories (id, content, created_at) VALUES (?, ?, ?)").run("mem-bia-1", "segredo-bia-xyz", t);
  assignNew("memory", "mem-bia-1", adminB);
  db.prepare("INSERT INTO conversations (id, admin_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("conv-bia", adminB, "conversa da bia", t, t);
  db.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)").run("msg-bia-1", "conv-bia", "resposta-bia-segredo", t);
  updateSettings({ comms: { telegram: { enabled: true, botToken: "7777:BIA-SECRET" } } }, { adminId: adminB });

  const inv = collectDiagnostics({ adminId, version: "1.2.0" });
  assert.equal(porId(inv, "dados:memorias").detalhes.registros, 2, "conta só as memórias da ana");
  assert.equal(porId(inv, "dados:conversas").detalhes.conversas, 0, "conversa da bia não aparece");

  const txt = JSON.stringify(inv);
  for (const proibido of ["segredo-bia-xyz", "resposta-bia-segredo", "7777:BIA-SECRET", "conversa da bia"]) {
    assert.ok(!txt.includes(proibido), `vazou dado de outro administrador: ${proibido}`);
  }
});

// ---------------------------------------------------------------------------
// Rota HTTP: sessão administrativa apenas
// ---------------------------------------------------------------------------

let server, base, sessao;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const req = (path, { method = "GET", body, cookie, csrf, bearer, origin = ORIGIN } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-jarvis-csrf": csrf } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

test("rota de diagnóstico é registrada somente com acesso de sessão", () => {
  const rotas = routeTable().filter((r) => r.pattern === "/api/diagnostics");
  assert.equal(rotas.length, 1);
  assert.equal(rotas[0].method, "GET");
  assert.equal(rotas[0].access, "session");
});

test("login administrativo estabelece a sessão da suíte", async () => {
  const r = await req("/api/auth/login", { method: "POST", body: { username: "ana", password: PW } });
  assert.equal(r.status, 200);
  const { csrf } = await r.json();
  sessao = { cookie: r.headers.get("set-cookie").split(";")[0], csrf };
});

test("anônimo não acessa o diagnóstico", async () => {
  const r = await req("/api/diagnostics");
  assert.equal(r.status, 401);
  const body = await r.json();
  assert.equal(body.itens, undefined);
});

test("token de serviço não acessa o diagnóstico", async () => {
  const mk = await req("/api/auth/tokens", { method: "POST", body: { name: "diag", scopes: ["chat"] }, cookie: sessao.cookie, csrf: sessao.csrf });
  assert.equal(mk.status, 200);
  const { token } = await mk.json();
  const r = await req("/api/diagnostics", { bearer: token });
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.equal(body.itens, undefined);
  assert.equal(body.error, "forbidden");
});

test("sessão administrativa recebe o inventário, sem segredos", async () => {
  const r = await req("/api/diagnostics", { cookie: sessao.cookie });
  assert.equal(r.status, 200);
  const inv = await r.json();
  assert.ok(Array.isArray(inv.itens) && inv.itens.length >= 15);
  assert.ok(Array.isArray(inv.riscos) && Array.isArray(inv.decisoesHumanas));
  const txt = JSON.stringify(inv);
  for (const proibido of ["sk-FAKE-SECRET-999", "9999:FAKE-TOKEN", "internal-secr3t-host"]) {
    assert.ok(!txt.includes(proibido), `vazou pela rota: ${proibido}`);
  }
});

test("diagnóstico não oferece mutação (POST não registrado)", async () => {
  const r = await req("/api/diagnostics", { method: "POST", body: {}, cookie: sessao.cookie, csrf: sessao.csrf });
  assert.equal(r.status, 404);
});
