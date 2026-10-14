// Local SQLite storage (node:sqlite, zero native deps). Everything lives in ./data.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export const DATA_DIR = process.env.JARVIS_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
mkdirSync(join(DATA_DIR, "voices"), { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "jarvis.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT DEFAULT '', embedding TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, bot_id TEXT, started_at TEXT, status TEXT, output TEXT);
CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, command TEXT, status TEXT, output TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, detail TEXT);
`);

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();

export function kvGet(key, fallback = null) {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function kvSet(key, value) {
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}
export function audit(kind, detail) {
  db.prepare("INSERT INTO audit (at, kind, detail) VALUES (?, ?, ?)").run(now(), kind, typeof detail === "string" ? detail : JSON.stringify(detail));
}

// JSON document tables (agents, bots)
export function docs(table) {
  return {
    list: () => db.prepare(`SELECT data FROM ${table}`).all().map((r) => JSON.parse(r.data)),
    get: (id) => { const r = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id); return r ? JSON.parse(r.data) : null; },
    save: (item) => {
      const full = { ...(item.id ? docs(table).get(item.id) || {} : {}), ...item, id: item.id || uid() };
      db.prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(full.id, JSON.stringify(full));
      return full;
    },
    remove: (id) => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id),
  };
}
export const agents = docs("agents");
export const bots = docs("bots");

if (agents.list().length === 0) {
  agents.save({
    id: "jarvis", name: "Jarvis", active: true, provider: "ollama", model: "llama3.1",
    instructions: "Você é J.A.R.V.I.S., assistente pessoal leal, preciso e elegante. Responda no idioma do usuário. Use a memória para lembrar preferências e fatos importantes.",
    tools: ["web_search", "fetch_url", "remember", "recall", "run_command", "cli_agent", "send_message"],
  });
}
