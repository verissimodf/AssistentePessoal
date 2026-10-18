// Fase H — migrações do histórico de conversas: v7 (tabelas novas, exatamente como aplicada em
// produção) e v8 (ALTER aditivo da coluna agent_id). As duas não tocam em nenhum dado preservado,
// são idempotentes e desfazem tudo em caso de falha (rollback completo, versão intacta).
// A v8 existe porque a v7 já estava aplicada em instalações existentes quando a coluna foi
// introduzida: a v7 não pode ser reescrita (quem já a tem não a roda de novo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, migrate, currentVersion, snapshotCounts, targetVersion } from "../server/migrations.js";

const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

// Base mínima como o app a cria antes das migrações (db.js): as tabelas preservadas precisam
// existir para a verificação de snapshot de cada migração.
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-migconv-"));
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

const seedPreserved = (db) => {
  db.prepare("INSERT INTO kv (key, value) VALUES ('k','v')").run();
  db.prepare("INSERT INTO memories (id, content, tags, created_at) VALUES ('m1','prefere café','legado','2025-01-01')").run();
  db.prepare("INSERT INTO agents (id, data) VALUES ('ag','{}')").run();
  db.prepare("INSERT INTO bots (id, data) VALUES ('bo','{}')").run();
  db.prepare("INSERT INTO runs (id, started_at, status) VALUES ('r','t','ok')").run();
  db.prepare("INSERT INTO approvals (id, command, status, created_at) VALUES ('ap','echo','pending','t')").run();
  db.prepare("INSERT INTO audit (at, kind, detail) VALUES ('t','x','{}')").run();
};

test("v6 → v7: tabelas de conversas criadas, preservados intactos, SEM agent_id (exatamente o que produção recebeu)", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 6) });
  assert.equal(currentVersion(db), 6);
  seedPreserved(db);
  const before = snapshotCounts(db);

  const { from, to, backup } = migrate(db, dir, { migrations: MIGRATIONS.slice(0, 7) });
  assert.equal(from, 6);
  assert.equal(to, 7);
  assert.ok(backup, "backup verificado antes da migração");
  assert.deepEqual(snapshotCounts(db), before, "nenhuma tabela preservada foi tocada");
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversations'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_messages'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_convmsg_client'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_convmsg_reply'").get());
  assert.equal(cols(db, "conversations").includes("agent_id"), false, "a v7 pura não tem agent_id");

  const again = migrate(db, dir, { migrations: MIGRATIONS.slice(0, 7) });
  assert.equal(again.backup, null);
  assert.equal(again.to, 7);
});

test("v7 → v8: ALTER aditivo sobre um banco v7 real; linhas existentes intactas com agent_id NULL", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 7) }); // simula o banco em produção agora
  db.prepare("INSERT INTO admins (id, username, password_hash, created_at) VALUES ('a1','ana','x','t')").run();
  db.prepare("INSERT INTO conversations (id, admin_id, title, created_at, updated_at) VALUES ('c1','a1','conversa anterior à v8','t','t')").run();
  db.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES ('m1','c1','user','oi','t')").run();
  const before = snapshotCounts(db);

  const { from, to } = migrate(db, dir);
  assert.equal(from, 7);
  assert.equal(to, targetVersion());
  assert.ok(cols(db, "conversations").includes("agent_id"), "coluna acrescentada pela v8");
  const row = db.prepare("SELECT * FROM conversations WHERE id='c1'").get();
  assert.equal(row.agent_id, null, "linha existente sem agente fixado");
  assert.equal(row.title, "conversa anterior à v8");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conversation_messages").get().n, 1, "mensagens intactas");
  assert.deepEqual(snapshotCounts(db), before);

  const again = migrate(db, dir);
  assert.equal(again.backup, null);
  assert.equal(again.to, to, "idempotente");
});

test("falha na v8: rollback completo (coluna ausente, versão 7) e nova tentativa funciona", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 7) });
  seedPreserved(db);
  const before = snapshotCounts(db);
  assert.throws(() => migrate(db, dir, { failAfterSql: 8 }), /desfeita/);
  assert.equal(currentVersion(db), 7);
  assert.equal(cols(db, "conversations").includes("agent_id"), false);
  assert.deepEqual(snapshotCounts(db), before);
  assert.equal(migrate(db, dir).to, targetVersion());
  assert.ok(cols(db, "conversations").includes("agent_id"));
});

test("falha na v7: rollback completo (tabelas ausentes, versão 6) e nova tentativa funciona", () => {
  const { db, dir } = fresh();
  migrate(db, dir, { migrations: MIGRATIONS.slice(0, 6) });
  const before = snapshotCounts(db);
  assert.throws(() => migrate(db, dir, { failAfterSql: 7 }), /desfeita/);
  assert.equal(currentVersion(db), 6);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('conversations','conversation_messages')").get().n, 0);
  assert.deepEqual(snapshotCounts(db), before);
  assert.equal(migrate(db, dir).to, targetVersion());
});

test("integridade referencial: FK válidas, CHECK de papel e exclusão em cascata quando habilitada", () => {
  const { db, dir } = fresh();
  migrate(db, dir);
  db.prepare("INSERT INTO admins (id, username, password_hash, created_at) VALUES ('a1','ana','x','t')").run();
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1, "FK habilitadas por padrão no node:sqlite");
  db.prepare("INSERT INTO conversations (id, admin_id, title, created_at, updated_at) VALUES ('c1','a1','t','t','t')").run();
  db.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES ('m1','c1','user','oi','t')").run();
  assert.throws(
    () => db.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES ('m2','nao-existe','user','x','t')").run(),
    /FOREIGN KEY constraint failed/,
  );
  assert.throws(
    () => db.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content, created_at) VALUES ('m3','c1','system','x','t')").run(),
    /CHECK constraint failed/,
  );
  db.prepare("DELETE FROM conversations WHERE id='c1'").run();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM conversation_messages").get().n, 0, "a cascata remove as mensagens filhas");
});
