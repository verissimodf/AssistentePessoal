// Workforce (evolução Fase 1): migração v20 — agent_definitions/agent_runs em banco limpo,
// upgrade de schema anterior, idempotência, constraints e CHECKs do ownership recriado.
// Padrão de fixture herdado de tests/migrations.test.mjs (banco pré-auth com linhas reais).
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

function legacyDb() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-wf-mig-"));
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
INSERT INTO memories VALUES ('m1','prefere café','pref',NULL,'2026-01-01');
INSERT INTO agents VALUES ('jarvis','{"id":"jarvis","name":"Jarvis"}');
INSERT INTO runs VALUES ('r1','b1','2026-01-01','done','ok');
INSERT INTO approvals VALUES ('a1','ls','pending',NULL,'2026-01-01');
`);
  return { db, dir };
}

test("migrações da Workforce existem e o schema sobe do zero até o alvo (>= 20)", () => {
  const V20 = MIGRATIONS.find((m) => m.version === 20);
  assert.ok(V20, "migração v20 da Workforce presente");
  assert.ok(targetVersion() >= 20);
  const { db, dir } = legacyDb();
  const r = migrate(db, dir);
  assert.equal(r.from, 0);
  assert.equal(r.to, targetVersion());
  assert.equal(currentVersion(db), targetVersion());
  assert.ok(readdirSync(join(dir, "backups")).length === 1);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='agent_definitions'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='agent_runs'").get());
  const idx = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_runs'")
    .all()
    .map((i) => i.name);
  assert.ok(idx.includes("idx_agent_runs_owner"));
  assert.ok(idx.includes("idx_agent_runs_idem"));
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("snapshot preserva as linhas legadas e os backups ficam íntegros", () => {
  const { db, dir } = legacyDb();
  const before = snapshotCounts(db);
  const r = migrate(db, dir);
  assert.deepEqual(snapshotCounts(db), before);
  const copy = new DatabaseSync(r.backup, { readOnly: true });
  assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(copy.prepare("PRAGMA user_version").get().user_version, 0);
  copy.close();
});

test("migração é idempotente: segunda execução não faz nada e não cria backup", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  const again = migrate(db, dir);
  assert.equal(again.backup, null);
});

test("upgrade do schema imediatamente anterior (v19→v20) preserva dados", () => {
  const { db, dir } = legacyDb();
  // Sobe até v19 e insere dados que a v20 precisa preservar.
  migrate(db, dir, { migrations: MIGRATIONS.filter((m) => m.version <= 19) });
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 19);
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('adm-1','ana','x','t')",
  ).run();
  db.prepare(
    "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('bot','b1','adm-1','t','migrated')",
  ).run();
  const r = migrate(db, dir, { migrations: MIGRATIONS.filter((m) => m.version === 20) });
  assert.equal(r.to, 20);
  // A linha de ownership sobrevive à recriação da tabela.
  assert.equal(
    db.prepare("SELECT owner_admin_id FROM ownership WHERE resource_id='b1'").get().owner_admin_id,
    "adm-1",
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agent_definitions").get().n, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("CHECKs do v20: status de run inválido e tipo de ownership desconhecido são rejeitados", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('a1','ana','x','t')",
  ).run();
  db.prepare(
    "INSERT INTO agent_definitions (id, owner_admin_id, name, created_at, updated_at) VALUES ('dA','a1','Pesq','t1','t1')",
  ).run();
  const ins = db.prepare(
    "INSERT INTO agent_runs (id, definition_id, definition_version, owner_admin_id, correlation_id, objective, status, depth, budget_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
  );
  assert.throws(() => ins.run("r1", "dA", 1, "a1", "c1", "o", "explodiu", 0, "{}", "t", "t"));
  // ownership recriado aceita os tipos novos...
  db.prepare(
    "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('agent_definition','dA','a1','t','created')",
  ).run();
  db.prepare(
    "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('agent_run','rX','a1','t','created')",
  ).run();
  // ...e rejeita tipo desconhecido (CHECK integral após a recriação).
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('nave','n1','a1','t','created')",
      )
      .run(),
  );
});

test("ownership permanece imutável (trigger recriado pela v20)", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('a1','ana','x','t')",
  ).run();
  db.prepare(
    "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('agent_definition','d1','a1','t','created')",
  ).run();
  assert.throws(() =>
    db.prepare("UPDATE ownership SET owner_admin_id='a2' WHERE resource_id='d1'").run(),
  );
});

test("UNIQUE (owner, name) em agent_definitions e índice parcial de idempotência", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('a1','ana','x','t')",
  ).run();
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('a2','bia','x','t')",
  ).run();
  db.prepare(
    "INSERT INTO agent_definitions (id, owner_admin_id, name, created_at, updated_at) VALUES ('dA','a1','Pesq','t1','t1')",
  ).run();
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO agent_definitions (id, owner_admin_id, name, created_at, updated_at) VALUES ('dB','a1','Pesq','t2','t2')",
      )
      .run(),
  );
  // Mesmo nome para outro admin é permitido.
  db.prepare(
    "INSERT INTO agent_definitions (id, owner_admin_id, name, created_at, updated_at) VALUES ('dC','a2','Pesq','t3','t3')",
  ).run();
  // Idempotência: mesma chave para o mesmo admin colide; chaves nulas nunca colidem.
  const ins = db.prepare(
    "INSERT INTO agent_runs (id, definition_id, definition_version, owner_admin_id, correlation_id, objective, status, depth, budget_json, idempotency_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  ins.run("rA", "dA", 1, "a1", "cA", "o", "queued", 0, "{}", "chave-1", "t", "t");
  assert.throws(() =>
    ins.run("rB", "dA", 1, "a1", "cB", "o", "queued", 0, "{}", "chave-1", "t", "t"),
  );
  ins.run("rC", "dA", 1, "a1", "cC", "o", "queued", 0, "{}", "chave-2", "t", "t");
  ins.run("rD", "dA", 1, "a1", "cD", "o", "queued", 0, "{}", null, "t", "t");
  ins.run("rE", "dA", 1, "a1", "cE", "o", "queued", 0, "{}", null, "t", "t");
});
