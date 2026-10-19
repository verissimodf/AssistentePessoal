// HTTP integration: Skills enter through an authenticated multipart endpoint and remain inert.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-skill-intake-http-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
process.env.JARVIS_MAX_UPLOAD = "200000";
const { createApp, routeTable } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");

const ORIGIN = "http://localhost:8080";
const PW = "senha-muito-forte-1";
let server, base, session;
before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const bootstrap = auth.ensureBootstrap();
  await fetch(base + "/api/auth/setup", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ token: bootstrap.token, username: "adminskill", password: PW }),
  });
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ username: "adminskill", password: PW }),
  });
  assert.equal(login.status, 200);
  session = {
    cookie: login.headers.get("set-cookie").split(";")[0],
    csrf: (await login.json()).csrf,
  };
});
after(async () => {
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  // Windows mantém o ficheiro SQLite bloqueado enquanto a ligação estiver aberta.
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const upload = (name = "SKILL.md", text = "Simple local note summarizer. No network or side effects.\n", authHeaders = true) => {
  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/markdown" }), name);
  return fetch(base + "/api/skills/inspect", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      ...(authHeaders ? { cookie: session.cookie, "x-jarvis-csrf": session.csrf } : {}),
    },
    body: form,
  });
};

test("Skills inspection route is protected and requires a human session", async () => {
  const route = routeTable().find((r) => r.method === "POST" && r.pattern === "/api/skills/inspect");
  assert.equal(route?.access, "session");
  assert.equal((await upload("SKILL.md", "content", false)).status, 401);
});

test("only a single SKILL.md upload is accepted", async () => {
  const wrongName = await upload("payload.json");
  assert.equal(wrongName.status, 400);
  assert.equal((await wrongName.json()).error, "skill_manifest_must_be_skill_md");
  const empty = await upload("SKILL.md", "");
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).error, "skill_file_empty");
});

test("inspection returns only a bounded verdict and never installs or activates", async () => {
  const marker = "CANARY-SKILL-CONTENT-MUST-NOT-RETURN-83d1";
  const r = await upload("SKILL.md", `---\nname: intake-test\ndescription: Local inert test skill\n---\n${marker}\n`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(["passed", "failed", "incomplete", "blocked"].includes(body.result.decision));
  assert.equal(body.result.safeToInstall, false, "inspection endpoint never authorizes installation");
  assert.equal(body.constraints.grantsPermissions, false);
  assert.equal(body.constraints.grantsActivation, false);
  assert.equal(body.constraints.allowsExecution, false);
  assert.equal(body.constraints.requiresHumanReview, true);
  assert.equal(JSON.stringify(body).includes(marker), false, "response must not echo candidate content");
  assert.ok(body.artifact?.hash?.digest === null || /^[a-f0-9]{64}$/.test(body.artifact.hash.digest));
  const events = db.prepare("SELECT kind, detail FROM audit WHERE kind = 'skill.inspect' ORDER BY id DESC LIMIT 1").get();
  assert.ok(events, "metadata-only audit event is persisted");
  const detail = JSON.parse(events.detail);
  assert.equal(detail.status, body.result.decision);
  assert.equal(JSON.stringify(detail).includes(marker), false);
});

test("oversized Skill upload is rejected before inspection", async () => {
  const tooLarge = "x".repeat(210_000);
  const r = await upload("SKILL.md", tooLarge);
  assert.equal(r.status, 413);
});
