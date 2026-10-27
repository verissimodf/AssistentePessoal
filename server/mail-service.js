// Phase 4 — mail wiring. Single seam between the pure core (`mail.js`) and the rest of the service.
//
// The default transport is a deterministic in-memory mock: it never opens a socket, never
// authenticates and never sends anything. The real IMAP/SMTP adapter (`mail-imap.js`) is used ONLY
// when the process environment explicitly opts in with `JARVIS_MAIL_TRANSPORT=imap` — absent,
// empty or invalid values keep the mock (no accidental activation). `setMailTransport` lets tests
// inject a transport without touching routes or tools.
import { createMailService, settingsAccountResolver } from "./mail.js";
import { transportFromEnv } from "./mail-imap.js";
import { getSettings } from "./settings.js";
import { audit } from "./db.js";
import { createOAuthMailTransport, oauthAccountResolver } from "./oauth.js";

const iso = (daysAgo, hour) => new Date(Date.UTC(2026, 9, 15 - daysAgo, hour, 0, 0)).toISOString();

/** Deterministic synthetic mailbox. Clearly a placeholder — no network, no credentials, no real data. */
export function createMockTransport(seed = {}) {
  const messages = seed.messages ?? [
    {
      id: "mock-1",
      date: iso(0, 9),
      from: "equipe@exemplo.test",
      subject: "Bem-vindo (mock)",
      unseen: true,
      body: "Mensagem sintetica de exemplo.\n<script>nao_executar()</script>",
    },
    {
      id: "mock-2",
      date: iso(1, 18),
      from: "alertas@exemplo.test",
      subject: "Relatorio diario (mock)",
      unseen: false,
      body: "<p>Corpo em <b>HTML</b> de exemplo.</p>",
    },
    {
      id: "mock-3",
      date: iso(3, 12),
      from: "chefe@exemplo.test",
      subject: "Reuniao (mock)",
      unseen: false,
      body: "Confirme a reuniao.",
    },
  ];
  const sent = [];

  const match = (m, c) => {
    if (c.from && !String(m.from).toLowerCase().includes(c.from.toLowerCase())) return false;
    if (c.subject && !String(m.subject).toLowerCase().includes(c.subject.toLowerCase()))
      return false;
    if (c.unseen !== undefined && !!m.unseen !== c.unseen) return false;
    if (c.since && new Date(m.date) < new Date(c.since)) return false;
    if (c.before && new Date(m.date) >= new Date(c.before)) return false;
    return true;
  };

  return {
    kind: "mock",
    async list(_account, { limit, offset }) {
      return { messages: messages.slice(offset, offset + limit), total: messages.length };
    },
    async read(_account, id) {
      const m = messages.find((x) => x.id === id);
      if (!m) throw Object.assign(new Error("message not found"), { code: "ENOENT" });
      return m;
    },
    async search(_account, criteria, { limit, offset }) {
      const hits = messages.filter((m) => match(m, criteria));
      return { messages: hits.slice(offset, offset + limit), total: hits.length };
    },
    async send(_account, outgoing) {
      sent.push(outgoing);
      return { messageId: `mock-${sent.length}` };
    },
    // exposed for tests only
    _messages: messages,
    _sent: sent,
  };
}

function build(transport, limits, resolveAccount = settingsAccountResolver(getSettings)) {
  return createMailService({
    transport,
    resolveAccount,
    audit,
    ...(limits ? { limits } : {}),
  });
}

/** OAuth connections take precedence for the same admin/provider; IMAP/mock remain compatible. */
const defaultTransport = () => {
  const legacy = transportFromEnv(process.env) ?? createMockTransport();
  const oauth = createOAuthMailTransport();
  const dispatch =
    (method) =>
    (...args) =>
      args[0]?.oauth ? oauth[method](...args) : legacy[method](...args);
  const resolveLegacy = settingsAccountResolver(getSettings);
  const resolveAccount = (adminId, accountId) => {
    const provider =
      accountId === "gmail" ? "google" : accountId === "outlook" ? "microsoft" : null;
    const connected = provider && oauthAccountResolver(adminId, provider);
    return connected ? { ...connected, type: accountId } : resolveLegacy(adminId, accountId);
  };
  return {
    kind: legacy.kind,
    list: dispatch("list"),
    read: dispatch("read"),
    search: dispatch("search"),
    send: dispatch("send"),
    resolveAccount,
  };
};

const initialTransport = defaultTransport();
let service = build(initialTransport, null, initialTransport.resolveAccount);

/** Replace the transport (tests inject a mock; the real adapter plugs in via the env opt-in). */
export function setMailTransport(transport, limits) {
  const selected = transport ?? defaultTransport();
  service = build(
    selected,
    limits,
    selected.resolveAccount || settingsAccountResolver(getSettings),
  );
}

export const getMailService = () => service;
