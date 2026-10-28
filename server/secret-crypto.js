// Local AES-256-GCM helpers shared by settings and versioned data migrations.
// Kept independent from db.js so the database migration runner can use it without an import cycle.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDataDir =
  process.env.JARVIS_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "data");

function masterKey({ dataDir = defaultDataDir, createKey = true } = {}) {
  const configured = process.env.JARVIS_MASTER_KEY;
  if (configured) return createHash("sha256").update(configured).digest();

  const keyFile = join(dataDir, "master.key");
  if (!existsSync(keyFile)) {
    if (!createKey) throw new Error("master_key_missing");
    try {
      writeFileSync(keyFile, randomBytes(32).toString("hex"), { mode: 0o600, flag: "wx" });
    } catch (error) {
      if (error?.code !== "EEXIST") throw new Error("master_key_unavailable");
    }
  }

  let stored;
  try {
    stored = readFileSync(keyFile, "utf8").trim();
  } catch {
    throw new Error("master_key_unavailable");
  }
  if (!/^[a-f0-9]{64}$/i.test(stored)) throw new Error("master_key_invalid");
  return Buffer.from(stored, "hex");
}

export function ensureMasterKey(options = {}) {
  masterKey(options);
}

export function encrypt(text, options = {}) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(options), iv);
  const encrypted = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  return `enc:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(value, options = {}) {
  if (typeof value !== "string" || !value.startsWith("enc:")) return value;
  try {
    const parts = value.split(":");
    if (parts.length !== 4) throw new Error("invalid_ciphertext");
    const [, iv, tag, data] = parts;
    const decipher = createDecipheriv("aes-256-gcm", masterKey(options), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error("ciphertext_invalid_or_key_unavailable");
  }
}
