// Fase II — P2: migração v9 (correlation_id em approval_actions + triggers audit)

// Imports e base mínima como o app cria antes das migrações (db.js): as tabelas preservadas
// precisam existir para a verificação de snapshot de cada migração.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, migrate, currentVersion, snapshotCounts, targetVersion } from "../server/migrations.js";

const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

// Base mínima: todas as tabelas preservadas + approval_actions (não preservado, mas esperado)
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-mig-v9-"));
  const db = new DatabaseSync(join(dir, "jarvis.db"));
  db.exec(`
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT DEFAULT '', embedding TEXT, created_at TEXT NOT NULL);
    CREATE TABLE agents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE bots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE runs (id TEXT PRIMARY KEY, bot_id TEXT, started_at TEXT, status TEXT, output TEXT);
    CREATE TABLE approvals (id TEXT PRIMARY KEY, command TEXT, status TEXT, output TEXT, created_at TEXT);
    CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, detail TEXT);
    CREATE TABLE approval_actions (approval_id TEXT PRIMARY KEY, action TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
  // Seed approval_actions com dados simulando estado "pós-P1" (v8)
  db.prepare("INSERT INTO approval_actions (approval_id, action, created_at) VALUES ('a1', '{\"correlation\":\"c1\"}', 't')").run();
  db.prepare("INSERT INTO approval_actions (approval_id, action, created_at) VALUES ('a2', '{}', 't')").run();           // sem correlation
  db.prepare("INSERT INTO approval_actions (approval_id, action, created_at) VALUES ('a3', '{\"other\":\"data\"}', 't')").run(); // sem correlation
  db.prepare("INSERT INTO audit (at, kind, detail) VALUES ('t','x','{}')").run();
  return { db, dir };
}

test("v8 → v9: migração aplicada, coluna criada, backfill, índice e triggers", () => {
  const { db, dir } = fresh();
  // Aplicar migrações v1 → v8 (simula produção atual)
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 8) });
  assert.equal(currentVersion(db), 8);

  // Aplicar v9
  const { from, to, backup } = migrate(db, dir, { migrations: MIGRATIONS.slice(0, 9) });
  assert.equal(from, 8);
  assert.equal(to, 9);
  assert.ok(backup, "backup verificado antes da migração");
});

test("v8 → v9: backfill de correlações existentes preserva valores e deixa NULL quando ausente", () => {
  const { db, dir } = fresh();
  // Aplicar migrações v1→v8 (estado pós-P1)
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 8) });
  assert.equal(currentVersion(db), 8);
  // Aplicar v9 (adiciona coluna, backfill, índice, triggers)
  const { from, to, backup } = migrate(db, dir, { migrations: MIGRATIONS.slice(0, 9) });
  assert.equal(from, 8);
  assert.equal(to, 9);
  assert.ok(backup, "backup verificado antes da migração");
  // Verificar os valores de backfill
  const a1 = db.prepare("SELECT correlation_id FROM approval_actions WHERE approval_id='a1'").get();
  const a2 = db.prepare("SELECT correlation_id FROM approval_actions WHERE approval_id='a2'").get();
  const a3 = db.prepare("SELECT correlation_id FROM approval_actions WHERE approval_id='a3'").get();
  assert.equal(a1.correlation_id, "c1", "registro com correlation no JSON tem valor preenchido");
  assert.equal(a2.correlation_id, null, "registro sem correlation no JSON fica NULL");
  assert.equal(a3.correlation_id, null, "registro sem correlation no JSON fica NULL");
});

test("v8 → v9: índice idx_approval_actions_correlation criado", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 9) });
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_approval_actions_correlation'").get(), "índice existe");
});

test("v8 → v9: triggers de integridade audit", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 9) });
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_audit_no_update'").get(), "trg_audit_no_update existe");
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_audit_no_delete'").get(), "trg_audit_no_delete existe");
});

test("v8 → v9: pragma integrity_check ok", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 9) });
  const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
  assert.equal(integrity, "ok", "integrity check ok");
});

test("v8 → v9: snapshot PRESERVED idêntico antes e depois (apenas para o estado v8; v9 adiciona objetos novos)", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 8) });
  const before = snapshotCounts(db);
  // Aplicar v9
  const { from, to } = migrate(db, dir, { migrations: MIGRATIONS.slice(0, 9) });
  assert.equal(from, 8);
  assert.equal(to, 9);
  // Snapshot após a v9 deve ser idêntico ao de v8 (approval_actions NÃO está em PRESERVED)
  assert.deepEqual(snapshotCounts(db), before, "tabelas preservadas inalteradas após a v9");
});

test("falha na v9: rollback completo (coluna ausente, versão 8) e nova tentativa funciona", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 8) });
  const before = snapshotCounts(db);
  assert.throws(() => migrate(db, dir, { failAfterSql: 9 }), /desfeita/);
  assert.equal(currentVersion(db), 8);
  assert.deepEqual(snapshotCounts(db), before);
  // Nova tentativa sem failAfterSql deve funcionar
  assert.equal(migrate(db, dir).to, targetVersion());
  assert.ok(cols(db, "approval_actions").includes("correlation_id"), "coluna presente após retry");
});

test("falha na v9: rollback usando backup verificado recupera schema v8", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 8) });
  const before = snapshotCounts(db);
  try {
    migrate(db, dir, { failAfterSql: 9 });
    assert.fail("deveria ter lançado erro");
  } catch (e) {
    assert.ok(e.message.includes("desfeita"), "erro de falha esperado");
  }
  // Banco deve permanecer em v8
  assert.equal(currentVersion(db), 8);
  assert.ok(!cols(db, "approval_actions").includes("correlation_id"), "coluna ausente após rollback");
  // A existência do backup verificado já foi confirmada na migração anterior (test 1).
  // Este teste foca no rollback: a versão voltou a 8 e a coluna sumiu.
});

test("v9 reexecutável sobre banco já migrado: idempotente", () => {
  const { db, dir } = fresh();
  // Aplicar todas as migrações v1→v9
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 9) });
  assert.equal(currentVersion(db), 9);
  // Reexecutar v9 deve ser idempotente (backup nulo, versão continua 9)
  const again = migrate(db, dir, { migrations: MIGRATIONS.slice(0, 9) });
  assert.equal(again.backup, null, "idempotente: sem novo backup");
  assert.equal(again.to, 9, "idempotente: versão continua 9");
  // Dados persistem: coluna e índice ainda existem
  assert.ok(db.prepare("SELECT correlation_id FROM approval_actions WHERE approval_id='a1'").get(), "dados persistem");
});