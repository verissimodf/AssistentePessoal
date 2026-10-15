// Phase 2 — single source of truth for "who owns what" (table `ownership`, migration v2).
// Rules: a resource is visible only to its owner admin; no owner = inaccessible to everyone
// until an admin explicitly claims it (audited, atomic). Owners are never inferred.
import { db, now, audit, uid } from "./db.js";
import { unlinkSync } from "node:fs";

export const TYPES = { memory: "memories", agent: "agents", bot: "bots", run: "runs", approval: "approvals", document: "documents" };
const DATE_COL = { memory: "created_at", run: "started_at", approval: "created_at", document: "created_at" };

export const ownerOf = (type, id) =>
  db.prepare("SELECT owner_admin_id FROM ownership WHERE resource_type = ? AND resource_id = ?").get(type, String(id))?.owner_admin_id || null;

/** True only when adminId is a real, non-empty id and owns the resource. */
export const owns = (adminId, type, id) => !!adminId && ownerOf(type, id) === adminId;

export function assignNew(type, id, adminId) {
  if (!adminId) throw new Error("assignNew requires an owner");
  db.prepare("INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES (?, ?, ?, ?, 'created')").run(type, String(id), adminId, now());
}
export const dropOwnership = (type, id) => db.prepare("DELETE FROM ownership WHERE resource_type = ? AND resource_id = ?").run(type, String(id));

export const ownedIds = (adminId, type) =>
  adminId ? new Set(db.prepare("SELECT resource_id FROM ownership WHERE resource_type = ? AND owner_admin_id = ?").all(type, adminId).map((r) => r.resource_id)) : new Set();

/** Run fn inside one IMMEDIATE transaction (rolls back on any throw). */
export function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; } catch (e) { db.exec("ROLLBACK"); throw e; }
}

// ---------- legacy (unowned) inventory: metadata only, never content ----------
export function legacyInventory() {
  const out = {};
  for (const [type, table] of Object.entries(TYPES)) {
    const date = DATE_COL[type] ? `t.${DATE_COL[type]}` : "NULL";
    out[type] = db.prepare(
      `SELECT t.id AS id, ${date} AS date FROM ${table} t
       WHERE NOT EXISTS (SELECT 1 FROM ownership o WHERE o.resource_type = ? AND o.resource_id = t.id)
       ORDER BY t.rowid`).all(type);
  }
  return out;
}

export function ownershipReport() {
  const r = {};
  for (const [type, table] of Object.entries(TYPES)) {
    const total = db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
    const owned = db.prepare(`SELECT COUNT(*) n FROM ${table} t JOIN ownership o ON o.resource_type = ? AND o.resource_id = t.id`).get(type).n;
    r[type] = { total, owned, unowned: total - owned };
  }
  return r;
}

export class ClaimError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

/**
 * Explicit claim of unowned resources. All-or-nothing: every id must exist, be unique and still
 * be unowned (re-checked inside the transaction); otherwise nothing is assigned.
 */
export function claimLegacy(adminId, { type, ids, confirm } = {}) {
  if (!adminId) throw new ClaimError(403, "admin_session_required");
  if (confirm !== "ASSUMIR") throw new ClaimError(400, "confirmation_required");
  if (!Object.hasOwn(TYPES, type)) throw new ClaimError(400, "invalid_type");
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every((i) => typeof i === "string" && i.length > 0 && i.length <= 200))
    throw new ClaimError(400, "invalid_ids");
  if (new Set(ids).size !== ids.length) throw new ClaimError(400, "duplicate_ids");
  const table = TYPES[type];
  return tx(() => {
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
    const ins = db.prepare("INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES (?, ?, ?, ?, 'claimed')");
    const log = db.prepare("INSERT INTO legacy_claims (resource_type, resource_id, admin_id, at) VALUES (?, ?, ?, ?)");
    const at = now();
    const runBotId = db.prepare("SELECT bot_id FROM runs WHERE id = ?");
    const expire = db.prepare("UPDATE approvals SET status = 'legacy_expired' WHERE id = ? AND status = 'pending'");
    const expired = [];
    for (const id of ids) {
      if (!exists.get(id)) throw new ClaimError(404, "resource_not_found");
      if (ownerOf(type, id)) throw new ClaimError(409, "already_owned");
      if (type === "run") {
        const botOwner = ownerOf("bot", runBotId.get(id)?.bot_id ?? "");
        if (botOwner && botOwner !== adminId) throw new ClaimError(403, "foreign_bot_run");
      }
      ins.run(type, id, adminId, at);
      log.run(type, id, adminId, at);
      // A legacy pending approval never becomes executable: invalidated in the same transaction.
      // command/output/created_at stay untouched (history preserved).
      if (type === "approval" && expire.run(id).changes) expired.push(id);
    }
    audit("legacy.claimed", { admin: adminId, type, count: ids.length, ids });
    if (expired.length) audit("legacy.approvals_expired", { admin: adminId, count: expired.length, ids: expired, status: "legacy_expired" });
    return { ok: true, type, claimed: ids.length, ...(type === "approval" ? { expired: expired.length } : {}) };
  });
}

// ---------- D_REC-1: controlled transfer of a deactivated admin's resources ----------

/** Inactive admins with per-type resource counts — metadata only, never content. */
export function inactiveAdminInventory() {
  const admins = db.prepare("SELECT id, username FROM admins WHERE active = 0 ORDER BY created_at").all();
  return admins.map((a) => {
    const counts = {};
    for (const [type, table] of Object.entries(TYPES)) {
      counts[type] = db.prepare(
        `SELECT COUNT(*) n FROM ${table} t JOIN ownership o ON o.resource_type = ? AND o.resource_id = t.id WHERE o.owner_admin_id = ?`).get(type, a.id).n;
    }
    return { id: a.id, username: a.username, counts };
  });
}

export const TRANSFER_LIMIT = 500;

/**
 * Explicit, granular, audited, logically-atomic transfer of a DEACTIVATED admin's resources to an
 * ACTIVE admin. All-or-nothing: every id must exist, be unique and still belong to `from`, otherwise
 * nothing changes. Ownership rows are re-created (the immutability trigger forbids UPDATE) with
 * origin='transferred', and every change is appended to `ownership_history` (append-only trail).
 * The source admin is NOT reactivated and no credentials are restored.
 */
export function transferResources(actorId, { from, to, type, ids, correlationId } = {}) {
  if (!actorId) throw new ClaimError(403, "admin_session_required");
  if (!Object.hasOwn(TYPES, type)) throw new ClaimError(400, "invalid_type");
  if (typeof from !== "string" || typeof to !== "string" || !from || !to || from === to) throw new ClaimError(400, "invalid_admins");
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > TRANSFER_LIMIT || !ids.every((i) => typeof i === "string" && i.length > 0 && i.length <= 200))
    throw new ClaimError(400, "invalid_ids");
  if (new Set(ids).size !== ids.length) throw new ClaimError(400, "duplicate_ids");
  const src = db.prepare("SELECT id, active FROM admins WHERE id = ?").get(from);
  if (!src) throw new ClaimError(404, "source_not_found");
  if (src.active) throw new ClaimError(409, "source_active");
  const dst = db.prepare("SELECT id, active FROM admins WHERE id = ?").get(to);
  if (!dst || !dst.active) throw new ClaimError(409, "target_not_active");
  const table = TYPES[type];
  const corr = String(correlationId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || `tr-${Date.now()}`;
  return tx(() => {
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
    const del = db.prepare("DELETE FROM ownership WHERE resource_type = ? AND resource_id = ?");
    const ins = db.prepare("INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES (?, ?, ?, ?, 'transferred')");
    const hist = db.prepare("INSERT INTO ownership_history (resource_type, resource_id, from_admin_id, to_admin_id, actor_admin_id, action, correlation_id, at) VALUES (?, ?, ?, ?, ?, 'transfer', ?, ?)");
    const at = now();
    for (const id of ids) {
      if (!exists.get(id)) throw new ClaimError(404, "resource_not_found");
      if (ownerOf(type, id) !== from) throw new ClaimError(409, "not_owned_by_source");
      if (isQuarantined(type, id)) throw new ClaimError(409, "quarantined");
      del.run(type, id);
      ins.run(type, id, to, at);
      hist.run(type, id, from, to, actorId, corr, at);
    }
    audit("ownership.transferred", { by: actorId, fromAdmin: from, toAdmin: to, type, count: ids.length, correlation: corr });
    return { ok: true, type, count: ids.length, from, to, correlation: corr };
  });
}

// ---------- D_REC-2: MANUAL-ONLY purge (no retention deadlines) ----------
// Eligibility: the resource is owned by an INACTIVE admin (clear ownership, owner cannot use it).
// Unowned/legacy resources are NOT eligible (ambiguous ownership — they can still be claimed).
// Purge is a two-stage, resumable, idempotent job: quarantine (isolate) then remove item by item.
// No automatic, age-based deletion.
export const isQuarantined = (type, id) =>
  !!db.prepare("SELECT 1 FROM purge_quarantine WHERE resource_type = ? AND resource_id = ?").get(type, String(id));

/** Create a purge job for eligible resources (owned by an inactive admin) WITHOUT executing it. */
export function createPurgeJob(actorId, { from, type, ids, correlationId } = {}) {
  if (!actorId) throw new ClaimError(403, "admin_session_required");
  if (!Object.hasOwn(TYPES, type)) throw new ClaimError(400, "invalid_type");
  if (typeof from !== "string" || !from) throw new ClaimError(400, "invalid_admins");
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > TRANSFER_LIMIT || !ids.every((i) => typeof i === "string" && i.length > 0 && i.length <= 200))
    throw new ClaimError(400, "invalid_ids");
  if (new Set(ids).size !== ids.length) throw new ClaimError(400, "duplicate_ids");
  const src = db.prepare("SELECT id, active FROM admins WHERE id = ?").get(from);
  if (!src) throw new ClaimError(404, "source_not_found");
  if (src.active) throw new ClaimError(409, "source_active"); // only inactive admins' resources are eligible
  const table = TYPES[type];
  const corr = String(correlationId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || `pg-${Date.now()}`;
  const jobId = uid();
  tx(() => {
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`);
    for (const id of ids) {
      if (!exists.get(id)) throw new ClaimError(404, "resource_not_found");
      if (ownerOf(type, id) !== from) throw new ClaimError(409, "not_owned_by_source");
    }
    const at = now();
    db.prepare("INSERT INTO purge_jobs (id, actor_admin_id, from_admin_id, resource_type, status, correlation_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'isolated', ?, ?, ?)")
      .run(jobId, actorId, from, type, corr, at, at);
    const q = db.prepare("INSERT INTO purge_quarantine (resource_type, resource_id, job_id, at) VALUES (?, ?, ?, ?)");
    const it = db.prepare("INSERT INTO purge_items (job_id, resource_id, state) VALUES (?, ?, 'isolated')");
    for (const id of ids) { q.run(type, id, jobId, at); it.run(jobId, id); }
    audit("purge.requested", { by: actorId, fromAdmin: from, type, count: ids.length, correlation: corr });
  });
  return jobId;
}

/** Create a purge job for eligible resources and run it to completion. */
export function purgeResources(actorId, opts = {}) {
  return executePurge(createPurgeJob(actorId, opts), actorId);
}

/** Run/resume a job: remove each still-isolated item (idempotent). opts.failAfterItem is a test hook. */
export function executePurge(jobId, actorId, opts = {}) {
  const job = db.prepare("SELECT * FROM purge_jobs WHERE id = ?").get(jobId);
  if (!job) throw new ClaimError(404, "job_not_found");
  if (job.status === "done") return { ok: true, job: jobId, status: "done", removed: 0, pending: 0 };
  const table = TYPES[job.resource_type];
  const items = db.prepare("SELECT resource_id FROM purge_items WHERE job_id = ? AND state = 'isolated' ORDER BY resource_id").all(jobId);
  let removed = 0, done = 0;
  for (const { resource_id } of items) {
    if (opts.failAfterItem !== undefined && done >= opts.failAfterItem) throw new ClaimError(500, "simulated_failure");
    try {
      // Derived data first (best-effort; no SQLite↔FS atomicity is promised).
      if (job.resource_type === "document") {
        const row = db.prepare("SELECT path FROM documents WHERE id = ?").get(resource_id);
        if (row?.path) { try { unlinkSync(row.path); } catch { /* missing file is fine */ } }
      }
      tx(() => {
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(resource_id);
        dropOwnership(job.resource_type, resource_id);
        db.prepare("UPDATE purge_items SET state = 'removed', error = NULL WHERE job_id = ? AND resource_id = ?").run(jobId, resource_id);
      });
      removed++;
    } catch (e) {
      db.prepare("UPDATE purge_items SET error = ? WHERE job_id = ? AND resource_id = ?").run(String(e.message).slice(0, 200), jobId, resource_id);
    }
    done++;
  }
  const pending = db.prepare("SELECT COUNT(*) n FROM purge_items WHERE job_id = ? AND state = 'isolated'").get(jobId).n;
  const status = pending === 0 ? "done" : "error";
  db.prepare("UPDATE purge_jobs SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), jobId);
  if (status === "done") audit("purge.completed", { by: actorId, fromAdmin: job.from_admin_id, type: job.resource_type, count: items.length, correlation: job.correlation_id });
  else audit("purge.partial", { by: actorId, type: job.resource_type, count: pending, correlation: job.correlation_id });
  return { ok: status === "done", job: jobId, status, removed, pending };
}

export const resumePurge = (jobId, actorId, opts) => executePurge(jobId, actorId, opts);

/**
 * Cancel a purge job that has NOT removed anything yet, releasing its quarantine.
 * A partially executed purge cannot be cancelled (some rows are already gone) — resume it instead,
 * so data is never left half-purged with an inconsistent quarantine.
 */
export function cancelPurge(jobId, actorId) {
  const job = db.prepare("SELECT * FROM purge_jobs WHERE id = ?").get(jobId);
  if (!job) throw new ClaimError(404, "job_not_found");
  const removed = db.prepare("SELECT COUNT(*) n FROM purge_items WHERE job_id = ? AND state = 'removed'").get(jobId).n;
  if (removed > 0) throw new ClaimError(409, "not_cancellable");
  tx(() => {
    db.prepare("DELETE FROM purge_quarantine WHERE job_id = ?").run(jobId);
    db.prepare("DELETE FROM purge_items WHERE job_id = ?").run(jobId);
    db.prepare("DELETE FROM purge_jobs WHERE id = ?").run(jobId);
    audit("purge.cancelled", { by: actorId, fromAdmin: job.from_admin_id, type: job.resource_type, correlation: job.correlation_id });
  });
  return { ok: true, job: jobId, cancelled: true };
}

/** Jobs with metadata only (no resource content). */
export const listPurgeJobs = () =>
  db.prepare(`SELECT j.id, j.from_admin_id AS fromAdmin, j.resource_type AS type, j.status, j.correlation_id AS correlation, j.created_at AS createdAt,
      (SELECT COUNT(*) FROM purge_items i WHERE i.job_id = j.id AND i.state = 'isolated') AS pending
    FROM purge_jobs j ORDER BY j.created_at DESC LIMIT 100`).all();
