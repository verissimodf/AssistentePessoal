#!/usr/bin/env node
// Reset controlado para o primeiro acesso.
//
// APAGA: contas, sessões, tokens, settings pessoais, ownership, agentes, bots, runs, memórias,
// conversas/mensagens, aprovações, evidências, documentos, legacy, tentativas de login, expurgo.
// PRESERVA: auditoria (com um evento novo), global_settings (config do sistema), master.key e o
// schema. Nunca roda sozinho no boot — exige --confirmar.
//
// Uso:
//   JARVIS_DATA_DIR=/caminho/data node scripts/reset-primeiro-acesso.mjs --confirmar
//
// Sem --confirmar: apenas relata o que seria apagado (dry-run).
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = process.env.JARVIS_DATA_DIR || join(RAIZ, "data");
const DB_PATH = join(DATA_DIR, "jarvis.db");
const CONFIRMAR = process.argv.includes("--confirmar");

// Ordem FK-safe: filhos antes dos pais. `admins` é o último (referenciado por todos).
const TABELAS = [
  "conversation_messages",
  "conversations",
  "approval_actions",
  "execution_evidence",
  "approvals",
  "ownership_history",
  "ownership",
  "memories",
  "agents",
  "bots",
  "runs",
  "document_chunks",
  "documents",
  "session_focus",
  "sessions",
  "service_tokens",
  "login_attempts",
  "legacy_claims",
  "legacy_settings",
  "purge_items",
  "purge_quarantine",
  "purge_jobs",
  "admin_settings",
];

if (!existsSync(DB_PATH)) {
  console.error(`Banco não encontrado em ${DB_PATH}`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
const contar = (t) => {
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  } catch {
    return null; // tabela ausente em versões antigas
  }
};

const integridade = db.prepare("PRAGMA integrity_check").get().integrity_check;
if (integridade !== "ok") {
  console.error(`Integridade do banco não está ok (${integridade}); abortando.`);
  process.exit(1);
}

const antes = Object.fromEntries(
  [...TABELAS, "admins", "audit", "global_settings"].map((t) => [t, contar(t)]),
);
const total = TABELAS.reduce((s, t) => s + (antes[t] || 0), 0) + (antes.admins || 0);

console.log(`Banco: ${DB_PATH}`);
console.log(`Contas: ${antes.admins} | registros descartáveis: ${total}`);
console.log(`Preservados: audit=${antes.audit} global_settings=${antes.global_settings}`);

if (!CONFIRMAR) {
  console.log("\nDRY-RUN. Nada foi alterado. Reexecute com --confirmar para aplicar.");
  db.close();
  process.exit(0);
}

if (total === 0) {
  console.log("\nNada a apagar (estado já limpo).");
  db.close();
  process.exit(0);
}

// ---------- backup verificado antes de tocar em qualquer coisa ----------
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = join(DATA_DIR, "backups");
mkdirSync(backupDir, { recursive: true });
const backupDb = join(backupDir, `reset-${stamp}.db`);
db.exec(`VACUUM INTO '${backupDb.replace(/'/g, "''")}'`);
const masterKey = join(DATA_DIR, "master.key");
if (existsSync(masterKey)) copyFileSync(masterKey, join(backupDir, `reset-${stamp}.master.key`));
const check = new DatabaseSync(backupDb, { readOnly: true });
const backupOk = check.prepare("PRAGMA integrity_check").get().integrity_check;
check.close();
if (backupOk !== "ok") {
  console.error(`Backup inválido (${backupOk}); abortando sem alterar nada.`);
  process.exit(1);
}
console.log(`\nBackup: ${backupDb} (${statSync(backupDb).size} bytes, integridade ok)`);

// ---------- transação única ----------
db.exec("PRAGMA foreign_keys = ON");
db.exec("BEGIN IMMEDIATE");
try {
  for (const t of TABELAS) {
    if (contar(t) === null) continue;
    db.exec(`DELETE FROM ${t}`);
  }
  // Os triggers protegem o último admin ativo; saem e voltam dentro da mesma transação.
  db.exec("DROP TRIGGER IF EXISTS trg_admins_protect_last_delete");
  db.exec("DROP TRIGGER IF EXISTS trg_admins_protect_last_disable");
  db.exec("DELETE FROM admins");
  db.exec(`CREATE TRIGGER trg_admins_protect_last_delete BEFORE DELETE ON admins
           WHEN OLD.active = 1 AND (SELECT COUNT(*) FROM admins WHERE active = 1) <= 1
           BEGIN SELECT RAISE(ABORT, 'last_admin_protected'); END`);
  db.exec(`CREATE TRIGGER trg_admins_protect_last_disable BEFORE UPDATE OF active ON admins
           WHEN OLD.active = 1 AND NEW.active = 0 AND (SELECT COUNT(*) FROM admins WHERE active = 1) <= 1
           BEGIN SELECT RAISE(ABORT, 'last_admin_protected'); END`);

  const resumo = Object.fromEntries(
    [...TABELAS, "admins"].map((t) => [t, antes[t] || 0]).filter(([, n]) => n > 0),
  );
  db.prepare("INSERT INTO audit (at, kind, detail) VALUES (?, ?, ?)").run(
    new Date().toISOString(),
    "system.reset",
    JSON.stringify({ report: resumo }),
  );
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`Falha na transação (nada foi apagado): ${e.message}`);
  console.error(`Backup disponível em ${backupDb}`);
  process.exit(1);
}

// ---------- validação pós-condição ----------
const depois = Object.fromEntries(
  [
    "admins",
    "sessions",
    "service_tokens",
    "ownership",
    "agents",
    "memories",
    "conversations",
    "audit",
  ].map((t) => [t, contar(t)]),
);
const fk = db.prepare("PRAGMA foreign_key_check").all().length;
const okPos =
  depois.admins === 0 &&
  depois.sessions === 0 &&
  depois.service_tokens === 0 &&
  depois.ownership === 0 &&
  depois.conversations === 0 &&
  depois.audit === (antes.audit || 0) + 1 &&
  db.prepare("PRAGMA integrity_check").get().integrity_check === "ok" &&
  fk === 0;

console.log(`\nDepois: ${JSON.stringify(depois)} | fk_violacoes=${fk}`);
console.log(
  okPos ? "Pós-condições OK: setupRequired=true." : "PÓS-CONDIÇÕES FALHARAM — restaure o backup.",
);
db.close();
process.exit(okPos ? 0 : 1);
