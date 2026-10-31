// SQLite-backed queue for scheduled bot runs. Payloads are encrypted and owners are canonical
// in the ownership table. A worker may retry only a job that never entered the agent loop.
import { randomUUID } from "node:crypto";
import { db, now, audit, bots } from "./db.js";
import { assignNew, ownerOf, tx } from "./ownership.js";
import { encrypt, decrypt } from "./settings.js";

// Fase 9: runner injetado por setter (bots.js registra runBot no carregamento) — elimina
// o ciclo estático bots↔jobs (auditoria da Fase 9, docs/evolution/phase-9/architecture-audit.md).
// PRIMEIRO registro vence: replica exatamente a semântica do import estático anterior
// (sempre a PRIMEIRA instância de bots.js do processo — reimports de teste não trocam o
// runner nem o estado de ocupação).
let botRunner = null;
export const setBotRunner = (fn) => {
  if (!botRunner && typeof fn === "function") botRunner = fn;
};

const LEASE_MS = 90_000;
const WORKER_ID = `${process.pid}:${randomUUID()}`;
let draining = false;

export function enqueueScheduledBot(bot, reason, triggerType, occurrenceKey) {
  const ownerAdminId = ownerOf("bot", bot.id);
  if (!ownerAdminId) return null;
  const key = `${bot.id}:${triggerType}:${occurrenceKey}`;
  const id = randomUUID();
  const at = now();
  let inserted = false;
  tx(() => {
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO durable_jobs
      (id,idempotency_key,bot_id,trigger_type,occurrence_key,encrypted_payload,status,available_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'queued',?,?,?)`,
      )
      .run(
        id,
        key,
        bot.id,
        triggerType,
        String(occurrenceKey),
        encrypt(JSON.stringify({ reason: String(reason).slice(0, 2000) })),
        at,
        at,
        at,
      );
    inserted = Number(result.changes) === 1;
    if (inserted) assignNew("job", id, ownerAdminId);
    db.prepare(
      `INSERT OR IGNORE INTO bot_schedule_claims
      (trigger_key,bot_id,trigger_type,status,claimed_at,updated_at) VALUES (?,?,?,'claimed',?,?)`,
    ).run(key, bot.id, triggerType, at, at);
  });
  const row = db.prepare("SELECT id,status FROM durable_jobs WHERE idempotency_key=?").get(key);
  return { ...row, inserted };
}

function claimJob(id = null) {
  const at = now();
  const expires = new Date(Date.now() + LEASE_MS).toISOString();
  return tx(() => {
    const row = id
      ? db
          .prepare("SELECT * FROM durable_jobs WHERE id=? AND status='queued' AND available_at<=?")
          .get(id, at)
      : db
          .prepare(
            "SELECT * FROM durable_jobs WHERE status='queued' AND available_at<=? ORDER BY created_at LIMIT 1",
          )
          .get(at);
    if (!row || !ownerOf("job", row.id) || ownerOf("job", row.id) !== ownerOf("bot", row.bot_id))
      return null;
    const update = db
      .prepare(
        `UPDATE durable_jobs SET status='running',attempts=attempts+1,
      lease_owner=?,lease_until=?,updated_at=? WHERE id=? AND status='queued'`,
      )
      .run(WORKER_ID, expires, at, row.id);
    if (!update.changes) return null;
    db.prepare(
      "UPDATE bot_schedule_claims SET status='running',updated_at=? WHERE trigger_key=?",
    ).run(at, row.idempotency_key);
    return db.prepare("SELECT * FROM durable_jobs WHERE id=?").get(row.id);
  });
}

function finish(row, status, runId = null, errorCode = null) {
  const at = now();
  const claimStatus =
    status === "succeeded"
      ? "done"
      : status === "awaiting_approval"
        ? status
        : status === "cancelled"
          ? status
          : status === "needs_reconciliation"
            ? "interrupted"
            : status === "failed"
              ? "error"
              : "skipped";
  tx(() => {
    db.prepare(
      `UPDATE durable_jobs SET status=?,run_id=COALESCE(?,run_id),last_error=?,lease_owner=NULL,
      lease_until=NULL,updated_at=? WHERE id=? AND lease_owner=?`,
    ).run(status, runId, errorCode, at, row.id, WORKER_ID);
    db.prepare(
      "UPDATE bot_schedule_claims SET status=?,run_id=COALESCE(?,run_id),updated_at=? WHERE trigger_key=?",
    ).run(claimStatus, runId, at, row.idempotency_key);
  });
}

export async function processScheduledJob(id = null, { agentRunner } = {}) {
  const row = claimJob(id);
  if (!row) return null;
  const heartbeat = setInterval(() => {
    const at = now();
    db.prepare(
      "UPDATE durable_jobs SET lease_until=?,updated_at=? WHERE id=? AND status='running' AND lease_owner=?",
    ).run(new Date(Date.now() + LEASE_MS).toISOString(), at, row.id, WORKER_ID);
  }, 25_000);
  heartbeat.unref?.();
  try {
    const bot = bots.get(row.bot_id);
    if (!bot || !bot.enabled || ownerOf("bot", bot.id) !== ownerOf("job", row.id)) {
      finish(row, "cancelled", null, "bot_unavailable");
      return { id: row.id, status: "cancelled" };
    }
    if (!botRunner) {
      // Sem runner registrado: falha segura com reconciliação (nunca retry cego).
      finish(row, "needs_reconciliation", null, "bot_runner_unregistered");
      audit("bot_schedule.failed", {
        bot: row.bot_id,
        trigger_type: row.trigger_type,
        reason: "runner_missing",
      });
      return { id: row.id, status: "needs_reconciliation" };
    }
    const { reason } = JSON.parse(decrypt(row.encrypted_payload));
    const result = await botRunner(bot, reason, row.trigger_type, {
      ...(agentRunner ? { agentRunner } : {}),
      onRunCreated: (runId) => {
        db.prepare(
          "UPDATE durable_jobs SET run_id=?,updated_at=? WHERE id=? AND lease_owner=?",
        ).run(runId, now(), row.id, WORKER_ID);
      },
    });
    if (
      result.status === "skipped" &&
      ["already_running", "admin_concurrency_limit"].includes(result.reason)
    ) {
      const retryAt = new Date(Date.now() + 5_000).toISOString();
      tx(() => {
        db.prepare(
          `UPDATE durable_jobs SET status='queued',available_at=?,lease_owner=NULL,lease_until=NULL,updated_at=?
          WHERE id=? AND lease_owner=?`,
        ).run(retryAt, now(), row.id, WORKER_ID);
        db.prepare(
          "UPDATE bot_schedule_claims SET status='claimed',updated_at=? WHERE trigger_key=?",
        ).run(now(), row.idempotency_key);
      });
      return { ...result, id: row.id, jobId: row.id, status: "queued" };
    }
    const status =
      result.status === "done"
        ? "succeeded"
        : result.status === "awaiting_approval"
          ? "awaiting_approval"
          : result.status === "cancelled"
            ? "cancelled"
            : result.status === "error"
              ? "failed"
              : "cancelled";
    finish(row, status, result.id || null, status === "failed" ? "run_failed" : null);
    return { ...result, jobId: row.id };
  } catch (error) {
    // If the agent loop began, the external effect may already have happened. Never retry blindly.
    const current = db.prepare("SELECT run_id FROM durable_jobs WHERE id=?").get(row.id);
    const status = current?.run_id ? "needs_reconciliation" : "failed";
    finish(row, status, current?.run_id || null, "worker_error");
    audit("bot_schedule.failed", {
      bot: row.bot_id,
      trigger_type: row.trigger_type,
      reason: current?.run_id ? "interrupted" : "unknown_action",
    });
    return {
      id: row.id,
      status,
      output: "A execução foi interrompida; consulte o estado antes de repetir.",
    };
  } finally {
    clearInterval(heartbeat);
  }
}

export async function drainScheduledJobs(id = null, options = {}) {
  if (draining) return;
  draining = true;
  try {
    return await processScheduledJob(id, options);
  } finally {
    draining = false;
  }
}

/** Startup recovery: only jobs proven not to have entered the agent loop are automatically queued. */
export function recoverScheduledJobs() {
  const at = now();
  tx(() => {
    const safe = db
      .prepare(
        "UPDATE durable_jobs SET status='queued',lease_owner=NULL,lease_until=NULL,updated_at=? WHERE status='running' AND run_id IS NULL",
      )
      .run(at);
    db.prepare(
      "UPDATE bot_schedule_claims SET status='claimed',updated_at=? WHERE trigger_key IN (SELECT idempotency_key FROM durable_jobs WHERE status='queued') AND status IN ('running','interrupted')",
    ).run(at);
    const uncertain = db
      .prepare(
        "UPDATE durable_jobs SET status='needs_reconciliation',lease_owner=NULL,lease_until=NULL,last_error='interrupted_after_start',updated_at=? WHERE status='running' AND run_id IS NOT NULL",
      )
      .run(at);
    db.prepare(
      "UPDATE bot_schedule_claims SET status='interrupted',updated_at=? WHERE trigger_key IN (SELECT idempotency_key FROM durable_jobs WHERE status='needs_reconciliation') AND status IN ('running','claimed')",
    ).run(at);
    return { safe: Number(safe.changes), uncertain: Number(uncertain.changes) };
  });
  return { safe: db.prepare("SELECT COUNT(*) n FROM durable_jobs WHERE status='queued'").get().n };
}

export function listScheduledJobs(adminId) {
  if (!adminId) return [];
  return db
    .prepare(
      `SELECT j.id,j.bot_id AS botId,j.trigger_type AS triggerType,j.status,j.attempts,
    j.run_id AS runId,j.last_error AS lastError,j.created_at AS createdAt,j.updated_at AS updatedAt
    FROM durable_jobs j JOIN ownership o ON o.resource_type='job' AND o.resource_id=j.id AND o.owner_admin_id=?
    ORDER BY j.created_at DESC LIMIT 100`,
    )
    .all(adminId);
}
