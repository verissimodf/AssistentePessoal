// Settings with secrets encrypted at rest (AES-256-GCM). The master key is created on first
// run in data/master.key (or taken from JARVIS_MASTER_KEY) and never leaves the machine.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, kvGet, kvSet } from "./db.js";

const keyFile = join(DATA_DIR, "master.key");
function masterKey() {
  if (process.env.JARVIS_MASTER_KEY) return createHash("sha256").update(process.env.JARVIS_MASTER_KEY).digest();
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  return Buffer.from(readFileSync(keyFile, "utf8").trim(), "hex");
}
const KEY = masterKey();

export function encrypt(text) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return `enc:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}
export function decrypt(value) {
  if (typeof value !== "string" || !value.startsWith("enc:")) return value;
  const [, iv, tag, data] = value.split(":");
  const d = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export const isSecretField = (k) => /key|token|password|secret/i.test(k);

const DEFAULTS = {
  general: { agentName: "Jarvis", language: "pt" },
  providers: { ollama: { enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3.1" } },
  integrations: {}, comms: {},
  voice: { tts: "browser", wake: { clap: true, word: true, hotkey: true, ptt: true }, sensitivity: 6, hotkey: "Ctrl+Shift+J", localVoiceUrl: "http://127.0.0.1:7778" },
  host: { enabled: false, allowlist: "ls, dir, git status, code ., start, xdg-open" },
};

/** Raw settings with secrets decrypted (server-side use only). */
export function getSettings() {
  const s = kvGet("settings", DEFAULTS);
  const walk = (o) => {
    if (!o || typeof o !== "object") return o;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, isSecretField(k) && typeof v === "string" ? decrypt(v) : walk(v)]));
  };
  return { ...DEFAULTS, ...walk(s) };
}

/** Settings safe for the browser: secrets replaced by hasKey flags. */
export function publicSettings() {
  const s = kvGet("settings", DEFAULTS);
  const walk = (o) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return o;
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (isSecretField(k) && typeof v === "string") { if (v) out.hasKey = true; out[k] = ""; }
      else out[k] = walk(v);
    }
    return out;
  };
  return { ...DEFAULTS, ...walk(s) };
}

/** Merge incoming settings; empty secret fields keep the stored value. */
export function updateSettings(incoming) {
  const current = kvGet("settings", DEFAULTS);
  const merge = (cur, inc) => {
    if (!inc || typeof inc !== "object" || Array.isArray(inc)) return inc;
    const out = { ...(cur || {}) };
    for (const [k, v] of Object.entries(inc)) {
      if (k === "hasKey") continue;
      if (isSecretField(k) && typeof v === "string") { if (v) out[k] = encrypt(v); }
      else out[k] = merge(cur?.[k], v);
    }
    return out;
  };
  kvSet("settings", merge(current, incoming));
  return publicSettings();
}
