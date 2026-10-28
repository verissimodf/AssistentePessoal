#!/usr/bin/env node
// Candidate-only live network smoke: direct egress must fail, public proxy navigation may pass,
// and a private CONNECT target must be rejected by the pinned egress broker.
import net from "node:net";
import { lookup } from "node:dns/promises";
import { existsSync, lstatSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const proxyPort = Number(process.env.JARVIS_BROWSER_PROXY_PORT || 8899);

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

function egressSocketMustBeProtected() {
  const socketPath =
    process.env.JARVIS_BROWSER_EGRESS_SOCKET || "/run/jarvis-browser/egress/egress.sock";
  const socket = lstatSync(socketPath);
  const directory = lstatSync(dirname(socketPath));
  if (socket.uid !== 1001 || socket.gid !== 1000 || (socket.mode & 0o777) !== 0o620)
    throw new Error("egress_socket_permissions_unexpected");
  if (directory.uid !== 1001 || directory.gid !== 1000 || (directory.mode & 0o777) !== 0o710)
    throw new Error("egress_socket_directory_permissions_unexpected");
  if (existsSync("/run/jarvis-browser/policy/policy.sock"))
    throw new Error("worker_can_access_policy_control");
  try {
    unlinkSync(socketPath);
  } catch (error) {
    if (["EACCES", "EROFS"].includes(error.code)) return;
    throw new Error("egress_socket_mutation_check_failed");
  }
  throw new Error("egress_socket_mutable_by_worker");
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
  egressSocketMustBeProtected();
  await Promise.all([directConnectMustFail(), dnsMustFail(), privateConnectMustFail()]);
  return {
    egressSocketMutation: "blocked",
    policyControlIsolation: "blocked",
    directTcp: "blocked",
    directDns: "blocked",
    privateTarget: "blocked",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBrowserNetworkSmoke()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(`browser-network-smoke: ${error.message}`);
      process.exitCode = 1;
    });
}
