import http from "node:http";
import { randomUUID } from "node:crypto";
import { normalizeBrowserHosts } from "./browser-hosts.js";
import { MAX_BROWSER_POLICY_LEASE_MS } from "./browser-egress-policy.js";

const MAX_RESPONSE_BYTES = 2_048;
const POLICY_TIMEOUT_MS = 2_000;

function requestPolicySocket({ socketPath, method, path, body, signal }) {
  if (!socketPath) return Promise.reject(new Error("browser_policy_socket_unavailable"));
  const json = JSON.stringify(body || {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path,
        method,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(json) },
        signal,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy(new Error("browser_policy_response_too_large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (res.statusCode !== 200 || value?.ok !== true)
              throw new Error(value?.error || "browser_policy_rejected");
            resolve(value);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error("browser_policy_timeout")),
      POLICY_TIMEOUT_MS,
    );
    req.once("close", () => clearTimeout(timer));
    req.once("error", reject);
    req.end(json);
  });
}

export async function createBrowserEgressPolicy(
  allowedHosts,
  { socketPath = process.env.JARVIS_BROWSER_POLICY_SOCKET, expiresAt, signal } = {},
) {
  const policyId = randomUUID();
  const expiry = expiresAt ?? Date.now() + MAX_BROWSER_POLICY_LEASE_MS;
  await requestPolicySocket({
    socketPath,
    method: "POST",
    path: "/policy",
    body: { policyId, allowedHosts: normalizeBrowserHosts(allowedHosts), expiresAt: expiry },
    signal,
  });
  return policyId;
}

export async function revokeBrowserEgressPolicy(
  policyId,
  { socketPath = process.env.JARVIS_BROWSER_POLICY_SOCKET, signal } = {},
) {
  await requestPolicySocket({
    socketPath,
    method: "DELETE",
    path: `/policy/${encodeURIComponent(policyId)}`,
    body: {},
    signal,
  });
}
