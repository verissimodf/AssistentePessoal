// Messaging, email and calendar connectors. All credentials come from local encrypted settings.
import { getSettings } from "./settings.js";
import { runShell } from "./tools.js";
import { audit } from "./db.js";

const HOSTS = {
  gmail: { imap: "imap.gmail.com", smtp: "smtp.gmail.com" },
  outlook: { imap: "outlook.office365.com", smtp: "smtp.office365.com" },
};

export async function sendMessage(adminId, channel, text) {
  if (!adminId) return "Sem proprietário válido: canal bloqueado.";
  const c = getSettings(adminId).comms?.[channel];
  if (!c?.enabled) return `Canal ${channel} não habilitado.`;
  audit("send_message", { admin: adminId, channel });
  if (channel === "telegram") {
    const r = await fetch(`https://api.telegram.org/bot${c.botToken}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: c.chatId, text }) });
    return r.ok ? "Enviado no Telegram." : `Telegram ${r.status}: ${await r.text()}`;
  }
  if (channel === "whatsapp") {
    const r = await fetch(`https://graph.facebook.com/v21.0/${c.phoneNumberId}/messages`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: c.to, type: "text", text: { body: text } }),
    });
    return r.ok ? "Enviado no WhatsApp." : `WhatsApp ${r.status}: ${await r.text()}`;
  }
  if (channel === "signal") {
    return runShell(`signal-cli -a ${JSON.stringify(c.number)} send -m ${JSON.stringify(text)} ${JSON.stringify(c.to)}`);
  }
  return `Canal desconhecido: ${channel}`;
}

export async function sendEmail(adminId, account, to, subject, body) {
  if (!adminId) return "Sem proprietário válido: conta bloqueada.";
  const c = getSettings(adminId).comms?.[account];
  if (!c?.enabled) return `Conta ${account} não habilitada.`;
  const nodemailer = (await import("nodemailer")).default;
  const t = nodemailer.createTransport({ host: HOSTS[account].smtp, port: 587, secure: false, auth: { user: c.user, pass: c.appPassword } });
  await t.sendMail({ from: c.user, to, subject, text: body });
  audit("send_email", { admin: adminId, account });
  return "E-mail enviado.";
}

export async function readInbox(adminId, account, limit = 10) {
  if (!adminId) return "Sem proprietário válido: conta bloqueada.";
  const c = getSettings(adminId).comms?.[account];
  if (!c?.enabled) return `Conta ${account} não habilitada.`;
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({ host: HOSTS[account].imap, port: 993, secure: true, auth: { user: c.user, pass: c.appPassword }, logger: false });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  const out = [];
  try {
    const total = client.mailbox.exists;
    for await (const m of client.fetch(`${Math.max(1, total - limit + 1)}:*`, { envelope: true })) {
      out.push(`- ${m.envelope.date?.toISOString?.().slice(0, 16)} | ${m.envelope.from?.[0]?.address} | ${m.envelope.subject}`);
    }
  } finally { lock.release(); await client.logout(); }
  return out.reverse().join("\n") || "Caixa vazia.";
}

/** Reads an ICS feed (Google Calendar "secret address", Outlook published calendar, Nextcloud…). */
export async function readCalendar(adminId, days = 7) {
  if (!adminId) return "Agenda não configurada.";
  const c = getSettings(adminId).comms?.calendar;
  if (!c?.enabled || !c.icsUrl) return "Agenda não configurada.";
  const ics = await (await fetch(c.icsUrl)).text();
  const events = [];
  for (const block of ics.split("BEGIN:VEVENT").slice(1)) {
    const get = (k) => block.match(new RegExp(`${k}[^:]*:(.*)`))?.[1]?.trim();
    const start = get("DTSTART");
    if (!start) continue;
    const d = new Date(start.replace(/^(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2}))?Z?$/, (_, y, m, dd, _t, h = "00", mi = "00") => `${y}-${m}-${dd}T${h}:${mi}:00`));
    if (d >= new Date() && d <= new Date(Date.now() + days * 864e5)) events.push({ d, s: get("SUMMARY") });
  }
  return events.sort((a, b) => a.d - b.d).map((e) => `- ${e.d.toLocaleString()} — ${e.s}`).join("\n") || "Sem eventos nos próximos dias.";
}

/**
 * Telegram long-poll, one loop per admin whose PERSONAL settings enable Telegram (P2).
 * The owner comes only from whose configuration holds the bot token; the message content and
 * sender are never trusted for identity. Only the configured chatId is accepted.
 */
export function startTelegramPolling(onMessage, listAdmins) {
  const offsets = new Map();
  const tick = async () => {
    for (const adminId of listAdmins()) {
      const c = getSettings(adminId).comms?.telegram;
      if (!c?.enabled || !c.botToken) continue;
      try {
        const r = await fetch(`https://api.telegram.org/bot${c.botToken}/getUpdates?timeout=5&offset=${offsets.get(adminId) || 0}`);
        const j = await r.json();
        for (const u of j.result || []) {
          offsets.set(adminId, u.update_id + 1);
          if (u.message?.text && String(u.message.chat.id) === String(c.chatId)) await onMessage(adminId, "telegram", u.message.text);
        }
      } catch { /* network hiccup */ }
    }
    setTimeout(tick, 3000);
  };
  tick();
}
