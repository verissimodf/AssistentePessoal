// Fase 4 / D_REC-1a — e-mail account ownership.
// Synthetic data + disposable temp DB only: no real account, credential, transport or send.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "jarvis-mail-owner-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { getSettings } = await import("../server/settings.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "SENHA_APP_SONDA_OWNER_77";
const B_SECRET = "SENHA_APP_SONDA_BIA_88";
const CONFIRM = "TRANSFERIR CONTA";
const repo = fileURLToPath(new URL("..", import.meta.url));
let server, base;
const A = {},
  B = {};

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
const rawData = (id) => {
  const r = db.prepare("SELECT data FROM admin_settings WHERE admin_id = ?").get(id);
  return r ? JSON.parse(r.data) : null;
};
const comms = (id) => rawData(id)?.comms || {};
const transfer = (s, body) => req("/api/ownership/mail/transfer", { method: "POST", body, s });
const reauth = (s) => req("/api/auth/reauth", { method: "POST", body: { password: PW }, s });

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
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
  assert.equal(
    (
      await req("/api/settings", {
        method: "PUT",
        body: {
          comms: {
            gmail: {
              enabled: true,
              state: "connected",
              user: "ana@exemplo.test",
              appPassword: SECRET,
            },
            outlook: {
              enabled: true,
              state: "connected",
              user: "ana@exemplo.test",
              appPassword: SECRET,
            },
          },
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
          comms: {
            outlook: {
              enabled: true,
              state: "connected",
              user: "bia@exemplo.test",
              appPassword: B_SECRET,
            },
          },
        },
        s: B,
      })
    ).status,
    200,
  );
});
after(() => server.close());

test("transferência: escopo inválido e origem ativa são recusados sem alteração", async () => {
  await reauth(B);
  const same = await json(
    await transfer(B, { from: A.id, to: A.id, account: "gmail", confirm: CONFIRM }),
  );
  assert.equal(same.status, 400);
  assert.equal(same.body.error, "invalid_admins");
  const invalid = await json(
    await transfer(B, { from: A.id, to: B.id, account: "yahoo", confirm: CONFIRM }),
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, "invalid_account");
  const active = await json(
    await transfer(B, { from: B.id, to: A.id, account: "outlook", confirm: CONFIRM }),
  );
  assert.equal(active.status, 409);
  assert.equal(active.body.error, "source_active");
  assert.ok(comms(A.id).gmail, "source keeps its account");
  assert.ok(comms(B.id).outlook, "target keeps its account");
});

test("desativação não transfere a conta: ela permanece com o titular original", async () => {
  const beforeA = rawData(A.id);
  assert.ok(beforeA.comms.gmail && beforeA.comms.outlook);
  assert.equal(comms(B.id).gmail, undefined);
  assert.equal((await req(`/api/auth/admins/${A.id}`, { method: "DELETE", s: B })).status, 200);
  const afterA = rawData(A.id);
  assert.deepEqual(afterA.comms.gmail, beforeA.comms.gmail, "same account, same owner");
  assert.deepEqual(afterA.comms.outlook, beforeA.comms.outlook, "same account, same owner");
  assert.equal(comms(B.id).gmail, undefined, "nothing moved to the active admin");
  // B (active) cannot reach A's account; unknown/foreign are indistinguishable.
  const foreign = await json(await req("/api/mail/gmail/messages", { s: B }));
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "account_not_found");
  // A's session was revoked by deactivation.
  assert.equal((await req("/api/mail/gmail/messages", { s: A })).status, 401);
});

test("transferência exige reautenticação recente e confirmação literal", async () => {
  await login("bia", B); // fresh session: reauth_at cleared
  const noReauth = await json(
    await transfer(B, { from: A.id, to: B.id, account: "gmail", confirm: CONFIRM }),
  );
  assert.equal(noReauth.status, 403);
  assert.equal(noReauth.body.error, "reauth_required");
  assert.ok(comms(A.id).gmail, "nothing changed without reauth");
  assert.equal((await reauth(B)).status, 200);
  const wrong = await json(
    await transfer(B, { from: A.id, to: B.id, account: "gmail", confirm: "TRANSFERIR" }),
  );
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, "confirmation_required");
  assert.ok(comms(A.id).gmail, "wrong confirmation changes nothing");
  const unknownTarget = await json(
    await transfer(B, { from: A.id, to: "nao-existe", account: "gmail", confirm: CONFIRM }),
  );
  assert.equal(unknownTarget.status, 409);
  assert.equal(unknownTarget.body.error, "target_not_active");
});

test("transferência move só a conta escolhida, não reativa e audita sem segredos", async () => {
  assert.equal((await reauth(B)).status, 200);
  const body = { from: A.id, to: B.id, account: "gmail", confirm: CONFIRM };
  // Two concurrent attempts: exactly one may commit; the other sees the source account gone.
  const [r1, r2] = await Promise.all([transfer(B, body).then(json), transfer(B, body).then(json)]);
  assert.deepEqual(
    [r1.status, r2.status].sort((a, b) => a - b),
    [200, 404],
    "one transfer, no duplicate",
  );
  const ok = r1.status === 200 ? r1 : r2;
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.account, "gmail");
  assert.equal(ok.body.from, A.id);
  assert.equal(ok.body.to, B.id);
  assert.ok(ok.body.correlation);
  assert.equal(JSON.stringify(ok.body).includes(SECRET), false, "no credential in response");
  assert.equal(
    JSON.stringify(ok.body).includes("ana@exemplo.test"),
    false,
    "no address in response",
  );

  const a = rawData(A.id);
  const b = rawData(B.id);
  assert.equal(a.comms.gmail, undefined, "source lost the selected account");
  assert.ok(a.comms.outlook, "source keeps the unselected account");
  assert.ok(b.comms.gmail, "target received the account");
  assert.ok(b.comms.outlook, "target's own account is untouched");
  assert.match(b.comms.gmail.appPassword, /^enc:/, "credential remains encrypted at rest");
  assert.equal(JSON.stringify(b).includes(SECRET), false, "no plaintext credential stored");

  const decrypted = getSettings(B.id).comms.gmail;
  assert.equal(decrypted.user, "ana@exemplo.test");
  assert.equal(decrypted.appPassword, SECRET);
  assert.equal(decrypted.enabled, false, "transfer does not reactivate the account");
  assert.equal(decrypted.state, "reconnect");
  assert.equal(getSettings(B.id).comms.outlook.appPassword, B_SECRET, "target account unchanged");

  const accounts = await json(await req("/api/mail/accounts", { s: B }));
  assert.equal(accounts.status, 200);
  const gmail = accounts.body.find((x) => x.type === "gmail");
  assert.equal(gmail.enabled, false);
  assert.equal(gmail.hasPassword, true);
  assert.equal(gmail.user, "a***@exemplo.test");
  assert.equal(JSON.stringify(accounts.body).includes(SECRET), false);
  assert.equal(
    (await json(await req("/api/mail/gmail/messages", { s: B }))).status,
    404,
    "disabled until the destination explicitly enables it",
  );

  const audits = db
    .prepare("SELECT kind, detail FROM audit WHERE kind='mail.account_transferred'")
    .all();
  assert.equal(audits.length, 1, "exactly one successful transfer audit");
  const detail = JSON.parse(audits[0].detail);
  assert.equal(detail.account, "gmail");
  assert.equal(detail.fromAdmin, A.id);
  assert.equal(detail.toAdmin, B.id);
  assert.equal(detail.by, B.id);
  assert.equal(detail.correlation, ok.body.correlation);
  assert.equal(JSON.stringify(detail).includes(SECRET), false, "no credential in audit");
  assert.equal(JSON.stringify(detail).includes("ana@exemplo.test"), false, "no address in audit");

  const h = db
    .prepare("SELECT * FROM ownership_history WHERE correlation_id = ?")
    .get(ok.body.correlation);
  assert.equal(h.resource_type, "mail_account");
  assert.equal(h.resource_id, "gmail");
  assert.equal(h.from_admin_id, A.id);
  assert.equal(h.to_admin_id, B.id);
  assert.equal(h.actor_admin_id, B.id);
  assert.equal(h.action, "transfer");

  const again = await json(await transfer(B, body));
  assert.equal(again.status, 404);
  assert.equal(again.body.error, "account_not_found");
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM audit WHERE kind='mail.account_transferred'").get().n,
    1,
    "repetition does not duplicate the audit trail",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM ownership_history WHERE resource_type='mail_account'").get()
      .n,
    1,
    "repetition does not duplicate the history trail",
  );
});

test("conflito no destino é recusado sem sobrescrever a conta existente", async () => {
  assert.equal((await reauth(B)).status, 200);
  const beforeA = rawData(A.id);
  const beforeB = rawData(B.id);
  const r = await json(
    await transfer(B, { from: A.id, to: B.id, account: "outlook", confirm: CONFIRM }),
  );
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "target_account_exists");
  assert.deepEqual(rawData(A.id).comms.outlook, beforeA.comms.outlook);
  assert.deepEqual(rawData(B.id).comms.outlook, beforeB.comms.outlook);
});

test("token de serviço não transfere conta (session-only)", async () => {
  const principal = auth.validateSession(B.cookie.split("=")[1]);
  const { token } = auth.createServiceToken(principal, {
    name: "mail-transfer",
    scopes: ["settings:write"],
  });
  const r = await req("/api/ownership/mail/transfer", {
    method: "POST",
    body: { from: A.id, to: B.id, account: "outlook", confirm: CONFIRM },
    bearer: token,
  });
  assert.equal(r.status, 403);
  assert.ok(comms(A.id).outlook, "nothing changed through a service token");
});

test("recuperação de acesso (break-glass) não transfere a conta de e-mail", () => {
  const recoveryDir = mkdtempSync(join(tmpdir(), "jarvis-mail-recovery-"));
  const env = { ...process.env, JARVIS_DATA_DIR: recoveryDir, JARVIS_NO_LISTEN: "1" };
  const setupScript = `
    import { auth, db } from "./server/db.js";
    import { updateSettings } from "./server/settings.js";
    const { token } = auth.ensureBootstrap();
    const a = auth.setupFirstAdmin({ token, username: "ana", password: ${JSON.stringify(PW)} });
    const b = auth.createAdmin({ adminId: a.id }, { username: "bia", password: ${JSON.stringify(PW)}, currentPassword: ${JSON.stringify(PW)} });
    updateSettings(
      { comms: { gmail: { enabled: true, user: "ana@exemplo.test", appPassword: ${JSON.stringify(SECRET)} } } },
      { adminId: a.id },
    );
    process.stdout.write("__RESULT__" + JSON.stringify({ a: a.id, b: b.id }));
  `;
  const output = execFileSync(
    process.execPath,
    ["--no-warnings", "--input-type=module", "-e", setupScript],
    {
      cwd: repo,
      env,
      encoding: "utf8",
    },
  );
  const marker = output.lastIndexOf("__RESULT__");
  assert.ok(marker >= 0, "setup script returned its ids");
  const { a, b } = JSON.parse(output.slice(marker + "__RESULT__".length));
  execFileSync(process.execPath, ["--no-warnings", "server/recuperar-acesso.js"], {
    cwd: repo,
    env,
    encoding: "utf8",
  });
  const recovered = new DatabaseSync(join(recoveryDir, "jarvis.db"));
  try {
    const aData = JSON.parse(
      recovered.prepare("SELECT data FROM admin_settings WHERE admin_id = ?").get(a).data,
    );
    const bRow = recovered.prepare("SELECT data FROM admin_settings WHERE admin_id = ?").get(b);
    assert.ok(aData.comms.gmail, "account stays with the original owner");
    assert.equal(aData.comms.gmail.enabled, true, "recovery does not change the account");
    assert.equal(aData.comms.gmail.user, "ana@exemplo.test");
    assert.equal(JSON.stringify(aData).includes(SECRET), false, "credential remains encrypted");
    assert.equal(bRow, undefined, "recovery creates no settings/account for another admin");
  } finally {
    recovered.close();
  }
});
