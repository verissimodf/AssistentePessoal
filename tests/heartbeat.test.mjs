import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHeartbeat, heartbeatEnabled, HEARTBEAT_LIMITS } from "../server/heartbeat.js";

const setup = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE autonomy_intentions (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      correlation_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution_code TEXT
    );
  `);
  return db;
};
const uuid = (n = "1") => `00000000-0000-4000-8000-${n.padStart(12, "0")}`;
const ids = () => { let n = 0; return () => uuid(String(++n)); };

test("flag: ausência e valores ambíguos desligam; true explícito habilita", () => {
  assert.equal(heartbeatEnabled({}), false);
  assert.equal(heartbeatEnabled({ envValue: "false", settings: { heartbeat: { enabled: true } } }), false);
  assert.equal(heartbeatEnabled({ envValue: "yes" }), false);
  assert.equal(heartbeatEnabled({ envValue: "1" }), true);
  assert.equal(heartbeatEnabled({ settings: { heartbeat: { enabled: true } } }), true);
  assert.equal(heartbeatEnabled({ settings: { heartbeat: { enabled: "true" } } }), false);
});

test("serviço desabilitado não inicia timer nem grava intenção", () => {
  const db = setup();
  let setCalls = 0;
  const hb = createHeartbeat({ db, uid: ids(), enabled: false, setIntervalFn: () => { setCalls++; return { unref() {} }; } });
  assert.equal(hb.start(), false);
  assert.equal(setCalls, 0);
  assert.deepEqual(hb.tick([{ adminId: "admin-a", kind: "approval_pending", payload: { count: 1 }, correlationId: uuid() }]), { skipped: true, created: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM autonomy_intentions").get().n, 0);
  db.close();
});

test("start é idempotente, unref é chamado e stop limpa o timer", () => {
  const db = setup();
  let calls = 0, clears = 0, unrefs = 0;
  const hb = createHeartbeat({
    db, uid: ids(), enabled: true,
    setIntervalFn: () => { calls++; return { unref() { unrefs++; } }; },
    clearIntervalFn: () => { clears++; },
  });
  assert.equal(hb.start(), true);
  assert.equal(hb.start(), false);
  assert.equal(calls, 1);
  assert.equal(unrefs, 1);
  assert.equal(hb.running, true);
  assert.equal(hb.stop(), true);
  assert.equal(hb.stop(), false);
  assert.equal(clears, 1);
  assert.equal(hb.running, false);
  db.close();
});

test("intenção é validada, idempotente por correlation_id e auditada só por metadados", () => {
  const db = setup();
  const auditRows = [];
  const hb = createHeartbeat({ db, uid: ids(), enabled: true, audit: (...args) => auditRows.push(args), now: () => "2026-10-18T00:00:00.000Z" });
  const input = { adminId: "admin-a", kind: "approval_pending", payload: { count: 2 }, correlationId: uuid("123") };
  const first = hb.insertIntent(input);
  const second = hb.insertIntent(input);
  assert.equal(first.created, true);
  assert.equal(first.intent.status, "pending");
  assert.equal(second.created, false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM autonomy_intentions").get().n, 1);
  assert.equal(auditRows.length, 1);
  assert.equal(JSON.stringify(auditRows).includes('"count":2'), true);
  db.close();
});

test("isolamento por proprietário e resolução compare-and-set", () => {
  const db = setup();
  const hb = createHeartbeat({ db, uid: ids(), enabled: true });
  const a = hb.insertIntent({ adminId: "admin-a", kind: "approval_pending", payload: { count: 1 }, correlationId: uuid("11") }).intent;
  const b = hb.insertIntent({ adminId: "admin-b", kind: "execution_unverified", payload: { code: "unknown" }, correlationId: uuid("12") }).intent;
  assert.deepEqual(hb.listIntents("admin-a").map((x) => x.id), [a.id]);
  assert.equal(hb.resolveIntent("admin-b", a.id, "approve"), null);
  assert.equal(hb.resolveIntent("admin-a", a.id, "approve").status, "approved");
  assert.equal(hb.resolveIntent("admin-a", a.id, "reject"), null);
  assert.equal(hb.listIntents("admin-b")[0].id, b.id);
  db.close();
});

test("payload inválido e limites são rejeitados sem gravação", () => {
  const db = setup();
  const hb = createHeartbeat({ db, uid: ids(), enabled: true });
  assert.equal(HEARTBEAT_LIMITS.payloadBytes, 2048);
  assert.throws(() => hb.insertIntent({ adminId: "admin-a", kind: "unknown", payload: {}, correlationId: uuid("1") }), /kind_invalid/);
  assert.throws(() => hb.insertIntent({ adminId: "admin-a", kind: "approval_pending", payload: { prompt: "texto livre não permitido" }, correlationId: uuid("2") }), /payload_value_invalid/);
  assert.throws(() => hb.insertIntent({ adminId: "admin-a", kind: "approval_pending", payload: { code: "x".repeat(2200) }, correlationId: uuid("3") }), /payload_value_invalid|payload_too_large/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM autonomy_intentions").get().n, 0);
  db.close();
});
