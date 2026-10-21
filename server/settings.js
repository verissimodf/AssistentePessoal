// Settings, Phase 2: PERSONAL (one record per admin, table admin_settings) and GLOBAL (one record
// for the installation, table global_settings). Secrets are encrypted at rest (AES-256-GCM); the
// master key is created on first run in data/master.key (or JARVIS_MASTER_KEY) and never leaves
// the machine. Pre-Phase-2 settings stay byte-for-byte in legacy_settings, inactive, until an
// admin explicitly claims the whole block. Personal values can never weaken the global policy:
// host/integrations/localVoiceUrl always come from the global record.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, db, now, audit } from "./db.js";
import { AuthError } from "./auth.js";

const keyFile = join(DATA_DIR, "master.key");
function masterKey() {
  if (process.env.JARVIS_MASTER_KEY)
    return createHash("sha256").update(process.env.JARVIS_MASTER_KEY).digest();
  if (!existsSync(keyFile))
    writeFileSync(keyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
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

// ---------- classification (D5) ----------
export const PERSONAL_DEFAULTS = {
  general: { agentName: "Jarvis", language: "pt" },
  providers: {
    ollama: { enabled: true, baseUrl: "http://ollama-llm:11434/v1", model: "llama3.1" },
  },
  comms: {},
  voice: {
    tts: "browser",
    wake: { clap: true, word: true, hotkey: true, ptt: true },
    sensitivity: 6,
    hotkey: "Ctrl+Shift+J",
  },
};
export const GLOBAL_DEFAULTS = {
  host: { enabled: false, allowlist: "ls, dir, git status, code ., start, xdg-open" },
  integrations: {},
  localVoiceUrl: "http://127.0.0.1:7778",
};
const PERSONAL_GENERAL = ["agentName", "language", "activeAgentId"];

/** Classify a dotted key path from the legacy single-record settings. */
export function classifyKey(path) {
  const [top, sub] = path.split(".");
  if (top === "host" || top === "integrations") return "global";
  if (top === "voice") return sub === "localVoiceUrl" ? "global" : "personal";
  if (top === "providers" || top === "comms") return "personal";
  if (top === "general")
    return sub === undefined || PERSONAL_GENERAL.includes(sub) ? "personal" : "unclassified";
  return "unclassified";
}

/** Keep only personal-classified parts of a settings object (values untouched, still encrypted). */
export function personalPart(s = {}) {
  const out = {};
  if (s.general && typeof s.general === "object") {
    const g = Object.fromEntries(
      Object.entries(s.general).filter(([k]) => PERSONAL_GENERAL.includes(k)),
    );
    if (Object.keys(g).length) out.general = g;
  }
  if (s.voice && typeof s.voice === "object") {
    const { localVoiceUrl: _drop, ...v } = s.voice;
    if (Object.keys(v).length) out.voice = v;
  }
  for (const k of ["providers", "comms"]) if (s[k] && typeof s[k] === "object") out[k] = s[k];
  return out;
}

// ---------- raw storage ----------
const readJson = (sql, ...a) => {
  const r = db.prepare(sql).get(...a);
  return r ? JSON.parse(r.data) : null;
};
const rawPersonal = (adminId) =>
  adminId ? readJson("SELECT data FROM admin_settings WHERE admin_id = ?", adminId) : null;
function rawGlobal() {
  const g = readJson("SELECT data FROM global_settings WHERE id = 1") || {};
  const clean = Object.fromEntries(
    Object.entries(g).filter(([, v]) => v !== null && v !== undefined),
  );
  return { ...GLOBAL_DEFAULTS, ...clean, host: { ...GLOBAL_DEFAULTS.host, ...(clean.host || {}) } };
}

const walkDecrypt = (o) => {
  if (!o || typeof o !== "object" || Array.isArray(o)) return o;
  return Object.fromEntries(
    Object.entries(o).map(([k, v]) => [
      k,
      isSecretField(k) && typeof v === "string" ? decrypt(v) : walkDecrypt(v),
    ]),
  );
};
const walkMask = (o) => {
  if (!o || typeof o !== "object" || Array.isArray(o)) return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (isSecretField(k) && typeof v === "string") {
      if (v) out.hasKey = true;
      out[k] = "";
    } else out[k] = walkMask(v);
  }
  return out;
};
const merge = (cur, inc) => {
  if (!inc || typeof inc !== "object" || Array.isArray(inc)) return inc;
  const out = { ...(cur && typeof cur === "object" ? cur : {}) };
  for (const [k, v] of Object.entries(inc)) {
    if (k === "hasKey") continue;
    if (isSecretField(k) && typeof v === "string") {
      if (v) out[k] = encrypt(v);
    } else out[k] = merge(cur?.[k], v);
  }
  return out;
};

function compose(personal, global, walk) {
  const p = walk(personal || {});
  const g = walk(global);
  return {
    general: { ...PERSONAL_DEFAULTS.general, ...(p.general || {}) },
    providers: p.providers || (personal ? {} : PERSONAL_DEFAULTS.providers),
    comms: p.comms || {},
    voice: { ...PERSONAL_DEFAULTS.voice, ...(p.voice || {}), localVoiceUrl: g.localVoiceUrl },
    integrations: g.integrations || {},
    host: g.host,
  };
}

/**
 * Effective settings for one admin (server-side only, secrets decrypted). adminId null → only
 * global settings + personal defaults (no credentials): unowned paths never see anyone's keys.
 */
export function getSettings(adminId = null) {
  const personal = rawPersonal(adminId);
  return compose(personal ?? (adminId ? null : null), rawGlobal(), walkDecrypt);
}

/** Settings safe for the browser: secrets replaced by hasKey flags. */
export function publicSettings(adminId = null) {
  return compose(rawPersonal(adminId), rawGlobal(), walkMask);
}

/**
 * Endereçamento: dentro de um container, `127.0.0.1`/IPs privados quase nunca apontam para
 * o serviço desejado (são o próprio container ou um IP dinâmico reciclável). Recusamos URLs
 * com host IP privado em providers/integrations para forçar o uso do DNS de serviço.
 * Fora do container (execução nativa), o loopback é legítimo e nada é recusado.
 */
const PRIVATE_IPV4_HOST = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
const isHttpUrl = (v) => typeof v === "string" && /^https?:\/\//i.test(v);
const insideContainer = () => existsSync("/.dockerenv") || existsSync("/run/.containerenv");

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function assertNoContainerIpUrls(inc) {
  if (!insideContainer()) return;
  const offenders = [];
  for (const [id, cfg] of Object.entries(inc.providers || {})) {
    if (isHttpUrl(cfg?.baseUrl) && PRIVATE_IPV4_HOST.test(hostOf(cfg.baseUrl)))
      offenders.push(`providers.${id}.baseUrl`);
  }
  for (const [id, cfg] of Object.entries(inc.integrations || {})) {
    if (isHttpUrl(cfg?.command) && PRIVATE_IPV4_HOST.test(hostOf(cfg.command)))
      offenders.push(`integrations.${id}.command`);
  }
  // URLs de comunicação (ex.: feed ICS da agenda) também são buscadas pelo serviço.
  for (const [id, cfg] of Object.entries(inc.comms || {})) {
    if (isHttpUrl(cfg?.icsUrl) && PRIVATE_IPV4_HOST.test(hostOf(cfg.icsUrl)))
      offenders.push(`comms.${id}.icsUrl`);
  }
  if (offenders.length) {
    throw new AuthError(
      400,
      `private_ip_url_not_allowed: ${offenders.join(", ")} — use o DNS de serviço (ex.: http://servico:porta)`,
    );
  }
}

/**
 * Merge incoming settings. Personal parts go to the caller's own record; global parts
 * (host, integrations, voice.localVoiceUrl) require allowGlobal (verified human admin).
 * Unknown keys are ignored. Empty secret fields keep the stored value.
 */
export function updateSettings(incoming = {}, { adminId = null, allowGlobal = true } = {}) {
  const inc = incoming && typeof incoming === "object" ? incoming : {};
  assertNoContainerIpUrls(inc);
  const g = {};
  if (inc.host !== undefined) g.host = inc.host;
  if (inc.integrations !== undefined) g.integrations = inc.integrations;
  if (inc.voice && inc.voice.localVoiceUrl !== undefined) g.localVoiceUrl = inc.voice.localVoiceUrl;
  if (Object.keys(g).length) {
    if (!allowGlobal) throw new AuthError(403, "global_settings_admin_only");
    const cur = readJson("SELECT data FROM global_settings WHERE id = 1") || {};
    const next = merge(cur, g);
    if (next.host)
      next.host = {
        enabled: !!next.host.enabled,
        allowlist: String(next.host.allowlist ?? GLOBAL_DEFAULTS.host.allowlist),
      };
    db.prepare(
      "INSERT INTO global_settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    ).run(JSON.stringify(next));
  }
  const p = personalPart(inc);
  if (adminId && Object.keys(p).length) {
    const next = merge(rawPersonal(adminId) || {}, p);
    db.prepare(
      "INSERT INTO admin_settings (admin_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(admin_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
    ).run(adminId, JSON.stringify(next), now());
  }
  return publicSettings(adminId);
}

// ---------- P0.2: proveniência efetiva (origem de cada valor, nunca o valor em si) ----------
// O painel precisa distinguir "este valor é meu/pessoal", "é a política global da instalação" e
// "é o padrão de fábrica" — sem expor segredos. Segredos entram apenas como `secret: true`; o
// valor NUNCA sai daqui (nem desencriptado, nem mascarado).

/** Variáveis de ambiente cujo VALOR é seguro mostrar (config operacional não sensível). */
export const ENV_REPORTED = [
  "NODE_ENV",
  "JARVIS_HOST",
  "JARVIS_PORT",
  "JARVIS_COOKIE_SECURE",
  "JARVIS_ALLOWED_ORIGINS",
  "JARVIS_MAX_UPLOAD",
  "JARVIS_MAX_DOCUMENT",
  "JARVIS_MAIL_TRANSPORT",
  "JARVIS_NO_LISTEN",
];
/** Variáveis que podem conter segredo/caminho: só "definida/não definida", nunca o valor. */
export const ENV_PRESENCE_ONLY = [
  "JARVIS_MASTER_KEY",
  "JARVIS_SERVICE_TOKEN",
  "JARVIS_DATA_DIR",
  "JARVIS_URL",
];

const envRaw = (name) => {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

export function envProvenance() {
  return {
    reported: ENV_REPORTED.map((name) => ({
      name,
      set: envRaw(name) !== null,
      value: envRaw(name),
    })),
    presenceOnly: ENV_PRESENCE_ONLY.map((name) => ({ name, set: envRaw(name) !== null })),
  };
}

const hasPath = (obj, parts) => {
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !Object.hasOwn(cur, p)) return false;
    cur = cur[p];
  }
  return true;
};

// O registro global guarda `host.*`, `integrations.*` e `localVoiceUrl` (não `voice.localVoiceUrl`).
const globalParts = (parts) => {
  const [top, sub] = parts;
  if (top === "voice") return sub === "localVoiceUrl" ? ["localVoiceUrl"] : null;
  if (top === "host" || top === "integrations") return parts;
  return null;
};

/**
 * Proveniência de CADA caminho efetivo para um administrador:
 *   `default`  → valor de fábrica (nada gravado);
 *   `personal` → gravado no registro pessoal DESTE administrador;
 *   `global`   → gravado na política global da instalação (host/integrações/voz local).
 * Devolve caminho, classe, origem e se é segredo — nunca valores.
 */
export function settingsProvenance(adminId = null) {
  const personal = rawPersonal(adminId) || {};
  const globalRecord = readJson("SELECT data FROM global_settings WHERE id = 1") || {};
  const effective = publicSettings(adminId);
  const keys = [];
  const walk = (obj, prefix = "") => {
    for (const [k, v] of Object.entries(obj || {})) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        walk(v, path);
        continue;
      }
      const parts = path.split(".");
      const gParts = globalParts(parts);
      const origin = gParts
        ? hasPath(globalRecord, gParts)
          ? "global"
          : "default"
        : hasPath(personal, parts)
          ? "personal"
          : "default";
      keys.push({ path, origin, class: classifyKey(path), secret: isSecretField(k) });
    }
  };
  walk(effective);
  return { keys, env: envProvenance() };
}

// ---------- legacy settings (pre-Phase-2 single record) ----------
function keyPaths(o, prefix = "", depth = 0, out = []) {
  for (const [k, v] of Object.entries(o || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v) && depth < 2)
      keyPaths(v, path, depth + 1, out);
    else out.push({ key: path, class: classifyKey(path), secret: isSecretField(k) });
  }
  return out;
}

/** Inventory of the legacy record: key names, classification and status — never values. */
export function legacySettingsInventory() {
  const r = db
    .prepare("SELECT data, claimed_by, claimed_at FROM legacy_settings WHERE id = 1")
    .get();
  if (!r) return { present: false };
  return {
    present: true,
    claimed: !!r.claimed_by,
    claimedAt: r.claimed_at,
    keys: keyPaths(JSON.parse(r.data)),
  };
}

/**
 * Explicit, whole-block claim of the legacy personal settings by ONE admin. Refused if already
 * claimed or if the admin already has personal settings (no automatic split/merge). Values are
 * copied still encrypted; nothing is decrypted, returned or logged. Unclassified keys stay inactive.
 */
export function claimLegacySettings(adminId, confirm) {
  if (!adminId) throw new AuthError(403, "admin_session_required");
  if (confirm !== "ASSUMIR CONFIGURACOES") throw new AuthError(400, "confirmation_required");
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = db.prepare("SELECT data, claimed_by FROM legacy_settings WHERE id = 1").get();
    if (!r) throw new AuthError(404, "no_legacy_settings");
    if (r.claimed_by) throw new AuthError(409, "already_claimed");
    if (rawPersonal(adminId)) throw new AuthError(409, "personal_settings_not_empty");
    const at = now();
    db.prepare(
      "UPDATE legacy_settings SET claimed_by = ?, claimed_at = ? WHERE id = 1 AND claimed_by IS NULL",
    ).run(adminId, at);
    db.prepare("INSERT INTO admin_settings (admin_id, data, updated_at) VALUES (?, ?, ?)").run(
      adminId,
      JSON.stringify(personalPart(JSON.parse(r.data))),
      at,
    );
    db.prepare(
      "INSERT INTO legacy_claims (resource_type, resource_id, admin_id, at) VALUES ('settings', 'legacy_settings', ?, ?)",
    ).run(adminId, at);
    audit("legacy.settings_claimed", { admin: adminId });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ok: true };
}
