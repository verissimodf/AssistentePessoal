// Server-side OAuth for owner-scoped Gmail API and Microsoft Graph connections.
// Tokens stay encrypted in the local SQLite database; provider HTTP errors never leave this module.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db, now, audit } from "./db.js";
import { assignNew, dropOwnership, ownerOf, tx } from "./ownership.js";
import { encrypt, decrypt } from "./settings.js";
import { MailError, sanitizeEmailBody } from "./mail.js";

const SCOPE = {
  google: {
    read: ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly"],
    send: "https://www.googleapis.com/auth/gmail.send",
  },
  microsoft: {
    read: ["openid", "profile", "email", "offline_access", "User.Read", "Mail.Read"],
    send: "Mail.Send",
  },
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const random = (bytes = 32) => randomBytes(bytes).toString("base64url");
const asJson = async (response) => {
  if (!response.ok) throw new OAuthError(502, "oauth_provider_error");
  return response.json();
};

export class OAuthError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function oauthConfig(provider, env = process.env) {
  if (!Object.hasOwn(SCOPE, provider)) throw new OAuthError(400, "oauth_provider_invalid");
  const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
  const clientId = env[`${prefix}_OAUTH_CLIENT_ID`];
  const clientSecret = env[`${prefix}_OAUTH_CLIENT_SECRET`];
  const redirectUri =
    env[`${prefix}_OAUTH_REDIRECT_URI`] ||
    (env.JARVIS_PUBLIC_BASE_URL &&
      `${env.JARVIS_PUBLIC_BASE_URL.replace(/\/$/, "")}/api/oauth/callback`);
  if (!clientId || !clientSecret || !redirectUri) throw new OAuthError(503, "oauth_not_configured");
  return { clientId, clientSecret, redirectUri, tenant: env.MICROSOFT_OAUTH_TENANT || "common" };
}

export function beginOAuth(
  adminId,
  provider,
  { includeSend = false, env = process.env, at = new Date() } = {},
) {
  if (!adminId) throw new OAuthError(403, "admin_session_required");
  const cfg = oauthConfig(provider, env);
  const state = random();
  const verifier = random(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const scopes = [...SCOPE[provider].read, ...(includeSend ? [SCOPE[provider].send] : [])];
  const url =
    provider === "google"
      ? new URL("https://accounts.google.com/o/oauth2/v2/auth")
      : new URL(
          `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/authorize`,
        );
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(provider === "google" ? { access_type: "offline", include_granted_scopes: "true" } : {}),
  }).toString();
  const createdAt = at.toISOString();
  db.prepare(
    "INSERT INTO oauth_states(state_hash,admin_id,provider,encrypted_verifier,include_send,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
  ).run(
    hash(state),
    adminId,
    provider,
    encrypt(verifier),
    includeSend ? 1 : 0,
    new Date(at.getTime() + 10 * 60_000).toISOString(),
    createdAt,
  );
  return { authorizationUrl: url.toString(), expiresInSeconds: 600 };
}

const profileFor = async (provider, accessToken, fetchFn) => {
  const endpoint =
    provider === "google"
      ? "https://www.googleapis.com/oauth2/v2/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName";
  const r = await fetchFn(endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const profile = await asJson(r);
  const id = provider === "google" ? profile.id : profile.id;
  const email = provider === "google" ? profile.email : profile.mail || profile.userPrincipalName;
  if (!id || !email) throw new OAuthError(502, "oauth_profile_invalid");
  return { id: String(id), email: String(email) };
};

export async function completeOAuth({
  state,
  code,
  env = process.env,
  fetchFn = (...args) => fetch(...args),
  at = new Date(),
}) {
  if (!state || !code || state.length > 256 || code.length > 4096)
    throw new OAuthError(400, "oauth_callback_invalid");
  const stateHash = hash(state);
  // Consume state in one SQLite write so parallel callbacks cannot both pass a preceding SELECT.
  const pending = db
    .prepare("DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING *")
    .get(stateHash, at.toISOString());
  if (!pending) throw new OAuthError(400, "oauth_state_invalid");
  const cfg = oauthConfig(pending.provider, env);
  const tokenUrl =
    pending.provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`;
  const tokenResponse = await fetchFn(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      code_verifier: decrypt(pending.encrypted_verifier),
      grant_type: "authorization_code",
      redirect_uri: cfg.redirectUri,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const token = await asJson(tokenResponse);
  if (!token.access_token) throw new OAuthError(502, "oauth_token_invalid");
  const profile = await profileFor(pending.provider, token.access_token, fetchFn);
  const existing = db
    .prepare(
      `SELECT c.* FROM oauth_connections c JOIN ownership o
    ON o.resource_type='integration_connection' AND o.resource_id=c.id AND o.owner_admin_id=?
    WHERE c.provider=?`,
    )
    .get(pending.admin_id, pending.provider);
  const refreshToken =
    token.refresh_token || (existing && decrypt(existing.encrypted_refresh_token));
  if (!refreshToken) throw new OAuthError(502, "oauth_refresh_token_missing");
  const id = existing?.id || randomUUID();
  const scopes = String(token.scope || "")
    .split(/[ ,]+/)
    .filter(Boolean);
  if (!scopes.length)
    scopes.push(
      ...SCOPE[pending.provider].read,
      ...(pending.include_send ? [SCOPE[pending.provider].send] : []),
    );
  const ts = at.toISOString();
  tx(() => {
    db.prepare(
      `INSERT INTO oauth_connections(id,provider,provider_user_id,email,encrypted_refresh_token,scopes,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'connected',?,?) ON CONFLICT(id) DO UPDATE SET provider_user_id=excluded.provider_user_id,
      email=excluded.email,encrypted_refresh_token=excluded.encrypted_refresh_token,scopes=excluded.scopes,status='connected',updated_at=excluded.updated_at`,
    ).run(
      id,
      pending.provider,
      profile.id,
      profile.email,
      encrypt(refreshToken),
      JSON.stringify(scopes),
      existing?.created_at || ts,
      ts,
    );
    if (!existing) assignNew("integration_connection", id, pending.admin_id);
  });
  audit("oauth.connected", { admin: pending.admin_id, account: pending.provider });
  return { provider: pending.provider, connected: true };
}

const ownedConnection = (adminId, provider) =>
  db
    .prepare(
      `SELECT c.* FROM oauth_connections c JOIN ownership o
  ON o.resource_type='integration_connection' AND o.resource_id=c.id AND o.owner_admin_id=?
  WHERE c.provider=? AND c.status IN ('connected','reconnect') LIMIT 1`,
    )
    .get(adminId, provider) || null;

export function listOAuthConnections(adminId) {
  if (!adminId) return [];
  return db
    .prepare(
      `SELECT c.id,c.provider,c.email,c.scopes,c.status,c.updated_at AS updatedAt FROM oauth_connections c
    JOIN ownership o ON o.resource_type='integration_connection' AND o.resource_id=c.id AND o.owner_admin_id=?
    ORDER BY c.provider`,
    )
    .all(adminId)
    .map((c) => ({ ...c, scopes: JSON.parse(c.scopes) }));
}

export function disconnectOAuth(adminId, provider) {
  const c = ownedConnection(adminId, provider);
  if (!c) return false;
  tx(() => {
    db.prepare("DELETE FROM oauth_connections WHERE id=?").run(c.id);
    dropOwnership("integration_connection", c.id);
  });
  audit("oauth.disconnected", { admin: adminId, account: provider });
  return true;
}

const refreshLocks = new Map();
export async function getOAuthAccessToken(
  adminId,
  provider,
  { env = process.env, fetchFn = (...args) => fetch(...args) } = {},
) {
  const connection = ownedConnection(adminId, provider);
  if (!connection || connection.status !== "connected")
    throw new MailError(404, "account_not_found");
  if (refreshLocks.has(connection.id)) return refreshLocks.get(connection.id);
  const work = (async () => {
    const cfg = oauthConfig(provider, env);
    const tokenUrl =
      provider === "google"
        ? "https://oauth2.googleapis.com/token"
        : `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`;
    const r = await fetchFn(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: decrypt(connection.encrypted_refresh_token),
        grant_type: "refresh_token",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    let token;
    try {
      token = await asJson(r);
    } catch {
      db.prepare("UPDATE oauth_connections SET status='reconnect',updated_at=? WHERE id=?").run(
        now(),
        connection.id,
      );
      throw new MailError(401, "oauth_reconnect_required");
    }
    if (!token.access_token) throw new MailError(502, "oauth_provider_error");
    if (token.refresh_token)
      db.prepare(
        "UPDATE oauth_connections SET encrypted_refresh_token=?,updated_at=? WHERE id=?",
      ).run(encrypt(token.refresh_token), now(), connection.id);
    return token.access_token;
  })().finally(() => refreshLocks.delete(connection.id));
  refreshLocks.set(connection.id, work);
  return work;
}

const headerMap = (headers = []) =>
  Object.fromEntries(headers.map((h) => [String(h.name || "").toLowerCase(), h.value || ""]));
const decodeB64 = (s = "") =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const gmailBody = (part) => {
  if (part?.mimeType === "text/plain" && part.body?.data) return decodeB64(part.body.data);
  for (const child of part?.parts || []) {
    const text = gmailBody(child);
    if (text) return text;
  }
  if (part?.body?.data) return decodeB64(part.body.data);
  return "";
};
const gmailMeta = (m, includeBody = true) => {
  const h = headerMap(m.payload?.headers);
  return {
    id: m.id,
    date: h.date ? new Date(h.date).toISOString() : null,
    from: h.from || "",
    subject: h.subject || "",
    unseen: !(m.labelIds || []).includes("UNREAD"),
    body: includeBody ? sanitizeEmailBody(gmailBody(m.payload)) : "",
  };
};
const graphMeta = (m, includeBody = true) => ({
  id: m.id,
  date: m.receivedDateTime || null,
  from: m.from?.emailAddress?.address || "",
  subject: m.subject || "",
  unseen: !m.isRead,
  body: includeBody ? sanitizeEmailBody(m.body?.content || "") : "",
});

async function providerJson(url, token, fetchFn, init = {}) {
  const r = await fetchFn(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok)
    throw new MailError(
      r.status === 401 ? 401 : 502,
      r.status === 401 ? "oauth_reconnect_required" : "oauth_provider_error",
    );
  return r.status === 204 ? {} : r.json();
}

export function createOAuthMailTransport({
  tokenFor = getOAuthAccessToken,
  fetchFn = (...args) => fetch(...args),
} = {}) {
  const load = async (account, { limit = 20, offset = 0 } = {}, query = "", criteria = {}) => {
    const token = await tokenFor(account.adminId, account.provider);
    if (account.provider === "google") {
      const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
      url.searchParams.set("maxResults", String(Math.min(100, limit + offset)));
      if (query) url.searchParams.set("q", query);
      const page = await providerJson(url, token, fetchFn);
      const rows = await Promise.all(
        (page.messages || []).slice(offset, offset + limit).map(async (m) => {
          const meta = await providerJson(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=Date&metadataHeaders=From&metadataHeaders=Subject`,
            token,
            fetchFn,
          );
          return gmailMeta(meta, false);
        }),
      );
      return { messages: rows, total: page.resultSizeEstimate || rows.length };
    }
    const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
    url.searchParams.set("$top", String(Math.min(100, limit + offset)));
    url.searchParams.set("$skip", String(offset));
    url.searchParams.set("$orderby", "receivedDateTime desc");
    url.searchParams.set("$select", "id,receivedDateTime,from,subject,isRead");
    const page = await providerJson(url, token, fetchFn, {
      headers: { Prefer: 'outlook.body-content-type="text"' },
    });
    const messages = (page.value || []).map(graphMeta);
    const filtered = query
      ? messages.filter((m) => {
          if (criteria.from && !m.from.toLowerCase().includes(String(criteria.from).toLowerCase()))
            return false;
          if (
            criteria.subject &&
            !m.subject.toLowerCase().includes(String(criteria.subject).toLowerCase())
          )
            return false;
          if (criteria.unseen !== undefined && m.unseen !== criteria.unseen) return false;
          if (criteria.since && new Date(m.date) < new Date(criteria.since)) return false;
          if (criteria.before && new Date(m.date) >= new Date(criteria.before)) return false;
          return true;
        })
      : messages;
    return { messages: filtered.slice(0, limit), total: filtered.length };
  };
  return {
    async list(account, page) {
      return load(account, page, "");
    },
    async search(account, criteria, page) {
      const q =
        account.provider === "google"
          ? [
              criteria.from && `from:${criteria.from}`,
              criteria.subject && `subject:${criteria.subject}`,
              criteria.unseen && "is:unread",
              criteria.since &&
                `after:${new Date(criteria.since).toISOString().slice(0, 10).replaceAll("-", "/")}`,
              criteria.before &&
                `before:${new Date(criteria.before).toISOString().slice(0, 10).replaceAll("-", "/")}`,
            ]
              .filter(Boolean)
              .join(" ")
          : [
              criteria.from,
              criteria.subject,
              criteria.unseen ? "unread" : "",
              criteria.since,
              criteria.before,
            ]
              .filter(Boolean)
              .join(" ");
      return load(account, page, q, criteria);
    },
    async read(account, id) {
      const token = await tokenFor(account.adminId, account.provider);
      if (account.provider === "google")
        return gmailMeta(
          await providerJson(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
            token,
            fetchFn,
          ),
        );
      const m = await providerJson(
        `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}?$select=id,receivedDateTime,from,subject,isRead,body`,
        token,
        fetchFn,
        { headers: { Prefer: 'outlook.body-content-type="text"' } },
      );
      return graphMeta(m);
    },
    async send(account, outgoing) {
      if (!account.includeSend) throw new MailError(403, "oauth_send_scope_missing");
      const token = await tokenFor(account.adminId, account.provider);
      if (account.provider === "microsoft") {
        await providerJson("https://graph.microsoft.com/v1.0/me/sendMail", token, fetchFn, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              subject: outgoing.subject,
              body: { contentType: "Text", content: outgoing.text },
              toRecipients: [{ emailAddress: { address: outgoing.to } }],
            },
            saveToSentItems: true,
          }),
        });
        return { messageId: null };
      }
      const raw = [
        `To: ${outgoing.to}`,
        `Subject: ${outgoing.subject.replace(/[\r\n]/g, " ")}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "",
        outgoing.text,
      ].join("\r\n");
      const encoded = Buffer.from(raw).toString("base64url");
      const result = await providerJson(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        token,
        fetchFn,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ raw: encoded }),
        },
      );
      return { messageId: result.id || null };
    },
  };
}

export function oauthAccountResolver(adminId, provider) {
  const c = ownedConnection(adminId, provider);
  if (!c) return null;
  const scopes = JSON.parse(c.scopes);
  const sendScope = SCOPE[provider].send;
  return {
    enabled: c.status === "connected",
    oauth: true,
    provider,
    adminId,
    email: c.email,
    includeSend: scopes.includes(sendScope),
  };
}
