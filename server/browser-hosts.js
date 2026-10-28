/** Canonical exact-host allowlist shared by the app and the isolated egress broker. */
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
