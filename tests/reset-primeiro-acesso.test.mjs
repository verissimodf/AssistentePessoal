// O reset é a operação mais destrutiva do produto: um erro apaga dados de produção.
// Este teste roda o script real contra um banco temporário e verifica as pós-condições.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "jarvis-reset-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { db, auth, agents, migration } = await import("../server/db.js");
const { assignNew } = await import("../server/ownership.js");

const rodar = (extra = []) =>
  spawnSync(process.execPath, [join(RAIZ, "scripts", "reset-primeiro-acesso.mjs"), ...extra], {
    env: { ...process.env, JARVIS_DATA_DIR: dir },
    encoding: "utf8",
  });

before(() => {
  auth.setupFirstAdmin({
    token: auth.ensureBootstrap().token,
    username: "antigo",
    password: "senha-muito-forte-1",
  });
  const adminId = db.prepare("SELECT id FROM admins WHERE active=1").get().id;
  const agente = agents.save({
    id: "ag1",
    name: "A",
    provider: "ollama",
    model: "m",
    active: true,
    instructions: "",
    tools: [],
  });
  assignNew("agent", agente.id, adminId);
  db.prepare("INSERT INTO memories (id, content, tags, created_at) VALUES (?,?,?,?)").run(
    "m1",
    "lembrar",
    "",
    new Date().toISOString(),
  );
  assignNew("memory", "m1", adminId);
  db.prepare(
    "INSERT INTO conversations (id, admin_id, title, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).run("c1", adminId, "teste", new Date().toISOString(), new Date().toISOString());
});

test("dry-run não altera nada", () => {
  const r = rodar();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DRY-RUN/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM admins").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agents").get().n, 1);
});

test("reset apaga contas e dados dispensáveis, preserva auditoria e integridade", () => {
  const auditAntes = db.prepare("SELECT COUNT(*) n FROM audit").get().n;
  const globalAntes = db.prepare("SELECT COUNT(*) n FROM global_settings").get().n;
  const r = rodar(["--confirmar"]);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /Pós-condições OK/);

  const n = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  assert.equal(n("admins"), 0, "nenhuma conta deve restar");
  assert.equal(n("sessions"), 0);
  assert.equal(n("service_tokens"), 0);
  assert.equal(n("ownership"), 0);
  assert.equal(n("agents"), 0);
  assert.equal(n("memories"), 0);
  assert.equal(n("conversations"), 0);
  assert.equal(n("conversation_messages"), 0);
  assert.equal(n("approvals"), 0);
  assert.equal(n("admin_settings"), 0);
  assert.equal(n("global_settings"), globalAntes, "configuração do sistema é preservada");
  assert.equal(n("audit"), auditAntes + 1, "auditoria preservada + evento de reset");
  const evento = db.prepare("SELECT kind FROM audit ORDER BY id DESC LIMIT 1").get();
  assert.equal(evento.kind, "system.reset");
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(
    db.prepare("PRAGMA user_version").get().user_version,
    migration.to,
    "schema preservado",
  );
});

test("segunda execução é no-op (idempotente)", () => {
  const auditAntes = db.prepare("SELECT COUNT(*) n FROM audit").get().n;
  const globalAntes = db.prepare("SELECT COUNT(*) n FROM global_settings").get().n;
  const r = rodar(["--confirmar"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Nada a apagar/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit").get().n, auditAntes);
});

test("o reset cria backup verificável antes de apagar", () => {
  const dirBackups = join(dir, "backups");
  assert.ok(existsSync(dirBackups), "diretório de backup deve existir");
  const arquivos = readdirSync(dirBackups).filter((f) => /^reset-.*\.db$/.test(f));
  assert.ok(arquivos.length >= 1, "deve haver ao menos um backup .db");
  const b = new DatabaseSync(join(dirBackups, arquivos[0]), { readOnly: true });
  assert.equal(b.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  b.close();
});

test("os triggers de proteção do último admin voltaram", () => {
  const nomes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_admins_protect%'",
    )
    .all()
    .map((r) => r.name)
    .sort();
  assert.deepEqual(nomes, ["trg_admins_protect_last_delete", "trg_admins_protect_last_disable"]);
});

test("setupRequired volta a true após o reset", () => {
  assert.equal(auth.setupRequired(), true);
});
