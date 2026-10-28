import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "jarvis-secret-crypto-"));
process.env.JARVIS_DATA_DIR = dataDir;
process.env.JARVIS_NO_LISTEN = "1";
delete process.env.JARVIS_MASTER_KEY;

const { encrypt, decrypt } = await import("../server/settings.js");

function assertPrivateKeyMode(path) {
  // Windows ACLs are not represented as POSIX mode bits by Node; Linux CI checks 0600 exactly.
  if (process.platform !== "win32") assert.equal(statSync(path).mode & 0o777, 0o600);
}

test("encrypt refuses to create a replacement key when createKey is false", () => {
  const missingDir = mkdtempSync(join(tmpdir(), "jarvis-no-key-"));
  assert.throws(
    () => encrypt("pending payload", { dataDir: missingDir, createKey: false }),
    /master_key_missing/,
  );
  assert.equal(statSync(missingDir).isDirectory(), true);
});

test("settings still creates the local master key during normal service initialization", () => {
  assertPrivateKeyMode(join(dataDir, "master.key"));
});

test("encrypt rejects a malformed existing master key", () => {
  const malformedDir = mkdtempSync(join(tmpdir(), "jarvis-bad-key-"));
  writeFileSync(join(malformedDir, "master.key"), "not-a-256-bit-hex-key\n", { mode: 0o600 });
  assert.throws(
    () => encrypt("pending payload", { dataDir: malformedDir, createKey: false }),
    /master_key_invalid/,
  );
});

test("new data-directory keys retain AES-GCM round-trip and private file mode", () => {
  const isolatedDir = mkdtempSync(join(tmpdir(), "jarvis-new-key-"));
  const plaintext = "FORM_SECRET_SENTINEL: texto de formulário";
  const ciphertext = encrypt(plaintext, { dataDir: isolatedDir });
  assert.notEqual(ciphertext, plaintext);
  assert.equal(decrypt(ciphertext, { dataDir: isolatedDir }), plaintext);
  assertPrivateKeyMode(join(isolatedDir, "master.key"));
  assert.equal(readFileSync(join(isolatedDir, "master.key"), "utf8").trim().length, 64);
});
