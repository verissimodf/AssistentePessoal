#!/usr/bin/env node
// Unix-socket egress broker for the isolated Playwright worker. The validated IP is the dial target.
import net from "node:net";
import { lookup as dnsResolve } from "node:dns/promises";
import { isIP } from "node:net";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { isBlockedAddress } from "../server/urlpolicy.js";
import { removeStaleUnixSocket } from "../server/unix-socket.js";

export const MAX_PROXY_HEADER_BYTES = 16 * 1024;
export const MAX_PROXY_CONNECTIONS = 32;
const HEADER_TIMEOUT_MS = 5_000;
const IDLE_TIMEOUT_MS = 120_000;
const ALLOWED_PORTS = new Set([80, 443]);
const AUTHORITY = /^(?:\[([0-9a-f:.%]+)\]|([a-z0-9.-]+)):(\d{1,5})$/i;

function targetAuthority(authority) {
  if (authority.includes("@")) throw new Error("invalid_proxy_target");
  const match = AUTHORITY.exec(authority);
  if (!match) throw new Error("invalid_proxy_target");
  const hostname = (match[1] || match[2]).toLowerCase();
  const port = Number(match[3]);
  if (!hostname || (hostname.endsWith(".") && hostname.length < 2))
    throw new Error("invalid_proxy_target");
  if (!Number.isInteger(port) || !ALLOWED_PORTS.has(port)) throw new Error("port_not_allowed");
  if (isIP(hostname) && isBlockedAddress(hostname)) throw new Error("blocked_destination");
  return { hostname, port };
}

export function parseProxyRequest(input, { maxHeaderBytes = MAX_PROXY_HEADER_BYTES } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  if (buffer.length > maxHeaderBytes) throw new Error("proxy_header_too_large");
  const delimiter = buffer.indexOf("\r\n\r\n");
  if (delimiter < 0) throw new Error("invalid_proxy_request");
  const lines = buffer.subarray(0, delimiter).toString("latin1").split("\r\n");
  const requestLine =
    /^(CONNECT|GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\s+(\S+)\s+(HTTP\/1\.[01])$/i.exec(
      lines.shift() || "",
    );
  if (!requestLine) throw new Error("invalid_proxy_request");
  const [, rawMethod, target, version] = requestLine;
  const method = rawMethod.toUpperCase();
  const headers = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0 || /[\r\n\0]/.test(line)) throw new Error("invalid_proxy_header");
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)
    )
      throw new Error("invalid_proxy_header");
    headers.push([name, value]);
  }
  const contentLengths = headers.filter(([name]) => /^content-length$/i.test(name));
  const hasTransferEncoding = headers.some(([name]) => /^transfer-encoding$/i.test(name));
  if (contentLengths.length > 1 || (contentLengths.length && hasTransferEncoding))
    throw new Error("invalid_proxy_header");

  if (method === "CONNECT") {
    const { hostname, port } = targetAuthority(target);
    return { method, hostname, port, requestHead: "" };
  }
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error("invalid_proxy_target");
  }
  if (url.protocol !== "http:" || url.username || url.password)
    throw new Error("invalid_proxy_target");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!ALLOWED_PORTS.has(port)) throw new Error("port_not_allowed");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(hostname) && isBlockedAddress(hostname)) throw new Error("blocked_destination");
  let sawHost = false;
  const outgoing = [];
  for (const [name, value] of headers) {
    if (/^(?:proxy-|connection$|keep-alive$|te$|trailer$|upgrade$)/i.test(name)) continue;
    if (/^host$/i.test(name)) {
      if (!sawHost) outgoing.push(["Host", url.host]);
      sawHost = true;
    } else outgoing.push([name, value]);
  }
  if (!sawHost) outgoing.push(["Host", url.host]);
  // One destination per client socket: prevent HTTP proxy connection reuse from bypassing
  // destination parsing/pinning for a later absolute-form request on the same stream.
  outgoing.push(["Connection", "close"]);
  const requestHead = `${method} ${url.pathname || "/"}${url.search} ${version}\r\n${outgoing
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("")}\r\n`;
  return { method, hostname, port, requestHead };
}

export async function resolvePinnedTarget(hostname, port, { resolveHost } = {}) {
  if (!ALLOWED_PORTS.has(Number(port))) throw new Error("port_not_allowed");
  const host = String(hostname)
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (!host || host.includes("%")) throw new Error("invalid_proxy_target");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new Error("blocked_destination");
    return { hostname: host, port: Number(port), address: host, family: isIP(host) };
  }
  let records;
  try {
    records = await (resolveHost || ((name) => dnsResolve(name, { all: true, verbatim: true })))(
      host,
    );
  } catch {
    throw new Error("blocked_destination");
  }
  const addresses = (Array.isArray(records) ? records : [records])
    .map((record) => record?.address || record)
    .filter((address) => typeof address === "string");
  if (!addresses.length || addresses.some(isBlockedAddress)) throw new Error("blocked_destination");
  const address = addresses[0];
  return { hostname: host, port: Number(port), address, family: isIP(address) };
}

function readRequestHead(socket) {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      socket.off("close", onEnd);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("invalid_proxy_request"));
    };
    const onData = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > MAX_PROXY_HEADER_BYTES) {
        cleanup();
        reject(new Error("proxy_header_too_large"));
        return;
      }
      const end = pending.indexOf("\r\n\r\n");
      if (end < 0) return;
      const headerEnd = end + 4;
      const head = pending.subarray(0, headerEnd);
      const remainder = pending.subarray(headerEnd);
      cleanup();
      socket.pause();
      resolve({ head, remainder });
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
    socket.once("close", onEnd);
    socket.resume();
  });
}

const waitConnected = (socket) =>
  new Promise((resolve, reject) => {
    if (socket.connecting === false) return resolve();
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

export async function handleProxySocket(
  socket,
  {
    resolveHost,
    dialer = ({ address, port }) => net.createConnection({ host: address, port }),
    headerTimeoutMs = HEADER_TIMEOUT_MS,
    idleTimeoutMs = IDLE_TIMEOUT_MS,
  } = {},
) {
  let upstream;
  try {
    socket.setTimeout(headerTimeoutMs, () => socket.destroy());
    const { head, remainder } = await readRequestHead(socket);
    const request = parseProxyRequest(head);
    const pinned = await resolvePinnedTarget(request.hostname, request.port, { resolveHost });
    if (socket.destroyed) return;
    upstream = dialer(pinned);
    upstream.setTimeout(idleTimeoutMs, () => upstream.destroy());
    await waitConnected(upstream);
    socket.setTimeout(idleTimeoutMs, () => socket.destroy());
    if (request.method === "CONNECT") socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    else upstream.write(request.requestHead);
    if (remainder.length) upstream.write(remainder);
    socket.pipe(upstream);
    upstream.pipe(socket);
    socket.resume();
    await Promise.race([
      new Promise((resolve) => socket.once("close", resolve)),
      new Promise((resolve) => upstream.once("close", resolve)),
    ]);
  } catch (error) {
    if (!socket.destroyed && !socket.writableEnded) {
      const forbidden = [
        "blocked_destination",
        "port_not_allowed",
        "invalid_proxy_target",
      ].includes(error?.message);
      socket.end(
        forbidden
          ? "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"
          : "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n",
      );
    }
  } finally {
    socket.destroy();
    upstream?.destroy();
  }
}

export async function startEgressProxy(
  socketPath = process.env.JARVIS_BROWSER_EGRESS_SOCKET || "/run/jarvis-browser/egress.sock",
) {
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  await removeStaleUnixSocket(socketPath);
  let connections = 0;
  const server = net.createServer((socket) => {
    if (connections >= MAX_PROXY_CONNECTIONS) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      return;
    }
    connections++;
    socket.once("close", () => connections--);
    void handleProxySocket(socket);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      try {
        chmodSync(socketPath, 0o600);
        resolve();
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startEgressProxy().catch(() => {
    console.error("browser-egress: failed to bind its private Unix socket");
    process.exit(1);
  });
}
