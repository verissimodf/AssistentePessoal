// Local scheduler for autonomous bots: daily time, interval, file change, incoming message, voice phrase.
import { watch } from "node:fs";
import { bots, db, now, uid, audit } from "./db.js";
import { runAgent } from "./llm.js";
import { resolveBotScopes } from "./auth.js";
import { ownerOf, assignNew, tx } from "./ownership.js";
import { reindexPendingDocuments } from "./documents.js";

/**
 * Identity of a bot run: the bot itself, on behalf of its owner admin. Ownership comes only from
 * the `ownership` table (Phase 2); the owner_admin_id stored in the bot JSON is informational.
 * Bots without a valid, active owner do not run (P4) — callers audit "legacy_blocked".
 * Scopes are explicit per bot (least privilege, never "*").
 */
export function botPrincipal(bot) {
  const owner = bot?.id ? ownerOf("bot", bot.id) : null;
  if (!owner) return null;
  const a = db.prepare("SELECT active FROM admins WHERE id = ?").get(owner);
  if (!a || !a.active) return null;
  return { type: "bot", botId: bot.id, adminId: owner, legacy: false, scopes: resolveBotScopes(bot) };
}

const TRIGGERS = new Set(["manual", "daily", "interval", "file", "message", "voice"]);
/** Audit a blocked attempt on an unowned bot. Metadata only: no message text, no file path. */
export function auditLegacyBlocked(botId, triggerType) {
  audit("authz.bot_denied", { bot: botId, reason: "legacy_blocked", trigger_type: TRIGGERS.has(triggerType) ? triggerType : "manual" });
}

/** reason is only shown to the model; triggerType (enum) is what gets audited. */
export async function runBot(bot, reason = "manual", triggerType = "manual") {
  const trig = TRIGGERS.has(triggerType) ? triggerType : "manual";
  if (!bot) return { status: "error", output: "bot inexistente" };
  const fresh = bots.get(bot.id) || bot; // re-read: config may have changed since scheduling
  if (reason !== "manual" && !fresh.enabled) return { status: "skipped", output: "bot desativado" };
  const principal = botPrincipal(fresh);
  if (!principal) {
    const reasonCode = ownerOf("bot", fresh.id) ? "owner_inactive" : "legacy_blocked";
    audit("authz.bot_denied", { bot: fresh.id, reason: reasonCode, trigger_type: trig });
    return { status: "denied", output: reasonCode === "legacy_blocked" ? "Bot sem proprietário: execução bloqueada até um administrador assumi-lo." : "Proprietário do bot inativo." };
  }
  bot = fresh;
  const id = uid();
  tx(() => {
    db.prepare("INSERT INTO runs (id, bot_id, started_at, status, output) VALUES (?, ?, ?, 'running', '')").run(id, bot.id, now());
    assignNew("run", id, principal.adminId);
  });
  audit("bot_run", { bot: bot.id, trigger_type: trig, owner: principal.adminId, scopes: principal.scopes, correlation: id });
  try {
    const r = await runAgent({
      agentId: bot.agent_id,
      autonomy: bot.autonomy || "confirm",
      principal,
      runId: id,
      maxSteps: Math.min(50, Number(bot.max_steps) || 8),
      messages: [{ role: "user", content: `[Tarefa autônoma "${bot.name}" disparada por: ${reason}]\n${bot.goal}` }],
      extraSystem: "Você está executando uma tarefa autônoma sem o usuário presente. Conclua o objetivo usando as ferramentas e termine com um resumo curto do que foi feito.",
    });
    const cancelled = /^Execução cancelada/.test(String(r.reply || ""));
    const status = cancelled ? "cancelled" : r.pending.length ? "awaiting_approval" : "done";
    db.prepare("UPDATE runs SET status=?, output=? WHERE id=?").run(status, r.reply, id);
    bots.save({ ...bot, last_run: now() });
    return { id, status, output: r.reply };
  } catch (e) {
    db.prepare("UPDATE runs SET status='error', output=? WHERE id=?").run(e.message, id);
    return { id, status: "error", output: e.message };
  }
}

/** Runs of a bot, restricted to runs owned by adminId. */
export const listRuns = (botId, adminId) =>
  adminId ? db.prepare(`SELECT r.* FROM runs r JOIN ownership o ON o.resource_type = 'run' AND o.resource_id = r.id AND o.owner_admin_id = ?
    WHERE r.bot_id = ? ORDER BY r.started_at DESC LIMIT 20`).all(adminId, botId) : [];

const watchers = new Map();
const lastDaily = new Map();
const lastInterval = new Map();
let lastAutoHeal = 0;

function syncWatchers() {
  const fileBots = bots.list().filter((b) => b.enabled && b.trigger_type === "file" && b.trigger_value && botPrincipal(b));
  for (const [id, w] of watchers) if (!fileBots.find((b) => b.id === id)) { w.close(); watchers.delete(id); }
  for (const b of fileBots) {
    if (watchers.has(b.id)) continue;
    try {
      let t;
      const w = watch(b.trigger_value, { recursive: true }, (_e, f) => { clearTimeout(t); t = setTimeout(() => runBot(b, `arquivo alterado: ${f}`, "file"), 2000); });
      watchers.set(b.id, w);
    } catch (e) { console.warn(`[bots] não foi possível observar ${b.trigger_value}: ${e.message}`); }
  }
}

export function startScheduler() {
  setInterval(() => {
    try {
      const d = new Date();
      const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      const today = d.toDateString();
      for (const b of bots.list().filter((x) => x.enabled)) {
        if (b.trigger_type === "daily" && b.trigger_value === hhmm && lastDaily.get(b.id) !== today) {
          lastDaily.set(b.id, today);
          runBot(b, `agenda ${hhmm}`, "daily"); // legacy bots: audited once, at the real firing time
        }
        if (b.trigger_type === "interval") {
          const mins = Math.max(1, Number(b.trigger_value) || 60);
          const last = lastInterval.get(b.id) || Date.now();
          if (!lastInterval.has(b.id)) lastInterval.set(b.id, last);
          else if (Date.now() - last >= mins * 60000) { lastInterval.set(b.id, Date.now()); runBot(b, `intervalo ${mins} min`, "interval"); }
        }
      }
      syncWatchers();

      // Auto-Healer RAG em segundo plano (v1.4.0): periodicamente verifica documentos em lexical_only
      if (Date.now() - lastAutoHeal >= 5 * 60 * 1000) {
        lastAutoHeal = Date.now();
        const activeAdmins = db.prepare("SELECT id FROM admins WHERE active = 1").all();
        for (const a of activeAdmins) {
          reindexPendingDocuments(a.id, { limit: 5 }).catch(() => {});
        }
      }
    } catch (e) {
      // Nunca deixe uma exceção do agendador derrubar o serviço inteiro.
      console.warn(`[bots] scheduler: ${e.message}`);
    }
  }, 20000);
}

/** Fire bots whose trigger phrase appears in a voice/text command or incoming message. */
export function triggerByText(type, text, adminId) {
  if (!adminId) return [];
  const lower = String(text).toLowerCase();
  const matches = bots.list().filter((b) => b.enabled && b.trigger_type === type && b.trigger_value && lower.includes(String(b.trigger_value).toLowerCase()));
  // Unowned matches: blocked attempt is audited (no text); the caller learns nothing.
  for (const b of matches) if (!ownerOf("bot", b.id)) auditLegacyBlocked(b.id, type);
  return matches.filter((b) => ownerOf("bot", b.id) === adminId).map((b) => runBot(b, `${type}: "${text}"`, type));
}
