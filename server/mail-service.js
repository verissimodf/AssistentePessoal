// Phase 4 — mail wiring. Single seam between the pure core (`mail.js`) and the rest of the service.
//
// IMPORTANT: the transport is a PLACEHOLDER. The real IMAP/SMTP adapter is NOT implemented and the
// provider authentication step is a pending product decision (docs/FASE-4-EMAIL.md §9/§11, D7).
// Until then the default transport is a deterministic in-memory mock: it never opens a socket,
// never authenticates and never sends anything. `setMailTransport` exists so tests (and, later, the
// approved real adapter) can inject a different transport without touching routes or tools.
import { createMailService, settingsAccountResolver } from "./mail.js";
import { getSettings } from "./settings.js";
import { audit } from "./db.js";

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

function build(transport, limits) {
  return createMailService({
    transport,
    resolveAccount: settingsAccountResolver(getSettings),
    audit,
    ...(limits ? { limits } : {}),
  });
}

let service = build(createMockTransport());

/** Replace the transport (tests inject a mock; the future real adapter plugs in here). */
export function setMailTransport(transport, limits) {
  service = build(transport ?? createMockTransport(), limits);
}

export const getMailService = () => service;
