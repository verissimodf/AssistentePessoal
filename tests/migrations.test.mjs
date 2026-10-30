import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migrate,
  currentVersion,
  snapshotCounts,
  targetVersion,
  MIGRATIONS,
} from "../server/migrations.js";

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

test("v14 preserva ownership existente ao ampliar o tipo permitido", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 13) });
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
  ).run("admin-v14", "admin-v14", "hash", "2026-10-27T00:00:00Z");
  const row = ["agent", "agent-existente", "admin-v14", "2026-10-27T00:00:00Z", "claimed"];
  db.prepare(
    "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES (?, ?, ?, ?, ?)",
  ).run(...row);

  const result = migrate(db, dir, { migrations: MIGRATIONS.slice(13, 14) });
  assert.equal(result.from, 13);
  assert.equal(result.to, 14);
  assert.deepEqual(
    Object.values(
      db
        .prepare(
          "SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership",
        )
        .get(),
    ),
    row,
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('inbox', 'x', 'admin-v14', 'now', 'claimed')",
        )
        .run(),
    /CHECK constraint failed/,
  );
});

test("v15 cria ledger idempotente sem alterar linhas preservadas", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 14) });
  const before = snapshotCounts(db);
  const result = migrate(db, dir, { migrations: MIGRATIONS.slice(14, 15) });
  assert.equal(result.from, 14);
  assert.equal(result.to, 15);
  assert.deepEqual(snapshotCounts(db), before);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.deepEqual(
    db
      .prepare('PRAGMA table_info("bot_schedule_claims")')
      .all()
      .map((c) => c.name),
    ["trigger_key", "bot_id", "trigger_type", "status", "run_id", "claimed_at", "updated_at"],
  );
  const claim = ["bot:daily:2026-10-27", "bot", "daily", "claimed", "2026-10-27", "2026-10-27"];
  db.prepare(
    "INSERT INTO bot_schedule_claims (trigger_key, bot_id, trigger_type, status, claimed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(...claim);
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO bot_schedule_claims (trigger_key, bot_id, trigger_type, status, claimed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(...claim),
    /UNIQUE constraint failed/,
  );
});

test("v16 cria fila de jobs, amplia ownership e preserva recursos existentes", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 15) });
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('admin-v16','admin-v16','hash','now')",
  ).run();
  db.prepare(
    "INSERT INTO ownership (resource_type,resource_id,owner_admin_id,assigned_at,origin) VALUES ('bot','keep-bot','admin-v16','now','created')",
  ).run();
  const result = migrate(db, dir, { migrations: MIGRATIONS.slice(15, 16) });
  assert.equal(result.from, 15);
  assert.equal(result.to, 16);
  assert.equal(
    db
      .prepare(
        "SELECT owner_admin_id FROM ownership WHERE resource_type='bot' AND resource_id='keep-bot'",
      )
      .get().owner_admin_id,
    "admin-v16",
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO ownership (resource_type,resource_id,owner_admin_id,assigned_at,origin) VALUES ('invalid','x','admin-v16','now','created')",
        )
        .run(),
    /CHECK constraint failed/,
  );
  assert.deepEqual(
    db
      .prepare('PRAGMA table_info("durable_jobs")')
      .all()
      .map((c) => c.name),
    [
      "id",
      "idempotency_key",
      "bot_id",
      "trigger_type",
      "occurrence_key",
      "encrypted_payload",
      "status",
      "attempts",
      "available_at",
      "lease_owner",
      "lease_until",
      "run_id",
      "last_error",
      "created_at",
      "updated_at",
    ],
  );
});

test("v17 adiciona política de retenção sem remover nem alterar memórias", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 16) });
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('admin-v17','admin-v17','hash','now')",
  ).run();
  db.prepare(
    "INSERT INTO memories(id,content,tags,embedding,created_at) VALUES('keep-memory','private fact','',NULL,'2025-01-01T00:00:00.000Z')",
  ).run();
  const before = db
    .prepare("SELECT id,content,tags,embedding,created_at FROM memories WHERE id='keep-memory'")
    .get();
  const result = migrate(db, dir, { migrations: MIGRATIONS.slice(16, 17) });
  assert.equal(result.to, 17);
  assert.deepEqual(
    db
      .prepare("SELECT id,content,tags,embedding,created_at FROM memories WHERE id='keep-memory'")
      .get(),
    before,
  );
  assert.equal(
    db.prepare("SELECT 1 FROM memory_retention_anchors WHERE memory_id='keep-memory'").get(),
    undefined,
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});

test("v18 adiciona OAuth e preserva todos os vínculos ownership", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 17) });
  db.prepare(
    "INSERT INTO admins(id,username,password_hash,created_at) VALUES('admin-v18','admin-v18','hash','now')",
  ).run();
  const existing = ["bot", "old-owned-bot", "admin-v18", "now", "created"];
  db.prepare(
    "INSERT INTO ownership(resource_type,resource_id,owner_admin_id,assigned_at,origin) VALUES(?,?,?,?,?)",
  ).run(...existing);
  const before = db
    .prepare("SELECT resource_type,resource_id,owner_admin_id,assigned_at,origin FROM ownership")
    .all();
  const result = migrate(db, dir, { migrations: MIGRATIONS.slice(17, 18) });
  assert.equal(result.to, 18);
  assert.deepEqual(
    db
      .prepare("SELECT resource_type,resource_id,owner_admin_id,assigned_at,origin FROM ownership")
      .all(),
    before,
  );
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO ownership(resource_type,resource_id,owner_admin_id,assigned_at,origin) VALUES('invalid','x','admin-v18','now','created')",
        )
        .run(),
    /CHECK constraint failed/,
  );
});

test("v19 encrypts pending browser fill text in place", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 18) });
  const originalText = "FORM_SECRET_SENTINEL: enviar proposta confidencial";
  const originalAction = {
    kind: "browser_action",
    params: {
      op: "fill",
      url: "https://example.com/submit",
      selector: "#message",
      text: originalText,
    },
    fingerprint: "fingerprint-v1",
    correlation: "correlation-v1",
  };
  db.prepare(
    "INSERT INTO approval_actions(approval_id,action,correlation_id,created_at) VALUES('a1',?,'correlation-v1','now')",
  ).run(JSON.stringify(originalAction));
  const beforeApproval = db.prepare("SELECT status FROM approvals WHERE id='a1'").get();
  const beforeCount = db.prepare("SELECT COUNT(*) n FROM approval_actions").get().n;
  const encryptFn = (text) => `enc_test:${Buffer.from(text, "utf8").toString("base64")}`;
  const result = migrate(db, dir, { encryptFn });
  assert.equal(result.to, targetVersion());

  const storedRow = db
    .prepare("SELECT action,correlation_id FROM approval_actions WHERE approval_id='a1'")
    .get();
  assert.equal(storedRow.action.includes(originalText), false);
  const stored = JSON.parse(storedRow.action);
  assert.equal(stored.params.text, undefined);
  assert.equal(
    Buffer.from(stored.params.encryptedText.slice("enc_test:".length), "base64").toString("utf8"),
    originalText,
  );
  assert.equal(stored.fingerprint, "fingerprint-v1");
  assert.equal(storedRow.correlation_id, "correlation-v1");
  assert.deepEqual(db.prepare("SELECT status FROM approvals WHERE id='a1'").get(), beforeApproval);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM approval_actions").get().n, beforeCount);

  const backup = new DatabaseSync(result.backup, { readOnly: true });
  assert.equal(
    JSON.parse(
      backup.prepare("SELECT action FROM approval_actions WHERE approval_id='a1'").get().action,
    ).params.text,
    originalText,
  );
  backup.close();
  assert.equal(migrate(db, dir).backup, null);
});

test("v19 rollback preserves plaintext action if encryption fails", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 18) });
  const originalText = "ROLLBACK_SECRET_SENTINEL";
  const originalAction = {
    kind: "browser_action",
    params: {
      op: "fill",
      url: "https://example.com/submit",
      selector: "#message",
      text: originalText,
    },
    fingerprint: "fingerprint-v1",
  };
  db.prepare(
    "INSERT INTO approval_actions(approval_id,action,correlation_id,created_at) VALUES('a1',?,NULL,'now')",
  ).run(JSON.stringify(originalAction));
  assert.throws(
    () =>
      migrate(db, dir, {
        encryptFn: () => {
          throw new Error("key unavailable");
        },
      }),
    /desfeita.*key unavailable/,
  );
  assert.equal(currentVersion(db), 18);
  assert.equal(
    JSON.parse(
      db.prepare("SELECT action FROM approval_actions WHERE approval_id='a1'").get().action,
    ).params.text,
    originalText,
  );
});

test("failure mid-migration rolls back completely (no partial schema)", () => {
  const { db, dir } = legacyDb();
  const before = snapshotCounts(db);
  assert.throws(() => migrate(db, dir, { failAfterSql: 1 }), /desfeita/);
  assert.equal(currentVersion(db), 0);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('admins','sessions','service_tokens')",
      )
      .get().n,
    0,
  );
  assert.deepEqual(snapshotCounts(db), before);
  // and a later normal run succeeds
  assert.equal(migrate(db, dir).to, targetVersion());
});

test("database triggers: max two admins and last active admin is protected", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  const ins = db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES (?, ?, 'x', 'now')",
  );
  ins.run("a1", "ana");
  assert.throws(() => db.prepare("DELETE FROM admins WHERE id='a1'").run(), /last_admin_protected/);
  assert.throws(
    () => db.prepare("UPDATE admins SET active=0 WHERE id='a1'").run(),
    /last_admin_protected/,
  );
  ins.run("a2", "bia");
  assert.throws(() => ins.run("a3", "caio"), /admin_limit_reached/);
  db.prepare("UPDATE admins SET active=0 WHERE id='a2'").run(); // allowed: a1 still active
  assert.throws(
    () => db.prepare("UPDATE admins SET active=0 WHERE id='a1'").run(),
    /last_admin_protected/,
  );
  ins.run("a3", "caio"); // a disabled admin frees its slot
  assert.throws(
    () => db.prepare("UPDATE admins SET active=1 WHERE id='a2'").run(),
    /admin_limit_reached/,
  ); // no 3rd via reactivation
});

test("verification detects content changes, not only row counts", async () => {
  const { db, dir } = legacyDb();
  const { snapshotContent } = await import("../server/migrations.js");
  const before = snapshotContent(db);
  const sneaky = [
    {
      version: 1,
      name: "edita conteúdo",
      sql: "UPDATE memories SET content='alterado' WHERE id='m1';",
    },
  ];
  assert.throws(() => migrate(db, dir, { migrations: sneaky }), /alterou dados preservados/);
  assert.equal(currentVersion(db), 0);
  assert.deepEqual(snapshotContent(db), before);
  assert.equal(
    db.prepare("SELECT content FROM memories WHERE id='m1'").get().content,
    "prefere café",
  );
});
