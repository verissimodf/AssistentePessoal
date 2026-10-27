// Per-admin opt-in retention. Expired memories are hidden immediately, quarantined for recovery,
// then deleted in bounded batches. Audit contains counts and ids only, never memory text.
import { db, now, audit } from "./db.js";
import { owns, tx, dropOwnership } from "./ownership.js";

export const RETENTION_DAYS = [30, 90, 180, 365];
const GRACE_DAYS = 30;

export function memoryRetentionPolicy(adminId) {
  if (!adminId) return { enabled: false, retentionDays: null, graceDays: GRACE_DAYS };
  const row = db
    .prepare(
      "SELECT enabled,retention_days,grace_days FROM memory_retention_policies WHERE admin_id=?",
    )
    .get(adminId);
  return row
    ? { enabled: !!row.enabled, retentionDays: row.retention_days, graceDays: row.grace_days }
    : { enabled: false, retentionDays: null, graceDays: GRACE_DAYS };
}

export function previewMemoryRetention(adminId, days, at = new Date()) {
  if (!adminId || !RETENTION_DAYS.includes(Number(days)))
    throw new Error("invalid_retention_policy");
  const cutoff = new Date(at.getTime() - Number(days) * 86_400_000).toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count, MIN(m.created_at) AS oldest
    FROM memories m JOIN ownership o ON o.resource_type='memory' AND o.resource_id=m.id AND o.owner_admin_id=?
    LEFT JOIN memory_retention_items q ON q.memory_id=m.id
    WHERE COALESCE((SELECT anchor_at FROM memory_retention_anchors a WHERE a.memory_id=m.id),m.created_at)<=? AND q.memory_id IS NULL`,
    )
    .get(adminId, cutoff);
  return {
    retentionDays: Number(days),
    cutoff,
    expiringCount: row.count,
    oldestCreatedAt: row.oldest,
  };
}

export function setMemoryRetentionPolicy(adminId, { enabled, retentionDays }) {
  if (!adminId || typeof enabled !== "boolean" || !RETENTION_DAYS.includes(Number(retentionDays)))
    throw new Error("invalid_retention_policy");
  const at = now();
  db.prepare(
    `INSERT INTO memory_retention_policies(admin_id,enabled,retention_days,grace_days,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(admin_id) DO UPDATE SET enabled=excluded.enabled,
    retention_days=excluded.retention_days,updated_at=excluded.updated_at`,
  ).run(adminId, enabled ? 1 : 0, Number(retentionDays), GRACE_DAYS, at);
  audit(enabled ? "memory.retention_enabled" : "memory.retention_disabled", {
    admin: adminId,
    count: Number(retentionDays),
  });
  return memoryRetentionPolicy(adminId);
}

export function listQuarantinedMemories(adminId) {
  if (!adminId) return [];
  return db
    .prepare(
      `SELECT m.id,m.content,m.tags,m.created_at AS createdAt,q.quarantined_at AS quarantinedAt,
      q.purge_after AS purgeAfter
    FROM memory_retention_items q JOIN memories m ON m.id=q.memory_id
    JOIN ownership o ON o.resource_type='memory' AND o.resource_id=m.id AND o.owner_admin_id=?
    ORDER BY q.purge_after LIMIT 100`,
    )
    .all(adminId);
}

export function restoreQuarantinedMemory(adminId, memoryId) {
  if (!adminId || !owns(adminId, "memory", memoryId)) return false;
  const at = now();
  const r = db
    .prepare(
      `DELETE FROM memory_retention_items WHERE memory_id=? AND owner_admin_id=?
    AND purge_after>?`,
    )
    .run(memoryId, adminId, at);
  if (r.changes)
    db.prepare(
      "INSERT INTO memory_retention_anchors(memory_id,anchor_at) VALUES(?,?) ON CONFLICT(memory_id) DO UPDATE SET anchor_at=excluded.anchor_at",
    ).run(memoryId, at);
  if (r.changes) audit("memory.retention_restored", { admin: adminId });
  return Number(r.changes) === 1;
}

/** Runs at startup and periodically. Work is limited to 50 rows per admin per pass. */
export function runMemoryRetention(at = new Date()) {
  const atIso = at.toISOString();
  let quarantined = 0;
  let purged = 0;
  const policies = db
    .prepare(
      `SELECT p.admin_id,p.retention_days,p.grace_days FROM memory_retention_policies p
    JOIN admins a ON a.id=p.admin_id AND a.active=1 WHERE p.enabled=1`,
    )
    .all();
  for (const p of policies) {
    const cutoff = new Date(at.getTime() - p.retention_days * 86_400_000).toISOString();
    const rows = db
      .prepare(
        `SELECT m.id FROM memories m JOIN ownership o
      ON o.resource_type='memory' AND o.resource_id=m.id AND o.owner_admin_id=?
      LEFT JOIN memory_retention_items q ON q.memory_id=m.id
      WHERE COALESCE((SELECT anchor_at FROM memory_retention_anchors a WHERE a.memory_id=m.id),m.created_at)<=? AND q.memory_id IS NULL ORDER BY m.created_at LIMIT 50`,
      )
      .all(p.admin_id, cutoff);
    if (rows.length)
      tx(() => {
        const add = db.prepare(
          "INSERT OR IGNORE INTO memory_retention_items(memory_id,owner_admin_id,quarantined_at,purge_after) VALUES(?,?,?,?)",
        );
        const purgeAfter = new Date(at.getTime() + p.grace_days * 86_400_000).toISOString();
        for (const row of rows) add.run(row.id, p.admin_id, atIso, purgeAfter);
      });
    quarantined += rows.length;
  }
  const due = db
    .prepare(
      `SELECT q.memory_id,q.owner_admin_id FROM memory_retention_items q
    JOIN ownership o ON o.resource_type='memory' AND o.resource_id=q.memory_id AND o.owner_admin_id=q.owner_admin_id
    WHERE q.purge_after<=? ORDER BY q.purge_after LIMIT 50`,
    )
    .all(atIso);
  for (const item of due)
    tx(() => {
      db.prepare(
        "DELETE FROM memories WHERE id=? AND EXISTS (SELECT 1 FROM ownership WHERE resource_type='memory' AND resource_id=? AND owner_admin_id=?)",
      ).run(item.memory_id, item.memory_id, item.owner_admin_id);
      dropOwnership("memory", item.memory_id);
    });
  purged = due.length;
  if (quarantined) audit("memory.retention_quarantined", { count: quarantined });
  if (purged) audit("memory.retention_purged", { count: purged });
  return { quarantined, purged };
}

/** SQL fragment to keep expired and quarantined memories out of retrieval/list/export immediately. */
export const visibleMemorySql = (memoryAlias = "m", ownerAlias = "o") =>
  `AND NOT EXISTS (SELECT 1 FROM memory_retention_items mq WHERE mq.memory_id=${memoryAlias}.id)
   AND NOT EXISTS (SELECT 1 FROM memory_retention_policies mp WHERE mp.admin_id=${ownerAlias}.owner_admin_id
     AND mp.enabled=1 AND julianday(COALESCE((SELECT anchor_at FROM memory_retention_anchors ma WHERE ma.memory_id=${memoryAlias}.id),${memoryAlias}.created_at)) < julianday('now', '-' || mp.retention_days || ' days'))`;
