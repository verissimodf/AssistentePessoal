#!/usr/bin/env node
// Candidate-only live network smoke: direct egress must fail, public proxy navigation may pass,
// and a private CONNECT target must be rejected by the pinned egress broker.
import net from "node:net";
import { lookup } from "node:dns/promises";
import { pathToFileURL } from "node:url";
import {
  assertBrowserDestination,
  installBrowserRequestPolicy,
} from "../server/browser-network.js";

const proxyPort = Number(process.env.JARVIS_BROWSER_PROXY_PORT || 8899);
const smokeUrl = process.env.JARVIS_BROWSER_SMOKE_URL || "https://example.com/";

function directConnectMustFail() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "1.1.1.1", port: 443 });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("direct_tcp_unexpectedly_open"));
    }, 2_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      reject(new Error("direct_tcp_unexpectedly_open"));
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function dnsMustFail() {
  try {
    await lookup("example.com");
  } catch {
    return;
  }
  throw new Error("direct_dns_unexpectedly_succeeded");
}

function privateConnectMustFail() {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host: "127.0.0.1", port: proxyPort });
    let response = "";
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("private_proxy_check_timeout"));
    }, 2_000);
    client.once("connect", () =>
      client.write("CONNECT 169.254.169.254:80 HTTP/1.1\r\nHost: 169.254.169.254\r\n\r\n"),
    );
    client.on("data", (chunk) => {
      response += chunk.toString("latin1");
      if (response.includes("\r\n\r\n")) {
        clearTimeout(timer);
        client.destroy();
        if (/^HTTP\/1\.1 403 /.test(response)) resolve();
        else reject(new Error("private_proxy_target_not_rejected"));
      }
    });
    client.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`private_proxy_unavailable: ${error.code || "error"}`));
    });
  });
}

export async function runBrowserNetworkSmoke() {
  await Promise.all([directConnectMustFail(), dnsMustFail(), privateConnectMustFail()]);
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
    proxy: { server: `http://127.0.0.1:${proxyPort}`, bypass: "localhost,127.0.0.1,::1" },
  });
  try {
    const page = await browser.newPage();
    await installBrowserRequestPolicy(page, { checkDns: false });
    await assertBrowserDestination(smokeUrl, { checkDns: false });
    await page.goto(smokeUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    const title = await page.title();
    if (!title.includes("Example Domain")) throw new Error("public_proxy_smoke_unexpected_page");
    return {
      directTcp: "blocked",
      directDns: "blocked",
      privateTarget: "blocked",
      publicPage: "ok",
    };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBrowserNetworkSmoke()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(`browser-network-smoke: ${error.message}`);
      process.exitCode = 1;
    });
}
