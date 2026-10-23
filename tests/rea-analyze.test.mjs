// Integração REA (rea_analyze): validação de caminho/raízes, aprovação humana obrigatória,
// revalidação de fingerprint e gravação integral da Evidence em data/rea/.
// Temporary data dir + synthetic data only (same bootstrap as phase2-fixes.test.mjs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-rea-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { callTool, reaResolvePath, parseReaRoots, reaFingerprint, REA_TEMPLATE } = await import("../server/tools.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let server, base;
const A = {};
const req = (path, { method = "GET", body, s } = {}) =>
  fetch(base + path, {
    method,
    headers: { origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(s ? { cookie: s.cookie, "x-jarvis-csrf": s.csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
async function login(u, t) {
  const r = await req("/api/auth/login", { method: "POST", body: { username: u, password: PW } });
  const j = await r.json();
  Object.assign(t, { cookie: r.headers.get("set-cookie").split(";")[0], csrf: j.csrf, id: j.admin.id });
  t.principal = auth.validateSession(t.cookie.split("=")[1]);
}
const putSettings = (body, s = A) => req("/api/settings", { method: "PUT", body, s });

const TARGET_NATIVE = join(dir, "rea", "targets", "demo-app");
const TARGET = TARGET_NATIVE.replace(/\\/g, "/");
before(async () => {
  // Wrapper `rea` no PATH do teste: shim hermético para testes de integração do Jarvis
  const binDir = join(dir, "bin");
  mkdirSync(binDir, { recursive: true });
  const reaScript = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const args = process.argv.slice(2);
const targetPath = (args.find((a) => !a.startsWith("-") && a !== "analyze-javascript-application") || "").replace(/\\\\/g, "/");

let jsCount = 0;
let ipcCount = 0;

function scanDir(d) {
  if (!fs.existsSync(d)) return;
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, entry.name);
    if (entry.isDirectory()) scanDir(full);
    else if (entry.name.endsWith(".js")) {
      jsCount++;
      const src = fs.readFileSync(full, "utf8");
      if (src.includes("ipcMain.")) ipcCount++;
    }
  }
}

if (targetPath) scanDir(targetPath);
const digest = crypto.createHash("sha256").update(targetPath || "rea-demo").digest("hex");
const evidenceId = "ev_" + digest;

const payload = {
  evidence_id: evidenceId,
  subject: {
    name: path.basename(targetPath) || "demo-app",
    local_path: targetPath,
    digest: { sha256: digest },
  },
  normalized_result: {
    statistics: {
      relevant_files: Math.max(jsCount, 2),
      parsed_javascript_files: Math.max(jsCount, 2),
      findings: 0,
    },
    summary: {
      ipc: {
        operations: Math.max(ipcCount, 1),
        main_handlers: Math.max(ipcCount, 1),
      },
    },
  },
};

process.stdout.write(JSON.stringify(payload) + "\\n");
`.replace(/\r\n/g, "\n");

  writeFileSync(join(binDir, "rea"), reaScript, { mode: 0o755 });
  try { chmodSync(join(binDir, "rea"), 0o755); } catch {}
  if (process.platform === "win32") {
    writeFileSync(join(binDir, "rea.cmd"), `@echo off\r\nnode "%~dp0rea" %*\r\n`);
  }
  process.env.PATH = `${binDir}${delimiter}${process.env.PATH}`;
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  await login("ana", A);
  mkdirSync(join(TARGET_NATIVE, "lib"), { recursive: true });
  writeFileSync(join(TARGET_NATIVE, "package.json"), JSON.stringify({ name: "demo-app", version: "1.0.0", main: "main.js" }));
  writeFileSync(join(TARGET_NATIVE, "main.js"), `const { ipcMain } = require("electron");\nconst { searchNotes } = require("./lib/search.js");\nipcMain.handle("search", (_e, q) => searchNotes(q));\n`);
  writeFileSync(join(TARGET_NATIVE, "lib/search.js"), "function searchNotes(notes, q){ return notes.filter(n => n.includes(q)); }\nmodule.exports = { searchNotes };\n");
});
after(() => server.close());

const T = (name, fn) => test(name, fn);

// ---------- validadores puros ----------
T("reaResolvePath: absolute, charset and traversal", () => {
  const roots = parseReaRoots({});
  assert.equal(reaResolvePath("main.js", {}).ok, false, "não absoluto");
  assert.equal(reaResolvePath(`${roots[0]}/../etc/passwd`, {}).ok, false, "traversal");
  assert.equal(reaResolvePath(`${roots[0]}/a; b`, {}).ok, false, "metacaractere");
  assert.equal(reaResolvePath("/opt/sem-permissao/app", {}).ok, false, "fora da raiz");
  assert.equal(reaResolvePath(`${roots[0]}/demo-app`, {}).ok, true, "dentro da raiz");
  assert.equal(reaResolvePath(`${roots[0]}/demo-app`, { roots: "/outra/raiz" }).ok, false, "raiz configurável");
});

T("reaResolvePath: demo target resolves (bootstrap layout)", () => {
  const v = reaResolvePath(TARGET, {});
  assert.equal(v.ok, true);
});

// ---------- fluxo completo pelo HTTP + aprovação ----------
T("rea_analyze: integração desabilitada → recusa sem aprovação", async () => {
  const out = await callTool("rea_analyze", { path: TARGET }, { autonomy: "confirm", pending: [], principal: A.principal });
  assert.match(out, /não está habilitada/i);
});

T("rea_analyze: pede aprovação, roda após aprovação e grava Evidence + índice", async () => {
  const on = await (await putSettings({ integrations: { rea: { enabled: true } } })).json();
  assert.ok(on.integrations?.rea?.enabled === true, "integração habilitada no painel");
  const ctx = { autonomy: "confirm", pending: [], principal: A.principal };
  const toolOut = await callTool("rea_analyze", { path: TARGET }, ctx);
  assert.match(toolOut, /aprovação/i);
  assert.equal(ctx.pending.length, 1, "aprovação pendente foi enfileirada");
  const approval = ctx.pending[0];

  // Sem aprovação: nada é executado e nenhum resultado existe.
  assert.ok(!existsSync(join(dir, "rea", "index.jsonl")), "nenhuma execução antes da aprovação");

  const r = await req(`/api/approvals/${approval.id}`, { method: "POST", body: { approve: true }, s: A });
  assert.ok(r.ok, "aprovação pelo painel");
  const j = await r.json();
  assert.match(j.output, /Evidence:/, "resumo com evidence_id");

  const row = db.prepare("SELECT status, output FROM approvals WHERE id = ?").get(approval.id);
  assert.equal(row.status, "done", "registro de aprovação done com output");
  matchEvidence(row.output);
});

function matchEvidence(text) {
  const id = (text.match(/Evidence: (ev_[a-f0-9]{6})/) || [])[1];
  assert.ok(id, "evidence_id presente no resumo");

  // O resultado integral (Evidence JSON) foi gravado.
  const results = db.prepare("SELECT data FROM global_settings WHERE id = 1").get();
  const rea = JSON.parse(results.data).integrations.rea;
  const roots = parseReaRoots(rea);
  const base = roots[0] ? roots[0].replace(/targets$/, "targets") : null;
  const files = readFileSync(join(dir, "rea", "index.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(files.length, 1, "um recibo no índice");
  assert.equal(files[0].ok, true, "execução registrada como ok");
  assert.equal(files[0].path, TARGET, "caminho carimbado é o aprovado");
  assert.ok(files[0].evidence_id?.startsWith("ev_"), "evidence_id no recibo");
  const evidencePath = join(dir, files[0].file);
  assert.ok(existsSync(evidencePath), "arquivo de Evidence existe");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  assert.match(evidence.evidence_id, /^ev_[a-f0-9]{64}$/, "Evidence bem formada");
  assert.equal(evidence.subject?.local_path, TARGET, "Evidence fala do alvo aprovado");
  const stats = evidence.normalized_result?.statistics ?? {};
  assert.ok(stats.parsed_javascript_files >= 2, "módulos JS parseados");
  const summary = evidence.normalized_result?.summary ?? {};
  assert.equal(summary.ipc?.operations, 1, "IPC do demo detectado");
}

T("approval negada não executa nada", async () => {
  const ctx = { autonomy: "confirm", pending: [], principal: A.principal };
  await callTool("rea_analyze", { path: TARGET }, ctx);
  const approval = ctx.pending[0];
  const before = readFileSync(join(dir, "rea", "index.jsonl"), "utf8").trim().split("\n").length;
  await req(`/api/approvals/${approval.id}`, { method: "POST", body: { approve: false }, s: A });
  const after = readFileSync(join(dir, "rea", "index.jsonl"), "utf8").trim().split("\n").length;
  assert.equal(after, before, "índice inalterado quando negado");
});

T("mudança de raiz entre pedido e aprovação → cancelada", async () => {
  const ctx = { autonomy: "confirm", pending: [], principal: A.principal };
  await callTool("rea_analyze", { path: TARGET }, ctx);
  const approval = ctx.pending[0];
  // admin muda a configuração da integração antes de aprovar
  await putSettings({ integrations: { rea: { enabled: true, command: "rea analyze-javascript-application {path} --json", roots: "/raiz-alterada" } } });
  const r = await req(`/api/approvals/${approval.id}`, { method: "POST", body: { approve: true }, s: A });
  const j = await r.json();
  assert.match(j.output, /cancelada/i, "fingerprint/raiz reavaliados na aprovação");
  // restauração explícita (merge mantém chaves anteriores)
  await putSettings({ integrations: { rea: { enabled: true, command: REA_TEMPLATE, roots: "" } } });
});

T("comando alterado no painel é recusado na execução", async () => {
  await putSettings({ integrations: { rea: { enabled: true, command: REA_TEMPLATE } } });
  const ctx = { autonomy: "confirm", pending: [], principal: A.principal };
  const out = await callTool("rea_analyze", { path: TARGET }, ctx);
  assert.match(out, /aprovação/i, "template padrão continua aceito");
  for (const p of ctx.pending) await req(`/api/approvals/${p.id}`, { method: "POST", body: { approve: false }, s: A });
  await putSettings({ integrations: { rea: { enabled: true, command: "rea arbitrary --exec" } } });
  const refused = await callTool("rea_analyze", { path: TARGET }, { autonomy: "confirm", pending: [], principal: A.principal });
  assert.match(refused, /não pode ser alterado/i, "divergência do template é recusada");
  await putSettings({ integrations: { rea: { enabled: true, command: REA_TEMPLATE, roots: "" } } });
});

// ---------- comando determinístico /rea no chat (sem LLM) ----------
T("/rea no chat: enfileira aprovação sem provedor e executa após aprovação", async () => {
  await putSettings({ integrations: { rea: { enabled: true } } });
  const r = await req("/api/chat", { method: "POST", body: { message: `/rea ${TARGET}`, clientMsgId: "9d2b7a1e-8f42-4a5a-9d9e-2222aaaabbbb" }, s: A });
  assert.ok(r.ok, `status ${r.status}`);
  const j = await r.json();
  assert.match(j.reply, /aprovação/i, "resposta determinística enfileira a aprovação");
  assert.equal((j.pending || []).length, 1, "pending vem na resposta do chat");
  const id = j.pending[0].id;

  const before = readFileSync(join(dir, "rea", "index.jsonl"), "utf8").trim().split("\n").length;
  const ap = await req(`/api/approvals/${id}`, { method: "POST", body: { approve: true }, s: A });
  const aj = await ap.json();
  assert.match(aj.output, /Evidence:/, "REA executou após a aprovação no chat");
  const after = readFileSync(join(dir, "rea", "index.jsonl"), "utf8").trim().split("\n").length;
  assert.equal(after, before + 1, "execução registrada no índice");
});

T("/rea: caminho fora das raízes → recusa determinística, sem aprovação", async () => {
  const r = await req("/api/chat", { method: "POST", body: { message: "/rea /opt/sem-permissao/app", clientMsgId: "aa3b7a1e-8f42-4a5a-9d9e-3333bbbbcccc" }, s: A });
  const j = await r.json();
  assert.match(j.reply, /fora das raízes/i);
  assert.equal((j.pending || []).length, 0, "nada pendente quando recusado");
});

T("/rea sem caminho → mesma troca de uso", async () => {
  const r = await req("/api/chat", { method: "POST", body: { message: "/rea", clientMsgId: "bb4b7a1e-8f42-4a5a-9d9e-4444ccccdddd" }, s: A });
  const j = await r.json();
  assert.match(j.reply, /Uso:/i);
});
