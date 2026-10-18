import { test } from "node:test";
import assert from "node:assert/strict";
import { migrate, MIGRATIONS, PRESERVED, targetVersion, currentVersion } from "../server/migrations.js";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Fase 1 (P0.3.1-FINAL → Fase B) — guardiões de reconciliação de schema.
//
// Contexto: o RFC antigo (docs/RFC_PR2_AUTONOMIA_E_SIMULADOR.md, era PR #2 quando targetVersion
// era 10) propunha "v12 = autonomy_intentions / survival_state". O v12 REAL enviado é
// `session_focus` (P0.2). Implementar o RFC tal como escrito ignoraria a migração em silêncio
// (`pending = m.version > from` → um segundo "v12" nunca correria). Próxima versão correta: v12,
// e só depois do desenho da Fase G ser aprovado. Estes testes garantem que qualquer tentativa de
// renumeração/colisão ou alteração retroativa das regras falha o CI.

test("migrações: versões estritamente crescentes, únicas e contíguas a partir de 1", () => {
  const versions = MIGRATIONS.map((m) => m.version);
  assert.equal(versions[0], 1, "a primeira migração é a v1");
  for (let i = 1; i < versions.length; i++) {
    assert.ok(
      versions[i] > versions[i - 1],
      `versões têm de crescer estritamente: ${versions[i - 1]} → ${versions[i]}`,
    );
    assert.equal(
      versions[i],
      versions[i - 1] + 1,
      `versões contíguas — um salto permite que uma migração proposta "pule" silenciosamente (v${versions[i - 1]} → v${versions[i]})`,
    );
  }
  assert.equal(new Set(versions).size, versions.length, "nenhuma versão duplicada");
  for (const m of MIGRATIONS) {
    assert.ok(m.name && typeof m.name === "string", `v${m.version} tem de ter nome`);
    assert.ok(m.sql, `v${m.version} tem de ter SQL`);
  }
});

test("existe exatamente UMA migração v12 e é a session_focus (o v12 do RFC antigo está proibido)", () => {
  const v12 = MIGRATIONS.filter((m) => m.version === 11);
  assert.equal(v12.length, 1, "exactamente uma migração v12 — nunca uma segunda");
  assert.match(v12[0].name, /session_focus/, "o v12 real é o session_focus (P0.2)");
  assert.ok(v12[0].expect?.length, "a v12 mantém a asserção de esquema (expect) do P0.3.1");
  // Tabelas propostas no RFC como "v12" só podem existir como v12+ (e após desenho aprovado).
  const rfcTables = ["simulador_indices"];
  for (const t of rfcTables) {
    const wrong = MIGRATIONS.filter((m) => m.version <= 11 && new RegExp(`CREATE TABLE (IF NOT EXISTS )?${t}\\b`).test(m.sql));
    assert.equal(wrong.length, 0, `${t} não pode aparecer antes da v12 (RFC antigo renumerado)`);
  }
});

test("targetVersion é 11 — qualquer mudança de schema exige atualizar este guardião de propósito", () => {
  // Se alguém acrescentar v12, este teste FALHA e obriga a rever: testes de migração,
  // rollback, preservação, execution-evidence (user_version) e o runbook de recuperação.
  assert.equal(targetVersion(), 12);
  assert.equal(MIGRATIONS.at(-1).version, targetVersion());
  const v12 = MIGRATIONS.filter((m) => m.version === 12);
  assert.equal(v12.length, 1, "exatamente uma migração v12");
  assert.match(v12[0].name, /heartbeat/);
  assert.deepEqual(v12[0].expect.map((x) => x.table).sort(), ["autonomy_intentions", "survival_state"]);
});

test("PRESERVED é exatamente o conjunto protegido (adições/remoções exigem justificativa própria)", () => {
  assert.deepEqual(
    [...PRESERVED].sort(),
    ["agents", "audit", "approvals", "bots", "kv", "memories", "runs"].sort(),
  );
});

test("nenhuma migração executa operação destrutiva ou ALTER sobre tabelas preservadas", () => {
  const preservedAlt = PRESERVED.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const forbidden = new RegExp(`\\b(DROP\\s+TABLE|ALTER\\s+TABLE|TRUNCATE)\\s+(IF\\s+EXISTS\\s+)?(${preservedAlt})\\b`, "i");
  const wipe = new RegExp(`\\b(DELETE\\s+FROM|UPDATE\\s+)(${preservedAlt})\\b`, "i");
  for (const m of MIGRATIONS) {
    const sql = typeof m.sql === "function" ? String(m.sql) : m.sql;
    assert.ok(!forbidden.test(sql), `v${m.version} não pode alterar/dropar tabelas preservadas`);
    assert.ok(
      !wipe.test(sql),
      `v${m.version} não pode apagar/reescrever linhas de tabelas preservadas (contagem+conteúdo verificados na migração real)`,
    );
  }
});

// Réplica do esquema BASE pré-auth (as tabelas PRESERVED vêm do db.js, não das migrações).
function baseDb(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
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

const seedPreserved = (db) =>
  db.exec(`INSERT INTO kv (key, value) VALUES ('invariante', 'não pode sumir');
           INSERT INTO memories (id, content, tags, created_at) VALUES ('m-inv', 'memória protegida', 't', '2026-10-18');`);

test("preservação: migração que apaga linhas preservadas é recusada e desfeita", () => {
  const { db, dir } = baseDb("jarvis-invariant-");
  migrate(db, dir);
  seedPreserved(db);
  const snap = () => JSON.stringify({
    kv: db.prepare("SELECT * FROM kv WHERE key='invariante'").all(),
    mem: db.prepare("SELECT * FROM memories WHERE id='m-inv'").all(),
    v: currentVersion(db),
  });
  const before = snap();
  assert.throws(
    () =>
      migrate(db, dir, {
        migrations: [...MIGRATIONS, { version: 12, name: "falsa: apaga kv", sql: `DELETE FROM kv WHERE key='invariante';` }],
      }),
    /Migração 12 .*alterou dados preservados/,
    "a verificação de contagem/conteúdo recusa a migração destrutiva",
  );
  assert.equal(snap(), before, "conteúdo e versão intactos após recusa + rollback");
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  db.close();
});

test("rollback: migração v12 inválida desfaz-se por completo e preserva o conteúdo", () => {
  const { db, dir } = baseDb("jarvis-invariant2-");
  migrate(db, dir);
  seedPreserved(db);
  const snap = () => JSON.stringify({
    kv: db.prepare("SELECT * FROM kv WHERE key='invariante'").all(),
    mem: db.prepare("SELECT * FROM memories WHERE id='m-inv'").all(),
    v: currentVersion(db),
  });
  const before = snap();

  assert.throws(
    () =>
      migrate(db, dir, {
        migrations: [
          ...MIGRATIONS,
          { version: 12, name: "falsa: SQL inválido no meio", sql: `CREATE TABLE tmp_x (a); SELECT isto_nao_existe();` },
        ],
      }),
    /Migração 12/,
  );
  assert.equal(snap(), before, "esquema e conteúdo preservados idênticos após rollback");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='tmp_x'").get().n, 0, "sem objetos parciais");
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  db.close();
});
