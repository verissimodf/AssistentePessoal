// Guarda-corpo de configuração: HSTS existe apenas no bloco HTTPS do template e nunca no
// rascunho HTTP (hop interno). Também fixa redirect, protocolos e encaminhamento de scheme.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const tls = read("../deploy/nginx-jarvis.laytech.com.br.tls.conf.example");
const httpDraft = read("../deploy/nginx-jarvis.laytech.com.br.conf");

// Blocos `server { ... }` de nível superior (locations são indentadas e não quebram o match).
const blocks = [...tls.matchAll(/^server\s*\{([\s\S]*?)^\}/gm)].map((m) => m[1]);
const httpBlock = blocks.find((b) => /^\s*listen 80;/m.test(b));
const httpsBlock = blocks.find((b) => /^\s*listen 443 ssl;/m.test(b));

test("template TLS tem exatamente os blocos HTTP e HTTPS", () => {
  assert.equal(blocks.length, 2);
  assert.ok(httpBlock, "bloco listen 80 ausente");
  assert.ok(httpsBlock, "bloco listen 443 ssl ausente");
});

test("HTTP redireciona para HTTPS preservando o desafio ACME", () => {
  assert.match(httpBlock, /location \/\.well-known\/acme-challenge\//);
  assert.match(httpBlock, /return 301 https:\/\/\$host\$request_uri;/);
});

test("HSTS existe somente no bloco HTTPS, com always e sem preload", () => {
  assert.doesNotMatch(httpBlock, /Strict-Transport-Security/i, "HSTS no hop HTTP é proibido");
  assert.match(
    httpsBlock,
    /Strict-Transport-Security "max-age=31536000; includeSubDomains" always;/,
  );
  // A diretiva não pode ter `preload` (o comentário pode mencionar a decisão).
  assert.doesNotMatch(httpsBlock, /^\s*add_header\s+Strict-Transport-Security[^\n]*preload/im);
  assert.doesNotMatch(
    httpDraft,
    /Strict-Transport-Security/i,
    "rascunho HTTP interno não pode ter HSTS",
  );
});

test("HTTPS usa TLS moderno, certificados montados e encaminha o scheme", () => {
  assert.match(httpsBlock, /ssl_protocols\s+TLSv1\.2 TLSv1\.3;/);
  assert.match(
    httpsBlock,
    /ssl_certificate\s+\/etc\/nginx\/certs\/jarvis\.laytech\.com\.br\.fullchain\.pem;/,
  );
  assert.match(
    httpsBlock,
    /ssl_certificate_key\s+\/etc\/nginx\/certs\/jarvis\.laytech\.com\.br\.key;/,
  );
  assert.match(httpsBlock, /proxy_set_header X-Forwarded-Proto \$scheme;/);
  assert.match(httpsBlock, /proxy_pass http:\/\/\$jarvis_api;/);
  assert.match(httpsBlock, /proxy_pass http:\/\/\$jarvis_panel;/);
});
