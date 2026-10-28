#!/usr/bin/env node
// Candidate-only app-to-broker-to-worker smoke for exact-host egress enforcement.
import { pathToFileURL } from "node:url";
import {
  createBrowserEgressPolicy,
  revokeBrowserEgressPolicy,
} from "../server/browser-egress-policy-client.js";
import { requestBrowserWorker } from "../server/browser-worker-client.js";

export async function runBrowserEgressSmoke() {
  const allowedHosts = ["example.com"];
  const policyId = await createBrowserEgressPolicy(allowedHosts, {
    expiresAt: Date.now() + 30_000,
  });
  try {
    const publicPage = await requestBrowserWorker({
      runId: "browser-egress-smoke-public",
      policyId,
      op: "navigate",
      url: "https://example.com/",
      timeoutMs: 15_000,
      allowedHosts,
    });
    if (publicPage.state !== "completed" || !publicPage.title?.includes("Example Domain"))
      throw new Error("browser_egress_public_smoke_failed");

    // Simulate a worker that bypasses its own route allowlist while retaining the app-issued grant.
    const outsideHost = await requestBrowserWorker({
      runId: "browser-egress-smoke-denied",
      policyId,
      op: "navigate",
      url: "https://example.org/",
      timeoutMs: 10_000,
      allowedHosts: [],
    });
    if (outsideHost.state === "completed") throw new Error("browser_egress_allowlist_bypassed");

    return { publicPage: "ok", brokerAllowlist: "blocked" };
  } finally {
    await revokeBrowserEgressPolicy(policyId).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBrowserEgressSmoke()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(`browser-egress-smoke: ${error.message}`);
      process.exitCode = 1;
    });
}
