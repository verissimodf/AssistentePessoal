// Defesa em profundidade para `crawl_page`: o Jarvis valida o destino ANTES de entregá-lo ao
// crawl4ai (que mantém a própria proteção). DNS e transporte são injetados — nenhum serviço
// interno ou externo é consultado.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertPublicHost } from "../server/urlpolicy.js";

// `tools.js` abre o banco no import: o diretório isolado precisa existir antes disso.
process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), "jarvis-crawl-"));
let crawlPage;
before(async () => {
  ({ crawlPage } = await import("../server/tools.js"));
});

/** Resolvedor controlado: host -> lista de IPs | Error. */
const resolver = (map) => (host, _opts, cb) => {
  const v = map[host];
  if (v instanceof Error) return cb(v);
  if (v === undefined)
    return cb(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
  cb(
    null,
    v.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
  );
};

test("assertPublicHost aceita host público e devolve a URL validada", async () => {
  const u = await assertPublicHost("https://public.example/docs", {
    resolve: resolver({ "public.example": ["93.184.216.34", "2606:4700:4700::1111"] }),
  });
  assert.equal(u.hostname, "public.example");
  assert.equal(u.pathname, "/docs");
});

test("assertPublicHost recusa host que resolve para IPv4 privado/loopback/metadados", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.7", "192.168.2.40", "169.254.169.254", "100.64.0.1"]) {
    await assert.rejects(
      () =>
        assertPublicHost("https://interno.example/", {
          resolve: resolver({ "interno.example": [ip] }),
        }),
      /blocked_destination/,
      ip,
    );
  }
});

test("assertPublicHost recusa IPv6 não global", async () => {
  for (const ip of ["::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "2001:db8::1"]) {
    await assert.rejects(
      () => assertPublicHost("https://v6.example/", { resolve: resolver({ "v6.example": [ip] }) }),
      /blocked_destination/,
      ip,
    );
  }
});

test("assertPublicHost recusa quando QUALQUER endereço do DNS é interno (múltiplos registros)", async () => {
  await assert.rejects(
    () =>
      assertPublicHost("https://misto.example/", {
        resolve: resolver({ "misto.example": ["93.184.216.34", "10.0.0.7"] }),
      }),
    /blocked_destination/,
  );
  // Ordem inversa também é recusada: não há "primeiro endereço público" que autorize o host.
  await assert.rejects(
    () =>
      assertPublicHost("https://misto2.example/", {
        resolve: resolver({ "misto2.example": ["192.168.2.40", "93.184.216.34"] }),
      }),
    /blocked_destination/,
  );
});

test("assertPublicHost recusa DNS vazio e propaga falha de resolução", async () => {
  await assert.rejects(
    () =>
      assertPublicHost("https://vazio.example/", { resolve: resolver({ "vazio.example": [] }) }),
    /dns_no_answer/,
  );
  await assert.rejects(
    () => assertPublicHost("https://naoexiste.example/", { resolve: resolver({}) }),
    /ENOTFOUND/,
  );
});

test("assertPublicHost aplica a política estática: esquema, porta, credenciais e IP literal", async () => {
  const nunca = () => {
    throw new Error("DNS não deveria ser consultado");
  };
  await assert.rejects(
    () => assertPublicHost("file:///etc/passwd", { resolve: nunca }),
    /protocol_not_allowed/,
  );
  await assert.rejects(
    () => assertPublicHost("http://public.example:8080/", { resolve: nunca }),
    /port_not_allowed/,
  );
  await assert.rejects(
    () => assertPublicHost("http://user:pass@public.example/", { resolve: nunca }),
    /credentials_not_allowed/,
  );
  await assert.rejects(
    () => assertPublicHost("http://127.0.0.1/", { resolve: nunca }),
    /blocked_destination/,
  );
  await assert.rejects(
    () => assertPublicHost("http://[::1]/", { resolve: nunca }),
    /blocked_destination/,
  );
});

test("crawl_page bloqueia o destino interno antes de chamar o crawl4ai", async () => {
  let chamadas = 0;
  const fetchImpl = async () => {
    chamadas++;
    return { ok: true, json: async () => ({ markdown: "não deveria" }) };
  };

  const out = await crawlPage("http://127.0.0.1/", { resolve: resolver({}), fetchImpl });
  assert.match(out, /política de segurança/i);
  assert.equal(chamadas, 0, "crawl4ai não pode ser chamado para destino interno");

  const out2 = await crawlPage("https://misto.example/", {
    resolve: resolver({ "misto.example": ["93.184.216.34", "10.0.0.7"] }),
    fetchImpl,
  });
  assert.match(out2, /política de segurança/i);
  assert.equal(chamadas, 0);
});

/** Resposta no formato real de `POST /crawl` do crawl4ai 0.9.2. */
const crawlResponse = (over = {}) => ({
  ok: true,
  json: async () => ({
    success: true,
    results: [
      {
        url: "https://public.example/docs",
        redirected_url: "",
        success: true,
        status_code: 200,
        markdown: {
          fit_markdown: "# Documentação\nconteúdo",
          raw_markdown: "# Documentação\nconteúdo bruto",
        },
        ...over,
      },
    ],
  }),
});

test("crawl_page entrega ao crawl4ai apenas destino público validado", async () => {
  let visto = null;
  const fetchImpl = async (url, init) => {
    visto = { url, body: JSON.parse(init.body) };
    return crawlResponse();
  };
  const out = await crawlPage("https://public.example/docs", {
    resolve: resolver({ "public.example": ["93.184.216.34"] }),
    fetchImpl,
  });
  assert.equal(out, "# Documentação\nconteúdo");
  assert.equal(visto.body.urls[0], "https://public.example/docs");
  assert.match(visto.url, /\/crawl$/);
});

test("crawl_page retém o conteúdo quando o crawl4ai termina em destino não público", async () => {
  const { db } = await import("../server/db.js");
  // Redirecionamento seguido pelo crawl4ai: a URL inicial era pública, a final não é.
  const fetchImpl = async () =>
    crawlResponse({ redirected_url: "http://169.254.169.254/latest/meta-data/" });
  const out = await crawlPage("https://public.example/docs", {
    resolve: resolver({
      "public.example": ["93.184.216.34"],
      "169.254.169.254": ["169.254.169.254"],
    }),
    fetchImpl,
  });
  assert.match(out, /redirecionou/i);
  assert.doesNotMatch(out, /conteúdo/i, "nenhum trecho da página pode vazar");
  const row = db
    .prepare("SELECT detail FROM audit WHERE kind = 'web.crawl_blocked' ORDER BY id DESC LIMIT 1")
    .get();
  assert.equal(JSON.parse(row.detail).reason, "redirect_blocked");
});

test("crawl_page aceita redirecionamento para outro host público", async () => {
  const fetchImpl = async () => crawlResponse({ redirected_url: "https://cdn.example/final" });
  const out = await crawlPage("https://public.example/docs", {
    resolve: resolver({
      "public.example": ["93.184.216.34"],
      "cdn.example": ["93.184.216.35"],
    }),
    fetchImpl,
  });
  assert.equal(out, "# Documentação\nconteúdo");
});

test("crawl_page é conservador com resposta sem resultado ou com falha do crawler", async () => {
  const semResultado = async () => ({
    ok: true,
    json: async () => ({ success: true, results: [] }),
  });
  const out1 = await crawlPage("https://public.example/docs", {
    resolve: resolver({ "public.example": ["93.184.216.34"] }),
    fetchImpl: semResultado,
  });
  assert.match(out1, /não retornou resultado/i);

  const falhou = async () => crawlResponse({ success: false, error_message: "boom", markdown: {} });
  const out2 = await crawlPage("https://public.example/docs", {
    resolve: resolver({ "public.example": ["93.184.216.34"] }),
    fetchImpl: falhou,
  });
  assert.match(out2, /crawl4ai/i);
  assert.doesNotMatch(out2, /# Documentação/);
});

test("crawl_page cai para raw_markdown quando o fit vem vazio", async () => {
  const fetchImpl = async () =>
    crawlResponse({ markdown: { fit_markdown: "", raw_markdown: "# só bruto" } });
  const out = await crawlPage("https://public.example/docs", {
    resolve: resolver({ "public.example": ["93.184.216.34"] }),
    fetchImpl,
  });
  assert.equal(out, "# só bruto");
});

test("o motivo do bloqueio sobrevive à auditoria (allowlist fechada)", async () => {
  const { db } = await import("../server/db.js");
  const motivo = (url, opts) =>
    crawlPage(url, opts).then(() => {
      const row = db
        .prepare(
          "SELECT detail FROM audit WHERE kind = 'web.crawl_blocked' ORDER BY id DESC LIMIT 1",
        )
        .get();
      return JSON.parse(row.detail);
    });
  const nunca = () => {
    throw new Error("DNS não deveria ser consultado");
  };
  // Cada motivo é uma constante do código (nunca texto do usuário), então pode ser auditado.
  assert.equal(
    (await motivo("http://public.example:8080/", { resolve: nunca })).reason,
    "port_not_allowed",
  );
  assert.equal(
    (await motivo("file:///etc/passwd", { resolve: nunca })).reason,
    "protocol_not_allowed",
  );
  assert.equal(
    (await motivo("http://user:pass@public.example/", { resolve: nunca })).reason,
    "credentials_not_allowed",
  );
  assert.equal(
    (await motivo("http://127.0.0.1/", { resolve: nunca })).reason,
    "blocked_destination",
  );
  assert.equal(
    (await motivo("https://vazio.example/", { resolve: resolver({ "vazio.example": [] }) })).reason,
    "dns_no_answer",
  );
});
