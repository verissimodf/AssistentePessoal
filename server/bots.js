// Local scheduler for autonomous bots: daily time, interval, file change, incoming message, voice phrase.
import { watch } from "node:fs";
import { bots, db, now, uid, audit } from "./db.js";
import { runAgent } from "./llm.js";

export async function runBot(bot, reason = "manual") {
  const id = uid();
  db.prepare("INSERT INTO runs (id, bot_id, started_at, status, output) VALUES (?, ?, ?, 'running', '')").run(id, bot.id, now());
  audit("bot_run", { bot: bot.name, reason });
  try {
    const r = await runAgent({
      agentId: bot.agent_id,
      autonomy: bot.autonomy || "confirm",
      maxSteps: Math.min(50, Number(bot.max_steps) || 8),
      messages: [{ role: "user", content: `[Tarefa autônoma "${bot.name}" disparada por: ${reason}]\n${bot.goal}` }],
      extraSystem: "Você está executando uma tarefa autônoma sem o usuário presente. Conclua o objetivo usando as ferramentas e termine com um resumo curto do que foi feito.",
    });
    const status = r.pending.length ? "awaiting_approval" : "done";
    db.prepare("UPDATE runs SET status=?, output=? WHERE id=?").run(status, r.reply, id);
    bots.save({ ...bot, last_run: now() });
    return { id, status, output: r.reply };
  } catch (e) {
    db.prepare("UPDATE runs SET status='error', output=? WHERE id=?").run(e.message, id);
    return { id, status: "error", output: e.message };
  }
}

export const listRuns = (botId) => db.prepare("SELECT * FROM runs WHERE bot_id=? ORDER BY started_at DESC LIMIT 20").all(botId);

const watchers = new Map();
const lastDaily = new Map();
const lastInterval = new Map();

function syncWatchers() {
  const fileBots = bots.list().filter((b) => b.enabled && b.trigger_type === "file" && b.trigger_value);
  for (const [id, w] of watchers) if (!fileBots.find((b) => b.id === id)) { w.close(); watchers.delete(id); }
  for (const b of fileBots) {
    if (watchers.has(b.id)) continue;
    try {
      let t;
      const w = watch(b.trigger_value, { recursive: true }, (_e, f) => { clearTimeout(t); t = setTimeout(() => runBot(b, `arquivo alterado: ${f}`), 2000); });
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
          runBot(b, `agenda ${hhmm}`);
        }
        if (b.trigger_type === "interval") {
          const mins = Math.max(1, Number(b.trigger_value) || 60);
          const last = lastInterval.get(b.id) || Date.now();
          if (!lastInterval.has(b.id)) lastInterval.set(b.id, last);
          else if (Date.now() - last >= mins * 60000) { lastInterval.set(b.id, Date.now()); runBot(b, `intervalo ${mins} min`); }
        }
      }
      syncWatchers();
    } catch (e) {
      // Nunca deixe uma exceção do agendador derrubar o serviço inteiro.
      console.warn(`[bots] scheduler: ${e.message}`);
    }
  }, 20000);
}

/** Fire bots whose trigger phrase appears in a voice/text command or incoming message. */
export function triggerByText(type, text) {
  const lower = text.toLowerCase();
  return bots.list()
    .filter((b) => b.enabled && b.trigger_type === type && b.trigger_value && lower.includes(String(b.trigger_value).toLowerCase()))
    .map((b) => runBot(b, `${type}: "${text}"`));
}
