// Messaging, email and calendar connectors. All credentials come from local encrypted settings.
import { getSettings } from "./settings.js";
import { runShell } from "./tools.js";
import { audit } from "./db.js";

const HOSTS = {
  gmail: { imap: "imap.gmail.com", smtp: "smtp.gmail.com" },
  outlook: { imap: "outlook.office365.com", smtp: "smtp.office365.com" },
};

export async function sendMessage(channel, text) {
  const c = getSettings().comms?.[channel];
  if (!c?.enabled) return `Canal ${channel} não habilitado.`;
  audit("send_message", { channel, text });
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

export async function sendEmail(account, to, subject, body) {
  const c = getSettings().comms?.[account];
  if (!c?.enabled) return `Conta ${account} não habilitada.`;
  const nodemailer = (await import("nodemailer")).default;
  const t = nodemailer.createTransport({ host: HOSTS[account].smtp, port: 587, secure: false, auth: { user: c.user, pass: c.appPassword } });
  await t.sendMail({ from: c.user, to, subject, text: body });
  audit("send_email", { account, to, subject });
  return "E-mail enviado.";
}

export async function readInbox(account, limit = 10) {
  const c = getSettings().comms?.[account];
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
export async function readCalendar(days = 7) {
  const c = getSettings().comms?.calendar;
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

/** Telegram long-poll: incoming messages are answered by the agent and can fire "message" bots. */
export function startTelegramPolling(onMessage) {
  let offset = 0;
  const loop = async () => {
    const c = getSettings().comms?.telegram;
    if (c?.enabled && c.botToken) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${c.botToken}/getUpdates?timeout=25&offset=${offset}`);
        const j = await r.json();
        for (const u of j.result || []) {
          offset = u.update_id + 1;
          if (u.message?.text && String(u.message.chat.id) === String(c.chatId)) await onMessage("telegram", u.message.text);
        }
      } catch { /* network hiccup */ }
    } else await new Promise((r) => setTimeout(r, 15000));
    setTimeout(loop, 500);
  };
  loop();
}
