// Fase 2 — Heartbeat passivo. Não executa ferramentas, shell, rede nem LLM.
const STATUSES = new Set(["pending", "approved", "rejected", "queued", "running", "done", "failed", "cancelled"]);
const KINDS = new Set(["approval_pending", "execution_unverified", "service_unavailable"]);
const RESOLUTIONS = new Set(["owner_approved", "owner_rejected", "policy_denied", "reconciled_after_restart", "detector_error"]);
const MAX_PAYLOAD_BYTES = 2048;
const MAX_PAYLOAD_ITEMS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const code = (s) => typeof s === "string" && /^[a-zA-Z0-9_.:@-]{1,80}$/.test(s);

export const HEARTBEAT_LIMITS = Object.freeze({
  payloadBytes: MAX_PAYLOAD_BYTES,
  payloadItems: MAX_PAYLOAD_ITEMS,
  pageSize: 50,
  kinds: Object.freeze([...KINDS]),
  statuses: Object.freeze([...STATUSES]),
  resolutions: Object.freeze([...RESOLUTIONS]),
});

/** Env values are explicit; "false", empty and unknown values never enable the service. */
export function parseHeartbeatEnv(value) {
  if (value === undefined || value === null) return null;
  if (value === true || value === "1" || value === "true") return true;
  if (value === false || value === "0" || value === "false" || value === "") return false;
  return false;
}

export function heartbeatEnabled({ envValue, settings } = {}) {
  const env = parseHeartbeatEnv(envValue);
  if (env !== null) return env;
  return settings?.heartbeat?.enabled === true;
}

function validatePayload(kind, payload) {
  if (!KINDS.has(kind)) throw new TypeError("heartbeat_kind_invalid");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TypeError("heartbeat_payload_invalid");
  const keys = Object.keys(payload);
  if (keys.length > MAX_PAYLOAD_ITEMS) throw new TypeError("heartbeat_payload_too_many_items");
  // Only bounded primitive metadata is allowed. Free-form text, paths, URLs, prompts and secrets
  // are deliberately not accepted by this first detector contract.
  for (const [key, value] of Object.entries(payload)) {
    if (!/^[a-z][a-zA-Z0-9_]{0,39}$/.test(key)) throw new TypeError("heartbeat_payload_key_invalid");
    if (!(typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || code(value))) {
      throw new TypeError("heartbeat_payload_value_invalid");
    }
  }
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) throw new TypeError("heartbeat_payload_too_large");
  return serialized;
}

const rowToIntent = (row) => row ? ({
  id: row.id,
  kind: row.kind,
  payload: JSON.parse(row.payload),
  status: row.status,
  correlationId: row.correlation_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  resolvedAt: row.resolved_at,
  resolutionCode: row.resolution_code,
}) : null;

export function createHeartbeat({
  db,
  audit = () => {},
  now = () => new Date().toISOString(),
  uid,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  intervalMs = 60_000,
  cooldownMs = 300_000,
  enabled = false,
} = {}) {
  if (!db || typeof db.prepare !== "function") throw new TypeError("heartbeat_db_required");
  if (typeof uid !== "function") throw new TypeError("heartbeat_uid_required");
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000) throw new TypeError("heartbeat_interval_invalid");
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0) throw new TypeError("heartbeat_cooldown_invalid");

  let timer = null;
  let inTick = false;
  let lastOccurrence = new Map();

  function insertIntent({ adminId, kind, payload, correlationId }) {
    if (!code(adminId)) throw new TypeError("heartbeat_admin_invalid");
    if (!UUID.test(correlationId || "")) throw new TypeError("heartbeat_correlation_invalid");
    const encoded = validatePayload(kind, payload);
    const timestamp = now();
    // Correlation ID is the idempotency key across restarts and instances. The DB unique
    // constraint, not the in-memory cooldown, is the final duplicate barrier.
    const id = uid();
    const result = db.prepare(`
      INSERT INTO autonomy_intentions
        (id, admin_id, kind, payload, status, correlation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
      ON CONFLICT(correlation_id) DO NOTHING
    `).run(id, adminId, kind, encoded, correlationId, timestamp, timestamp);
    if (Number(result.changes) === 0) {
      const existing = db.prepare("SELECT * FROM autonomy_intentions WHERE correlation_id = ? AND admin_id = ?").get(correlationId, adminId);
      return { created: false, intent: rowToIntent(existing) };
    }
    audit("heartbeat.anomaly_detected", { admin: adminId, kind, count: 1, correlation: correlationId });
    return {
      created: true,
      intent: rowToIntent(db.prepare("SELECT * FROM autonomy_intentions WHERE id = ? AND admin_id = ?").get(id, adminId)),
    };
  }

  function listIntents(adminId, { limit = 20, offset = 0, status } = {}) {
    if (!code(adminId)) throw new TypeError("heartbeat_admin_invalid");
    const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(HEARTBEAT_LIMITS.pageSize, limit)) : 20;
    const safeOffset = Number.isInteger(offset) ? Math.max(0, offset) : 0;
    if (status !== undefined && !STATUSES.has(status)) throw new TypeError("heartbeat_status_invalid");
    const rows = status
      ? db.prepare("SELECT * FROM autonomy_intentions WHERE admin_id = ? AND status = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?").all(adminId, status, safeLimit, safeOffset)
      : db.prepare("SELECT * FROM autonomy_intentions WHERE admin_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?").all(adminId, safeLimit, safeOffset);
    return rows.map(rowToIntent);
  }

  function resolveIntent(adminId, id, action) {
    if (!code(adminId)) throw new TypeError("heartbeat_admin_invalid");
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new TypeError("heartbeat_intention_id_invalid");
    if (action !== "approve" && action !== "reject") throw new TypeError("heartbeat_action_invalid");
    const status = action === "approve" ? "approved" : "rejected";
    const resolution = action === "approve" ? "owner_approved" : "owner_rejected";
    const timestamp = now();
    const result = db.prepare(`
      UPDATE autonomy_intentions
      SET status = ?, updated_at = ?, resolved_at = ?, resolution_code = ?
      WHERE id = ? AND admin_id = ? AND status = 'pending'
    `).run(status, timestamp, timestamp, resolution, id, adminId);
    if (Number(result.changes) !== 1) return null;
    audit(action === "approve" ? "heartbeat.intention_approved" : "heartbeat.intention_rejected", {
      admin: adminId, status, correlation: id,
    });
    return rowToIntent(db.prepare("SELECT * FROM autonomy_intentions WHERE id = ? AND admin_id = ?").get(id, adminId));
  }

  function tick(detections = []) {
    if (!enabled || inTick) return { skipped: true, created: 0 };
    inTick = true;
    try {
      let created = 0;
      for (const detection of detections) {
        const { adminId, kind, payload, correlationId, occurrenceKey } = detection || {};
        const key = typeof occurrenceKey === "string" ? occurrenceKey : correlationId;
        const time = Date.now();
        const previous = lastOccurrence.get(key);
        if (previous !== undefined && time - previous < cooldownMs) continue;
        const result = insertIntent({ adminId, kind, payload, correlationId });
        if (result.created) {
          created += 1;
          lastOccurrence.set(key, time);
        }
      }
      return { skipped: false, created };
    } finally {
      inTick = false;
    }
  }

  function start() {
    if (!enabled || timer !== null) return false;
    timer = setIntervalFn(() => {
      // No detectors are run implicitly: integrations must supply validated detections explicitly.
      // This timer is deliberately inert until a detector is approved and injected.
    }, intervalMs);
    timer?.unref?.();
    return true;
  }

  function stop() {
    if (timer === null) return false;
    clearIntervalFn(timer);
    timer = null;
    return true;
  }

  return Object.freeze({
    start, stop, tick, insertIntent, listIntents, resolveIntent,
    get enabled() { return enabled; },
    get running() { return timer !== null; },
  });
}

export { STATUSES as HEARTBEAT_STATUSES, KINDS as HEARTBEAT_KINDS, RESOLUTIONS as HEARTBEAT_RESOLUTIONS };
