import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), "jarvis-oauth-"));
process.env.JARVIS_NO_LISTEN = "1";
const { auth, db } = await import("../server/db.js");
const {
  beginOAuth,
  completeOAuth,
  listOAuthConnections,
  getOAuthAccessToken,
  disconnectOAuth,
  createOAuthMailTransport,
  OAuthError,
} = await import("../server/oauth.js");
auth.setupFirstAdmin({
  token: auth.ensureBootstrap().token,
  username: "oauth-admin",
  password: "senha-muito-forte-1",
});
const admin = db.prepare("SELECT id FROM admins WHERE username='oauth-admin'").get().id;
const env = {
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "https://jarvis.example/api/oauth/callback",
};
const json = (value, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => value,
});

test("OAuth usa state one-use, PKCE, refresh token cifrado e ownership do administrador", async () => {
  const started = beginOAuth(admin, "google", { includeSend: true, env });
  const authUrl = new URL(started.authorizationUrl);
  assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
  assert.match(authUrl.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  const state = authUrl.searchParams.get("state");
  const expectedVerifier = (await import("../server/settings.js")).decrypt(
    db.prepare("SELECT encrypted_verifier FROM oauth_states").get().encrypted_verifier,
  );
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("code_verifier"), expectedVerifier);
      return json({
        access_token: "short-lived-access",
        refresh_token: "long-lived-refresh",
        scope:
          "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send",
      });
    }
    return json({ id: "provider-user", email: "user@example.test" });
  };
  assert.deepEqual(await completeOAuth({ state, code: "temporary-code", env, fetchFn }), {
    provider: "google",
    connected: true,
  });
  const rows = listOAuthConnections(admin);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, "user@example.test");
  assert.ok(rows[0].scopes.includes("https://www.googleapis.com/auth/gmail.send"));
  const encrypted = db
    .prepare("SELECT encrypted_refresh_token FROM oauth_connections")
    .get().encrypted_refresh_token;
  assert.match(encrypted, /^enc:/);
  assert.ok(!encrypted.includes("long-lived-refresh"));
  assert.equal(
    await getOAuthAccessToken(admin, "google", {
      env,
      fetchFn: async () => json({ access_token: "refreshed-access" }),
    }),
    "refreshed-access",
  );
  await assert.rejects(
    completeOAuth({ state, code: "replay", env, fetchFn }),
    (e) => e.code === "oauth_state_invalid",
  );
  assert.equal(disconnectOAuth(admin, "google"), true);
  assert.deepEqual(listOAuthConnections(admin), []);
});

test("OAuth account without client registration fails before storing a pending state", () => {
  assert.throws(
    () => beginOAuth(admin, "microsoft", { env: {} }),
    (e) => e instanceof OAuthError && e.code === "oauth_not_configured",
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM oauth_states").get().n, 0);
});

test("Gmail transport list loads metadata without fetching message bodies", async () => {
  const calls = [];
  const mail = createOAuthMailTransport({
    tokenFor: async () => "token",
    fetchFn: async (url) => {
      calls.push(String(url));
      if (String(url).includes("/messages?") && !String(url).includes("/messages/m1"))
        return json({ messages: [{ id: "m1" }], resultSizeEstimate: 1 });
      return json({
        id: "m1",
        labelIds: ["INBOX"],
        payload: {
          headers: [
            { name: "From", value: "A <a@example.test>" },
            { name: "Subject", value: "Hello" },
            { name: "Date", value: "Mon, 26 Oct 2026 10:00:00 GMT" },
          ],
        },
      });
    },
  });
  const result = await mail.list({ provider: "google", adminId: admin }, { limit: 10, offset: 0 });
  assert.equal(result.messages[0].subject, "Hello");
  assert.equal(result.messages[0].body, "");
  assert.ok(calls[1].includes("format=metadata"));
});

test("Microsoft Graph search applies criteria to metadata without requesting message bodies", async () => {
  let requested;
  const mail = createOAuthMailTransport({
    tokenFor: async () => "token",
    fetchFn: async (url) => {
      requested = String(url);
      return json({
        value: [
          {
            id: "match",
            receivedDateTime: "2026-10-26T10:00:00Z",
            from: { emailAddress: { address: "a@example.test" } },
            subject: "Relatório",
            isRead: false,
          },
          {
            id: "read",
            receivedDateTime: "2026-10-26T10:00:00Z",
            from: { emailAddress: { address: "a@example.test" } },
            subject: "Relatório",
            isRead: true,
          },
          {
            id: "other",
            receivedDateTime: "2026-10-26T10:00:00Z",
            from: { emailAddress: { address: "b@example.test" } },
            subject: "Outro",
            isRead: false,
          },
        ],
      });
    },
  });
  const result = await mail.search(
    { provider: "microsoft", adminId: admin },
    { from: "a@example.test", subject: "relatório", unseen: true },
    { limit: 10, offset: 0 },
  );
  assert.deepEqual(
    result.messages.map((message) => message.id),
    ["match"],
  );
  assert.equal(
    new URL(requested).searchParams.get("$select"),
    "id,receivedDateTime,from,subject,isRead",
  );
  assert.doesNotMatch(requested, /body/i);
});
