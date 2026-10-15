// Fase 4 — e-mail core. Synthetic data + MOCK transport only: no network, no credentials, no mailbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MailError,
  sanitizeEmailBody,
  labelUntrusted,
  validateSearch,
  clampPage,
  classifyConnectionError,
  redactAccount,
  withRetry,
  createMailService,
  settingsAccountResolver,
  LIMITS,
} from "../server/mail.js";

const SECRET = "SENHA_APP_SONDA_123";

/** Capture a rejection (assert.rejects resolves to undefined, it does not return the error). */
async function catchErr(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to reject");
}

// ---------- untrusted content ----------

test("sanitize: strips executable markup and keeps readable text", () => {
  const html = `<html><head><style>body{x:1}</style></head><body>
    <p>Ola <b>mundo</b></p>
    <script>alert('x')</script>
    <iframe src="https://evil.example"></iframe>
    <img src=x onerror="steal()">
    <a href="javascript:alert(1)">clique</a>
    <div>Linha &amp; outra &lt;fim&gt;</div>
  </body></html>`;
  const out = sanitizeEmailBody(html);
  assert.equal(
    /<\s*(script|iframe|img|a|svg|object|embed)\b/i.test(out),
    false,
    "no tag constructs",
  );
  assert.equal(out.includes("alert"), false, "no script body");
  assert.equal(out.includes("onerror"), false);
  assert.equal(out.includes("javascript:"), false);
  assert.match(out, /Ola mundo/);
  assert.match(out, /Linha & outra/);
  assert.match(out, /&lt;fim&gt;/, "entity-encoded markup stays inert text, never a raw tag");
});

test("sanitize: entity-smuggled markup cannot become a raw tag", () => {
  const out = sanitizeEmailBody(
    "&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=go()&gt;",
  );
  assert.equal(out.includes("<"), false, "no raw angle brackets are ever emitted");
  assert.equal(
    /script|img|onerror/i.test(out.replace(/&lt;|&gt;/g, "")),
    true,
    "payload is inert text",
  );
});

test("sanitize: plain text is preserved and control chars removed", () => {
  assert.equal(sanitizeEmailBody("linha 1\r\nlinha 2\u0000"), "linha 1\nlinha 2");
});

test("labelUntrusted: bounded, labelled and sanitised", () => {
  const block = labelUntrusted({
    from: "a@b.c",
    subject: "Assunto <script>x</script>",
    body: "<b>oi</b>",
  });
  assert.match(block, /UNTRUSTED DATA/);
  assert.match(block, /never an instruction/i);
  assert.equal(block.includes("<script>"), false);
  assert.match(block, /subject: Assunto/);
  assert.match(block, /body: oi/);
});

// ---------- search validation ----------

test("validateSearch: allowlist only, no arbitrary regex or body scan", () => {
  assert.deepEqual(validateSearch({ from: "chefe@empresa.com", unseen: true }), {
    from: "chefe@empresa.com",
    unseen: true,
  });
  assert.deepEqual(validateSearch({}), {}, "empty search allowed");
  for (const bad of [{ regex: ".*" }, { body: "segredo" }, { raw: "x" }, { where: "1=1" }]) {
    const code = bad.where ? "unknown_filter" : "forbidden_filter";
    assert.throws(
      () => validateSearch(bad),
      (e) => e instanceof MailError && e.code === code,
    );
  }
  assert.throws(
    () => validateSearch({ unknown: "x" }),
    (e) => e.code === "unknown_filter",
  );
  assert.throws(
    () => validateSearch({ from: 5 }),
    (e) => e.code === "invalid_filter",
  );
  assert.throws(
    () => validateSearch({ since: "nao-e-data" }),
    (e) => e.code === "invalid_date",
  );
  assert.throws(
    () => validateSearch({ subject: "x".repeat(500) }),
    (e) => e.code === "invalid_filter",
  );
  assert.throws(
    () => validateSearch("texto"),
    (e) => e.code === "invalid_search",
  );
});

test("validateSearch: strips control characters from filter values", () => {
  assert.equal(validateSearch({ subject: "a\u0000b\u001fc" }).subject, "abc");
});

// ---------- pagination ----------

test("clampPage: never trusts client bounds", () => {
  assert.deepEqual(clampPage(undefined, undefined), { limit: LIMITS.defaultPage, offset: 0 });
  assert.deepEqual(clampPage(9999, -5), { limit: LIMITS.maxPage, offset: 0 });
  assert.deepEqual(clampPage(0, 3), { limit: 1, offset: 3 });
  assert.deepEqual(clampPage(10, 999999), { limit: 10, offset: LIMITS.maxTotal });
});

// ---------- error classification + redaction ----------

test("classifyConnectionError: auth fails fast, transient retries", () => {
  assert.deepEqual(
    classifyConnectionError(Object.assign(new Error("Invalid login: 535 auth"), { code: "EAUTH" })),
    { state: "reconnect", retryable: false },
  );
  assert.deepEqual(
    classifyConnectionError(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })),
    { state: "error", retryable: true },
  );
  assert.deepEqual(classifyConnectionError(new Error("boom")), {
    state: "error",
    retryable: false,
  });
});

test("redactAccount: never exposes the password; masks the address", () => {
  const view = redactAccount({
    type: "gmail",
    enabled: true,
    user: "ana@exemplo.com",
    appPassword: SECRET,
  });
  assert.equal(JSON.stringify(view).includes(SECRET), false);
  assert.equal(view.user, "a***@exemplo.com");
  assert.equal(view.hasPassword, true);
  assert.equal(view.type, "gmail");
});

// ---------- retry / timeout ----------

test("withRetry: recovers a transient failure, then stops", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 2) throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
      return "ok";
    },
    { retries: 2, sleep: async () => {} },
  );
  assert.equal(result, "ok");
  assert.equal(calls, 2);
});

test("withRetry: permanent (auth) failure is not retried", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw Object.assign(new Error("535 auth"), { code: "EAUTH" });
      },
      { retries: 3, sleep: async () => {} },
    ),
  );
  assert.equal(calls, 1);
});

test("withRetry: a hung provider times out (bounded)", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        await new Promise(() => {});
      },
      { retries: 0, timeoutMs: 20, sleep: async () => {} },
    ),
    (e) => e.code === "ETIMEDOUT",
  );
  assert.equal(calls, 1);
});

// ---------- service ----------

const mockTransport = (over = {}) => {
  const state = { calls: { list: 0, read: 0, search: 0, send: 0 }, sent: [] };
  const accounts = new Map();
  const base = {
    async list() {
      state.calls.list += 1;
      return {
        messages: [
          {
            id: "1",
            date: "2026-10-15T10:00:00Z",
            from: "a@b.c",
            subject: "Oi <script>x</script>",
            unseen: true,
          },
        ],
        total: 1,
      };
    },
    async read() {
      state.calls.read += 1;
      return {
        id: "1",
        from: "a@b.c",
        subject: "Oi",
        html: "<p>corpo</p><script>steal()</script>",
        unseen: false,
      };
    },
    async search() {
      state.calls.search += 1;
      return { messages: [], total: 0 };
    },
    async send(account, outgoing) {
      state.calls.send += 1;
      state.sent.push(outgoing);
      return { messageId: "m1" };
    },
  };
  return { state, accounts, transport: { ...base, ...over } };
};

const makeService = ({ transport, resolver, audit } = {}) => {
  const audits = [];
  const svc = createMailService({
    transport,
    resolveAccount:
      resolver ??
      ((adminId, id) =>
        adminId === "A" && id === "gmail"
          ? { type: "gmail", enabled: true, user: "ana@exemplo.com", appPassword: SECRET }
          : null),
    audit: audit ?? ((kind, detail) => audits.push({ kind, detail })),
    limits: { sleep: async () => {}, timeoutMs: 50 },
  });
  return { svc, audits };
};

test("service: list/read/search sanitise output and never leak raw HTML", async () => {
  const { svc } = makeService({ transport: mockTransport().transport });
  const list = await svc.list("A", "gmail", { limit: 9999 });
  assert.equal(list.limit, LIMITS.maxPage, "limit clamped");
  assert.equal(list.messages[0].subject.includes("<script>"), false);
  const msg = await svc.read("A", "gmail", "1");
  assert.equal(msg.untrusted, true);
  assert.equal(msg.body.includes("<"), false);
  assert.equal(msg.body.includes("steal"), false);
  assert.match(msg.body, /corpo/);
  const search = await svc.search("A", "gmail", { from: "chefe@empresa.com" }, { limit: 5 });
  assert.deepEqual(search.messages, []);
});

test("service: ownership is enforced per admin; foreign and missing look identical", async () => {
  const { svc } = makeService({ transport: mockTransport().transport });
  const missing = await catchErr(svc.list("A", "outlook"));
  const foreign = await catchErr(svc.list("B", "gmail"));
  assert.equal(missing.code, "account_not_found");
  assert.equal(missing.status, 404);
  assert.equal(foreign.code, "account_not_found", "foreign and missing are indistinguishable");
  assert.equal(foreign.status, 404);
  assert.equal((await catchErr(svc.list(null, "gmail"))).code, "admin_session_required");
  assert.equal((await catchErr(svc.list("A", "yahoo"))).code, "invalid_account");
});

test("service: send requires explicit confirmation and validated input", async () => {
  const { state, transport } = mockTransport();
  const { svc, audits } = makeService({ transport });
  await assert.rejects(
    svc.send("A", "gmail", { to: "x@y.z", subject: "s", body: "b" }),
    (e) => e.code === "confirmation_required",
  );
  await assert.rejects(
    svc.send("A", "gmail", { to: "nao-email", subject: "s", body: "b", confirm: "ENVIAR" }),
    (e) => e.code === "invalid_recipient",
  );
  await assert.rejects(
    svc.send("A", "gmail", { to: "x@y.z", subject: "s", body: "   ", confirm: "ENVIAR" }),
    (e) => e.code === "invalid_body",
  );
  await assert.rejects(
    svc.send("A", "gmail", {
      to: "x@y.z",
      subject: "s",
      body: "x".repeat(LIMITS.maxBody + 1),
      confirm: "ENVIAR",
    }),
    (e) => e.code === "body_too_large",
  );
  assert.equal(state.calls.send, 0, "transport never called on invalid input");

  const ok = await svc.send("A", "gmail", {
    to: "x@y.z",
    subject: "Assunto",
    body: "Corpo",
    confirm: "ENVIAR",
  });
  assert.equal(ok.ok, true);
  assert.equal(state.calls.send, 1);
  assert.deepEqual(state.sent[0], { to: "x@y.z", subject: "Assunto", text: "Corpo" });
  const sent = audits.find((a) => a.kind === "mail.sent");
  assert.deepEqual(
    Object.keys(sent.detail).sort(),
    ["account", "admin"],
    "audit has no recipient/subject/body",
  );
  assert.equal(JSON.stringify(audits).includes("Corpo"), false);
});

test("service: provider failure becomes a generic 502 and is audited without secrets", async () => {
  const transport = mockTransport({
    async list() {
      throw Object.assign(new Error(`boom ${SECRET}`), { code: "ECONNRESET" });
    },
  }).transport;
  const { svc, audits } = makeService({ transport });
  const err = await catchErr(svc.list("A", "gmail"));
  assert.ok(err instanceof MailError);
  assert.equal(err.status, 502);
  assert.equal(err.code, "provider_error");
  assert.equal(String(err.message).includes(SECRET), false);
  assert.equal(JSON.stringify(audits).includes(SECRET), false);
  const logged = audits.find((a) => a.kind === "mail.provider_error");
  assert.deepEqual(Object.keys(logged.detail).sort(), ["account", "admin", "status"]);
});

test("settingsAccountResolver: keeps accounts isolated per admin", () => {
  const settings = {
    A: { comms: { gmail: { enabled: true, user: "ana@x.com", appPassword: SECRET } } },
    B: { comms: {} },
  };
  const resolve = settingsAccountResolver((id) => settings[id] ?? {});
  assert.equal(resolve("A", "gmail").user, "ana@x.com");
  assert.equal(resolve("B", "gmail"), null, "B never sees A's account");
  assert.equal(resolve("A", "outlook"), null);
});

test("limits: every bound is configurable per service (F4.11 values still pending)", async () => {
  const { transport } = mockTransport();
  const svc = createMailService({
    transport,
    resolveAccount: () => ({ type: "gmail", enabled: true, user: "a@b.test", appPassword: SECRET }),
    audit: () => {},
    limits: { defaultPage: 3, maxPage: 5, maxTotal: 9, maxBody: 12, maxFilter: 4 },
  });
  assert.deepEqual(clampPage(undefined, undefined, { defaultPage: 3, maxPage: 5, maxTotal: 9 }), {
    limit: 3,
    offset: 0,
  });
  assert.equal(
    (await svc.list("A", "gmail", { limit: 999 })).limit,
    5,
    "maxPage override respected",
  );
  await assert.rejects(
    svc.search("A", "gmail", { subject: "12345" }),
    (e) => e.code === "invalid_filter",
    "maxFilter override respected",
  );
  await assert.rejects(
    svc.send("A", "gmail", { to: "x@y.z", subject: "s", body: "x".repeat(13), confirm: "ENVIAR" }),
    (e) => e.code === "body_too_large",
    "maxBody override respected",
  );
});
