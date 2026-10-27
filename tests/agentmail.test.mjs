// AgentMail server-side: webhook Svix (message.received), persistência de metadados, client v0
// (sem segredo na saída) e ferramentas agentmail_* com D9 (envio só após aprovação humana).
// Banco TEMPORÁRIO (JARVIS_DATA_DIR): nunca toca o banco ativo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "jarvis-agentmail-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
delete process.env.AGENTMAIL_API_KEY;
delete process.env.AGENTMAIL_WEBHOOK_SECRET;

const { db, auth } = await import("../server/db.js");
const { createApp, routeTable } = await import("../server/index.js");
const { updateSettings } = await import("../server/settings.js");
const {
  verifySvixSignature,
  agentMailConfig,
  describeAgentMailSend,
  agentMailSendFingerprint,
  setAgentMailClientFactory,
  listAgentMailEvents,
} = await import("../server/agentmail.js");
const { TOOL_SCOPES } = await import("../server/auth.js");
const { ownerOf } = await import("../server/ownership.js");
const { callTool, resolveApproval } = await import("../server/tools.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let server, base, principal, S;

const req = (path, { method = "GET", body, raw, headers = {}, cookie, csrf } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-jarvis-csrf": csrf } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });

// ---------- helpers Svix ----------
const SECRET = "whsec_MfKQ9r8GKYqrqwjSHUWO33p3PUxWtgA8rGkOS7vGvq8_linux"; // qualquer base64
const SIGN_SECRET = SECRET.replace(/^whsec_/, "");
const sign = (id, ts, payload) =>
  `v1,${createHmac("sha256", Buffer.from(SIGN_SECRET, "base64")).update(`${id}.${ts}.${payload}`, "utf8").digest("base64")}`;
const envelope = (id, ts, payload, extra = {}) => ({
  headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": sign(id, ts, payload), ...extra },
});
const eventPayload = (inboxId = "kayra@agentmail.to", body = "corpo-que-NUNCA-pode-ir-ao-banco") =>
  JSON.stringify({
    type: "event",
    event_type: "message.received",
    event_id: "evt_test_1",
    message: {
      inbox_id: inboxId,
      thread_id: "thd_test_1",
      message_id: "msg_test_1",
      from: "Remetente <remetente@exemplo.test>",
      to: [inboxId],
      subject: "Chegada de teste",
      extracted_text: body,
      created_at: new Date().toISOString(),
    },
  });

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const r = await req("/api/auth/login", { method: "POST", body: { username: "ana", password: PW } });
  const j = await r.json();
  S = { cookie: r.headers.get("set-cookie").split(";")[0], csrf: j.csrf };
  const me = await req("/api/auth/me", { cookie: S.cookie });
  principal = (await me.json()).admin ? await (async () => auth.validateSession(S.cookie.split("=")[1]))() : null;
  assert.ok(principal, "sessão viva");
});
after(async () => {
  await new Promise((r) => server.close(r));
  setAgentMailClientFactory(null);
});

const setAgentMail = (cfg = {}) =>
  updateSettings(
    { integrations: { agentmail: { enabled: true, apiKey: "am_test_key", webhookSecret: SECRET, inboxId: "kayra@agentmail.to", ...cfg } } },
    { adminId: principal.adminId, allowGlobal: true },
  );

test("migração v13: tabela agentmail_events existe e o hook de rota raw é registrado", () => {
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agentmail_events'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agentmail_inboxes'").get());
  const table = routeTable();
  assert.ok(table.some((r) => r.pattern === "/api/integrations/agentmail/webhook" && r.access === "public"));
  assert.ok(table.some((r) => r.pattern === "/api/integrations/agentmail/status" && r.access === "session"));
});

test("verifySvixSignature: matriz", () => {
  const payload = eventPayload();
  const ts = String(Math.floor(Date.now() / 1000));
  const good = envelope("msg_1", ts, payload);
  assert.equal(verifySvixSignature(Buffer.from(payload), good.headers, SECRET), true, "assinatura válida");
  assert.equal(verifySvixSignature(Buffer.from(payload + "x"), good.headers, SECRET), false, "corpo alterado");
  assert.equal(verifySvixSignature(Buffer.from(payload), { ...good.headers, "svix-signature": "v1,zzz" }, SECRET), false, "assinatura lixo");
  assert.equal(verifySvixSignature(Buffer.from(payload), good.headers, "whsec_chave_errada"), false, "segredo errado");
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  const stale = envelope("msg_1", old, payload);
  assert.equal(verifySvixSignature(Buffer.from(payload), stale.headers, SECRET), false, "timestamp atrasado");
  const future = String(Math.floor(Date.now() / 1000) + 3600);
  const early = envelope("msg_1", future, payload);
  assert.equal(verifySvixSignature(Buffer.from(payload), early.headers, SECRET), false, "timestamp futuro");
  assert.equal(verifySvixSignature(Buffer.from(payload), {}, SECRET), false, "headers ausentes");
});

test("webhook: fail-closed quando desabilitada (503) e quando secret ausente (503)", async () => {
  let r = await req("/api/integrations/agentmail/webhook", { method: "POST", raw: eventPayload() });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "integration_disabled");

  updateSettings(
    { integrations: { agentmail: { enabled: true, apiKey: "am_test_key" } } },
    { adminId: principal.adminId, allowGlobal: true },
  );
  r = await req("/api/integrations/agentmail/webhook", { method: "POST", raw: eventPayload() });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, "integration_unconfigured");
});

test("webhook: assinatura inválida → 400; válida → 200 + metadados; corpo NUNCA é persistido", async () => {
  setAgentMail(); // enabled + secret
  const payload = eventPayload();
  const ts = String(Math.floor(Date.now() / 1000));
  // Assinatura genuinamente inválida: id sofreu tampering do payload assinado.
  const bad = envelope("msg_invalido", ts, "!corpo-forjado!");
  let r = await req("/api/integrations/agentmail/webhook", {
    method: "POST",
    raw: payload,
    headers: bad.headers,
  });
  assert.equal(r.status, 400);
  r = await req("/api/integrations/agentmail/webhook", {
    method: "POST",
    raw: payload,
    headers: envelope("msg_100", ts, payload).headers,
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.duplicated, false);

  const row = db.prepare("SELECT * FROM agentmail_events WHERE svix_id = 'msg_100'").get();
  assert.ok(row, "evento persistido");
  assert.equal(row.message_id, "msg_test_1");
  assert.equal(row.subject, "Chegada de teste");
  assert.equal(row.event_type, "message.received");
  const cols = db.prepare("PRAGMA table_info(agentmail_events)").all().map((c) => c.name);
  const dump = JSON.stringify(row).toLowerCase();
  assert.equal(dump.includes("corpo-que-nunca"), false, "corpo do e-mail jamais no banco");
  assert.equal(cols.some((c) => /body|text|content|html/i.test(c)), false, "nenhuma coluna de conteúdo");
});

test("webhook: dedupe pelo svix-id (retry do provider não reprocessa)", async () => {
  const payload = eventPayload();
  const ts = String(Math.floor(Date.now() / 1000));
  const r = await req("/api/integrations/agentmail/webhook", {
    method: "POST",
    raw: payload,
    headers: envelope("msg_100", ts, payload).headers, // mesmo id do teste anterior
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).duplicated, true);
  const n = db.prepare("SELECT COUNT(*) AS n FROM agentmail_events WHERE svix_id = 'msg_100'").get().n;
  assert.equal(n, 1);
});

test("inbox: reivindicação exige confirmação; eventos são visíveis só pelo proprietário", async () => {
  setAgentMail();
  const path = "/api/integrations/agentmail/inbox/claim";
  let r = await req(path, { method: "POST", body: {}, cookie: S.cookie, csrf: S.csrf });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "confirmation_required");
  r = await req(path, { method: "POST", body: { confirm: "ASSUMIR" }, cookie: S.cookie, csrf: S.csrf });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).alreadyOwned, false);
  assert.equal(ownerOf("agentmail_inbox", "kayra@agentmail.to"), principal.adminId);
  assert.equal(listAgentMailEvents({ adminId: principal.adminId }).length, 1);
  assert.equal(listAgentMailEvents({ adminId: "outro-admin" }).length, 0);

  r = await req("/api/integrations/agentmail/events", { cookie: S.cookie });
  assert.equal(r.status, 200);
  const events = await r.json();
  assert.equal(events.events.length, 1);
  assert.equal(events.events[0].svix_id, "msg_100");
});

test("ferramentas: escopos declarados; leitura exige integração habilitada", async () => {
  assert.equal(TOOL_SCOPES.agentmail_read_email, "comms:read");
  assert.equal(TOOL_SCOPES.agentmail_send_email, "comms:send");

  updateSettings(
    { integrations: { agentmail: { enabled: false } } },
    { adminId: principal.adminId, allowGlobal: true },
  );
  const ctx = () => ({ autonomy: "confirm", pending: [], principal });
  const out = await callTool("agentmail_read_email", {}, ctx());
  assert.match(out, /não está habilitada/);

  setAgentMail();
  const calls = [];
  setAgentMailClientFactory(() => ({
    kind: "agentmail",
    listInboxes: async () => ({ count: 1, inboxes: [{ inbox_id: "kayra@agentmail.to" }] }),
    listMessages: async (inboxId, { limit }) => {
      calls.push({ inboxId, limit });
      return { count: 1, messages: [
        { timestamp: "2026-10-27T10:00:00Z", from: "Alguém <alguem@exemplo.test>", subject: "Assunto injetado" },
      ] };
    },
  }));
  const out2 = await callTool("agentmail_read_email", { limit: 5 }, ctx());
  assert.match(out2, /DADO NÃO CONFIÁVEL/);
  assert.deepEqual(calls, [{ inboxId: "kayra@agentmail.to", limit: 5 }]);
});

test("envio por agente: D9 — enfileira aprovação; resolveApproval envia com revalidação", async () => {
  setAgentMail();
  const sent = [];
  setAgentMailClientFactory(() => ({
    kind: "agentmail",
    sendMessage: async (inboxId, outgoing) => {
      sent.push({ inboxId, outgoing });
      return { message_id: "<msg-provider@agentmail.to>", thread_id: "thd_x" };
    },
  }));
  const ctx = () => ({ autonomy: "confirm", pending: [], principal });
  const out = await callTool(
    "agentmail_send_email",
    { to: "laytech.ia@gmail.com", subject: "Teste server-side", body: "Conteúdo conferido" },
    ctx(),
  );
  assert.match(out, /Nada foi enviado/);
  assert.equal(sent.length, 0, "nenhum envio direto");

  // O kind vive no JSON de approval_actions (a tabela approvals não tem coluna kind).
  const approvals = db
    .prepare(
      `SELECT a.id, a.command, json_extract(x.action, '$.kind') AS kind
       FROM approvals a JOIN approval_actions x ON x.approval_id = a.id
       WHERE a.status = 'pending' ORDER BY a.created_at DESC`,
    )
    .all();
  const mine = approvals.find((a) => a.kind === "agentmail_send");
  assert.ok(mine, "aprovação pendente criada");

  // Aprovação humana → executor roda e envia de fato com a config do momento.
  const res = await resolveApproval(mine.id, true, principal);
  assert.equal(res.status, "done");
  assert.match(res.output, /Enviado via AgentMail/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].outgoing.subject, "Teste server-side");

  // Aprovação com config posterior diferente → denegada (fail-closed), nada enviado.
  const outDeny = await callTool("agentmail_send_email", { to: "x@y.test", subject: "Porta", body: "b" }, ctx());
  const pending = db.prepare("SELECT id FROM approvals WHERE status='pending' AND command LIKE '%x@y.test%'").get();
  updateSettings({ integrations: { agentmail: { enabled: false } } }, { adminId: principal.adminId, allowGlobal: true });
  const res2 = await resolveApproval(pending.id, true, principal);
  assert.equal(res2.status, "denied");
  assert.equal(sent.length, 1);

  setAgentMail();
  const outInbox = await callTool("agentmail_send_email", { to: "x@y.test", subject: "Inbox", body: "b" }, ctx());
  assert.match(outInbox, /Nada foi enviado/);
  const pendingInbox = db.prepare("SELECT id FROM approvals WHERE status='pending' AND command LIKE '%x@y.test%'").get();
  updateSettings({ integrations: { agentmail: { inboxId: "outra@agentmail.to" } } }, { adminId: principal.adminId, allowGlobal: true });
  const resInbox = await resolveApproval(pendingInbox.id, true, principal);
  assert.equal(resInbox.status, "denied");
  assert.equal(sent.length, 1, "troca da inbox invalida aprovação antiga");
});

test("describeAgentMailSend/agentMailConfig: precedência settings > env; sem key desabilita", () => {
  const prev = process.env.AGENTMAIL_API_KEY;
  process.env.AGENTMAIL_API_KEY = "am_do_ambiente";
  const cfg = agentMailConfig(process.env, { integrations: { agentmail: { enabled: true, apiKey: "am_do_settings" } } });
  assert.equal(cfg.apiKey, "am_do_settings");
  const envcfg = agentMailConfig(process.env, { integrations: { agentmail: { enabled: true } } });
  assert.equal(envcfg.apiKey, "am_do_ambiente");
  const offcfg = agentMailConfig(process.env, { integrations: { agentmail: {} } });
  assert.equal(offcfg.enabled, false, "presença de chave no env NÃO habilita");
  assert.equal(describeAgentMailSend(null, {}).ok, false);
  process.env.AGENTMAIL_API_KEY = prev;
});
