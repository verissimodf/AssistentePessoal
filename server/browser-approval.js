import { createHash } from "node:crypto";
import { decrypt, encrypt } from "./secret-crypto.js";

export const browserFingerprint = (request = {}) =>
  createHash("sha256")
    .update(
      [
        request.op,
        request.url || "",
        request.selector || "",
        request.text || "",
        String(request.timeoutMs ?? ""),
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 32);

export const isBrowserWrite = (action) =>
  action?.kind === "browser_action" && ["click", "fill"].includes(action.params?.op);

export function protectBrowserAction(action) {
  if (action?.kind !== "browser_action" || action?.params?.op !== "fill") return action;
  const { text = "", ...params } = action.params;
  if (typeof text !== "string") throw new Error("browser_payload_invalid");
  return { ...action, params: { ...params, encryptedText: encrypt(text) } };
}

export function unprotectBrowserAction(action) {
  if (action?.kind !== "browser_action" || action?.params?.op !== "fill") return action;
  if (typeof action.params.encryptedText !== "string" || "text" in action.params)
    throw new Error("browser_payload_invalid");
  const { encryptedText, ...params } = action.params;
  const executable = { ...action, params: { ...params, text: decrypt(encryptedText) } };
  if (!action.fingerprint || browserFingerprint(executable.params) !== action.fingerprint)
    throw new Error("browser_fingerprint_mismatch");
  return executable;
}

export function browserActionReview(action, { reveal = false } = {}) {
  if (action?.kind !== "browser_action" || !action.params)
    throw new Error("browser_action_invalid");
  const params = action.params;
  const isFill = params.op === "fill";
  let preview = null;
  if (isFill) {
    if (typeof params.encryptedText !== "string" || "text" in params)
      throw new Error("browser_payload_invalid");
    preview = reveal ? unprotectBrowserAction(action).params.text : "••••••••";
  } else if (reveal) {
    throw new Error("browser_reveal_not_applicable");
  }
  if (!action.fingerprint) throw new Error("browser_fingerprint_mismatch");
  return {
    operation: String(params.op || ""),
    host: params.url ? new URL(params.url).host : null,
    selector: params.selector || null,
    hasText: isFill,
    preview,
    fingerprint: action.fingerprint,
  };
}

export function normalizeBrowserHosts(value) {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const hosts = entries.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  if (hosts.length > 100) throw new Error("browser_hosts_limit");
  for (const host of hosts) {
    if (
      host.length > 253 ||
      host.includes("*") ||
      /[/:?#@\s]/.test(host) ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\.?$/.test(
        host,
      )
    )
      throw new Error("browser_host_invalid");
  }
  return [...new Set(hosts.map((host) => host.replace(/\.$/, "")))];
}

export function browserHostAllowed(rawUrl, allowedHosts = []) {
  const allowlist = normalizeBrowserHosts(allowedHosts);
  if (!allowlist.length) return true;
  const host = new URL(rawUrl).hostname.toLowerCase().replace(/\.$/, "");
  return allowlist.includes(host);
}
