// Phase 2 — single source of truth for "who owns what" (table `ownership`, migration v2).
// Rules: a resource is visible only to its owner admin; no owner = inaccessible to everyone
// until an admin explicitly claims it (audited, atomic). Owners are never inferred.
import { db, now, audit } from "./db.js";

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
      del.run(type, id);
      ins.run(type, id, to, at);
      hist.run(type, id, from, to, actorId, corr, at);
    }
    audit("ownership.transferred", { by: actorId, fromAdmin: from, toAdmin: to, type, count: ids.length, correlation: corr });
    return { ok: true, type, count: ids.length, from, to, correlation: corr };
  });
}
