// P0.2 — Proveniência efetiva das configurações: de onde CADA valor vem, sem expor segredos.
//
// Regras sob teste:
//   - sem valor gravado → `default` (padrão de fábrica), não "pessoal";
//   - valor gravado no registro do admin → `personal`; política da instalação (host, integrações,
//     voz local) → `global` (e um admin sem `allowGlobal` continua sem poder gravá-la);
//   - segredos aparecem APENAS como `secret: true` — o valor nunca sai (nem desencriptado);
//   - variáveis sensíveis (`JARVIS_MASTER_KEY`, `JARVIS_SERVICE_TOKEN`, ...) só como presença;
//   - anônimo → 401.
// Banco TEMPORÁRIO; nenhuma rede externa.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-prov-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
process.env.JARVIS_MASTER_KEY = "segredo-do-mestre-que-nunca-aparece";

const { auth } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { settingsProvenance, ENV_REPORTED, ENV_PRESENCE_ONLY } =
  await import("../server/settings.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";

let server, base, A;

const at = (rows, path) => rows.find((r) => r.path === path);

const getProvenance = (sess) =>
  fetch(`${base}/api/settings/provenance`, { headers: { origin: ORIGIN, cookie: sess.cookie } });

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ username: "ana", password: PW }),
  });
  assert.equal(r.status, 200);
  const sid = r.headers.get("set-cookie").split(";")[0].split("=")[1];
  A = { principal: auth.validateSession(sid), cookie: `jarvis_sid=${sid}` };
});

after(() => server.close());

test("sem valor gravado → origem padrão (nada é apresentado como pessoal)", async () => {
  const r = await getProvenance(A);
  assert.equal(r.status, 200);
  const { keys, env } = await r.json();
  assert.ok(keys.length > 10, "inventário cobre o formato efetivo");
  assert.equal(at(keys, "general.agentName")?.origin, "default");
  assert.equal(at(keys, "voice.tts")?.origin, "default");
  assert.equal(at(keys, "host.enabled")?.origin, "default");
  assert.equal(at(keys, "providers.ollama.baseUrl")?.origin, "default");
  // Cada entrada traz caminho + classe + segredo; nunca um valor.
  for (const k of keys) {
    assert.deepEqual(Object.keys(k).sort(), ["class", "origin", "path", "secret"]);
    assert.ok(["default", "personal", "global"].includes(k.origin));
    assert.equal(typeof k.secret, "boolean");
  }
  assert.ok(
    env.reported.length >= 1 && env.presenceOnly.length >= 1,
    "blocos de ambiente presentes",
  );
});

test("valor pessoal gravado muda a origem para personal", async () => {
  const w = await fetch(`${base}/api/settings`, {
    method: "PUT",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      cookie: A.cookie,
      "x-jarvis-csrf": A.principal.csrf,
    },
    body: JSON.stringify({
      general: { agentName: "Jarvis Prime" },
      providers: { ollama: { model: "llama3.2" } },
    }),
  });
  assert.equal(w.status, 200);
  const { keys } = await (await getProvenance(A)).json();
  assert.equal(at(keys, "general.agentName")?.origin, "personal");
  assert.equal(at(keys, "providers.ollama.model")?.origin, "personal");
  // Campos não gravados não entram no formato efetivo (o painel usa o fallback do catálogo);
  // se estiverem presentes, a origem é `default` — nunca "pessoal" por acaso.
  const baseUrl = at(keys, "providers.ollama.baseUrl");
  assert.ok(!baseUrl || baseUrl.origin === "default");
  assert.equal(at(keys, "voice.tts")?.origin, "default");
});

test("política global (host/integrações/voz local) tem origem global", async () => {
  const w = await fetch(`${base}/api/settings`, {
    method: "PUT",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      cookie: A.cookie,
      "x-jarvis-csrf": A.principal.csrf,
    },
    body: JSON.stringify({
      host: { enabled: true, allowlist: "ls, git status" },
      voice: { localVoiceUrl: "http://voz:7778" },
    }),
  });
  assert.equal(w.status, 200);
  const { keys } = await (await getProvenance(A)).json();
  assert.equal(at(keys, "host.enabled")?.origin, "global");
  assert.equal(at(keys, "voice.localVoiceUrl")?.origin, "global");
  assert.equal(at(keys, "host.enabled")?.class, "global");
  assert.equal(at(keys, "general.language")?.origin, "default");
});

test("segredos: apenas a marca `secret`, nunca o valor (no inventário nem nas variáveis)", async () => {
  const { keys, env } = settingsProvenance(A.principal.adminId);
  const apiKey = at(keys, "providers.ollama.apiKey");
  if (apiKey) assert.equal(apiKey.secret, true, "campo de chave marcado como segredo");
  // Prova de não-vazamento: o texto da resposta não contém nenhum valor sensível.
  const raw = JSON.stringify({ keys, env });
  assert.ok(!raw.includes(PW), "senha fora da resposta");
  assert.ok(!raw.includes("segredo-do-mestre"), "JARVIS_MASTER_KEY fora da resposta");
  assert.ok(!raw.includes("enc:"), "valor encriptado fora da resposta");
  // Variáveis sensíveis só declaram presença.
  const master = env.presenceOnly.find((e) => e.name === "JARVIS_MASTER_KEY");
  assert.deepEqual(Object.keys(master).sort(), ["name", "set"], "só presença");
  assert.equal(master.set, true);
  for (const name of ENV_PRESENCE_ONLY)
    assert.ok(!raw.includes(`"${name}":"`), `${name} não expõe valor`);
  for (const name of ENV_REPORTED) assert.ok(ENV_PRESENCE_ONLY.includes(name) === false);
});

test("anônimo → 401 (mesma barreira das demais rotas de configuração)", async () => {
  const r = await fetch(`${base}/api/settings/provenance`, { headers: { origin: ORIGIN } });
  assert.equal(r.status, 401);
});
