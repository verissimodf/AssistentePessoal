// Contrato do cookie de sessão quando o serviço roda atrás de HTTPS: `Secure` precisa ser
// emitido, sem perder HttpOnly/SameSite. O módulo lê o ambiente no import, então o arquivo
// roda em processo próprio (runner do Node) e define JARVIS_COOKIE_SECURE antes do import.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-cookie-secure-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
process.env.JARVIS_COOKIE_SECURE = "1";

const { createApp } = await import("../server/index.js");
const { auth } = await import("../server/db.js");

const PW = "senha-muito-forte-secure-1";
const ORIGIN = "http://localhost:8080";
let server, base;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const { token } = auth.ensureBootstrap();
  const r = await fetch(`${base}/api/auth/setup`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ token, username: "verissimo", password: PW }),
  });
  assert.equal(r.status, 200);
});
after(() => server.close());

test("com JARVIS_COOKIE_SECURE=1 o login emite cookie Secure + HttpOnly + SameSite=Strict", async () => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ username: "verissimo", password: PW }),
  });
  assert.equal(r.status, 200);
  const sc = r.headers.get("set-cookie");
  assert.match(sc, /^jarvis_sid=jss_/);
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  assert.match(sc, /;\s*Secure(;|$)/);
  assert.match(sc, /Path=\//);
});
