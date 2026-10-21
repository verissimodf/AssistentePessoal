// Fase 4 — e-mail routes and tools. Synthetic data + MOCK transport only: no network, no credentials,
// no real mailbox, no real send.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-mail-routes-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { setMailTransport } = await import("../server/mail-service.js");
const { callTool } = await import("../server/tools.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "SENHA_APP_SONDA_MAIL_55";
const BODY = "CORPO_PRIVADO_SONDA_MAIL";
let server, base;
const A = {},
  B = {};

// Controllable mock transport: never opens a socket.
const tstate = {
  mode: "ok",
  failNext: 0,
  calls: { list: 0, read: 0, search: 0, send: 0 },
  sent: [],
};
const transport = {
  async list(_a, page) {
    tstate.calls.list += 1;
    if (tstate.failNext > 0) {
      tstate.failNext -= 1;
      throw Object.assign(new Error(`boom ${SECRET}`), { code: "ECONNRESET" });
    }
    if (tstate.mode === "fail")
      throw Object.assign(new Error(`boom ${SECRET}`), { code: "ECONNRESET" });
    if (tstate.mode === "auth")
      throw Object.assign(new Error("Invalid login 535"), { code: "EAUTH" });
    if (tstate.mode === "hang") return new Promise(() => {});
    return {
      messages: [
        {
          id: "m1",
          date: "2026-10-15T09:00:00Z",
          from: "chefe@exemplo.test",
          subject: "Oi <script>alert(1)</script>",
          unseen: true,
        },
      ],
      total: 1,
      limit: page.limit,
      offset: page.offset,
    };
  },
  async read(_a, id) {
    tstate.calls.read += 1;
    return {
      id,
      from: "chefe@exemplo.test",
      subject: "Oi",
      html: `<p>${BODY}</p><script>steal()</script>`,
      unseen: false,
    };
  },
  async search(_a, criteria, page) {
    tstate.calls.search += 1;
    return { messages: [], total: 0, limit: page.limit, offset: page.offset };
  },
  async send(_a, outgoing) {
    tstate.calls.send += 1;
    tstate.sent.push(outgoing);
    return { messageId: "srv-1" };
  },
};

const req = (path, { method = "GET", body, s, bearer } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(s ? { cookie: s.cookie, "x-jarvis-csrf": s.csrf } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const json = async (r) => ({ status: r.status, body: await r.json() });
async function login(u, t) {
  const r = await req("/api/auth/login", { method: "POST", body: { username: u, password: PW } });
  assert.equal(r.status, 200);
  const j = await r.json();
  Object.assign(t, {
    cookie: r.headers.get("set-cookie").split(";")[0],
    csrf: j.csrf,
    id: j.admin.id,
  });
}
const auditRows = () => db.prepare("SELECT kind, detail FROM audit").all();
const auditText = () => JSON.stringify(auditRows());

before(async () => {
  server = createApp(); // default transport (mock) — replaced below
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  setMailTransport(transport, { timeoutMs: 40, retries: 2, sleep: async () => {} });
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  await login("ana", A);
  assert.equal(
    (
      await req("/api/auth/admins", {
        method: "POST",
        body: { username: "bia", password: PW, currentPassword: PW },
        s: A,
      })
    ).status,
    200,
  );
  await login("bia", B);
  // A configures gmail; B configures outlook — accounts are per admin (F4.8).
  assert.equal(
    (
      await req("/api/settings", {
        method: "PUT",
        body: {
          comms: { gmail: { enabled: true, user: "ana@exemplo.test", appPassword: SECRET } },
        },
        s: A,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await req("/api/settings", {
        method: "PUT",
        body: {
          comms: { outlook: { enabled: true, user: "bia@exemplo.test", appPassword: SECRET } },
        },
        s: B,
      })
    ).status,
    200,
  );
});
after(() => server.close());

test("mail: unauthenticated access is refused", async () => {
  assert.equal((await req("/api/mail/accounts")).status, 401);
  assert.equal((await req("/api/mail/gmail/messages")).status, 401);
  assert.equal(
    (
      await req("/api/mail/gmail/send", {
        method: "POST",
        body: { to: "x@y.z", subject: "s", body: "b", confirm: "ENVIAR" },
      })
    ).status,
    401,
  );
});

test("mail: accounts are listed per admin, credentials redacted", async () => {
  const a = await json(await req("/api/mail/accounts", { s: A }));
  assert.equal(a.status, 200);
  assert.deepEqual(
    a.body.map((x) => x.type),
    ["gmail"],
  );
  assert.equal(a.body[0].user, "a***@exemplo.test");
  assert.equal(a.body[0].hasPassword, true);
  assert.equal(JSON.stringify(a.body).includes(SECRET), false, "never returns the app password");
  const b = await json(await req("/api/mail/accounts", { s: B }));
  assert.deepEqual(
    b.body.map((x) => x.type),
    ["outlook"],
  );
});

test("mail: ownership — another admin's account is indistinguishable from a non-existent one", async () => {
  const foreign = await json(await req("/api/mail/outlook/messages", { s: A }));
  const missing = await json(await req("/api/mail/yahoo/messages", { s: A }));
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "account_not_found");
  assert.equal(missing.status, 400, "an unknown account name is a malformed request");
  assert.equal(missing.body.error, "invalid_account");
  // B cannot read A's account either.
  assert.equal((await json(await req("/api/mail/gmail/messages", { s: B }))).status, 404);
});

test("mail: list/read/search sanitise output (no markup reaches the client)", async () => {
  const list = await json(await req("/api/mail/gmail/messages?limit=9999", { s: A }));
  assert.equal(list.status, 200);
  assert.equal(list.body.messages.length, 1);
  assert.equal(list.body.messages[0].subject.includes("<script>"), false, "subject sanitised");
  assert.equal(list.body.limit, 50, "limit clamped server-side");

  const read = await json(await req("/api/mail/gmail/messages/m1", { s: A }));
  assert.equal(read.status, 200);
  assert.equal(read.body.untrusted, true);
  assert.equal(read.body.body.includes("<"), false, "no raw markup in body");
  assert.equal(read.body.body.includes("steal"), false);
  assert.match(read.body.body, new RegExp(BODY));

  assert.equal((await json(await req("/api/mail/gmail/search?from=chefe", { s: A }))).status, 200);
});

test("mail: search validation rejects forbidden/unknown filters and bad dates", async () => {
  const regex = await json(await req("/api/mail/gmail/search?regex=.*", { s: A }));
  assert.equal(regex.status, 400);
  assert.equal(regex.body.error, "forbidden_filter");
  const unknown = await json(await req("/api/mail/gmail/search?where=1", { s: A }));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown_filter");
  const badDate = await json(await req("/api/mail/gmail/search?since=nao-e-data", { s: A }));
  assert.equal(badDate.status, 400);
  assert.equal(badDate.body.error, "invalid_date");
});

test("mail: provider failure becomes a generic 502 with no secret in the audit", async () => {
  tstate.mode = "fail";
  const r = await json(await req("/api/mail/gmail/messages", { s: A }));
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "provider_error");
  assert.equal(JSON.stringify(r.body).includes(SECRET), false);
  assert.equal(auditText().includes(SECRET), false, "audit never carries the provider message");
  const logged = auditRows().filter((x) => x.kind === "mail.provider_error");
  assert.ok(logged.length >= 1);
  tstate.mode = "ok";
});

test("mail: a hung provider times out (bounded) instead of hanging the request", async () => {
  tstate.mode = "hang";
  const r = await json(await req("/api/mail/gmail/messages", { s: A }));
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "provider_error");
  tstate.mode = "ok";
});

test("mail: a transient failure is retried and can succeed", async () => {
  tstate.failNext = 1;
  const before = tstate.calls.list;
  const r = await json(await req("/api/mail/gmail/messages", { s: A }));
  assert.equal(r.status, 200);
  assert.equal(tstate.calls.list, before + 2, "one failure then one success");
});

test("mail: manual send requires the explicit confirmation ENVIAR", async () => {
  const noConfirm = await json(
    await req("/api/mail/gmail/send", {
      method: "POST",
      body: { to: "x@y.z", subject: "s", body: "b" },
      s: A,
    }),
  );
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.body.error, "confirmation_required");
  assert.equal(tstate.calls.send, 0, "nothing sent without confirmation");

  const badTo = await json(
    await req("/api/mail/gmail/send", {
      method: "POST",
      body: { to: "nao-email", subject: "s", body: "b", confirm: "ENVIAR" },
      s: A,
    }),
  );
  assert.equal(badTo.status, 400);
  assert.equal(badTo.body.error, "invalid_recipient");

  const sent = await json(
    await req("/api/mail/gmail/send", {
      method: "POST",
      body: { to: "dest@exemplo.test", subject: "Assunto", body: BODY, confirm: "ENVIAR" },
      s: A,
    }),
  );
  assert.equal(sent.status, 200);
  assert.equal(sent.body.ok, true);
  assert.equal(tstate.calls.send, 1);
  assert.deepEqual(tstate.sent[0], { to: "dest@exemplo.test", subject: "Assunto", text: BODY });
});

test("mail: send is session-only (a service token cannot send)", async () => {
  const tok = (
    await json(
      await req("/api/auth/tokens", {
        method: "POST",
        body: { name: "m", scopes: ["comms:send", "comms:read"] },
        s: A,
      }),
    )
  ).body.token;
  const r = await json(
    await req("/api/mail/gmail/send", {
      method: "POST",
      body: { to: "x@y.z", subject: "s", body: "b", confirm: "ENVIAR" },
      bearer: tok,
    }),
  );
  assert.equal(r.status, 403);
  // ...but reading with the token is allowed.
  assert.equal((await req("/api/mail/gmail/messages", { bearer: tok })).status, 200);
});

test("mail: audit never contains the body, recipient or secret", async () => {
  assert.equal(auditText().includes(BODY), false);
  assert.equal(auditText().includes("dest@exemplo.test"), false);
  assert.equal(auditText().includes(SECRET), false);
  const sent = auditRows().filter((x) => x.kind === "mail.sent");
  assert.ok(sent.length >= 1);
  assert.deepEqual(Object.keys(JSON.parse(sent.at(-1).detail)).sort(), ["account", "admin"]);
});

test("tools: read_email uses the core (sanitised); send_email prepares a draft (never sends)", async () => {
  const principal = { type: "service", adminId: A.id, scopes: ["comms:read", "comms:send"] };
  const ctx = () => ({ autonomy: "confirm", pending: [], principal });

  const read = await callTool("read_email", { account: "gmail" }, ctx());
  assert.match(read, /chefe@exemplo.test/);
  assert.equal(read.includes("<script>"), false, "tool output is sanitised");

  const before = tstate.calls.send;
  const drafted = await callTool(
    "send_email",
    { account: "gmail", to: "x@y.z", subject: "s", body: BODY },
    ctx(),
  );
  assert.match(drafted, /Nada foi enviado/i);
  assert.equal(tstate.calls.send, before, "agent send never reaches the transport");
  assert.equal(auditText().includes(BODY), false);
});

test("mail: rate limits are enforced per admin+account, with retryAfter", async () => {
  // Inject small limits; a fresh service (and limiter) is built by setMailTransport.
  setMailTransport(transport, {
    timeoutMs: 40,
    retries: 2,
    sleep: async () => {},
    readPerMin: 2,
    sendPerHour: 1,
  });
  try {
    assert.equal((await req("/api/mail/gmail/messages", { s: A })).status, 200);
    assert.equal((await req("/api/mail/gmail/messages", { s: A })).status, 200);
    const limited = await json(await req("/api/mail/gmail/messages", { s: A }));
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error, "rate_limited");
    assert.ok(limited.body.retryAfter >= 1, "the client is told when to retry");
    assert.equal(JSON.stringify(limited.body).includes(SECRET), false);

    const first = await json(
      await req("/api/mail/gmail/send", {
        method: "POST",
        body: { to: "x@y.z", subject: "s", body: "b", confirm: "ENVIAR" },
        s: A,
      }),
    );
    assert.equal(first.status, 200);
    const blocked = await json(
      await req("/api/mail/gmail/send", {
        method: "POST",
        body: { to: "x@y.z", subject: "s", body: "b", confirm: "ENVIAR" },
        s: A,
      }),
    );
    assert.equal(blocked.status, 429, "send has its own (hourly) bucket");
  } finally {
    setMailTransport(transport, { timeoutMs: 40, retries: 2, sleep: async () => {} });
  }
});

test("mail: a client can never influence which transport is used", async () => {
  // The transport is chosen server-side (env opt-in / injected). A body field or header claiming a
  // transport must be ignored: the injected mock still handles the call.
  const before = tstate.sent.length;
  const viaBody = await json(
    await req("/api/mail/gmail/send", {
      method: "POST",
      body: { to: "x@y.z", subject: "s", body: "b", confirm: "ENVIAR", transport: "imap" },
      s: A,
    }),
  );
  assert.equal(viaBody.status, 200);
  assert.equal(tstate.sent.length, before + 1, "the injected mock handled it");

  const viaHeader = await json(
    await fetch(`${base}/api/mail/gmail/messages`, {
      headers: { origin: ORIGIN, cookie: A.cookie, "x-jarvis-mail-transport": "imap" },
    }),
  );
  assert.equal(viaHeader.status, 200);
  assert.ok(Array.isArray(viaHeader.body.messages), "still the mock shape");
});
