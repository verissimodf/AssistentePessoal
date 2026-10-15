// Phase 4 — D7: real IMAP/SMTP transport (app password). OAuth is out of scope for this phase.
//
// This module implements the SAME interface the core expects from a transport
// (list/read/search/send) on top of imapflow + nodemailer. It is NOT wired in by default: the default
// transport in `mail-service.js` is still the mock. Activating it requires an explicit decision (D7)
// and operator-configured credentials — this code never authenticates on its own.
//
// Safety properties:
//  - the provider clients are INJECTABLE, so contract tests exercise the mapping without any socket;
//  - timeouts, bounded retries and error classification live in the core (`mail.js`), which wraps every
//    call — this adapter only throws the raw provider error and never logs it;
//  - credentials (user/app password) are only ever placed in the provider client options; they are
//    never returned, logged or embedded in error messages.

/** Provider endpoints (D7 direction: IMAPS 993 / SMTP 587 + STARTTLS). */
export const DEFAULT_HOSTS = {
  gmail: { imap: "imap.gmail.com", smtp: "smtp.gmail.com" },
  outlook: { imap: "outlook.office365.com", smtp: "outlook.office365.com" },
};

const loadImapFlow = async () => (await import("imapflow")).ImapFlow;
const loadNodemailer = async () => (await import("nodemailer")).default;

const address = (a) => (a?.address ? (a.name ? `${a.name} <${a.address}>` : a.address) : "");

/** Map an IMAP envelope to the core's metadata shape. Never returns the body. */
export function envelopeToMeta(uid, envelope = {}, flags) {
  const seen =
    typeof flags?.has === "function"
      ? flags.has("\\Seen")
      : Array.isArray(flags)
        ? flags.includes("\\Seen")
        : false;
  return {
    id: String(uid),
    date: envelope.date ? new Date(envelope.date).toISOString() : null,
    from: address(envelope.from?.[0]),
    subject: envelope.subject ?? "",
    unseen: !seen,
  };
}

/**
 * Best-effort plain extraction from a raw RFC822 source: drop the header block. The core then
 * sanitises whatever remains (HTML or text), so no markup can reach the client. Full MIME part
 * selection/decoding is a refinement that needs the real server to validate.
 */
export function rawToBody(source) {
  if (!source) return "";
  const raw = Buffer.isBuffer(source) ? source.toString("utf8") : String(source);
  const split = raw.search(/\r?\n\r?\n/);
  if (split === -1) return raw;
  return raw.slice(split).replace(/^\r?\n\r?\n/, "");
}

/**
 * Create the IMAP/SMTP transport. `createImapClient` and `createSmtpTransport` are async factories
 * (injectable for contract tests); by default they load imapflow/nodemailer lazily, so importing this
 * module never opens a socket.
 */
export function createImapSmtpTransport({
  hosts = DEFAULT_HOSTS,
  createImapClient,
  createSmtpTransport,
  imapPort = 993,
  smtpPort = 587,
  logger = false,
} = {}) {
  const imapFactory = createImapClient ?? (async (opts) => new (await loadImapFlow())(opts));
  const smtpFactory =
    createSmtpTransport ?? (async (opts) => (await loadNodemailer()).createTransport(opts));

  const endpoint = (account) => {
    const h = hosts[account?.type];
    if (!h) throw Object.assign(new Error("unsupported provider"), { code: "EUNKNOWN" });
    return h;
  };

  const withMailbox = async (account, fn) => {
    const h = endpoint(account);
    const client = await imapFactory({
      host: h.imap,
      port: imapPort,
      secure: true,
      auth: { user: account.user, pass: account.appPassword },
      logger,
    });
    await client.connect();
    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        return await fn(client);
      } finally {
        lock.release();
      }
    } finally {
      try {
        await client.logout();
      } catch {
        /* best effort */
      }
    }
  };

  const fetchMetas = async (client, sequence) => {
    const out = [];
    for await (const m of client.fetch(sequence, { envelope: true, flags: true, uid: true })) {
      out.push(envelopeToMeta(m.uid, m.envelope, m.flags));
    }
    return out;
  };

  return {
    async list(account, { limit, offset }) {
      return withMailbox(account, async (client) => {
        const total = client.mailbox?.exists ?? 0;
        if (total === 0) return { messages: [], total: 0 };
        const end = Math.max(1, total - offset);
        const start = Math.max(1, end - limit + 1);
        const messages = await fetchMetas(client, `${start}:${end}`);
        return { messages: messages.reverse(), total };
      });
    },

    async read(account, id) {
      return withMailbox(account, async (client) => {
        for await (const m of client.fetch(
          String(id),
          { envelope: true, flags: true, uid: true, source: true },
          { uid: true },
        )) {
          return { ...envelopeToMeta(m.uid, m.envelope, m.flags), body: rawToBody(m.source) };
        }
        throw Object.assign(new Error("message not found"), { code: "ENOENT" });
      });
    },

    async search(account, criteria, { limit, offset }) {
      return withMailbox(account, async (client) => {
        const query = {};
        if (criteria.from) query.from = criteria.from;
        if (criteria.subject) query.subject = criteria.subject;
        if (criteria.since) query.since = new Date(criteria.since);
        if (criteria.before) query.before = new Date(criteria.before);
        if (criteria.unseen !== undefined) query.seen = !criteria.unseen;
        const uids = await client.search(query, { uid: true });
        const total = uids.length;
        const slice = uids.slice(offset, offset + limit);
        const messages = slice.length ? await fetchMetas(client, slice.join(",")) : [];
        return { messages, total };
      });
    },

    async send(account, { to, subject, text }) {
      const h = endpoint(account);
      const transport = await smtpFactory({
        host: h.smtp,
        port: smtpPort,
        secure: false,
        requireTLS: true,
        auth: { user: account.user, pass: account.appPassword },
      });
      try {
        const info = await transport.sendMail({ from: account.user, to, subject, text });
        return { messageId: info?.messageId ?? null };
      } finally {
        try {
          transport.close?.();
        } catch {
          /* best effort */
        }
      }
    },
  };
}
