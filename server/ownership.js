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
