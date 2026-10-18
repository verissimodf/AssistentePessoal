// Messaging, email and calendar connectors. All credentials come from local encrypted settings.
import { createHash } from "node:crypto";
import { getSettings } from "./settings.js";
import { safeFetch } from "./urlpolicy.js";
import { audit } from "./db.js";

const HOSTS = {
  gmail: { imap: "imap.gmail.com", smtp: "smtp.gmail.com" },
  outlook: { imap: "outlook.office365.com", smtp: "smtp.office365.com" },
};

/**
 * Resolve o canal e o destinatário efetivos SEM enviar nada. É o que a ferramenta usa para
 * montar a aprovação — e o que o resolvedor reavalia antes de enviar.
 * O canal `signal` fica indisponível enquanto `signal-cli` não tiver um executor estruturado:
 * hoje ele seria chamado por shell, fora da allowlist de comandos.
 */
export function describeSend(adminId, channel, text) {
  if (!adminId) return { ok: false, reason: "Sem proprietário válido: canal bloqueado." };
  if (channel === "signal") {
    return { ok: false, reason: "Canal signal desabilitado: requer execução estruturada e limitada (não usa shell livre)." };
  }
  const c = getSettings(adminId).comms?.[channel];
  if (!c?.enabled) return { ok: false, reason: `Canal ${channel} não habilitado.` };
  const destination = channel === "telegram" ? c.chatId : channel === "whatsapp" ? c.to : null;
  if (destination === null || destination === undefined || String(destination) === "") {
    return { ok: false, reason: `Canal ${channel} sem destinatário configurado.` };
  }
  return { ok: true, channel, destination: String(destination), text: String(text ?? "") };
}

/** Impressão digital estável de (canal, destinatário, texto): prende a aprovação ao conteúdo. */
export function sendFingerprint({ channel, destination, text }) {
  return createHash("sha256").update(JSON.stringify([channel, destination, text])).digest("hex").slice(0, 32);
}

/**
 * Envia de fato. `expect` (opcional) revalida a impressão digital: se o canal, o destinatário
 * ou o texto mudaram desde a aprovação, nada é enviado.
 */
/** Pós-condição de envio observada no corpo da resposta do provedor.
 *  Um HTTP 2xx isolado NÃO prova aceitação: exige o IDENTIFICADOR que só o provedor emite
 *  (`result.message_id` no Telegram / `messages[0].id` no WhatsApp). Sem identificador →
 *  tentativa sem comprovação (`http_status`, `ok:false`). Nunca devolve token, chat_id ou
 *  conteúdo da mensagem — só metadados do verificador. */
const providerAccepted = (id) =>
  id !== undefined && id !== null && id !== ""
    ? { verifier: "provider_message_id", ok: true }
    : { verifier: "http_status", ok: false };

export async function sendMessage(adminId, channel, text, expect) {
  const d = describeSend(adminId, channel, text);
  if (!d.ok) return { output: d.reason };
  if (expect && sendFingerprint(d) !== expect) return { output: "Envio cancelado: o canal/destinatário mudou desde a aprovação." };
  const c = getSettings(adminId).comms[channel];
  audit("send_message", { admin: adminId, channel });
  if (channel === "telegram") {
    const r = await fetch(`https://api.telegram.org/bot${c.botToken}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: c.chatId, text }) });
    const raw = await r.text();
    if (!r.ok) return { output: `Telegram ${r.status}: ${raw.slice(0, 500)}` };
    let body = null; try { body = JSON.parse(raw); } catch { /* corpo malformado → sem comprovação */ }
    return { output: "Enviado no Telegram.", verify: providerAccepted(body?.result?.message_id) };
  }
  if (channel === "whatsapp") {
    const r = await fetch(`https://graph.facebook.com/v21.0/${c.phoneNumberId}/messages`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${c.token}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to: c.to, type: "text", text: { body: text } }),
    });
    const raw = await r.text();
    if (!r.ok) return { output: `WhatsApp ${r.status}: ${raw.slice(0, 500)}` };
    let body = null; try { body = JSON.parse(raw); } catch { /* corpo malformado → sem comprovação */ }
    return { output: "Enviado no WhatsApp.", verify: providerAccepted(body?.messages?.[0]?.id) };
  }
  if (channel === "signal") {
    // Não suportado: `signal-cli` exigiria shell livre, fora da allowlist e do fluxo aprovado.
    return { output: "Canal signal desabilitado." };
  }
  return { output: `Canal desconhecido: ${channel}` };
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
  // Mesma política de destinos das ferramentas de rede: a URL vem das settings (admin), mas
  // não pode alcançar loopback/privados/metadados.
  const r = await safeFetch(c.icsUrl, { timeoutMs: 20000 });
  if (r.status >= 400) return `Agenda indisponível (HTTP ${r.status}).`;
  const { text: ics } = await r.body();
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
  if (typeof onMessage !== "function") {
    throw new TypeError("startTelegramPolling exige onMessage como função");
  }
  if (typeof listAdmins !== "function") {
    throw new TypeError("startTelegramPolling exige listAdmins como função");
  }

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
