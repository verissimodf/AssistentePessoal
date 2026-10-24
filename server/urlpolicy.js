// Política de destinos para requisições HTTP de saída das ferramentas.
//
// O ponto crítico: a validação acontece no **connect** (via `lookup` customizado), não só
// sobre a string da URL. Assim o endereço efetivamente conectado é o validado — uma resposta
// DNS que mude depois da checagem (DNS rebinding) não passa — e cada salto de redirecionamento
// é revalidado. Só http/https, só portas necessárias, com limite de tempo, tamanho e saltos.
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set([80, 443]);
export const MAX_REDIRECTS = 3;
export const MAX_BYTES = 2_000_000;

/** Bloqueia faixas não roteáveis/internas e metadados de nuvem em IPv4. */
export function isBlockedIPv4(ip) {
  const p = String(ip).split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127) return true; // 0/8, 10/8, 127/8
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0/24, 192.0.2/24
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reservado
  return false;
}

/** Expande um literal IPv6 para 16 bytes (aceita `::` e IPv4 embutido). */
export function ipv6Bytes(input) {
  let s = String(input).split("%")[0].trim();
  if (!s.includes(":")) return null;
  // IPv4 embutido no fim (ex.: ::ffff:192.168.1.1)
  const m = s.match(/(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (m) {
    const v4 = m[2].split(".").map(Number);
    if (v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = m[1] + `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const [head, tail] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const groups = s.includes("::")
    ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t]
    : h;
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) {
    const n = parseInt(g === "" ? "0" : g, 16);
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null;
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

/**
 * IPv6: allowlist conservadora — só unicast global (2000::/3), excluindo documentação,
 * 6to4 e Teredo. Todo o resto (::1, ::, fc00::/7, fe80::/10, ff00::/8, IPv4-mapeado) é bloqueado.
 */
export function isBlockedIPv6(ip) {
  const b = ipv6Bytes(ip);
  if (!b) return true;
  if ((b[0] & 0xe0) !== 0x20) return true; // fora de 2000::/3
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32
  if (b[0] === 0x20 && b[1] === 0x02) return true; // 2002::/16
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // 2001::/32
  return false;
}

export const isBlockedAddress = (ip) =>
  String(ip).includes(":") ? isBlockedIPv6(ip) : isBlockedIPv4(ip);

/** Validação estática da URL (esquema, porta, credenciais, host). Não substitui o connect. */
export function assertSafeUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new Error("invalid_url");
  }
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) throw new Error("protocol_not_allowed");
  if (u.username || u.password) throw new Error("credentials_not_allowed");
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) throw new Error("port_not_allowed");
  if (!u.hostname) throw new Error("invalid_url");
  // IP literal: o cliente HTTP não consulta o DNS, então o `lookup` não roda — precisa
  // ser barrado aqui, senão `http://169.254.169.254/` escaparia da política.
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) throw new Error("blocked_destination");
  return u;
}

/**
 * Defesa em profundidade para destinos buscados por OUTRO cliente (ex.: crawl4ai): além da
 * validação estática, resolve o hostname e recusa se QUALQUER endereço retornado for não
 * público. Impede que uma URL interna chegue ao serviço remoto; não substitui a proteção
 * dele. O resolvedor é injetável para testes, sem DNS real.
 */
export async function assertPublicHost(raw, { resolve = dnsLookup } = {}) {
  const u = assertSafeUrl(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return u; // literal já validado em assertSafeUrl
  const addrs = await new Promise((res, rej) => {
    resolve(host, { all: true, verbatim: true }, (err, list) => (err ? rej(err) : res(list)));
  });
  const list = (Array.isArray(addrs) ? addrs : [addrs]).filter((a) => a && a.address);
  if (!list.length) throw new Error("dns_no_answer");
  for (const a of list) if (isBlockedAddress(a.address)) throw new Error("blocked_destination");
  return u;
}

/** `lookup` que só devolve endereços públicos; usado em cada conexão (anti-rebinding). */
export function guardedLookup(hostname, options, cb, { resolve = dnsLookup } = {}) {
  resolve(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = (Array.isArray(addrs) ? addrs : [addrs]).filter((a) => a && a.address);
    if (!list.length) return cb(new Error("dns_no_answer"));
    for (const a of list)
      if (isBlockedAddress(a.address)) return cb(new Error("blocked_destination"));
    // Node 22 (autoSelectFamily) pede TODOS os endereços quando `options.all`; devolver um
    // escalar nesse caso faz o http.request falhar com ERR_INVALID_IP_ADDRESS (fetch_url quebrado).
    if (options?.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function readCapped(res, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    res.on("data", (c) => {
      total += c.length;
      if (total > maxBytes) {
        res.destroy();
        resolve({ text: Buffer.concat(chunks).toString("utf8"), truncated: true });
        return;
      }
      chunks.push(c);
    });
    res.on("end", () =>
      resolve({ text: Buffer.concat(chunks).toString("utf8"), truncated: false }),
    );
    res.on("error", reject);
  });
}

function once(url, { headers, timeoutMs, maxBytes }) {
  const mod = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = mod(url, { lookup: guardedLookup, headers, timeout: timeoutMs }, (res) => {
      resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        body: () => readCapped(res, maxBytes),
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/** Destino de um salto de redirecionamento, já submetido à mesma política da URL inicial. */
export function resolveRedirect(current, location) {
  return assertSafeUrl(new URL(location, current).toString());
}

/**
 * GET com política: revalida a URL e cada salto de redirecionamento, limita saltos,
 * tempo e bytes. Erros são explícitos (blocked_destination, too_many_redirects, timeout…).
 */
export async function safeFetch(
  rawUrl,
  { headers = {}, timeoutMs = 20000, maxBytes = MAX_BYTES, maxRedirects = MAX_REDIRECTS } = {},
) {
  let url = assertSafeUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    const res = await once(url, { headers, timeoutMs, maxBytes });
    const loc = res.headers?.location;
    if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
      if (hop >= maxRedirects) throw new Error("too_many_redirects");
      await res.body().catch(() => undefined); // drena o corpo do salto
      url = resolveRedirect(url, loc);
      continue;
    }
    return res;
  }
}
