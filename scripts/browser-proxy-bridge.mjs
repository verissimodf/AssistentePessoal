#!/usr/bin/env node
// Worker-local TCP proxy endpoint forwarded to the isolated egress broker over a Unix socket.
import net from "node:net";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export function startProxyBridge({
  socketPath = process.env.JARVIS_BROWSER_EGRESS_SOCKET || "/run/jarvis-browser/egress.sock",
  host = "127.0.0.1",
  port = Number(process.env.JARVIS_BROWSER_PROXY_PORT || 8899),
} = {}) {
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  return net
    .createServer((client) => {
      const broker = net.createConnection({ path: socketPath });
      client.once("error", () => broker.destroy());
      broker.once("error", () => client.destroy());
      client.once("close", () => broker.destroy());
      broker.once("close", () => client.destroy());
      client.pipe(broker);
      broker.pipe(client);
    })
    .listen(port, host);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startProxyBridge();
