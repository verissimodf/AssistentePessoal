// Local access recovery. Requires being on this computer with the service stopped.
// Disables every admin, revokes all sessions/tokens and writes a fresh first-access code.
// Memories, agents, bots, settings, approvals and audit are untouched; a verified backup is made first.
import { db, auth, audit, DATA_DIR } from "./db.js";
import { backupAndVerify, MIGRATIONS } from "./migrations.js";

const backup = backupAndVerify(db, DATA_DIR, "antes-recuperacao");
const t = Date.now();
db.exec("BEGIN IMMEDIATE");
try {
  db.exec(
    "DROP TRIGGER IF EXISTS trg_admins_protect_last_delete; DROP TRIGGER IF EXISTS trg_admins_protect_last_disable;",
  );
  db.prepare(
    "UPDATE admins SET active = 0, username = username || '#off-' || ? WHERE active = 1",
  ).run(String(t)); // frees the names for reuse
  db.prepare("UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL").run(t);
  db.prepare("UPDATE service_tokens SET revoked_at = ? WHERE revoked_at IS NULL").run(t);
  db.exec(MIGRATIONS.find((m) => m.version === 1).sql); // recreates the protection triggers
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error(`Recuperação desfeita: ${e.message}. Backup: ${backup}`);
  process.exit(1);
}
audit("auth.recovery", { at: new Date(t).toISOString() });
auth.ensureBootstrap();
console.log(`Backup verificado: ${backup}`);
console.log(
  "Ao iniciar, o Jarvis gera um novo código de primeiro acesso em data/bootstrap-token.txt.",
);
console.log("Inicie o Jarvis agora e conclua o primeiro acesso no painel.");
