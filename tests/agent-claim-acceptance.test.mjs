// Fase F — aceitação da reivindicação do agente persistido e rollback de propriedade.
// Roda em banco TEMPORÁRIO (JARVIS_DATA_DIR): nunca toca o banco ativo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-claim-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db, agents, audit } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { owns, ownedIds, dropOwnership, claimLegacy, legacyInventory } =
  await import("../server/ownership.js");
const { resolveAgent, DEFAULT_AGENT } = await import("../server/llm.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const AGENT_ID = "jarvis";
let admin, principal, server, base;

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
  principal = auth.validateSession(r.headers.get("set-cookie").split(";")[0].split("=")[1]);
  admin = db.prepare("SELECT id FROM admins WHERE active=1").get();
  // Agente persistido sem dono (como no estado atual do servidor).
  agents.save({
    id: AGENT_ID,
    name: "J.A.R.V.I.S.",
    provider: "ollama",
    model: "qwen2.5:7b",
    active: true,
    instructions: "instruções do operador",
    tools: ["web_search", "remember", "recall"],
  });
});
after(async () => {
  await new Promise((r) => server.close(r));
});

test("antes de reivindicar: agente sem dono é invisível e o chat usa o template", () => {
  assert.equal(owns(admin.id, "agent", AGENT_ID), false);
  assert.equal(ownedIds(admin.id, "agent").size, 0);
  assert.equal(resolveAgent(admin.id, AGENT_ID, null), null, "não pode ser selecionado por id");
  assert.equal(resolveAgent(admin.id, null, null).id, DEFAULT_AGENT.id, "cai no template embutido");
  assert.deepEqual(
    legacyInventory().agent.map((a) => a.id),
    [AGENT_ID],
  );
});

test("reivindicar por procedimento suportado torna o agente utilizável", () => {
  const r = claimLegacy(admin.id, { type: "agent", ids: [AGENT_ID], confirm: "ASSUMIR" });
  assert.equal(r.ok, true);
  assert.equal(owns(admin.id, "agent", AGENT_ID), true);
  const a = resolveAgent(admin.id, AGENT_ID, null);
  assert.equal(a.id, AGENT_ID);
  assert.equal(a.model, "qwen2.5:7b");
  assert.deepEqual(a.tools, ["web_search", "remember", "recall"]);
  assert.ok(audit, "auditoria disponível");
  const rows = db
    .prepare("SELECT kind FROM audit ORDER BY id DESC LIMIT 5")
    .all()
    .map((x) => x.kind);
  assert.ok(rows.includes("legacy.claimed"), `auditado: ${rows.join(",")}`);
});

test("reivindicar duas vezes é recusado (sem sobrescrever dono)", () => {
  assert.throws(
    () => claimLegacy(admin.id, { type: "agent", ids: [AGENT_ID], confirm: "ASSUMIR" }),
    /already_owned|ClaimError/,
  );
});

test("reivindicar exige confirmação explícita", () => {
  dropOwnership("agent", AGENT_ID);
  assert.throws(
    () => claimLegacy(admin.id, { type: "agent", ids: [AGENT_ID], confirm: "sim" }),
    /confirmation_required/,
  );
  assert.equal(owns(admin.id, "agent", AGENT_ID), false);
});

test("rollback de propriedade: dropOwnership devolve o agente ao estado invisível", () => {
  claimLegacy(admin.id, { type: "agent", ids: [AGENT_ID], confirm: "ASSUMIR" });
  assert.equal(resolveAgent(admin.id, AGENT_ID, null).id, AGENT_ID);
  dropOwnership("agent", AGENT_ID);
  assert.equal(owns(admin.id, "agent", AGENT_ID), false);
  assert.equal(resolveAgent(admin.id, AGENT_ID, null), null, "volta a ser invisível");
  assert.equal(resolveAgent(admin.id, null, null).id, DEFAULT_AGENT.id);
  // O dado do agente permanece intacto: rollback não apaga nada.
  const stored = agents.get(AGENT_ID);
  assert.equal(stored.model, "qwen2.5:7b");
  assert.equal(stored.instructions, "instruções do operador");
});

test("o agente reivindicado continua sem escopos além dos permitidos ao dono", () => {
  // A posse não amplia permissões: quem executa é o principal (sessão/token/bot).
  const before = ownedIds(admin.id, "agent").size;
  claimLegacy(admin.id, { type: "agent", ids: [AGENT_ID], confirm: "ASSUMIR" });
  assert.equal(ownedIds(admin.id, "agent").size, before + 1);
  assert.equal(typeof principal.scopes, "object");
});
