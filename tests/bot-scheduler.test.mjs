import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), "jarvis-bot-scheduler-"));
process.env.JARVIS_NO_LISTEN = "1";

const { auth, bots, db } = await import("../server/db.js");
const { assignNew } = await import("../server/ownership.js");
const { runBot, runScheduledBot } = await import("../server/bots.js");
const { listScheduledJobs, recoverScheduledJobs } = await import("../server/jobs.js");
auth.setupFirstAdmin({
  token: auth.ensureBootstrap().token,
  username: "ana",
  password: "senha-muito-forte-1",
});
const adminId = auth.validateSession(
  auth.login({ username: "ana", password: "senha-muito-forte-1", ip: "127.0.0.1" }).sid,
).adminId;

function addBot(id) {
  const bot = bots.save({ id, name: id, goal: "teste", enabled: true, autonomy: "confirm" });
  assignNew("bot", id, adminId);
  return bot;
}

test("scheduler evita duas execuções simultâneas do mesmo bot", async () => {
  const bot = addBot("same-bot");
  let release;
  let calls = 0;
  const runner = () => {
    calls++;
    return new Promise((resolve) => {
      release = () => resolve({ reply: "ok", pending: [] });
    });
  };
  const first = runBot(bot, "manual", "manual", { agentRunner: runner });
  const duplicate = await runBot(bot, "manual", "manual", { agentRunner: runner });
  assert.equal(duplicate.status, "skipped");
  assert.equal(calls, 1);
  release();
  assert.equal((await first).status, "done");
});

test("scheduler limita a duas execuções simultâneas por administrador", async () => {
  const botsToRun = [addBot("limit-1"), addBot("limit-2"), addBot("limit-3")];
  const pending = [];
  const runner = () => new Promise((resolve) => pending.push(resolve));
  const first = runBot(botsToRun[0], "manual", "manual", { agentRunner: runner });
  const second = runBot(botsToRun[1], "manual", "manual", { agentRunner: runner });
  const third = await runBot(botsToRun[2], "manual", "manual", { agentRunner: runner });
  assert.equal(third.status, "skipped");
  assert.equal(pending.length, 2);
  pending.forEach((resolve) => resolve({ reply: "ok", pending: [] }));
  assert.deepEqual(
    (await Promise.all([first, second])).map((r) => r.status),
    ["done", "done"],
  );
});

test("ledger mantém a idempotência de disparo após recarregar o módulo", async () => {
  const bot = addBot("persistent-daily");
  let calls = 0;
  const runner = async () => {
    calls++;
    return { reply: "ok", pending: [] };
  };
  assert.equal(
    (await runScheduledBot(bot, "agenda 08:00", "daily", "2026-10-27", { agentRunner: runner }))
      .status,
    "done",
  );
  const { runScheduledBot: afterRestart } = await import("../server/bots.js?simulated-restart");
  const replay = await afterRestart(bot, "agenda 08:00", "daily", "2026-10-27", {
    agentRunner: runner,
  });
  assert.equal(replay.status, "skipped");
  assert.equal(calls, 1, "um gatilho persistido só inicia uma execução");
  assert.equal(listScheduledJobs(adminId).length, 1);
  assert.equal(listScheduledJobs("other-admin").length, 0);
  const persisted = db
    .prepare("SELECT encrypted_payload,status FROM durable_jobs WHERE bot_id=?")
    .get(bot.id);
  assert.equal(persisted.status, "succeeded");
  assert.match(persisted.encrypted_payload, /^enc:/);
});

test("job agendado concorrente permanece na fila para tentativa posterior", async () => {
  const bot = addBot("queued-on-contention");
  let release;
  const runner = () =>
    new Promise((resolve) => {
      release = () => resolve({ reply: "ok", pending: [] });
    });
  const manual = runBot(bot, "manual", "manual", { agentRunner: runner });
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const scheduled = await runScheduledBot(bot, "agenda", "daily", "2026-10-28", {
    agentRunner: runner,
  });
  assert.equal(scheduled.status, "queued");
  const saved = db
    .prepare("SELECT status,available_at FROM durable_jobs WHERE bot_id=?")
    .get(bot.id);
  assert.equal(saved.status, "queued");
  assert.ok(new Date(saved.available_at) > new Date());
  release();
  assert.equal((await manual).status, "done");
});

test("recuperação re-enfileira job sem run e isola execução iniciada para reconciliação", () => {
  const bot = addBot("recovery-bot");
  const at = new Date().toISOString();
  const add = (id, runId) => {
    db.prepare(
      `INSERT INTO durable_jobs
      (id,idempotency_key,bot_id,trigger_type,occurrence_key,encrypted_payload,status,attempts,available_at,lease_owner,lease_until,run_id,created_at,updated_at)
      VALUES (?,?,?,'daily',?,'enc:test','running',1,?,'dead-worker',?, ?,?,?)`,
    ).run(id, id, bot.id, id, at, at, runId, at, at);
    assignNew("job", id, adminId);
  };
  add("never-started", null);
  add("possibly-effected", "run-existing");
  recoverScheduledJobs();
  assert.equal(
    db.prepare("SELECT status FROM durable_jobs WHERE id='never-started'").get().status,
    "queued",
  );
  assert.equal(
    db.prepare("SELECT status FROM durable_jobs WHERE id='possibly-effected'").get().status,
    "needs_reconciliation",
  );
});
