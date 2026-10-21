// P0.2 — Metadados de build (versão + commit) reais, sem adivinhação.
//
// O `/api/health` e os diagnósticos reportam a ÁRVORE EXATA construída. Regras sob teste:
//   - sem metadados injetados → "unknown" e o painel diz "Não registrado" (nunca um commit
//     inferido do branch atual, que pode não ser a árvore que a imagem contém);
//   - commit só entra se parecer um SHA (um branch/tag nunca vira "commit");
//   - o valor vem do build (`--build-arg` → `JARVIS_DATA_DIR/server/build-info.json`), com
//     `APP_VERSION`/`GIT_SHA`/`BUILD_TIME` por env vencendo o ficheiro.
// Banco TEMPORÁRIO; nenhuma rede, nenhum efeito externo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-buildinfo-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
// O runner local/CI NÃO injeta metadados de build: o teste assegura o caminho honesto ("unknown")
// para o arranque sem build, e o caminho injetado escrevendo o ficheiro que o build grava.
delete process.env.APP_VERSION;
delete process.env.GIT_SHA;
delete process.env.BUILD_TIME;

const { auth, db } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { buildInfo, isKnownCommit, commitOrUnknown, GIT_COMMIT } =
  await import("../server/build-info.js");
const { collectDiagnostics } = await import("../server/diagnostics.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SHA = "abc1234def567890abcdef1234567890abcdef12";

let server, base, A;

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
  assert.ok(A.principal, "sessão real (anti-forja por WeakMap)");
});

after(() => server.close());

test("commit desconhecido/malformado nunca passa por um SHA", () => {
  assert.equal(isKnownCommit("unknown"), false);
  assert.equal(isKnownCommit(""), false);
  assert.equal(isKnownCommit(null), false);
  assert.equal(isKnownCommit("main"), false, "branch não é commit");
  assert.equal(isKnownCommit("v1.2.2-gigabrain1"), false, "tag de imagem não é commit");
  assert.equal(isKnownCommit("HEAD"), false);
  assert.equal(isKnownCommit("gabc1234"), false, "prefixo git porcelain não é SHA");
  assert.equal(isKnownCommit("abc1234"), true);
  assert.equal(isKnownCommit(SHA), true);
  assert.equal(isKnownCommit("ABC1234"), true, "SHA é case-insensitive");
  assert.equal(isKnownCommit("zzz"), false);
});

test("arranque sem build → metadados 'unknown' (nunca adivinha)", () => {
  const info = buildInfo();
  assert.equal(info.version, "unknown", "sem manifest de build a versão não é presumida");
  assert.equal(info.commit, "unknown");
  assert.equal(info.revision, "unknown");
  assert.equal(commitOrUnknown(), "unknown");
  assert.equal(typeof info.buildTime, "string", "campo presente, mesmo quando desconhecido");
});

test("health expõe os campos de build sem inventar valores", async () => {
  const r = await fetch(`${base}/api/health`, { headers: { origin: ORIGIN } });
  assert.equal(r.status, 200);
  const h = await r.json();
  for (const k of ["version", "commit", "buildTime", "mode"]) {
    assert.ok(k in h, `campo ausente: ${k}`);
    assert.equal(typeof h[k], "string", `${k} deve ser string`);
  }
  assert.equal(h.commit, "unknown", "sem build injetado o commit é 'unknown'");
  assert.ok(!isKnownCommit(h.commit), "nunca reporta um SHA que o build não injetou");
});

test("diagnósticos carregam commit/buildTime junto da versão", () => {
  const adminId = db.prepare("SELECT id FROM admins WHERE active=1").get().id;
  const inv = collectDiagnostics({
    adminId,
    version: "1.3.0",
    commit: SHA,
    buildTime: "2026-10-18T05:33:13Z",
  });
  assert.equal(inv.versao.app, "1.3.0");
  assert.equal(inv.versao.commit, SHA, "commit real propagado aos diagnósticos");
  assert.equal(inv.versao.buildTime, "2026-10-18T05:33:13Z");
});

test("diagnósticos com build desconhecido não inventam commit", () => {
  const adminId = db.prepare("SELECT id FROM admins WHERE active=1").get().id;
  const inv = collectDiagnostics({ adminId, version: null, commit: null, buildTime: null });
  assert.equal(inv.versao.commit, null, "sem commit → null, nunca um valor do branch");
  assert.equal(inv.versao.buildTime, null);
});

test("env de build vence o ficheiro e o script rejeita SHA malformado", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "jarvis-buildinfo-inj-"));
  mkdirSync(join(dataDir, "server"), { recursive: true });
  // Ficheiro legado com commit que NÃO é SHA: o build-info deve descartá-lo.
  writeFileSync(
    join(dataDir, "server", "build-info.json"),
    JSON.stringify({
      appVersion: "1.0.0",
      commit: "main",
      buildTime: "ontem",
      mode: "production",
    }) + "\n",
  );
  process.env.JARVIS_DATA_DIR = dataDir;
  const fresh = await import(`../server/build-info.js?t=${Date.now()}`);
  assert.equal(fresh.isKnownCommit(fresh.GIT_COMMIT), false, "branch nunca vira commit");
  assert.equal(fresh.commitOrUnknown(), "unknown");
  assert.equal(fresh.buildInfo().commit, "unknown");

  // Com SHA válido no ficheiro (caminho do container, sem env) → commit exposto.
  writeFileSync(
    join(dataDir, "server", "build-info.json"),
    JSON.stringify({
      appVersion: "1.3.0",
      commit: SHA,
      buildTime: "2026-10-18T05:33:13Z",
      mode: "production",
    }) + "\n",
  );
  const withSha = await import(`../server/build-info.js?sha=${Date.now()}`);
  assert.equal(withSha.commitOrUnknown(), SHA);
  assert.equal(withSha.buildInfo().version, "1.3.0");

  // Env vence o ficheiro (é o caminho do container).
  process.env.APP_VERSION = "9.9.9";
  const withEnv = await import(`../server/build-info.js?env=${Date.now()}`);
  assert.equal(withEnv.buildInfo().version, "9.9.9");
  delete process.env.APP_VERSION;

  process.env.JARVIS_DATA_DIR = dir;
  rmSync(dataDir, { recursive: true, force: true });
});

test("o script de build grava o JSON no diretório de dados do serviço", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "jarvis-buildinfo-writer-"));
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(
    process.execPath,
    [join(process.cwd(), "scripts", "write-build-info.mjs")],
    {
      env: {
        ...process.env,
        JARVIS_DATA_DIR: dataDir,
        APP_VERSION: "2.0.0",
        GIT_SHA: "main",
        BUILD_TIME: "agora",
      },
      encoding: "utf8",
    },
  );
  assert.match(out, /commit=unknown/, "o script registra que rejeitou o branch");
  const raw = JSON.parse(
    (await import("node:fs")).readFileSync(join(dataDir, "server", "build-info.json"), "utf8"),
  );
  assert.equal(raw.appVersion, "2.0.0");
  assert.equal(raw.commit, "unknown", "branch rejeitado → unknown, nunca gravado como commit");
  rmSync(dataDir, { recursive: true, force: true });
});

test("sem args o script cai no manifesto do repositório, nunca num branch", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "jarvis-buildinfo-writer2-"));
  const { execFileSync } = await import("node:child_process");
  // Sem `.app-version` no cwd → sem versão conhecida: tudo "unknown" (nada é presumido).
  execFileSync(process.execPath, [join(process.cwd(), "scripts", "write-build-info.mjs")], {
    env: { JARVIS_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  const raw = JSON.parse(
    (await import("node:fs")).readFileSync(join(dataDir, "server", "build-info.json"), "utf8"),
  );
  for (const k of ["appVersion", "commit", "buildTime"]) {
    assert.equal(raw[k], "unknown", `${k} deve ser unknown sem build args`);
  }
  rmSync(dataDir, { recursive: true, force: true });
});

test("sem APP_VERSION o script cai no `.app-version` (manifesto do repositório)", async () => {
  const { execFileSync } = await import("node:child_process");
  // Reproduz o Dockerfile: cwd tem `.app-version` e o ARG vem vazio ("sem-build" ou ausente).
  // `.app-version` entra no `.gitignore` como artefato de build; a fonte versionada é o package.json,
  // extraído no build — o teste lê a MESMA fonte para nunca divergir do manifesto real.
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version;
  // O script resolve o manifesto em `JARVIS_DATA_DIR` → cwd; o teste passa os dois alinhados.
  const dataDir = mkdtempSync(join(tmpdir(), "jarvis-buildinfo-writer3-"));
  writeFileSync(join(dataDir, ".app-version"), `${manifest}\n`);
  for (const vazio of [undefined, "sem-build"]) {
    execFileSync(process.execPath, [join(process.cwd(), "scripts", "write-build-info.mjs")], {
      env: { ...process.env, JARVIS_DATA_DIR: dataDir, APP_VERSION: vazio },
      encoding: "utf8",
    });
  // Leitura ancorada no dataDir deste teste: o `before` já importou o serviço apontando para OUTRO
  // diretório, então o módulo em memória não pode decidir onde gravar aqui.
  const raw = JSON.parse(readFileSync(join(dataDir, "server", "build-info.json"), "utf8"));
    assert.equal(
      raw.appVersion,
      manifest,
      `ARG vazio="${vazio}" deve cair no manifesto (${manifest}), não num branch`,
    );
    assert.equal(raw.commit, "unknown", "sem GIT_SHA nunca há commit");
  }
  rmSync(dataDir, { recursive: true, force: true });
});

// P0.3.1 — validação estrita de release: um release SEM identidade verificável tem de falhar o
// build (nunca produzir uma imagem com "unknown" que só se descobre em produção).
test("RELEASE_BUILD=1 recusa metadados incompletos (falha de build, nunca 'unknown')", async () => {
  const { execFileSync } = await import("node:child_process");
  const dataDir = mkdtempSync(join(tmpdir(), "jarvis-buildinfo-strict-"));
  let stderr = "";
  assert.throws(() => {
    try {
      execFileSync(process.execPath, [join(process.cwd(), "scripts", "write-build-info.mjs")], {
        env: {
          ...process.env,
          JARVIS_DATA_DIR: dataDir,
          RELEASE_BUILD: "1",
          GIT_SHA: "main",
          BUILD_TIME: "agora",
          APP_VERSION: "1.0.0",
        },
        encoding: "utf8",
      });
    } catch (e) {
      stderr = String(e.stderr || "");
      throw e;
    }
  });
  assert.match(stderr, /RELEASE_BUILD com metadados inválidos/);
  assert.match(stderr, /GIT_SHA inválido/);
  rmSync(dataDir, { recursive: true, force: true });
});

test("RELEASE_BUILD=1 com SHA completo, versão e RFC3339 aprova e grava o JSON", async () => {
  const { execFileSync } = await import("node:child_process");
  const dataDir = mkdtempSync(join(tmpdir(), "jarvis-buildinfo-strict-ok-"));
  const sha = "1972e00b4e2d2a88516df7e29fd2227260bfa5d6";
  const when = "2026-10-18T17:40:00Z";
  const out = execFileSync(
    process.execPath,
    [join(process.cwd(), "scripts", "write-build-info.mjs")],
    {
      env: {
        ...process.env,
        JARVIS_DATA_DIR: dataDir,
        RELEASE_BUILD: "1",
        GIT_SHA: sha,
        BUILD_TIME: when,
        APP_VERSION: "1.0.0",
      },
      encoding: "utf8",
    },
  );
  assert.match(out, /commit=1972e00b/, "o script confirma o SHA aceite");
  const raw = JSON.parse(readFileSync(join(dataDir, "server", "build-info.json"), "utf8"));
  assert.equal(raw.commit, sha);
  assert.equal(raw.appVersion, "1.0.0");
  assert.equal(raw.buildTime, when);
  rmSync(dataDir, { recursive: true, force: true });
});
