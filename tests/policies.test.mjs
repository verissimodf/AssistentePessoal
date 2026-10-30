// Policy Engine (evolução Fase 3): CRUD versionado, decisões ALLOW/DENY/REQUIRE_APPROVAL,
// fail-closed, precedência de negação, cache com invalidação e tentativas de manipulação.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), "jarvis-pol-"));
process.env.JARVIS_NO_LISTEN = "1";
const { db } = await import("../server/db.js");
const { createAuth } = await import("../server/auth.js");
const auth = createAuth(db, { dataDir: process.env.JARVIS_DATA_DIR });
auth.setupFirstAdmin({
  token: auth.ensureBootstrap().token,
  username: "ana",
  password: "senha-muito-forte-1",
});
const ADMIN = auth.validateSession(
  auth.login({ username: "ana", password: "senha-muito-forte-1", ip: "127.0.0.1" }).sid,
);

const pol = await import("../server/policies.js");

test("CRUD com validação: alvo inexistente, efeito/escopo/condições inválidos são recusados", () => {
  assert.throws(
    () =>
      pol.createPolicy(ADMIN.adminId, {
        name: "P1",
        scope: "tool",
        target: "ferramenta_fantasma",
        effect: "deny",
        conditions: [],
      }),
    /target_not_a_tool/,
  );
  assert.throws(
    () =>
      pol.createPolicy(ADMIN.adminId, {
        name: "P2",
        scope: "galaxia",
        target: "*",
        effect: "deny",
        conditions: [],
      }),
    /scope_invalid/,
  );
  assert.throws(
    () =>
      pol.createPolicy(ADMIN.adminId, {
        name: "P3",
        scope: "tool",
        target: "*",
        effect: "talvez",
        conditions: [],
      }),
    /effect_invalid/,
  );
  assert.throws(
    () =>
      pol.createPolicy(ADMIN.adminId, {
        name: "P4",
        scope: "tool",
        target: "*",
        effect: "deny",
        conditions: [{ field: "x", op: "regex", value: "1" }],
      }),
    /conditions_condition_0_op_invalid/,
  );
  assert.throws(
    () =>
      pol.createPolicy(ADMIN.adminId, {
        name: "P5",
        scope: "tool",
        target: "*",
        effect: "deny",
        conditions: "não é lista",
      }),
    /conditions_conditions_not_array/,
  );
  const p = pol.createPolicy(ADMIN.adminId, {
    name: "Bloqueia vendas",
    scope: "tool",
    target: "web_search",
    effect: "deny",
    conditions: [{ field: "tool", op: "eq", value: "web_search" }],
  });
  assert.equal(p.effect, "deny");
  assert.equal(p.version, 1);
  const up = pol.updatePolicy(ADMIN.adminId, p.id, { description: "nova" });
  assert.equal(up.version, 2);
  // Revisões imutáveis acumulam versões.
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM wf_policy_revisions WHERE policy_id=?").get(p.id).n,
    2,
  );
  assert.equal(pol.deletePolicy(ADMIN.adminId, p.id), true);
  assert.equal(pol.getPolicy(ADMIN.adminId, p.id), null);
});

test("decisões: ALLOW (sem política), DENY prevalece e REQUIRE_APPROVAL força D9 em ferramentas capazes", () => {
  pol.createPolicy(ADMIN.adminId, {
    name: "Proíbe crawl",
    scope: "tool",
    target: "crawl_page",
    effect: "deny",
    conditions: [{ field: "tool", op: "eq", value: "crawl_page" }],
  });
  pol.createPolicy(ADMIN.adminId, {
    name: "Run command exige aprovação",
    scope: "tool",
    target: "run_command",
    effect: "require_approval",
    conditions: [{ field: "tool", op: "eq", value: "run_command" }],
  });
  // Sem política para web_search → allow (engine complementa autorização).
  assert.equal(
    pol.evaluatePolicies(ADMIN.adminId, { kind: "tool", target: "web_search", tool: "web_search" })
      .decision,
    "allow",
  );
  // DENY para crawl_page.
  assert.equal(
    pol.evaluatePolicies(ADMIN.adminId, { kind: "tool", target: "crawl_page", tool: "crawl_page" })
      .decision,
    "deny",
  );
  pol.createPolicy(ADMIN.adminId, {
    name: "Web exige aprovação",
    scope: "tool",
    target: "web_search",
    effect: "require_approval",
    conditions: [{ field: "tool", op: "eq", value: "web_search" }],
  });
  // REQUIRE_APPROVAL: ferramenta D9-capable → allow com force_approval (o fluxo D9 nativo assume).
  const rc = pol.toolPolicyVerdict(ADMIN.adminId, {
    tool: "run_command",
    scope: "host:run",
    principal: { type: "bot", scopes: ["host:run"] },
  });
  assert.equal(rc.force_approval, true);
  // REQUIRE_APPROVAL: ferramenta SEM caminho D9 → negada (nunca autorizada).
  const ws = pol.toolPolicyVerdict(ADMIN.adminId, {
    tool: "web_search",
    scope: "web",
    principal: { type: "bot", scopes: ["web"] },
  });
  assert.equal(ws.decision, "deny");
  assert.equal(ws.reason, "tool_has_no_approval_path");
});

test("fail-closed: política com condição inválida no banco → DENY auditado", () => {
  pol.createPolicy(ADMIN.adminId, {
    name: "Corrompida",
    scope: "tool",
    target: "*",
    effect: "allow",
    conditions: [{ field: "tool", op: "eq", value: "recall" }],
  });
  // Corrompe a condição direto no banco (simula política inválida em vigor; fora da API não
  // há invalidação automática — invalidamos manualmente, como faria uma correção operacional).
  db.prepare("UPDATE wf_policies SET conditions='{\"quebra\":true}' WHERE name='Corrompida'").run();
  pol.invalidatePolicyCache(ADMIN.adminId);
  const v = pol.evaluatePolicies(ADMIN.adminId, { kind: "tool", target: "recall", tool: "recall" });
  assert.equal(v.decision, "deny");
  assert.equal(v.reason, "policy_invalid_conditions");
  // Auditado como fail_closed.
  const auditRow = db
    .prepare("SELECT detail FROM audit WHERE kind='policy.fail_closed' ORDER BY id DESC LIMIT 1")
    .get();
  assert.ok(auditRow);
  // Remove a política corrompida (senão ela nega tudo por fail-closed nos testes seguintes).
  pol.invalidatePolicyCache(ADMIN.adminId);
  pol.deletePolicy(
    ADMIN.adminId,
    db.prepare("SELECT id FROM wf_policies WHERE name='Corrompida'").get().id,
  );
});

test("precedência: deny vence require_approval e allow mesmo com prioridade menor", () => {
  pol.createPolicy(ADMIN.adminId, {
    name: "Deny forte",
    scope: "agent",
    target: "agente-x",
    effect: "deny",
    priority: 0,
    conditions: [{ field: "agent", op: "exists" }],
  });
  pol.createPolicy(ADMIN.adminId, {
    name: "Allow fraco",
    scope: "agent",
    target: "agente-x",
    effect: "allow",
    priority: 100,
    conditions: [{ field: "agent", op: "exists" }],
  });
  const v = pol.evaluatePolicies(ADMIN.adminId, {
    kind: "agent",
    target: "agente-x",
    agent: "agente-x",
  });
  assert.equal(v.decision, "deny");
});

test("isolamento: políticas de outro admin não se aplicam; mutação invalida o cache", async () => {
  auth.reauth(ADMIN, "senha-muito-forte-1");
  auth.createAdmin(ADMIN, {
    username: "bia-pol",
    password: "senha-muito-forte-2",
    currentPassword: "senha-muito-forte-1",
  });
  const BIA = auth.validateSession(
    auth.login({ username: "bia-pol", password: "senha-muito-forte-2", ip: "127.0.0.1" }).sid,
  );
  // Política de BIA bloqueia web_search — mas a avaliação para ANA ignora (ownership);
  // a decisão de ana vem da política DELA ("Web exige aprovação", require_approval).
  pol.createPolicy(BIA.adminId, {
    name: "BIA bloqueia",
    scope: "tool",
    target: "web_search",
    effect: "deny",
    conditions: [{ field: "tool", op: "eq", value: "web_search" }],
  });
  const vAna = pol.evaluatePolicies(ADMIN.adminId, {
    kind: "tool",
    target: "web_search",
    tool: "web_search",
  });
  assert.equal(vAna.decision, "require_approval"); // não é o deny de BIA
  assert.equal(
    vAna.matched,
    pol.listPolicies(ADMIN.adminId).find((p) => p.name === "Web exige aprovação").id,
  );
  assert.equal(
    pol.evaluatePolicies(BIA.adminId, { kind: "tool", target: "web_search", tool: "web_search" })
      .decision,
    "deny",
  );
  // BIA não lê nem altera política de ana (ownership).
  const pAna = pol.createPolicy(ADMIN.adminId, {
    name: "De Ana",
    scope: "tool",
    target: "*",
    effect: "deny",
    conditions: [{ field: "tool", op: "exists" }],
  });
  assert.equal(pol.getPolicy(BIA.adminId, pAna.id), null);
  assert.equal(pol.updatePolicy(BIA.adminId, pAna.id, { effect: "allow" }), null);
  assert.equal(pol.deletePolicy(BIA.adminId, pAna.id), false);
  // Cache: política desativada passa a valer sem reprocesso manual (recall: negada → desativada
  // → permitida; "De Ana" (deny tudo) é removida antes para o cenário ficar limpo).
  pol.deletePolicy(ADMIN.adminId, pAna.id);
  const nova = pol.createPolicy(ADMIN.adminId, {
    name: "Bloqueia recall",
    scope: "tool",
    target: "recall",
    effect: "deny",
    conditions: [{ field: "tool", op: "eq", value: "recall" }],
  });
  assert.equal(
    pol.evaluatePolicies(ADMIN.adminId, { kind: "tool", target: "recall", tool: "recall" })
      .decision,
    "deny",
  );
  pol.updatePolicy(ADMIN.adminId, nova.id, { enabled: false });
  assert.equal(
    pol.evaluatePolicies(ADMIN.adminId, { kind: "tool", target: "recall", tool: "recall" })
      .decision,
    "allow",
  );
});
