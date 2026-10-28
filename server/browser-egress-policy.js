import { normalizeBrowserHosts } from "./browser-hosts.js";

export const MAX_ACTIVE_BROWSER_POLICIES = 32;
export const MAX_BROWSER_POLICY_LEASE_MS = 65_000;
const POLICY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Bounded, short-lived host grants installed only through the app-to-broker Unix socket. */
export function createBrowserEgressPolicyRegistry({ now = Date.now } = {}) {
  const policies = new Map();

  const prune = () => {
    const instant = now();
    for (const [id, policy] of policies) {
      if (policy.expiresAt <= instant) policies.delete(id);
    }
  };

  return {
    register({ policyId, allowedHosts, expiresAt } = {}) {
      prune();
      if (typeof policyId !== "string" || !POLICY_ID.test(policyId))
        throw new Error("browser_policy_id_invalid");
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now())
        throw new Error("browser_policy_expiry_invalid");
      if (expiresAt > now() + MAX_BROWSER_POLICY_LEASE_MS)
        throw new Error("browser_policy_lease_too_long");
      const hosts = normalizeBrowserHosts(allowedHosts);
      if (policies.has(policyId)) throw new Error("browser_policy_exists");
      if (policies.size >= MAX_ACTIVE_BROWSER_POLICIES) throw new Error("browser_policy_capacity");
      policies.set(policyId, { allowedHosts: new Set(hosts), expiresAt });
      return true;
    },

    revoke(policyId) {
      return policies.delete(String(policyId || ""));
    },

    authorize(policyId, hostname) {
      prune();
      if (typeof policyId !== "string" || !POLICY_ID.test(policyId))
        throw new Error("proxy_auth_required");
      const policy = policies.get(policyId);
      if (!policy) throw new Error("proxy_policy_expired");
      const host = String(hostname).toLowerCase().replace(/\.$/, "");
      if (policy.allowedHosts.size > 0 && !policy.allowedHosts.has(host))
        throw new Error("host_not_allowed");
      return true;
    },

    get size() {
      prune();
      return policies.size;
    },
  };
}
