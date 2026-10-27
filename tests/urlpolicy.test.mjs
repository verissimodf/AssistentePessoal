// Política de destinos de `fetch_url`/`web_search`: bloqueio de loopback, privados, link-local,
// metadados de nuvem e IPv6 não global — validado na string E no connect (anti-rebinding),
// com redirecionamentos revalidados e limites de tempo/tamanho/saltos.
// Nenhum serviço sensível é consultado: só IPs literais, resolução local e um servidor efêmero.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  isBlockedIPv4,
  isBlockedIPv6,
  isBlockedAddress,
  ipv6Bytes,
  assertSafeUrl,
  guardedLookup,
  safeFetch,
} from "../server/urlpolicy.js";

test("IPv4: loopback, privado, link-local, metadados, CGNAT, multicast e reservados", () => {
  const blocked = [
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.2.40",
    "169.254.169.254",
    "169.254.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "198.51.100.7",
    "203.0.113.9",
    "192.0.2.1",
    "192.0.0.1",
    "192.88.99.1",
  ];
  for (const ip of blocked) assert.equal(isBlockedIPv4(ip), true, `${ip} deveria ser bloqueado`);
  for (const ip of [
    "1.1.1.1",
    "8.8.8.8",
    "93.184.216.34",
    "172.32.0.1",
    "192.169.0.1",
    "11.0.0.1",
  ]) {
    assert.equal(isBlockedIPv4(ip), false, `${ip} deveria passar`);
  }
});

test("IPv6: só unicast global passa; loopback/ULA/link-local/multicast/mapeado/6to4/doc são bloqueados", () => {
  const blocked = [
    "::1",
    "::",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:192.168.1.1",
    "2002:7f00:1::",
    "2001:db8::1",
    "2001::1",
    "::ffff:169.254.169.254",
  ];
  for (const ip of blocked) assert.equal(isBlockedIPv6(ip), true, `${ip} deveria ser bloqueado`);
  for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) {
    assert.equal(isBlockedIPv6(ip), false, `${ip} deveria passar`);
  }
  assert.equal(ipv6Bytes("lixo"), null);
  assert.equal(isBlockedAddress("::ffff:10.0.0.1"), true);
});

test("URL: apenas http/https, portas necessárias, sem credenciais", () => {
  assert.throws(() => assertSafeUrl("ftp://example.com"), /protocol_not_allowed/);
  assert.throws(() => assertSafeUrl("file:///etc/passwd"), /protocol_not_allowed/);
  assert.throws(() => assertSafeUrl("gopher://example.com"), /protocol_not_allowed/);
  assert.throws(() => assertSafeUrl("http://example.com:8080/"), /port_not_allowed/);
  assert.throws(() => assertSafeUrl("http://example.com:22/"), /port_not_allowed/);
  assert.throws(() => assertSafeUrl("http://user:senha@example.com/"), /credentials_not_allowed/);
  assert.throws(() => assertSafeUrl("nao-e-url"), /invalid_url/);
  assert.equal(assertSafeUrl("https://example.com/x").hostname, "example.com");
  assert.equal(assertSafeUrl("http://example.com/").port, "");
});

test("IP literal interno é recusado sem consultar DNS nem conectar", () => {
  for (const u of [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1/",
    "http://192.168.2.40/",
    "http://[::1]/",
    "http://[fd00::1]/",
  ]) {
    assert.throws(() => assertSafeUrl(u), /blocked_destination|port_not_allowed/, u);
  }
});

test("guardedLookup recusa host que resolve para endereço interno (garantia anti-rebinding)", async () => {
  await new Promise((resolve) => {
    guardedLookup("localhost", { all: true }, (err) => {
      assert.ok(err, "deveria falhar");
      assert.match(err.message, /blocked_destination/);
      resolve();
    });
  });
});

test("guardedLookup respeita o contrato `all` do Node (autoSelectFamily) — regressão do fetch_url", async () => {
  // Node 22 chama o lookup com `all: true` e espera a LISTA; devolver um escalar faz o
  // http.request falhar com "Invalid IP address: undefined". Resolvedor injetado: sem DNS real.
  const publico = (host, opts, cb) => cb(null, [{ address: "93.184.216.34", family: 4 }]);
  const interno = (host, opts, cb) => cb(null, [{ address: "10.0.0.7", family: 4 }]);

  const todos = await new Promise((res, rej) =>
    guardedLookup("publico.example", { all: true }, (e, a) => (e ? rej(e) : res(a)), {
      resolve: publico,
    }),
  );
  assert.ok(Array.isArray(todos), "all:true devolve array");
  assert.equal(todos[0].address, "93.184.216.34");

  const um = await new Promise((res, rej) =>
    guardedLookup("publico.example", {}, (e, a, f) => (e ? rej(e) : res({ a, f })), {
      resolve: publico,
    }),
  );
  assert.equal(um.a, "93.184.216.34");
  assert.equal(um.f, 4);

  await assert.rejects(
    () =>
      new Promise((res, rej) =>
        guardedLookup("interno.example", { all: true }, (e) => (e ? rej(e) : res()), {
          resolve: interno,
        }),
      ),
    /blocked_destination/,
  );
});

test("safeFetch recusa metadados de nuvem e loopback (nenhuma conexão é tentada)", async () => {
  await assert.rejects(
    () => safeFetch("http://169.254.169.254/latest/meta-data/"),
    /blocked_destination/,
  );
  await assert.rejects(() => safeFetch("http://127.0.0.1/"), /blocked_destination/);
  await assert.rejects(() => safeFetch("http://[::1]/"), /blocked_destination|port_not_allowed/);
});

test("safeFetch não alcança um servidor local nem quando a porta é permitida pelo cliente", async () => {
  let hits = 0;
  const srv = createServer((_q, r) => {
    hits++;
    r.end("segredo-interno");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  // Porta fora da allowlist → recusada pela política, sem abrir conexão.
  await assert.rejects(
    () => safeFetch(`http://127.0.0.1:${port}/`),
    /port_not_allowed|blocked_destination/,
  );
  // Hostname que resolve para loopback → bloqueado no connect.
  await assert.rejects(
    () => safeFetch(`http://localhost:${port}/`),
    /port_not_allowed|blocked_destination/,
  );
  assert.equal(hits, 0, "o servidor local não pode ter recebido nenhuma requisição");
  await new Promise((r) => srv.close(r));
});

test("safeFetch recusa esquema e credenciais antes de qualquer I/O", async () => {
  await assert.rejects(() => safeFetch("file:///etc/passwd"), /protocol_not_allowed/);
  await assert.rejects(() => safeFetch("http://user:pass@example.com/"), /credentials_not_allowed/);
});
