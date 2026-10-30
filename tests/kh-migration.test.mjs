// Knowledge Hub (evolução Fase 2): migração v21 — upgrade de v20, banco limpo, idempotência,
// constraints (CHECKs/UNIQUEs/FKs), ownership recriado com tipos kh_* e FTS5 operante.
// Padrão herdado de tests/migrations.test.mjs / tests/workforce-migration.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, currentVersion, targetVersion, MIGRATIONS } from "../server/migrations.js";

function legacyDb() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-kh-mig-"));
  const db = new DatabaseSync(join(dir, "jarvis.db"));
  db.exec(`
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT DEFAULT '', embedding TEXT, created_at TEXT NOT NULL);
CREATE TABLE agents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE bots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE runs (id TEXT PRIMARY KEY, bot_id TEXT, started_at TEXT, status TEXT, output TEXT);
CREATE TABLE approvals (id TEXT PRIMARY KEY, command TEXT, status TEXT, output TEXT, created_at TEXT);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, detail TEXT);
INSERT INTO memories VALUES ('m1','prefere café','pref',NULL,'2026-01-01');
`);
  return { db, dir };
}

test("v21 é a migração de topo e sobe do zero até o schema alvo", () => {
  assert.ok(targetVersion() >= 21);
  const V21 = MIGRATIONS.find((m) => m.version === 21);
  assert.ok(V21, "migração v21 do Knowledge Hub presente");
  const { db, dir } = legacyDb();
  const r = migrate(db, dir);
  assert.equal(r.from, 0);
  assert.ok(r.to >= 21);
  assert.equal(currentVersion(db), r.to);
  for (const t of [
    "kh_libraries",
    "kh_notebooks",
    "kh_sources",
    "kh_source_versions",
    "kh_source_content",
    "kh_chunk_index",
    "kh_relationships",
    "kh_transformations",
    "kh_jobs",
  ])
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(t), t);
  // FTS5 virtual table existe e indexa/busca.
  db.prepare(
    "INSERT INTO kh_fts (rowid, text, title) VALUES (1, 'relatório anual de vendas', 'relatório')",
  ).run();
  const hit = db.prepare("SELECT rowid FROM kh_fts WHERE kh_fts MATCH ?").get("anual");
  assert.equal(hit.rowid, 1);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("backup criado, íntegro e no schema anterior (v0)", () => {
  const { db, dir } = legacyDb();
  const r = migrate(db, dir);
  assert.ok(readdirSync(join(dir, "backups")).length === 1);
  const copy = new DatabaseSync(r.backup, { readOnly: true });
  assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(copy.prepare("PRAGMA user_version").get().user_version, 0);
  copy.close();
});

test("migração é idempotente", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  const again = migrate(db, dir);
  assert.equal(again.backup, null);
});

test("upgrade v20→v21 preserva ownership e dados legados", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir, { migrations: MIGRATIONS.filter((m) => m.version <= 20) });
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 20);
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('adm-1','ana','x','t')",
  ).run();
  db.prepare(
    "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('agent_definition','d1','adm-1','t','created')",
  ).run();
  const r = migrate(db, dir, { migrations: MIGRATIONS.filter((m) => m.version === 21) });
  assert.equal(r.to, 21);
  // Linha de ownership sobrevive à recriação (com CHECK estendido).
  assert.equal(
    db.prepare("SELECT owner_admin_id FROM ownership WHERE resource_id='d1'").get().owner_admin_id,
    "adm-1",
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM kh_libraries").get().n, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("CHECKs e FKs: ingest_status, kind, relações e ownership são fechados", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('a1','ana','x','t')",
  ).run();
  db.prepare(
    "INSERT INTO kh_libraries (id, owner_admin_id, name, created_at, updated_at) VALUES ('l1','a1','Pessoal','t','t')",
  ).run();
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO kh_libraries (id, owner_admin_id, name, kind, created_at, updated_at) VALUES ('l2','a1','Outra','institucional','t','t')",
      )
      .run(),
  );
  db.prepare(
    "INSERT INTO kh_notebooks (id, library_id, owner_admin_id, name, created_at, updated_at) VALUES ('n1','l1','a1','Tese','t','t')",
  ).run();
  // FK: notebook de outra owner/livro inexistente é recusado.
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO kh_notebooks (id, library_id, owner_admin_id, name, created_at, updated_at) VALUES ('n2','ghost','a1','X','t','t')",
      )
      .run(),
  );
  // ingest_status fechado.
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO kh_sources (id, notebook_id, owner_admin_id, title, ingest_status, created_at, updated_at) VALUES ('s1','n1','a1','T','explodiu','t','t')",
      )
      .run(),
  );
  // Relação: tipo de nó fora do conjunto é recusado; kind só explicit|inferred.
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO kh_relationships (id, owner_admin_id, from_type, from_id, relation, to_type, to_id, created_at) VALUES ('r1','a1','nave','n1','relaciona','source','s1','t')",
      )
      .run(),
  );
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO kh_relationships (id, owner_admin_id, from_type, from_id, relation, to_type, to_id, kind, created_at) VALUES ('r2','a1','source','s1','relaciona','notebook','n1','chutado','t')",
      )
      .run(),
  );
  // ownership aceita kh_* e rejeita desconhecido.
  db.prepare(
    "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('kh_source','sX','a1','t','created')",
  ).run();
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('nave','n1','a1','t','created')",
      )
      .run(),
  );
});

test("UNIQUEs: (owner,name) em bibliotecas, (library,name) em notebooks e hash por notebook", () => {
  const { db, dir } = legacyDb();
  migrate(db, dir);
  db.prepare(
    "INSERT INTO admins (id, username, password_hash, created_at) VALUES ('a1','ana','x','t')",
  ).run();
  db.prepare(
    "INSERT INTO kh_libraries (id, owner_admin_id, name, created_at, updated_at) VALUES ('l1','a1','Pessoal','t','t')",
  ).run();
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO kh_libraries (id, owner_admin_id, name, created_at, updated_at) VALUES ('l2','a1','Pessoal','t','t')",
      )
      .run(),
  );
  db.prepare(
    "INSERT INTO kh_notebooks (id, library_id, owner_admin_id, name, created_at, updated_at) VALUES ('n1','l1','a1','Tese','t','t')",
  ).run();
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO kh_notebooks (id, library_id, owner_admin_id, name, created_at, updated_at) VALUES ('n2','l1','a1','Tese','t','t')",
      )
      .run(),
  );
  db.prepare(
    "INSERT INTO kh_sources (id, notebook_id, owner_admin_id, title, content_hash, created_at, updated_at) VALUES ('s1','n1','a1','A','hash1','t','t')",
  ).run();
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO kh_sources (id, notebook_id, owner_admin_id, title, content_hash, created_at, updated_at) VALUES ('s2','n1','a1','B','hash1','t','t')",
      )
      .run(),
  );
});
