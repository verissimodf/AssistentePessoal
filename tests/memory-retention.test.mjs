import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), "jarvis-memory-retention-"));
process.env.JARVIS_NO_LISTEN = "1";
const { auth, db } = await import("../server/db.js");
const { assignNew } = await import("../server/ownership.js");
const {
  memoryRetentionPolicy,
  previewMemoryRetention,
  setMemoryRetentionPolicy,
  listQuarantinedMemories,
  restoreQuarantinedMemory,
  runMemoryRetention,
  visibleMemorySql,
} = await import("../server/memory-retention.js");

auth.setupFirstAdmin({
  token: auth.ensureBootstrap().token,
  username: "retencao",
  password: "senha-muito-forte-1",
});
const admin = db.prepare("SELECT id FROM admins WHERE username='retencao'").get().id;
function addMemory(id, createdAt, owner = admin) {
  db.prepare(
    "INSERT INTO memories(id,content,tags,embedding,created_at) VALUES(?,?, '',NULL,?)",
  ).run(id, `conteudo ${id}`, createdAt);
  assignNew("memory", id, owner);
}

test("retention starts disabled; preview lists only the explicit owner's expired memories", () => {
  addMemory("old-owned", "2025-01-01T00:00:00.000Z");
  addMemory("recent-owned", new Date().toISOString());
  assert.equal(memoryRetentionPolicy(admin).enabled, false);
  assert.equal(previewMemoryRetention(admin, 30).expiringCount, 1);
  assert.throws(() => previewMemoryRetention(null, 30), /invalid_retention_policy/);
});

test("expired memories quarantine, disappear from retrieval, and can be restored", () => {
  setMemoryRetentionPolicy(admin, { enabled: true, retentionDays: 30 });
  const now = new Date();
  assert.deepEqual(runMemoryRetention(now), { quarantined: 1, purged: 0 });
  assert.equal(listQuarantinedMemories(admin)[0].id, "old-owned");
  const visible = db
    .prepare(
      `SELECT m.id FROM memories m JOIN ownership o
    ON o.resource_type='memory' AND o.resource_id=m.id AND o.owner_admin_id=? WHERE 1=1 ${visibleMemorySql("m", "o")}`,
    )
    .all(admin);
  assert.deepEqual(
    visible.map((r) => r.id),
    ["recent-owned"],
  );
  assert.equal(restoreQuarantinedMemory(admin, "old-owned"), true);
  assert.equal(listQuarantinedMemories(admin).length, 0);
  assert.ok(
    db.prepare("SELECT anchor_at FROM memory_retention_anchors WHERE memory_id='old-owned'").get()
      .anchor_at,
  );
});

test("quarantined memory is physically removed only after the grace period", () => {
  addMemory("purge-after-grace", "2024-01-01T00:00:00.000Z");
  const now = new Date();
  runMemoryRetention(now);
  assert.ok(db.prepare("SELECT 1 FROM memories WHERE id='purge-after-grace'").get());
  runMemoryRetention(new Date(now.getTime() + 31 * 86_400_000));
  assert.equal(db.prepare("SELECT 1 FROM memories WHERE id='purge-after-grace'").get(), undefined);
  assert.equal(
    db
      .prepare(
        "SELECT 1 FROM ownership WHERE resource_type='memory' AND resource_id='purge-after-grace'",
      )
      .get(),
    undefined,
  );
});
