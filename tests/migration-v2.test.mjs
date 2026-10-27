// Phase 2 — migration v2 on a synthetic v1 database: preserved data, provable ownership only,
// legacy settings kept byte-for-byte, global policy not widened, idempotence, rollback, restore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migrate,
  MIGRATIONS,
  currentVersion,
  snapshotCounts,
  snapshotContent,
} from "../server/migrations.js";

// This suite validates migration v2 in isolation; later migrations (v3+) are out of scope here.
const migrateV2 = (db, dir, opts = {}) =>
  migrate(db, dir, { ...opts, migrations: MIGRATIONS.filter((m) => m.version <= 2) });

const SETTINGS = JSON.stringify({
  general: { language: "en" },
  host: { enabled: true, allowlist: "echo" },
  integrations: { claude_code: { enabled: true, command: "claude -p {prompt}" } },
  voice: { tts: "xtts", localVoiceUrl: "http://127.0.0.1:7778" },
  providers: { openai: { apiKey: "enc:a:b:c" } },
});

function v1Db() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-mig2-"));
  const db = new DatabaseSync(join(dir, "jarvis.db"));
  db.exec(`
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT DEFAULT '', embedding TEXT, created_at TEXT NOT NULL);
CREATE TABLE agents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE bots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE runs (id TEXT PRIMARY KEY, bot_id TEXT, started_at TEXT, status TEXT, output TEXT);
CREATE TABLE approvals (id TEXT PRIMARY KEY, command TEXT, status TEXT, output TEXT, created_at TEXT);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, detail TEXT);`);
  migrate(db, dir, { migrations: MIGRATIONS.filter((m) => m.version === 1) });
  db.prepare("INSERT INTO kv VALUES ('settings', ?)").run(SETTINGS);
  db.exec(`
INSERT INTO admins (id, username, password_hash, created_at) VALUES ('ad1','ana','x','now');
INSERT INTO memories VALUES ('m1','prefere café','pref',NULL,'2026-01-01');
INSERT INTO agents VALUES ('jarvis','{"id":"jarvis","name":"Jarvis"}');
INSERT INTO bots VALUES ('b-owned','{"id":"b-owned","owner_admin_id":"ad1"}'),('b-ghost','{"id":"b-ghost","owner_admin_id":"nao-existe"}'),('b-legacy','{"id":"b-legacy"}');
INSERT INTO runs VALUES ('r1','b-owned','2026-01-01','done','ok'),('r2','b-legacy','2026-01-01','done','ok'),('r3','b-ghost','2026-01-01','done','ok');
INSERT INTO approvals VALUES ('a1','ls','pending',NULL,'2026-01-01');
INSERT INTO audit (at, kind, detail) VALUES ('2026-01-01','boot','x');`);
  assert.equal(currentVersion(db), 1);
  return { db, dir };
}
const owners = (db) =>
  Object.fromEntries(
    db
      .prepare("SELECT resource_type || ':' || resource_id k, owner_admin_id o FROM ownership")
      .all()
      .map((r) => [r.k, r.o]),
  );

test("v2 preserves counts and SHA-256 content of every preserved table; backup verified", () => {
  const { db, dir } = v1Db();
  const counts = snapshotCounts(db),
    content = snapshotContent(db);
  const r = migrateV2(db, dir);
  assert.deepEqual([r.from, r.to], [1, 2]);
  assert.ok(r.backup);
  assert.deepEqual(snapshotCounts(db), counts);
  assert.deepEqual(snapshotContent(db), content);
  const copy = new DatabaseSync(r.backup, { readOnly: true });
  assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(copy.prepare("PRAGMA user_version").get().user_version, 1);
  assert.deepEqual(snapshotContent(copy), content);
  copy.close();
});

test("v2 assigns ownership only from provable sources; nothing else gets an owner", () => {
  const { db, dir } = v1Db();
  migrateV2(db, dir);
  assert.deepEqual(owners(db), { "bot:b-owned": "ad1", "run:r1": "ad1" });
  assert.equal(
    db.prepare("SELECT origin FROM ownership WHERE resource_id='b-owned'").get().origin,
    "migrated",
  );
});

test("v2 keeps legacy settings byte-for-byte; global extracts only global keys without widening policy", () => {
  const { db, dir } = v1Db();
  migrateV2(db, dir);
  assert.equal(db.prepare("SELECT data FROM legacy_settings").get().data, SETTINGS);
  assert.equal(db.prepare("SELECT claimed_by FROM legacy_settings").get().claimed_by, null);
  const g = JSON.parse(db.prepare("SELECT data FROM global_settings").get().data);
  assert.deepEqual(Object.keys(g).sort(), ["host", "integrations", "localVoiceUrl"]);
  assert.deepEqual(g.host, { enabled: true, allowlist: "echo" });
  assert.equal(JSON.stringify(g).includes("enc:a:b:c"), false, "no personal secret in global");
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM admin_settings").get().n,
    0,
    "no automatic personal assignment",
  );
});

test("v2 is idempotent: second run makes no backup and changes nothing", () => {
  const { db, dir } = v1Db();
  migrateV2(db, dir);
  const before = JSON.stringify([snapshotContent(db), owners(db)]);
  const again = migrateV2(db, dir);
  assert.equal(again.backup, null);
  assert.equal(JSON.stringify([snapshotContent(db), owners(db)]), before);
});

test("v2 failure rolls back completely: stays v1, no new tables, data intact; retry succeeds", () => {
  const { db, dir } = v1Db();
  const content = snapshotContent(db);
  assert.throws(() => migrateV2(db, dir, { failAfterSql: 2 }), /desfeita/);
  assert.equal(currentVersion(db), 1);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('ownership','admin_settings','global_settings','legacy_settings','legacy_claims')",
      )
      .get().n,
    0,
  );
  assert.deepEqual(snapshotContent(db), content);
  assert.equal(migrateV2(db, dir).to, 2);
});

test("ownership records are immutable (no silent re-assignment)", () => {
  const { db, dir } = v1Db();
  migrateV2(db, dir);
  assert.throws(
    () =>
      db.prepare("UPDATE ownership SET owner_admin_id='outro' WHERE resource_id='b-owned'").run(),
    /ownership_immutable/,
  );
});

test("restoring the verified backup returns the exact pre-migration database", () => {
  const { db, dir } = v1Db();
  const content = snapshotContent(db);
  const { backup } = migrateV2(db, dir);
  db.close();
  const restored = join(dir, "restaurado.db");
  copyFileSync(backup, restored);
  const r = new DatabaseSync(restored);
  assert.equal(currentVersion(r), 1);
  assert.deepEqual(snapshotContent(r), content);
  assert.equal(r.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='ownership'").get().n, 0);
  r.close();
});
