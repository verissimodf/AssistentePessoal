import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, currentVersion, snapshotCounts, targetVersion } from "../server/migrations.js";

// Builds a database exactly as v1.0.0 (pre-auth) left it, with real rows in every table.
function legacyDb() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-mig-"));
  const db = new DatabaseSync(join(dir, "jarvis.db"));
  db.exec(`
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT DEFAULT '', embedding TEXT, created_at TEXT NOT NULL);
CREATE TABLE agents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE bots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE runs (id TEXT PRIMARY KEY, bot_id TEXT, started_at TEXT, status TEXT, output TEXT);
CREATE TABLE approvals (id TEXT PRIMARY KEY, command TEXT, status TEXT, output TEXT, created_at TEXT);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, detail TEXT);
INSERT INTO kv VALUES ('settings', '{"general":{"agentName":"Jarvis"}}');
INSERT INTO memories VALUES ('m1','prefere café','pref',NULL,'2026-01-01'),('m2','reunião segunda','agenda',NULL,'2026-01-02');
INSERT INTO agents VALUES ('jarvis','{"id":"jarvis","name":"Jarvis"}');
INSERT INTO bots VALUES ('b1','{"id":"b1","name":"Resumo","enabled":true}');
INSERT INTO runs VALUES ('r1','b1','2026-01-01','done','ok');
INSERT INTO approvals VALUES ('a1','ls','pending',NULL,'2026-01-01');
INSERT INTO audit (at, kind, detail) VALUES ('2026-01-01','boot','x');
`);
  return { db, dir };
}

test("migration creates a verified backup and preserves every legacy row", () => {
  const { db, dir } = legacyDb();
  const before = snapshotCounts(db);
  const bot = db.prepare("SELECT data FROM bots WHERE id='b1'").get().data;
  const r = migrate(db, dir);
  assert.equal(r.from, 0);
  assert.equal(r.to, targetVersion());
  assert.ok(r.backup && readdirSync(join(dir, "backups")).length === 1);
  assert.deepEqual(snapshotCounts(db), before);
  // no silent ownership assignment on legacy bots
  assert.equal(db.prepare("SELECT data FROM bots WHERE id='b1'").get().data, bot);
  const copy = new DatabaseSync(r.backup, { readOnly: true });
  assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(snapshotCounts(copy), before);
  assert.equal(copy.prepare("PRAGMA user_version").get().user_version, 0);
  copy.close();
});

test("migration is idempotent: second run does nothing and makes no new backup", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  const again = migrate(db, dir);
  assert.equal(again.backup, null);
  assert.equal(readdirSync(join(dir, "backups")).length, 1);
});

test("failure mid-migration rolls back completely (no partial schema)", () => {
  const { db, dir } = legacyDb();
  const before = snapshotCounts(db);
  assert.throws(() => migrate(db, dir, { failAfterSql: 1 }), /desfeita/);
  assert.equal(currentVersion(db), 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('admins','sessions','service_tokens')").get().n, 0);
  assert.deepEqual(snapshotCounts(db), before);
  // and a later normal run succeeds
  assert.equal(migrate(db, dir).to, targetVersion());
});

test("database triggers: max two admins and last active admin is protected", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  const ins = db.prepare("INSERT INTO admins (id, username, password_hash, created_at) VALUES (?, ?, 'x', 'now')");
  ins.run("a1", "ana");
  assert.throws(() => db.prepare("DELETE FROM admins WHERE id='a1'").run(), /last_admin_protected/);
  assert.throws(() => db.prepare("UPDATE admins SET active=0 WHERE id='a1'").run(), /last_admin_protected/);
  ins.run("a2", "bia");
  assert.throws(() => ins.run("a3", "caio"), /admin_limit_reached/);
  db.prepare("UPDATE admins SET active=0 WHERE id='a2'").run(); // allowed: a1 still active
  assert.throws(() => db.prepare("UPDATE admins SET active=0 WHERE id='a1'").run(), /last_admin_protected/);
  ins.run("a3", "caio"); // a disabled admin frees its slot
  assert.throws(() => db.prepare("UPDATE admins SET active=1 WHERE id='a2'").run(), /admin_limit_reached/); // no 3rd via reactivation
});

test("verification detects content changes, not only row counts", async () => {
  const { db, dir } = legacyDb();
  const { snapshotContent } = await import("../server/migrations.js");
  const before = snapshotContent(db);
  const sneaky = [{ version: 1, name: "edita conteúdo", sql: "UPDATE memories SET content='alterado' WHERE id='m1';" }];
  assert.throws(() => migrate(db, dir, { migrations: sneaky }), /alterou dados preservados/);
  assert.equal(currentVersion(db), 0);
  assert.deepEqual(snapshotContent(db), before);
  assert.equal(db.prepare("SELECT content FROM memories WHERE id='m1'").get().content, "prefere café");
});
