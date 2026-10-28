import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { parseProxyRequest, resolvePinnedTarget, handleProxySocket, startEgressProxy } =
  await import("../scripts/browser-egress-proxy.mjs");
const { removeStaleUnixSocket } = await import("../server/unix-socket.js");

test("proxy parses CONNECT and absolute HTTP requests with strict host/port policy", () => {
  assert.deepEqual(
    parseProxyRequest("CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n"),
    {
      method: "CONNECT",
      hostname: "example.test",
      port: 443,
      requestHead: "",
    },
  );
  const request = parseProxyRequest(
    "GET http://example.test/path?q=1 HTTP/1.1\r\nHost: example.test\r\nX-Test: ok\r\n\r\n",
  );
  assert.equal(request.method, "GET");
  assert.equal(request.hostname, "example.test");
  assert.equal(request.port, 80);
  assert.equal(
    request.requestHead,
    "GET /path?q=1 HTTP/1.1\r\nHost: example.test\r\nX-Test: ok\r\nConnection: close\r\n\r\n",
  );
  assert.throws(
    () => parseProxyRequest("CONNECT example.test:22 HTTP/1.1\r\n\r\n"),
    /port_not_allowed/,
  );
  assert.throws(
    () => parseProxyRequest("CONNECT user@example.test:443 HTTP/1.1\r\n\r\n"),
    /invalid_proxy_target/,
  );
  assert.throws(() => parseProxyRequest("GET /relative HTTP/1.1\r\n\r\n"), /invalid_proxy_target/);
  assert.throws(
    () => parseProxyRequest("GET https://example.test/ HTTP/1.1\r\n\r\n"),
    /invalid_proxy_target/,
  );
  assert.throws(
    () => parseProxyRequest("GET http://example.test/ HTTP/1.1\r\nBad Header: x\r\n\r\n"),
    /invalid_proxy_header/,
  );
  assert.throws(
    () => parseProxyRequest("GET http://user:pass@example.test/ HTTP/1.1\r\n\r\n"),
    /invalid_proxy_target/,
  );
  assert.throws(
    () =>
      parseProxyRequest(
        "POST http://example.test/ HTTP/1.1\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n",
      ),
    /invalid_proxy_header/,
  );
  assert.throws(
    () => parseProxyRequest("GET http://example.test/ HTTP/1.1\r\nX-Test: bad\u0001value\r\n\r\n"),
    /invalid_proxy_header/,
  );
  assert.throws(() => parseProxyRequest(Buffer.alloc(17 * 1024, 65)), /proxy_header_too_large/);
});

test("proxy forwards absolute HTTP form to the pinned IP and strips proxy credentials", async (t) => {
  const origin = net.createServer((socket) => {
    let request = "";
    socket.on("data", (chunk) => {
      request += chunk.toString();
      if (request.includes("\r\n\r\n")) {
        socket.end("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n");
      }
    });
  });
  origin.listen(0, "127.0.0.1");
  await once(origin, "listening");
  t.after(() => origin.close());
  const originPort = origin.address().port;
  let captured = "";
  const broker = net.createServer((socket) => {
    void handleProxySocket(socket, {
      resolveHost: async () => [{ address: "93.184.216.34" }],
      dialer: ({ address, port }) => {
        assert.equal(address, "93.184.216.34");
        assert.equal(port, 80);
        const upstream = net.createConnection({ host: "127.0.0.1", port: originPort });
        upstream.on("connect", () => {});
        const originalWrite = upstream.write.bind(upstream);
        upstream.write = (chunk, ...args) => {
          captured += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
          return originalWrite(chunk, ...args);
        };
        return upstream;
      },
    });
  });
  broker.listen(0, "127.0.0.1");
  await once(broker, "listening");
  t.after(() => broker.close());
  const client = net.createConnection({ host: "127.0.0.1", port: broker.address().port });
  await once(client, "connect");
  t.after(() => client.destroy());
  const response = new Promise((resolve, reject) => {
    let result = "";
    client.on("data", (chunk) => {
      result += chunk.toString();
      if (result.includes("204 No Content")) resolve(result);
    });
    client.once("error", reject);
    client.once("end", () => reject(new Error(`proxy_response_incomplete: ${result}`)));
    setTimeout(() => reject(new Error(`proxy_response_timeout: ${result}`)), 1500).unref();
  });
  client.write(
    "GET http://public.example/path?q=1 HTTP/1.1\r\nHost: forged.example\r\nProxy-Authorization: Basic secret\r\nConnection: close\r\n\r\n",
  );
  assert.match(await response, /204 No Content/);
  assert.match(captured, /^GET \/path\?q=1 HTTP\/1\.1\r\n/);
  assert.match(captured, /Host: public\.example\r\n/);
  assert.doesNotMatch(captured, /Proxy-Authorization|forged\.example/);
});

test("proxy resolves all answers and rejects blocked or mixed DNS answers", async () => {
  await assert.rejects(
    () =>
      resolvePinnedTarget("private.example", 443, {
        resolveHost: async () => [{ address: "10.0.0.1" }],
      }),
    /blocked_destination/,
  );
  await assert.rejects(
    () =>
      resolvePinnedTarget("mixed.example", 443, {
        resolveHost: async () => [{ address: "93.184.216.34" }, { address: "169.254.169.254" }],
      }),
    /blocked_destination/,
  );
  await assert.rejects(
    () =>
      resolvePinnedTarget("dns.example", 443, {
        resolveHost: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    /blocked_destination/,
  );
});

test("CONNECT tunnels to the pinned address once and closes bounded resources", async () => {
  const origin = net.createServer((socket) => socket.pipe(socket));
  origin.listen(0, "127.0.0.1");
  await once(origin, "listening");
  const originPort = origin.address().port;
  const resolutionCalls = [];
  const dialCalls = [];
  let accepted = 0;
  const broker = net.createServer((socket) => {
    accepted++;
    void handleProxySocket(socket, {
      resolveHost: async (host) => {
        resolutionCalls.push(host);
        return [{ address: "93.184.216.34" }];
      },
      dialer: ({ address, port }) => {
        dialCalls.push({ address, port });
        return net.createConnection({ host: "127.0.0.1", port: originPort });
      },
    });
  });
  broker.listen(0, "127.0.0.1");
  await once(broker, "listening");
  const client = net.createConnection({ host: "127.0.0.1", port: broker.address().port });
  await once(client, "connect");
  const chunks = [];
  client.on("data", (chunk) => chunks.push(chunk));
  client.write("CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n\r\n");
  await new Promise((resolve) => setTimeout(resolve, 30));
  client.write("PING");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.match(Buffer.concat(chunks).toString(), /200 Connection Established/);
  assert.match(Buffer.concat(chunks).toString(), /PING/);
  assert.deepEqual(resolutionCalls, ["public.example"]);
  assert.deepEqual(dialCalls, [{ address: "93.184.216.34", port: 443 }]);
  client.destroy();
  broker.close();
  origin.close();
  await Promise.all([once(broker, "close"), once(origin, "close")]);
  assert.equal(accepted, 1);
});

test("proxy drops clients that never finish a bounded request header", async (t) => {
  const broker = net.createServer(
    (socket) => void handleProxySocket(socket, { headerTimeoutMs: 40 }),
  );
  broker.listen(0, "127.0.0.1");
  await once(broker, "listening");
  t.after(() => broker.close());
  const client = net.createConnection({ host: "127.0.0.1", port: broker.address().port });
  await once(client, "connect");
  t.after(() => client.destroy());
  const closed = once(client, "close");
  client.write("CONNECT public.example:443 HTTP/1.1\r\nHost: public.example:443\r\n");
  await closed;
  assert.equal(client.destroyed, true);
});

test("Unix socket startup preserves active listeners and removes stale sockets", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "jarvis-egress-socket-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const activePath = join(directory, "active.sock");
  const activeServer = await startEgressProxy(activePath);
  t.after(() => activeServer.close());
  await assert.rejects(() => removeStaleUnixSocket(activePath), /unix_socket_in_use/);
  assert.equal(existsSync(activePath), true);
  activeServer.close();
  await once(activeServer, "close");

  const stalePath = join(directory, "stale.sock");
  const child = spawn(
    process.execPath,
    [
      "-e",
      "require('node:net').createServer().listen(process.argv[1],()=>process.stdout.write('ready'))",
      stalePath,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  t.after(() => child.kill("SIGKILL"));
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", resolve);
  });
  child.kill("SIGKILL");
  await once(child, "close");
  assert.equal(existsSync(stalePath), true);
  assert.equal(await removeStaleUnixSocket(stalePath), true);
  assert.equal(existsSync(stalePath), false);
});
