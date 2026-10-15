// Versioned, idempotent schema migrations with a verified backup before any change.
// Schema version lives in PRAGMA user_version. Each migration runs inside one transaction:
// if anything fails (including the row-count and row-content check), it rolls back and the database stays
// exactly as it was — never partially migrated. See docs/RECUPERACAO.md.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Tables whose rows must survive every migration untouched. */
export const PRESERVED = ["kv", "memories", "agents", "bots", "runs", "approvals", "audit"];

export const MIGRATIONS = [
  {
    version: 1,
    name: "auth: admins, sessions, login throttling, service tokens",
    sql: `
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE TRIGGER IF NOT EXISTS trg_admins_max_two BEFORE INSERT ON admins
WHEN NEW.active = 1 AND (SELECT COUNT(*) FROM admins WHERE active = 1) >= 2
BEGIN SELECT RAISE(ABORT, 'admin_limit_reached'); END;
CREATE TRIGGER IF NOT EXISTS trg_admins_max_two_reactivate BEFORE UPDATE OF active ON admins
WHEN OLD.active = 0 AND NEW.active = 1 AND (SELECT COUNT(*) FROM admins WHERE active = 1) >= 2
BEGIN SELECT RAISE(ABORT, 'admin_limit_reached'); END;
CREATE TRIGGER IF NOT EXISTS trg_admins_protect_last_delete BEFORE DELETE ON admins
WHEN OLD.active = 1 AND (SELECT COUNT(*) FROM admins WHERE active = 1) <= 1
BEGIN SELECT RAISE(ABORT, 'last_admin_protected'); END;
CREATE TRIGGER IF NOT EXISTS trg_admins_protect_last_disable BEFORE UPDATE OF active ON admins
WHEN OLD.active = 1 AND NEW.active = 0 AND (SELECT COUNT(*) FROM admins WHERE active = 1) <= 1
BEGIN SELECT RAISE(ABORT, 'last_admin_protected'); END;

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_admin ON sessions(admin_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS service_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  created_at INTEGER NOT NULL,
  last_used INTEGER,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS bootstrap (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`,
  },
];

const count = (db, t) => {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  return exists ? db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : null;
};
export const snapshotCounts = (db) => Object.fromEntries(PRESERVED.map((t) => [t, count(db, t)]));
/** Content fingerprint: SHA-256 over every row (all columns, rowid order) of each preserved table. */
export function snapshotContent(db) {
  const out = {};
  for (const t of PRESERVED) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    if (!exists) { out[t] = null; continue; }
    const h = createHash("sha256");
    for (const row of db.prepare(`SELECT rowid AS __rowid, * FROM ${t} ORDER BY rowid`).iterate()) h.update(JSON.stringify(row) + "\n");
    out[t] = h.digest("hex");
  }
  return out;
}
const snapshot = (db) => JSON.stringify({ counts: snapshotCounts(db), content: snapshotContent(db) });
export const currentVersion = (db) => db.prepare("PRAGMA user_version").get().user_version;
export const targetVersion = () => MIGRATIONS.at(-1).version;

/** Copy the live database with VACUUM INTO and prove the copy is readable and complete. */
export function backupAndVerify(db, dataDir, label) {
  const dir = join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `jarvis-${stamp}-${label}.db`);
  if (existsSync(file)) throw new Error(`backup já existe: ${file}`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = copy.prepare("PRAGMA integrity_check").get().integrity_check;
    if (integrity !== "ok") throw new Error(`backup corrompido: ${integrity}`);
    const a = snapshot(db);
    const b = snapshot(copy);
    if (a !== b) throw new Error(`backup incompleto: ${a} != ${b}`);
  } finally {
    copy.close();
  }
  return file;
}

/**
 * Apply pending migrations. Returns { from, to, backup }. Throws (and leaves the database
 * untouched) if the backup cannot be verified or any migration step fails.
 * opts.failAfterSql is a test hook that simulates a crash mid-migration.
 */
export function migrate(db, dataDir, opts = {}) {
  const from = currentVersion(db);
  const list = opts.migrations || MIGRATIONS; // test hook
  const pending = list.filter((m) => m.version > from);
  if (!pending.length) return { from, to: from, backup: null };

  const backup = backupAndVerify(db, dataDir, `v${from}`);
  for (const m of pending) {
    const before = snapshot(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.sql);
      if (opts.failAfterSql === m.version) throw new Error("falha simulada");
      const after = snapshot(db);
      if (before !== after) throw new Error(`migração ${m.version} alterou dados preservados`);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Migração ${m.version} (${m.name}) falhou e foi desfeita: ${e.message}. Backup verificado: ${backup}`);
    }
  }
  return { from, to: currentVersion(db), backup };
}
