// Ações externas passam por aprovação vinculada à operação concreta:
//   - `openhands_task` e `send_message` NÃO executam nada antes da aprovação;
//   - a aprovação é consumida uma única vez e não autoriza outra operação;
//   - mudanças de destino/conteúdo (ou desabilitar o canal/integração) invalidam a aprovação.
// Nenhuma mensagem real é enviada: o `fetch` global é substituído por um duplo controlado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "jarvis-appr-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { callTool, resolveApproval } = await import("../server/tools.js");
const { updateSettings, getSettings } = await import("../server/settings.js");
const { describeSend, sendFingerprint } = await import("../server/comms.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let admin, principal, stub, stubPort, stubHits, server, base;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  // Sessão real: só `validateSession` produz um principal "verificado" (anti-forja por WeakMap).
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ username: "ana", password: PW }),
  });
  assert.equal(r.status, 200);
  const sid = r.headers.get("set-cookie").split(";")[0].split("=")[1];
  principal = auth.validateSession(sid);
  assert.ok(principal, "sessão válida");
  admin = db.prepare("SELECT id, username FROM admins WHERE active=1").get();
  stubHits = [];
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      stubHits.push({ url: req.url, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ conversation_id: "conv-1", status: "running" }));
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  stubPort = stub.address().port;
  // Ações no host habilitadas (o portão do openhands/send_message é outro).
  updateSettings({ host: { enabled: true } }, { adminId: admin.id, allowGlobal: true });
});

after(async () => {
  await new Promise((r) => stub.close(r));
  await new Promise((r) => server.close(r));
});

const ctx = () => ({ autonomy: "confirm", pending: [], principal });
const setOpenhands = (enabled, port = stubPort) =>
  updateSettings(
    { integrations: { openhands: { enabled, kind: "http", command: `http://127.0.0.1:${port}` } } },
    { adminId: admin.id, allowGlobal: true },
  );

// ---------------------------------------------------------------- openhands_task
test("openhands_task: integração desabilitada é recusada sem aprovação e sem requisição", async () => {
  setOpenhands(false);
  const c = ctx();
  const out = await callTool("openhands_task", { task: "faça algo" }, c);
  assert.match(out, /não está habilitada/);
  assert.equal(c.pending.length, 0);
  assert.equal(stubHits.length, 0);
});

test("openhands_task: NADA é enviado antes da aprovação; aprovar executa exatamente uma vez", async () => {
  setOpenhands(true);
  const before = db.prepare("SELECT COUNT(*) n FROM approvals").get().n;
  const c = ctx();
  const out = await callTool("openhands_task", { task: "tarefa A" }, c);
  assert.match(out, /aprovação/);
  assert.equal(c.pending.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM approvals").get().n, before + 1);
  assert.equal(
    db.prepare("SELECT status FROM approvals WHERE id=?").get(c.pending[0].id).status,
    "pending",
  );
  assert.equal(stubHits.length, 0, "nenhuma requisição antes da aprovação");

  const r = await resolveApproval(c.pending[0].id, true, principal);
  assert.match(r.output, /conversation_id/);
  assert.equal(stubHits.length, 1);
  assert.match(stubHits[0].body, /tarefa A/);
  assert.equal(
    db.prepare("SELECT status FROM approvals WHERE id=?").get(c.pending[0].id).status,
    "done",
  );
});

test("openhands_task: a mesma aprovação não pode ser consumida duas vezes", async () => {
  setOpenhands(true);
  const c = ctx();
  await callTool("openhands_task", { task: "tarefa B" }, c);
  await resolveApproval(c.pending[0].id, true, principal);
  const hitsAfter = stubHits.length;
  await assert.rejects(() => resolveApproval(c.pending[0].id, true, principal), {
    code: "already_resolved",
  });
  assert.equal(stubHits.length, hitsAfter, "replay não executa de novo");
});

test("openhands_task: uma aprovação não autoriza outra tarefa", async () => {
  setOpenhands(true);
  const c = ctx();
  await callTool("openhands_task", { task: "tarefa C" }, c);
  await resolveApproval(c.pending[0].id, true, principal);
  const sentC = stubHits.at(-1).body;
  assert.match(sentC, /tarefa C/);
  assert.doesNotMatch(sentC, /tarefa D/);
  // A tarefa D só é enviada depois de uma NOVA aprovação.
  const c2 = ctx();
  await callTool("openhands_task", { task: "tarefa D" }, c2);
  assert.notEqual(c2.pending[0].id, c.pending[0].id);
  assert.equal(stubHits.at(-1).body.includes("tarefa D"), false);
  await resolveApproval(c2.pending[0].id, true, principal);
  assert.match(stubHits.at(-1).body, /tarefa D/);
});

test("openhands_task: negar não envia nada", async () => {
  setOpenhands(true);
  const c = ctx();
  await callTool("openhands_task", { task: "tarefa E" }, c);
  const hits = stubHits.length;
  const r = await resolveApproval(c.pending[0].id, false, principal);
  assert.match(r.output, /Negado/);
  assert.equal(stubHits.length, hits);
  assert.equal(
    db.prepare("SELECT status FROM approvals WHERE id=?").get(c.pending[0].id).status,
    "denied",
  );
});

test("openhands_task: desabilitar a integração após o pedido invalida a aprovação", async () => {
  setOpenhands(true);
  const c = ctx();
  await callTool("openhands_task", { task: "tarefa F" }, c);
  const hits = stubHits.length;
  setOpenhands(false);
  const r = await resolveApproval(c.pending[0].id, true, principal);
  assert.match(r.output, /desabilitada/);
  assert.equal(stubHits.length, hits, "nada foi enviado após a integração ser desabilitada");
  setOpenhands(true);
});

// ---------------------------------------------------------------- send_message
test("send_message: canal não configurado permanece inócuo, sem aprovação", async () => {
  const c = ctx();
  const out = await callTool("send_message", { channel: "telegram", text: "oi" }, c);
  assert.match(out, /não habilitado/);
  assert.equal(c.pending.length, 0);
});

test("send_message: canal habilitado sem destinatário é inócuo", async () => {
  updateSettings(
    { comms: { telegram: { enabled: true, botToken: "x" } } },
    { adminId: admin.id, allowGlobal: false },
  );
  const c = ctx();
  const out = await callTool("send_message", { channel: "telegram", text: "oi" }, c);
  assert.match(out, /sem destinatário/);
  assert.equal(c.pending.length, 0);
});

test("send_message: nada é enviado antes da aprovação; aprovar envia uma vez", async () => {
  updateSettings(
    { comms: { telegram: { enabled: true, botToken: "token-de-teste", chatId: "999" } } },
    { adminId: admin.id, allowGlobal: false },
  );
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body });
    return { ok: true, status: 200, text: async () => "{}" };
  };
  try {
    const c = ctx();
    const out = await callTool(
      "send_message",
      { channel: "telegram", text: "mensagem de teste" },
      c,
    );
    assert.match(out, /aprovação/);
    assert.equal(c.pending.length, 1);
    assert.equal(calls.length, 0, "nenhum envio antes da aprovação");
    const r = await resolveApproval(c.pending[0].id, true, principal);
    assert.match(r.output, /Enviado/);
    assert.equal(calls.length, 1);
    assert.match(String(calls[0].body), /mensagem de teste/);
    assert.match(calls[0].url, /api\.telegram\.org/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("send_message: negar não envia", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls.push(1);
    return { ok: true, status: 200, text: async () => "{}" };
  };
  try {
    const c = ctx();
    await callTool("send_message", { channel: "telegram", text: "não deve sair" }, c);
    await resolveApproval(c.pending[0].id, false, principal);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("send_message: mudar o destinatário após o pedido invalida a aprovação", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls.push(1);
    return { ok: true, status: 200, text: async () => "{}" };
  };
  try {
    const c = ctx();
    await callTool("send_message", { channel: "telegram", text: "conteudo original" }, c);
    // O destinatário muda entre o pedido e a aprovação.
    updateSettings(
      { comms: { telegram: { enabled: true, botToken: "token-de-teste", chatId: "111" } } },
      { adminId: admin.id, allowGlobal: false },
    );
    const r = await resolveApproval(c.pending[0].id, true, principal);
    assert.match(r.output, /mudou desde a aprovação|alterado desde a aprovação|desabilitado/);
    assert.equal(calls.length, 0, "nada é enviado quando o destino mudou");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("send_message: canal signal está desabilitado (executor estruturado pendente)", async () => {
  const c = ctx();
  const out = await callTool("send_message", { channel: "signal", text: "oi" }, c);
  assert.match(out, /signal desabilitado/i);
  assert.equal(c.pending.length, 0, "não cria aprovação para canal sem executor estruturado");
  assert.equal(describeSend(admin.id, "signal", "x").ok, false);
});

test("send_message: a impressão digital cobre canal, destinatário e texto", () => {
  const base = { channel: "telegram", destination: "999", text: "a" };
  assert.equal(sendFingerprint(base), sendFingerprint({ ...base }));
  assert.notEqual(sendFingerprint(base), sendFingerprint({ ...base, destination: "111" }));
  assert.notEqual(sendFingerprint(base), sendFingerprint({ ...base, text: "b" }));
  assert.notEqual(sendFingerprint(base), sendFingerprint({ ...base, channel: "signal" }));
  assert.equal(describeSend(admin.id, "inexistente", "x").ok, false);
  assert.equal(getSettings(admin.id).comms.telegram.chatId, "111");
});
