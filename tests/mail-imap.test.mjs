// Fase 4 — D7 IMAP/SMTP transport: CONTRACT tests with fake provider clients.
// No socket is ever opened, no credential is real, nothing is sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createImapSmtpTransport,
  envelopeToMeta,
  rawToBody,
  DEFAULT_HOSTS,
  transportFromEnv,
} from "../server/mail-imap.js";
import { createMailService, MailError } from "../server/mail.js";

const SECRET = "APP_PASSWORD_SONDA_IMAP_9";

const ACCOUNT = { type: "gmail", enabled: true, user: "ana@exemplo.test", appPassword: SECRET };

/** Build fake provider factories that record everything the adapter passes them. */
function fakes({ messages = [], uids = [1, 2], connectError, sendError, logoutThrows } = {}) {
  const rec = {
    imap: null,
    smtp: null,
    connected: false,
    mailbox: null,
    released: false,
    loggedOut: false,
    fetched: null,
    searched: null,
    mail: null,
    closed: false,
  };
  const createImapClient = async (opts) => {
    rec.imap = opts;
    return {
      mailbox: { exists: messages.length },
      async connect() {
        if (connectError) throw connectError;
        rec.connected = true;
      },
      async getMailboxLock(name) {
        rec.mailbox = name;
        return {
          release: () => {
            rec.released = true;
          },
        };
      },
      async *fetch(sequence, query, options) {
        rec.fetched = { sequence, query, options };
        for (const m of messages) yield m;
      },
      async search(q, o) {
        rec.searched = { q, o };
        return uids;
      },
      async logout() {
        rec.loggedOut = true;
        if (logoutThrows) throw new Error("logout failed");
      },
      close() {
        rec.closed = true;
      },
    };
  };
  const createSmtpTransport = async (opts) => {
    rec.smtp = opts;
    return {
      async sendMail(mail) {
        if (sendError) throw sendError;
        rec.mail = mail;
        return { messageId: "real-1" };
      },
      close() {
        rec.closed = true;
      },
    };
  };
  return { rec, createImapClient, createSmtpTransport };
}

test("helpers: envelope mapping and body extraction", () => {
  const meta = envelopeToMeta(
    7,
    {
      date: new Date("2026-10-15T09:00:00Z"),
      from: [{ name: "Chefe", address: "chefe@x.test" }],
      subject: "Oi",
    },
    new Set(["\\Seen"]),
  );
  assert.deepEqual(meta, {
    id: "7",
    date: "2026-10-15T09:00:00.000Z",
    from: "Chefe <chefe@x.test>",
    subject: "Oi",
    unseen: false,
  });
  assert.equal(rawToBody("Subject: x\r\nFrom: a\r\n\r\nHello <b>world</b>"), "Hello <b>world</b>");
  assert.equal(rawToBody("no headers here"), "no headers here");
});

test("d7: IMAPS 993 + app-password auth; lock released and client logged out", async () => {
  const { rec, createImapClient, createSmtpTransport } = fakes({
    messages: [
      {
        uid: 3,
        envelope: {
          date: new Date("2026-10-15T09:00:00Z"),
          from: [{ address: "a@x.test" }],
          subject: "Oi",
        },
        flags: new Set(),
      },
    ],
  });
  const t = createImapSmtpTransport({ createImapClient, createSmtpTransport });
  const page = await t.list(ACCOUNT, { limit: 10, offset: 0 });

  assert.deepEqual(rec.imap, {
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    auth: { user: "ana@exemplo.test", pass: SECRET },
    logger: false,
  });
  assert.equal(rec.connected, true);
  assert.equal(rec.mailbox, "INBOX");
  assert.equal(rec.released, true, "mailbox lock released");
  assert.equal(rec.loggedOut, true, "client logged out");
  assert.equal(page.total, 1);
  assert.deepEqual(page.messages[0], {
    id: "3",
    date: "2026-10-15T09:00:00.000Z",
    from: "a@x.test",
    subject: "Oi",
    unseen: true,
  });
  assert.equal(JSON.stringify(page).includes(SECRET), false, "credentials never in the result");
});

test("d7: connection test authenticates and logs out without locking or reading INBOX", async () => {
  const { rec, createImapClient, createSmtpTransport } = fakes();
  const t = createImapSmtpTransport({ createImapClient, createSmtpTransport });
  assert.deepEqual(await t.testConnection(ACCOUNT), { ok: true });
  assert.equal(rec.connected, true);
  assert.equal(rec.loggedOut, true);
  assert.equal(rec.mailbox, null, "connection test never opens/locks a mailbox");
  assert.equal(rec.fetched, null, "connection test never fetches messages");
  assert.equal(rec.searched, null, "connection test never searches messages");
  assert.equal(rec.smtp, null, "connection test never touches SMTP");
});

test("d7: list computes the sequence window from the mailbox size", async () => {
  const messages = Array.from({ length: 3 }, (_, i) => ({
    uid: i + 1,
    envelope: { subject: `m${i}` },
    flags: new Set(["\\Seen"]),
  }));
  const { rec, createImapClient, createSmtpTransport } = fakes({ messages });
  const t = createImapSmtpTransport({ createImapClient, createSmtpTransport });
  await t.list(ACCOUNT, { limit: 2, offset: 0 });
  assert.equal(rec.fetched.sequence, "2:3", "newest two messages");
  assert.equal(rec.fetched.query.envelope, true);
});

test("d7: read fetches the source and drops the header block", async () => {
  const { createImapClient, createSmtpTransport } = fakes({
    messages: [
      {
        uid: 5,
        envelope: { subject: "Oi" },
        flags: new Set(),
        source: Buffer.from("Subject: Oi\r\n\r\ncorpo <script>x</script>"),
      },
    ],
  });
  const t = createImapSmtpTransport({ createImapClient, createSmtpTransport });
  const msg = await t.read(ACCOUNT, "5");
  assert.equal(msg.id, "5");
  assert.match(msg.body, /corpo/);
});

test("d7: search maps allowlisted criteria to IMAP search flags", async () => {
  const { rec, createImapClient, createSmtpTransport } = fakes({ uids: [4, 5] });
  const t = createImapSmtpTransport({ createImapClient, createSmtpTransport });
  const page = await t.search(
    ACCOUNT,
    { from: "chefe@x.test", subject: "rel", since: "2026-10-01", unseen: true },
    { limit: 50, offset: 0 },
  );
  assert.equal(rec.searched.q.from, "chefe@x.test");
  assert.equal(rec.searched.q.subject, "rel");
  assert.ok(rec.searched.q.since instanceof Date);
  assert.equal(rec.searched.q.seen, false, "unseen=true → seen=false");
  assert.deepEqual(rec.searched.o, { uid: true });
  assert.equal(page.total, 2);
});

test("d7: send uses SMTP 587 + STARTTLS, then closes the transport", async () => {
  const { rec, createImapClient, createSmtpTransport } = fakes();
  const t = createImapSmtpTransport({ createImapClient, createSmtpTransport });
  const out = await t.send(ACCOUNT, { to: "dest@x.test", subject: "Assunto", text: "Corpo" });
  assert.deepEqual(rec.smtp, {
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    auth: { user: "ana@exemplo.test", pass: SECRET },
  });
  assert.deepEqual(rec.mail, {
    from: "ana@exemplo.test",
    to: "dest@x.test",
    subject: "Assunto",
    text: "Corpo",
  });
  assert.equal(rec.closed, true);
  assert.equal(out.messageId, "real-1");
});

test("d7: an unsupported provider fails without opening a connection", async () => {
  const { rec, createImapClient, createSmtpTransport } = fakes();
  const t = createImapSmtpTransport({ createImapClient, createSmtpTransport });
  await assert.rejects(
    t.list({ type: "yahoo", user: "x", appPassword: SECRET }, { limit: 1, offset: 0 }),
    (e) => e.code === "EUNKNOWN",
  );
  assert.equal(rec.imap, null, "no client was created");
});

test("d7: through the core, an auth failure is a generic 502 and never leaks the password", async () => {
  const authErr = Object.assign(new Error(`Invalid login ${SECRET}`), { code: "EAUTH" });
  const { createImapClient, createSmtpTransport } = fakes({ connectError: authErr });
  const audits = [];
  const svc = createMailService({
    transport: createImapSmtpTransport({ createImapClient, createSmtpTransport }),
    resolveAccount: () => ACCOUNT,
    audit: (kind, detail) => audits.push({ kind, detail }),
    limits: { sleep: async () => {}, timeoutMs: 50 },
  });
  const err = await svc.list("A", "gmail").then(
    () => null,
    (e) => e,
  );
  assert.ok(err instanceof MailError);
  assert.equal(err.status, 502);
  assert.equal(err.code, "provider_error");
  assert.equal(String(err.message).includes(SECRET), false);
  assert.equal(
    JSON.stringify(audits).includes(SECRET),
    false,
    "audit never carries the provider message",
  );
});

test("d7: constructing the transport without factories does not load the provider modules", () => {
  // Lazy factories: importing/constructing must not require imapflow/nodemailer nor open anything.
  assert.doesNotThrow(() => createImapSmtpTransport());
  assert.deepEqual(DEFAULT_HOSTS.gmail, { imap: "imap.gmail.com", smtp: "smtp.gmail.com" });
});

test("d7: the real transport needs an explicit opt-in (absent/invalid stays on the mock)", () => {
  assert.equal(transportFromEnv({}), null, "absent");
  assert.equal(transportFromEnv({ JARVIS_MAIL_TRANSPORT: "" }), null, "empty");
  assert.equal(transportFromEnv({ JARVIS_MAIL_TRANSPORT: "mock" }), null, "invalid");
  assert.equal(
    transportFromEnv({ JARVIS_MAIL_TRANSPORT: "IMAP" }),
    null,
    "case-sensitive: no accidental activation",
  );
  const t = transportFromEnv({ JARVIS_MAIL_TRANSPORT: "imap" });
  assert.ok(t && typeof t.list === "function" && typeof t.send === "function");
});

test("d7: a failed connect still tears the client down (no leaked socket)", async () => {
  const { rec, createImapClient, createSmtpTransport } = fakes({
    connectError: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    logoutThrows: true,
  });
  const t = createImapSmtpTransport({ createImapClient, createSmtpTransport });
  await assert.rejects(t.list(ACCOUNT, { limit: 1, offset: 0 }));
  assert.equal(rec.loggedOut, true, "logout is attempted even when connect fails");
  assert.equal(rec.closed, true, "close() is the fallback when logout also fails");
  assert.equal(rec.mailbox, null, "the mailbox is never locked");
});

test("d7: a failed send still closes the SMTP transport", async () => {
  const { rec, createImapClient, createSmtpTransport } = fakes({
    sendError: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
  });
  const t = createImapSmtpTransport({ createImapClient, createSmtpTransport });
  await assert.rejects(t.send(ACCOUNT, { to: "x@y.z", subject: "s", text: "b" }));
  assert.equal(rec.closed, true, "the transport is closed on failure too");
});

test("d7: through the core, a failed send is classified and never leaks the password", async () => {
  const { createImapClient, createSmtpTransport } = fakes({
    sendError: Object.assign(new Error(`535 Invalid login ${SECRET}`), { code: "EAUTH" }),
  });
  const audits = [];
  const svc = createMailService({
    transport: createImapSmtpTransport({ createImapClient, createSmtpTransport }),
    resolveAccount: () => ACCOUNT,
    audit: (kind, detail) => audits.push({ kind, detail }),
    limits: { sleep: async () => {}, timeoutMs: 50 },
  });
  const err = await svc
    .send("A", "gmail", { to: "x@y.z", subject: "s", body: "b", confirm: "ENVIAR" })
    .then(
      () => null,
      (e) => e,
    );
  assert.ok(err instanceof MailError);
  assert.equal(err.status, 502);
  assert.equal(err.outcome, "failed", "auth fails before the message is transmitted");
  assert.equal(String(err.message).includes(SECRET), false);
  assert.equal(JSON.stringify(audits).includes(SECRET), false);
});
