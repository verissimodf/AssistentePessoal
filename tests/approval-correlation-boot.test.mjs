// Fase II P2.1 — recuperação de boot com a coluna v9. Pré-cria um banco v8 (sem a coluna) com
// uma aprovação "running" cujo JSON carrega a correlação e então importa o serviço: a migração v9
// deve (a) acrescentar a coluna, (b) preenchê-la via backfill, (c) marcar a aprovação "interrupted"
// e (d) emitir exatamente um "(unknown)" com a correlação lida da COLUNA. Banco temporário.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CORR = "33333333-4444-4555-8666-777777777777";
const dir = mkdtempSync(join(tmpdir(), "jarvis-corr-boot-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

// Estado v8: approval_actions sem a coluna correlation_id.
const raw = new DatabaseSync(join(dir, "jarvis.db"));
raw.exec(`
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, detail TEXT);
CREATE TABLE approvals (id TEXT PRIMARY KEY, command TEXT, status TEXT, output TEXT, created_at TEXT);
CREATE TABLE approval_actions (approval_id TEXT PRIMARY KEY, action TEXT NOT NULL, created_at TEXT NOT NULL);
`);
raw.prepare("INSERT INTO approvals (id, command, status, output, created_at) VALUES (?,?,?,?,?)")
  .run("ap-run", "echo x", "running", "", "2026-01-01");
raw.prepare("INSERT INTO approval_actions (approval_id, action, created_at) VALUES (?,?,?)")
  .run("ap-run", JSON.stringify({ kind: "run_command", command: "echo x", correlation: CORR }), "2026-01-01");
raw.close();

const { db, schema, detectApprovalCorrelation } = await import("../server/db.js");

test("boot v9: coluna criada e preenchida por backfill", () => {
  assert.equal(schema.approvalCorrelation, true, "v9 aplicada no import");
  assert.equal(detectApprovalCorrelation(db), true);
  const col = db.prepare("SELECT correlation_id FROM approval_actions WHERE approval_id='ap-run'").get().correlation_id;
  assert.equal(col, CORR, "backfill preencheu a coluna a partir do JSON");
});

test("boot v9: recuperação marca interrupted e emite unknown com a correlação da coluna", () => {
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id='ap-run'").get().status, "interrupted");
  const ev = db.prepare("SELECT detail FROM audit WHERE kind='run_command(unknown)'").all();
  assert.equal(ev.length, 1, "exatamente um evento unknown");
  const d = JSON.parse(ev[0].detail);
  assert.equal(d.approvalId, "ap-run");
  assert.equal(d.reason, "interrupted");
  assert.equal(d.correlation, CORR);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit WHERE kind='run_command(done)'").get().n, 0, "nenhum sucesso retroativo");
});
