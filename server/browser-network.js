import { lookup as dnsResolve } from "node:dns/promises";
import { isIP } from "node:net";
import { assertSafeUrl, isBlockedAddress } from "./urlpolicy.js";
import { browserHostAllowed } from "./browser-approval.js";

/** Resolve and validate the exact destination used by a browser request, failing closed. */
export async function assertBrowserDestination(
  rawUrl,
  {
    resolveHost = (host) => dnsResolve(host, { all: true, verbatim: true }),
    allowedHosts = [],
  } = {},
) {
  const url = assertSafeUrl(rawUrl);
  if (!browserHostAllowed(url.toString(), allowedHosts)) throw new Error("blocked_destination");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error("blocked_destination");
    return url;
  }
  let records;
  try {
    records = await resolveHost(host);
  } catch {
    throw new Error("blocked_destination");
  }
  const addresses = (Array.isArray(records) ? records : [records])
    .map((item) => item?.address || item)
    .filter((item) => typeof item === "string");
  if (!addresses.length || addresses.some(isBlockedAddress)) throw new Error("blocked_destination");
  return url;
}

/** Shared by the in-process browser and managed worker for every request, redirect and resource. */
export async function installBrowserRequestPolicy(
  page,
  { signal, resolveHost, allowedHosts = [] } = {},
) {
  await page.route("**/*", async (route) => {
    try {
      if (signal?.aborted) throw new Error("browser_cancelled");
      await assertBrowserDestination(route.request().url(), { resolveHost, allowedHosts });
      if (signal?.aborted) throw new Error("browser_cancelled");
      await route.continue();
    } catch {
      await route.abort().catch(() => false);
    }
  });
}
