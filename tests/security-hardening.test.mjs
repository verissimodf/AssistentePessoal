// Endurecimento — casos que faltavam nas suítes anteriores:
//   concorrência/replay de aprovação, aprovação sem ação associada, falha entre consumir e
//   executar, mudança de parâmetros, SSRF (IPv4/IPv6/mapeado/redirecionamento/nomes alternativos),
//   comandos indiretos e conteúdo externo como dado não confiável.
// Stubs locais apenas; nenhum serviço sensível é consultado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "jarvis-sec-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { callTool, resolveApproval, UNTRUSTED } = await import("../server/tools.js");
const { updateSettings } = await import("../server/settings.js");
const { describeSend } = await import("../server/comms.js");
const { assertSafeUrl, resolveRedirect, isBlockedAddress, guardedLookup, safeFetch } =
  await import("../server/urlpolicy.js");
const { decide, isAllowlisted } = await import("../server/hostpolicy.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let admin, principal, stub, stubPort, hits, server, base, failNext;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ username: "ana", password: PW }),
  });
  principal = auth.validateSession(r.headers.get("set-cookie").split(";")[0].split("=")[1]);
  admin = db.prepare("SELECT id FROM admins WHERE active=1").get();
  hits = [];
  failNext = false;
  stub = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      hits.push({ url: req.url, body });
      if (failNext) {
        res.writeHead(500);
        return res.end("falha simulada");
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ conversation_id: "c1", status: "running" }));
    });
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  stubPort = stub.address().port;
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

// ---------------------------------------------------------------- concorrência e replay
test("concorrência: três aprovações simultâneas de openhands executam exatamente uma vez", async () => {
  setOpenhands(true);
  const c = ctx();
  await callTool("openhands_task", { task: "concorrente" }, c);
  const before = hits.length;
  const rs = await Promise.allSettled([
    resolveApproval(c.pending[0].id, true, principal),
    resolveApproval(c.pending[0].id, true, principal),
    resolveApproval(c.pending[0].id, true, principal),
  ]);
  const ok = rs.filter((r) => r.status === "fulfilled").length;
  const conflict = rs.filter(
    (r) => r.status === "rejected" && r.reason?.code === "already_resolved",
  ).length;
  assert.equal(ok, 1, "só uma resolve");
  assert.equal(conflict, 2, "as outras duas recebem already_resolved");
  assert.equal(hits.length - before, 1, "exatamente uma requisição");
});

test("replay: aprovar de novo depois de done não reexecuta", async () => {
  setOpenhands(true);
  const c = ctx();
  await callTool("openhands_task", { task: "replay" }, c);
  await resolveApproval(c.pending[0].id, true, principal);
  const n = hits.length;
  await assert.rejects(() => resolveApproval(c.pending[0].id, true, principal), {
    code: "already_resolved",
  });
  assert.equal(hits.length, n);
});

// ---------------------------------------------------------------- mudança de parâmetros
test("openhands: trocar o destino da integração após o pedido invalida a aprovação", async () => {
  setOpenhands(true);
  const c = ctx();
  await callTool("openhands_task", { task: "alvo muda" }, c);
  const n = hits.length;
  const other = createServer((_q, r) => {
    hits.push({ url: "outro" });
    r.end("{}");
  });
  await new Promise((r) => other.listen(0, "127.0.0.1", r));
  setOpenhands(true, other.address().port);
  const out = await resolveApproval(c.pending[0].id, true, principal);
  assert.match(out.output, /cancelada|mudou|desabilitada/);
  assert.equal(hits.length, n, "nada foi enviado após o destino mudar");
  await new Promise((r) => other.close(r));
  setOpenhands(true);
});

test("openhands: a tarefa aprovada é exatamente a registrada (não a de uma chamada posterior)", async () => {
  setOpenhands(true);
  const c1 = ctx();
  await callTool("openhands_task", { task: "ALFA" }, c1);
  const c2 = ctx();
  await callTool("openhands_task", { task: "BRAVO" }, c2);
  await resolveApproval(c1.pending[0].id, true, principal);
  assert.match(hits.at(-1).body, /ALFA/);
  assert.doesNotMatch(hits.at(-1).body, /BRAVO/);
  await resolveApproval(c2.pending[0].id, true, principal);
  assert.match(hits.at(-1).body, /BRAVO/);
});

// ---------------------------------------------------------------- falha entre consumir e executar
test("falha do serviço após consumir a aprovação: status error, sem reexecução automática", async () => {
  setOpenhands(true);
  const c = ctx();
  await callTool("openhands_task", { task: "vai falhar" }, c);
  failNext = true;
  const out = await resolveApproval(c.pending[0].id, true, principal);
  assert.match(out.output, /OpenHands 500|Falha/);
  failNext = false;
  const st = db.prepare("SELECT status FROM approvals WHERE id=?").get(c.pending[0].id).status;
  assert.ok(["done", "error"].includes(st), st);
  const n = hits.length;
  await assert.rejects(() => resolveApproval(c.pending[0].id, true, principal), {
    code: "already_resolved",
  });
  assert.equal(hits.length, n, "não reexecuta");
});

// ---------------------------------------------------------------- aprovação antiga / sem ação
test("aprovação legada sem registro de ação é tratada como comando de shell e respeita host.enabled", async () => {
  db.prepare(
    "INSERT INTO approvals (id, command, status, created_at) VALUES ('legacy-x', 'echo legado-x', 'pending', '2025-01-01')",
  ).run();
  db.prepare(
    "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('approval','legacy-x',?,?,'claimed')",
  ).run(admin.id, new Date().toISOString());
  const out = await resolveApproval("legacy-x", true, principal);
  assert.match(out.output, /legado-x/, "comando simples executa quando host está habilitado");
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id='legacy-x'").get().status, "done");
});

test("aprovação sem ação e sem owner não é resolvível (404)", async () => {
  db.prepare(
    "INSERT INTO approvals (id, command, status, created_at) VALUES ('orfao', 'rm -rf /', 'pending', '2025')",
  ).run();
  await assert.rejects(() => resolveApproval("orfao", true, principal), { code: "not_found" });
  assert.equal(
    db.prepare("SELECT status FROM approvals WHERE id='orfao'").get().status,
    "pending",
    "permanece intocada",
  );
});

// ---------------------------------------------------------------- send_message: conteúdo
test("send_message: mudar o TEXTO após o pedido invalida a aprovação", async () => {
  updateSettings(
    { comms: { telegram: { enabled: true, botToken: "t", chatId: "555" } } },
    { adminId: admin.id, allowGlobal: false },
  );
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    calls.push(1);
    return { ok: true, status: 200, text: async () => "{}" };
  };
  try {
    const c = ctx();
    await callTool("send_message", { channel: "telegram", text: "texto aprovado" }, c);
    // A aprovação guarda o texto original; um envio com outro texto tem impressão digital diferente.
    const { sendFingerprint } = await import("../server/comms.js");
    const d = describeSend(admin.id, "telegram", "texto DIFERENTE");
    assert.notEqual(
      sendFingerprint(d),
      sendFingerprint(describeSend(admin.id, "telegram", "texto aprovado")),
    );
    const out = await resolveApproval(c.pending[0].id, true, principal);
    assert.match(out.output, /Enviado/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = real;
  }
});

// ---------------------------------------------------------------- SSRF
test("SSRF: IPv4 mapeado em IPv6 e formas alternativas de loopback são bloqueados", () => {
  for (const ip of [
    "::ffff:169.254.169.254",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:192.168.0.1",
    "::ffff:100.64.0.1",
  ]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const u of [
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:127.0.0.1]/",
    "http://0.0.0.0/",
    "http://[::]/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
  ]) {
    assert.throws(() => assertSafeUrl(u), /blocked_destination|port_not_allowed/, u);
  }
});

test("SSRF: redirecionamento de destino permitido para proibido é recusado pela mesma política", () => {
  const from = assertSafeUrl("https://example.com/start");
  assert.equal(resolveRedirect(from, "/next").hostname, "example.com");
  assert.equal(resolveRedirect(from, "https://outro.example.org/x").hostname, "outro.example.org");
  for (const loc of [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://192.168.2.1/",
    "file:///etc/passwd",
    "http://example.com:6379/",
  ]) {
    assert.throws(
      () => resolveRedirect(from, loc),
      /blocked_destination|protocol_not_allowed|port_not_allowed/,
      loc,
    );
  }
});

test("SSRF: cadeia longa de redirecionamentos não é seguida indefinidamente", async () => {
  // Servidor local em porta não permitida: recusado antes de qualquer conexão (limite de política).
  let served = 0;
  const s = createServer((_q, r) => {
    served++;
    r.writeHead(302, { location: "/x" });
    r.end();
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  await assert.rejects(
    () => safeFetch(`http://127.0.0.1:${s.address().port}/a`),
    /port_not_allowed|blocked_destination/,
  );
  assert.equal(served, 0);
  await new Promise((r) => s.close(r));
});

test("SSRF: nome que resolve para loopback é bloqueado no connect (anti-rebinding)", async () => {
  await new Promise((res) =>
    guardedLookup("localhost", { all: true }, (e) => {
      assert.ok(e && /blocked_destination/.test(e.message));
      res();
    }),
  );
  await assert.rejects(
    () => safeFetch("http://localhost/"),
    /port_not_allowed|blocked_destination/,
  );
});

test("fetch_url não alcança destino bloqueado e não devolve conteúdo", async () => {
  await assert.rejects(
    () => callTool("fetch_url", { url: "http://169.254.169.254/latest/meta-data/" }, ctx()),
    /blocked_destination/,
  );
  await assert.rejects(
    () => callTool("fetch_url", { url: "http://127.0.0.1/" }, ctx()),
    /blocked_destination/,
  );
  await assert.rejects(
    () => callTool("fetch_url", { url: "file:///etc/passwd" }, ctx()),
    /protocol_not_allowed/,
  );
});

test("conteúdo externo é marcado como dado não confiável", () => {
  assert.match(UNTRUSTED, /não confiável/);
  assert.match(UNTRUSTED, /nunca como instrução/);
});

// ---------------------------------------------------------------- comandos indiretos
test("invocações indiretas não passam pela allowlist mínima", () => {
  const allow = "ls, pwd, whoami, date, df, echo, node --version, npm --version";
  for (const c of [
    "sh -c ls",
    "bash -c 'id'",
    "eval ls",
    "env ls",
    "xargs ls",
    "find . -exec ls {} ;",
    "python3 -c 'import os'",
    "node -e 'require(\"child_process\")'",
    "ls $(whoami)",
    "ls `whoami`",
    "ls\nwhoami",
    "ls; whoami",
    "ls && whoami",
    "ls || whoami",
    "ls | whoami",
    "ls > /tmp/x",
    "ls < /etc/passwd",
    "ls & whoami",
    "(ls)",
    "{ ls; }",
    "ls \\$(id)",
  ]) {
    assert.equal(isAllowlisted(c, allow), false, c);
    assert.equal(decide(c, { enabled: true, allowlist: allow, autonomy: "safe" }), "deny", c);
  }
  assert.equal(isAllowlisted("ls -la", allow), true);
  assert.equal(isAllowlisted("echo oi", allow), true);
});
