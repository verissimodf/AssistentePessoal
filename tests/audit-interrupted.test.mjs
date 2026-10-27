// Trilha P1 — desconhecido por interrupção (boot). Pré-cria uma aprovação "running" com
// correlação no payload JSON e então importa o serviço: ele deve (a) marcá-la "interrupted",
// (b) emitir exatamente um evento "(unknown)" com reason "interrupted" e a correlação, e
// (c) nunca inventar um evento de sucesso. Sem tocar o banco ativo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CORR = "77777777-8888-4999-9aaa-bbbbbbbbbbbb";
const dir = mkdtempSync(join(tmpdir(), "jarvis-interrupt-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

// Pré-semeia tabelas mínimas (db.js roda CREATE TABLE IF NOT EXISTS + migrações no import).
const raw = new DatabaseSync(join(dir, "jarvis.db"));
raw.exec(`
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, detail TEXT);
CREATE TABLE approvals (id TEXT PRIMARY KEY, command TEXT, status TEXT, output TEXT, created_at TEXT);
CREATE TABLE approval_actions (approval_id TEXT PRIMARY KEY, action TEXT NOT NULL, created_at TEXT NOT NULL);
`);
raw
  .prepare("INSERT INTO approvals (id, command, status, output, created_at) VALUES (?,?,?,?,?)")
  .run("ap-running", "echo x", "running", "", "2026-01-01");
raw
  .prepare("INSERT INTO approval_actions (approval_id, action, created_at) VALUES (?,?,?)")
  .run(
    "ap-running",
    JSON.stringify({ kind: "run_command", command: "echo x", correlation: CORR }),
    "2026-01-01",
  );
raw.close();

const { db } = await import("../server/db.js");

test("boot marca interrupted e emite unknown (sem retroativo de sucesso)", () => {
  const row = db.prepare("SELECT status FROM approvals WHERE id=?").get("ap-running");
  assert.equal(row.status, "interrupted");
  const ev = db.prepare("SELECT kind, detail FROM audit WHERE kind='run_command(unknown)'").all();
  assert.equal(ev.length, 1, "exatamente um evento unknown");
  const d = JSON.parse(ev[0].detail);
  assert.equal(d.approvalId, "ap-running");
  assert.equal(d.status, "unknown");
  assert.equal(d.reason, "interrupted");
  assert.equal(d.correlation, CORR);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM audit WHERE kind='run_command(done)'").get().n,
    0,
    "nenhum sucesso retroativo",
  );
});
