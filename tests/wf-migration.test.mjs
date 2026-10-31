// Workflow Studio (evolução Fase 3): migração v22 — upgrade, idempotência, constraints,
// ownership wf_* e FTS intacto. Padrão dos testes de migração anteriores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, currentVersion, targetVersion, MIGRATIONS } from "../server/migrations.js";

function legacyDb() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-wf3-mig-"));
  const db = new DatabaseSync(join(dir, "jarvis.db"));
  db.exec(`
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT DEFAULT '', embedding TEXT, created_at TEXT NOT NULL);
CREATE TABLE agents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE bots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE runs (id TEXT PRIMARY KEY, bot_id TEXT, started_at TEXT, status TEXT, output TEXT);
CREATE TABLE approvals (id TEXT PRIMARY KEY, command TEXT, status TEXT, output TEXT, created_at TEXT);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, detail TEXT);
`);
  return { db, dir };
}

test("v22 existe e o schema sobe do zero com as tabelas wf_* e ownership estendido", () => {
  const V22 = MIGRATIONS.find((m) => m.version === 22);
  assert.ok(V22, "migração v22 do Workflow Studio presente");
  const { db, dir } = legacyDb();
  const r = migrate(db, dir);
  assert.equal(r.to, targetVersion());
  assert.ok(currentVersion(db) >= 22);
  for (const t of [
    "wf_definitions",
    "wf_definition_versions",
    "wf_runs",
    "wf_node_executions",
    "wf_events",
    "wf_policies",
    "wf_policy_revisions",
  ])
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(t), t);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("backup íntegro no schema anterior; migração idempotente", () => {
  const { db, dir } = legacyDb();
  const r = migrate(db, dir);
  const copy = new DatabaseSync(r.backup, { readOnly: true });
  assert.equal(copy.prepare("PRAGMA user_version").get().user_version, 0);
  assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  copy.close();
  const again = migrate(db, dir);
  assert.equal(again.backup, null);
});

test("upgrade v21→v22 preserva ownership (incl. tipos kh_*) e dados", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir, { migrations: MIGRATIONS.filter((m) => m.version <= 21) });
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('adm-1','ana','x','t')",
  ).run();
  db.prepare(
    "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('kh_source','s1','adm-1','t','created')",
  ).run();
  const r = migrate(db, dir, { migrations: MIGRATIONS.filter((m) => m.version === 22) });
  assert.equal(r.to, 22);
  assert.equal(
    db.prepare("SELECT owner_admin_id FROM ownership WHERE resource_id='s1'").get().owner_admin_id,
    "adm-1",
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM wf_policies").get().n, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("CHECKs: status de run/nó, efeito de política e scope são fechados", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('a1','ana','x','t')",
  ).run();
  db.prepare(
    "INSERT INTO wf_definitions (id, owner_admin_id, name, created_at, updated_at) VALUES ('d1','a1','Fluxo','t','t')",
  ).run();
  const run = db.prepare(
    "INSERT INTO wf_runs (id, definition_id, definition_version, owner_admin_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  );
  assert.throws(() => run.run("r1", "d1", 1, "a1", "explodiu", "t", "t"));
  run.run("r1", "d1", 1, "a1", "queued", "t", "t");
  const node = db.prepare(
    "INSERT INTO wf_node_executions (id, run_id, node_id, node_type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  );
  assert.throws(() => node.run("n1", "r1", "a", "tool", "viajando", "t", "t"));
  const pol = db.prepare(
    "INSERT INTO wf_policies (id, owner_admin_id, name, scope, target, effect, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  assert.throws(() => pol.run("p1", "a1", "P", "tool", "*", "talvez", "t", "t"));
  assert.throws(() => pol.run("p2", "a1", "P2", "galaxia", "*", "deny", "t", "t"));
  // ownership: tipos wf_* aceitos; desconhecido rejeitado.
  db.prepare(
    "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('wf_policy','p3','a1','t','created')",
  ).run();
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('nave','n1','a1','t','created')",
      )
      .run(),
  );
});

test("FKs e versionamento: versões únicas por definição; revisões de política versionadas", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('a1','ana','x','t')",
  ).run();
  db.prepare(
    "INSERT INTO wf_definitions (id, owner_admin_id, name, current_version, created_at, updated_at) VALUES ('d1','a1','F',1,'t','t')",
  ).run();
  db.prepare(
    "INSERT INTO wf_definition_versions (id, definition_id, version, graph, created_at) VALUES ('v1','d1',1,'{}','t')",
  ).run();
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO wf_definition_versions (id, definition_id, version, graph, created_at) VALUES ('v2','d1',1,'{}','t')",
      )
      .run(),
  );
  db.prepare(
    "INSERT INTO wf_policies (id, owner_admin_id, name, version, scope, target, conditions, effect, created_at, updated_at) VALUES ('p1','a1','P',1,'tool','*','[]','deny','t','t')",
  ).run();
  db.prepare(
    "INSERT INTO wf_policy_revisions (id, policy_id, version, snapshot, created_at) VALUES ('r1','p1',1,'{}','t')",
  ).run();
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO wf_policy_revisions (id, policy_id, version, snapshot, created_at) VALUES ('r2','p1',1,'{}','t')",
      )
      .run(),
  );
});
