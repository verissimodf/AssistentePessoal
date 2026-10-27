import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, MIGRATIONS, snapshotCounts } from "../server/migrations.js";

// P0.3.1 — asserção de esquema por migração. Motivo: `CREATE TABLE IF NOT EXISTS` NÃO falha quando
// já existe qualquer objeto com o mesmo nome (uma VIEW homónima é ignorada em silêncio e a migração
// "conclui" sem criar a tabela — observado em ensaio real a 2026-10-18). Estes testes cobrem o
// caminho positivo e os dois caminhos negativos (VIEW homónima e tabela com estrutura divergente).

const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-assert-"));
  return { db: new DatabaseSync(join(dir, "jarvis.db")), dir };
};
const tableOf = (db, name) => db.prepare("SELECT type FROM sqlite_master WHERE name = ?").get(name);
const userVersion = (db) => db.prepare("PRAGMA user_version").get().user_version;

test("v11: migração cria session_focus com colunas e PK esperadas (asserção aprova)", () => {
  const { db, dir } = fresh();
  const r = migrate(db, dir);
  assert.equal(r.to, MIGRATIONS.at(-1).version);
  assert.equal(tableOf(db, "session_focus").type, "table");
  const cols = db.prepare('PRAGMA table_info("session_focus")').all();
  assert.deepEqual(
    cols.map((c) => c.name),
    ["admin_id", "objective", "summary", "decisions", "updated_at"],
  );
  const pk = cols.filter((c) => c.pk > 0).map((c) => c.name);
  assert.deepEqual(pk, ["admin_id"]);
  db.close();
});

test("v11: VIEW homónima aborta a migração com asserção de esquema e faz rollback total", () => {
  const { db, dir } = fresh();
  // Base já em v10 (como produção) com dados reais nas tabelas preservadas.
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 10) });
  const before = snapshotCounts(db);
  db.exec("CREATE VIEW session_focus AS SELECT 'nada' AS objective");

  assert.throws(
    () => migrate(db, dir),
    (e) =>
      /asserção de esquema/.test(e.message) &&
      /session_focus é view, esperado table/.test(e.message),
  );
  // Rollback completo: versão continua 10, sem tabela parcial, a VIEW pré-existente intacta.
  assert.equal(userVersion(db), 10);
  assert.equal(tableOf(db, "session_focus").type, "view");
  assert.deepEqual(snapshotCounts(db), before);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  db.close();
});

test("v11: tabela homónima com estrutura divergente também aborta (colunas obrigatórias)", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 10) });
  // Tabela chamada session_focus mas sem as colunas que a migração promete.
  db.exec("CREATE TABLE session_focus (admin_id TEXT PRIMARY KEY)");

  assert.throws(
    () => migrate(db, dir),
    (e) => /asserção de esquema/.test(e.message) && /sem colunas/.test(e.message),
  );
  assert.equal(userVersion(db), 10);
  const cols = db
    .prepare('PRAGMA table_info("session_focus")')
    .all()
    .map((c) => c.name);
  assert.deepEqual(cols, ["admin_id"]); // objeto pré-existente não foi "consertado" às escondidas
  db.close();
});

test("v11: PK divergente aborta (admin_id tem de ser a chave primária)", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 10) });
  db.exec(`CREATE TABLE session_focus (
    admin_id TEXT NOT NULL, objective TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
    decisions TEXT NOT NULL DEFAULT '[]', updated_at TEXT, PRIMARY KEY (objective))`);

  assert.throws(
    () => migrate(db, dir),
    (e) => /asserção de esquema/.test(e.message) && /PK de session_focus/.test(e.message),
  );
  assert.equal(userVersion(db), 10);
  db.close();
});
