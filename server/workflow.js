// Workflow Engine — evolução Fase 3 (docs/evolution/phase-3/workflow-engine.md).
// Workflows duráveis com definição versionada IMUTÁVEL, execução persistente por nó,
// checkpoints, eventos, cancelamento cooperativo, timeout, orçamento e reconciliação de
// `unknown` por evidência. SEM terceira fila de jobs (ADR-WF-001): executor in-process sobre
// estado persistido + recovery no boot — reutiliza Workforce (nós agent), Knowledge Hub
// (nós knowledge/transform), callTool (nós tool, com D9) e o policy engine em toda decisão.
import { db, now, uid, audit } from "./db.js";
import { assignNew, owns, dropOwnership, tx } from "./ownership.js";
import { TOOL_SCOPES } from "./auth.js";
import { evaluatePolicies } from "./policies.js";

const NODE_TYPES = new Set([
  "start",
  "end",
  "agent",
  "tool",
  "condition",
  "transform",
  "knowledge_search",
  "approval",
  "wait",
  "subworkflow",
]);
const RUN_STATUSES = new Set([
  "queued",
  "running",
  "waiting_approval",
  "waiting_dependency",
  "completed",
  "failed",
  "cancelled",
  "unknown",
]);
export const WF_BUDGET = {
  runtime_ms: 10 * 60 * 1000,
  max_nodes: 50,
  max_agent_runs: 10,
  max_depth: 3, // subworkflows
};
const MAX_PARALLEL = 2; // fan-out limitado

/** Escopos efetivos do workflow: derivados no backend das allowed_tools declaradas pelo
 *  operador (TOOL_SCOPES) + workforce:run para delegação. Ferramentas fora da lista não têm
 *  escopo no principal → can() nega no callTool (execução nunca amplia a declaração). */
function workflowScopes(definition) {
  // allowed_tools já chega parseado via defRow — aceitar ambos (array ou string JSON).
  const tools = Array.isArray(definition?.allowed_tools)
    ? definition.allowed_tools
    : parseJson(definition?.allowed_tools, []);
  const scopes = new Set();
  for (const t of tools) if (TOOL_SCOPES[t]) scopes.add(TOOL_SCOPES[t]);
  if (scopes.size) scopes.add("workforce:run"); // nós agent/subworkflow dentro do orçamento
  return [...scopes];
}

/** Leitura interna da definição (o run já foi resolvido com ownership no início). */
function getWfDefinitionInternal(id) {
  return defRow(db.prepare("SELECT * FROM wf_definitions WHERE id = ?").get(id));
}

const parseJson = (t, f) => {
  if (t === null || t === undefined) return f;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? v : f;
  } catch {
    return f;
  }
};
const clean = (v, max) => String(v ?? "").slice(0, max);

// ---------- validação de grafo ----------

/** Valida o grafo: tipos conhecidos, start/end únicos+, sem ciclos, arestas válidas. */
export function validateGraph(graph) {
  const errors = [];
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return ["graph_not_object"];
  const { nodes = [], edges = [] } = graph;
  if (!Array.isArray(nodes) || nodes.length < 2) return ["nodes_min_2"];
  if (!Array.isArray(edges)) return ["edges_not_array"];
  if (nodes.length > WF_BUDGET.max_nodes) errors.push("too_many_nodes");
  const ids = new Set(nodes.map((n) => n?.id));
  if (ids.size !== nodes.length) errors.push("duplicate_node_ids");
  for (const n of nodes) {
    if (!n?.id || typeof n.id !== "string" || !/^[a-zA-Z0-9_-]{1,60}$/.test(n.id))
      errors.push(`node_id_invalid:${n?.id}`);
    if (!NODE_TYPES.has(n?.type)) errors.push(`node_type_invalid:${n?.id}:${n?.type}`);
  }
  const starts = nodes.filter((n) => n.type === "start");
  const ends = nodes.filter((n) => n.type === "end");
  if (starts.length !== 1) errors.push("start_required_single");
  if (ends.length < 1) errors.push("end_required");
  for (const e of edges) {
    if (!ids.has(e?.from) || !ids.has(e?.to)) errors.push(`edge_invalid:${e?.from}->${e?.to}`);
    if (e?.from === e?.to) errors.push(`edge_self:${e?.from}`);
  }
  // Ciclos (DFS a partir de start) + nós não alcançáveis.
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) adj.get(e.from)?.push(e);
  const seen = new Set();
  const stack = new Set();
  const dfs = (id) => {
    if (stack.has(id)) {
      errors.push(`cycle_at:${id}`);
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    stack.add(id);
    for (const e of adj.get(id) || []) dfs(e.to);
    stack.delete(id);
  };
  if (starts[0]) dfs(starts[0].id);
  for (const n of nodes)
    if (!seen.has(n.id) && !errors.some((e) => e.startsWith("cycle")))
      errors.push(`unreachable:${n.id}`);
  // Condition nodes: toda aresta de saída precisa de when true/false.
  for (const n of nodes.filter((x) => x.type === "condition")) {
    const out = (adj.get(n.id) || []).map((e) => e.when);
    if (!out.length || out.some((w) => w !== "true" && w !== "false"))
      errors.push(`condition_edges:${n.id}`);
    // Fail-closed: operação de condição desconhecida é rejeitada na validação (nunca avaliada como true).
    if (n.config?.op && !["eq", "ne", "gt", "lt", "contains"].includes(n.config.op))
      errors.push(`condition_op_invalid:${n.id}`);
  }
  return errors;
}

// ---------- definições ----------

const defRow = (r) => r && { ...r, allowed_tools: parseJson(r.allowed_tools, []) };

export function createDefinition(adminId, body = {}) {
  if (!adminId) throw new Error("wf_owner_required");
  const name = clean(body.name, 120).trim();
  if (!name) throw new Error("wf_name_required");
  const graph =
    body.graph && typeof body.graph === "object" ? body.graph : { nodes: [], edges: [] };
  const errors = validateGraph(graph);
  if (errors.length) throw new Error(`wf_graph_invalid:${errors[0]}`);
  const allowed_tools = Array.isArray(body.allowed_tools)
    ? body.allowed_tools.filter((t) => typeof t === "string")
    : [];
  const id = uid();
  const ts = now();
  tx(() => {
    db.prepare(
      "INSERT INTO wf_definitions (id, owner_admin_id, name, description, status, current_version, allowed_tools, created_at, updated_at) VALUES (?,?,?,?,'draft',0,?,?,?)",
    ).run(id, adminId, name, clean(body.description, 2000), JSON.stringify(allowed_tools), ts, ts);
    assignNew("wf_definition", id, adminId);
    db.prepare(
      "INSERT INTO wf_definition_versions (id, definition_id, version, graph, created_at) VALUES (?,?,?,?,?)",
    ).run(uid(), id, 1, JSON.stringify(graph), ts);
    db.prepare("UPDATE wf_definitions SET current_version = 1 WHERE id = ?").run(id);
  });
  audit("wf.definition_created", { admin: adminId, ids: [id] });
  return getDefinition(adminId, id);
}

export function listDefinitions(adminId) {
  return db
    .prepare("SELECT * FROM wf_definitions WHERE owner_admin_id = ? ORDER BY created_at DESC")
    .all(adminId)
    .map(defRow);
}

export function getDefinition(adminId, id) {
  if (!owns(adminId, "wf_definition", id)) return null;
  return defRow(db.prepare("SELECT * FROM wf_definitions WHERE id = ?").get(id));
}

export function getDefinitionVersion(adminId, definitionId, version = null) {
  const def = getDefinition(adminId, definitionId);
  if (!def) return null;
  const v = version ?? def.current_version;
  const row = db
    .prepare("SELECT * FROM wf_definition_versions WHERE definition_id = ? AND version = ?")
    .get(definitionId, v);
  if (!row) return null;
  return { version: row.version, graph: parseJson(row.graph, null), created_at: row.created_at };
}

export function updateDefinition(adminId, id, body = {}) {
  if (!owns(adminId, "wf_definition", id)) return null;
  const def = defRow(db.prepare("SELECT * FROM wf_definitions WHERE id = ?").get(id));
  const ts = now();
  if (body.graph !== undefined) {
    // Edita o grafo da versão de TRABALHO (nova versão), preservando versões publicadas.
    const errors = validateGraph(body.graph);
    if (errors.length) throw new Error(`wf_graph_invalid:${errors[0]}`);
    const next = def.current_version + 1;
    tx(() => {
      db.prepare(
        "INSERT INTO wf_definition_versions (id, definition_id, version, graph, created_at) VALUES (?,?,?,?,?)",
      ).run(uid(), id, next, JSON.stringify(body.graph), ts);
      db.prepare("UPDATE wf_definitions SET current_version = ?, updated_at = ? WHERE id = ?").run(
        next,
        ts,
        id,
      );
    });
  }
  const sets = [];
  const vals = [];
  if (body.name !== undefined) {
    const n = clean(body.name, 120).trim();
    if (!n) throw new Error("wf_name_required");
    sets.push("name = ?");
    vals.push(n);
  }
  if (body.description !== undefined) {
    sets.push("description = ?");
    vals.push(clean(body.description, 2000));
  }
  if (body.allowed_tools !== undefined) {
    sets.push("allowed_tools = ?");
    vals.push(
      JSON.stringify(
        Array.isArray(body.allowed_tools)
          ? body.allowed_tools.filter((t) => typeof t === "string")
          : [],
      ),
    );
  }
  if (sets.length) {
    sets.push("updated_at = ?");
    vals.push(ts, id, adminId);
    db.prepare(
      `UPDATE wf_definitions SET ${sets.join(", ")} WHERE id = ? AND owner_admin_id = ?`,
    ).run(...vals);
    audit("wf.definition_updated", { admin: adminId, ids: [id] });
  }
  return getDefinition(adminId, id);
}

export function publishDefinition(adminId, id) {
  if (!owns(adminId, "wf_definition", id)) return null;
  const def = defRow(db.prepare("SELECT * FROM wf_definitions WHERE id = ?").get(id));
  const version = getDefinitionVersion(adminId, id);
  const errors = validateGraph(version.graph);
  if (errors.length) throw new Error(`wf_graph_invalid:${errors[0]}`);
  db.prepare("UPDATE wf_definitions SET status='published', updated_at=? WHERE id=?").run(
    now(),
    id,
  );
  audit("wf.definition_published", { admin: adminId, ids: [id], status: String(version.version) });
  return getDefinition(adminId, id);
}

export function deleteDefinition(adminId, id) {
  if (!owns(adminId, "wf_definition", id)) return false;
  const active = db
    .prepare(
      "SELECT COUNT(*) AS n FROM wf_runs WHERE definition_id = ? AND status IN ('queued','running','waiting_approval','waiting_dependency')",
    )
    .get(id).n;
  if (active > 0) throw new Error("wf_definition_active_runs");
  tx(() => {
    for (const r of db.prepare("SELECT id FROM wf_runs WHERE definition_id = ?").all(id))
      dropOwnership("wf_run", r.id);
    db.prepare("DELETE FROM wf_definitions WHERE id = ?").run(id);
    dropOwnership("wf_definition", id);
  });
  audit("wf.definition_deleted", { admin: adminId, ids: [id] });
  return true;
}

// ---------- execução ----------

const activeWfRuns = new Set();
const nodeRow = (r) =>
  r && { ...r, input: parseJson(r.input_json, null), output: parseJson(r.output_json, null) };

function emit(runId, kind, nodeId = null, detail = {}) {
  db.prepare("INSERT INTO wf_events (run_id, at, kind, node_id, detail) VALUES (?,?,?,?,?)").run(
    runId,
    now(),
    clean(kind, 60),
    nodeId,
    JSON.stringify(detail),
  );
}

function setRunStatus(runId, from, to, extra = {}) {
  const sets = ["status = ?", "updated_at = ?"];
  const vals = [to, now()];
  if (extra.started) {
    sets.push("started_at = ?");
    vals.push(now());
  }
  if (extra.finished) {
    sets.push("finished_at = ?");
    vals.push(now());
  }
  if (extra.errorCode !== undefined) {
    sets.push("error_code = ?");
    vals.push(extra.errorCode);
  }
  const r = db
    .prepare(`UPDATE wf_runs SET ${sets.join(", ")} WHERE id = ? AND status = ?`)
    .run(...vals, runId, from);
  return r.changes === 1;
}

function setNodeStatus(nodeId, from, to, extra = {}) {
  const sets = ["status = ?", "updated_at = ?"];
  const vals = [to, now()];
  if (extra.output !== undefined) {
    sets.push("output_json = ?");
    vals.push(JSON.stringify(extra.output));
  }
  if (extra.input !== undefined) {
    sets.push("input_json = ?");
    vals.push(JSON.stringify(extra.input));
  }
  if (extra.errorCode !== undefined) {
    sets.push("error_code = ?");
    vals.push(extra.errorCode);
  }
  if (extra.approvalId !== undefined) {
    sets.push("approval_id = ?");
    vals.push(extra.approvalId);
  }
  if (extra.agentRunId !== undefined) {
    sets.push("agent_run_id = ?");
    vals.push(extra.agentRunId);
  }
  if (extra.wakeAt !== undefined) {
    sets.push("wake_at = ?");
    vals.push(extra.wakeAt);
  }
  if (extra.attempt !== undefined) {
    sets.push("attempt = ?");
    vals.push(extra.attempt);
  }
  const r = db
    .prepare(`UPDATE wf_node_executions SET ${sets.join(", ")} WHERE id = ? AND status = ?`)
    .run(...vals, nodeId, from);
  return r.changes === 1;
}

/** Interpolação determinística: strings "$node.<id>.<caminho>" → saída de nó anterior. */
function resolveValue(value, outputs) {
  if (typeof value === "string" && value.startsWith("$node.")) {
    const [, nodeId, ...path] = value.split(".");
    const nodeOut = outputs.get(nodeId);
    let cur = nodeOut;
    for (const p of path) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[p];
    }
    return cur;
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, outputs));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveValue(v, outputs)]));
  }
  return value;
}

function conditionTrue(config, outputs) {
  const left = resolveValue(config.left, outputs);
  const right = resolveValue(config.right, outputs);
  switch (config.op) {
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
    case "gt":
      return Number(left) > Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "contains":
      return String(left ?? "").includes(String(right ?? ""));
    default:
      return false; // fail-closed
  }
}

/** Cria um approval D9 real (correlation_id = run do workflow) para o nó de aprovação. */
function createWorkflowApproval(ownerId, nodeExecId, config, correlation) {
  const { default: noop } = { default: null };
  const id = uid();
  const action =
    config.action && typeof config.action === "object"
      ? config.action
      : { kind: config.kind || "approval", description: clean(config.description, 500) };
  tx(() => {
    db.prepare(
      "INSERT INTO approvals (id, command, status, created_at) VALUES (?, ?, 'pending', ?)",
    ).run(id, clean(config.description || config.command || "aprovação de workflow", 500), now());
    assignNew("approval", id, ownerId);
    db.prepare(
      "INSERT INTO approval_actions (approval_id, action, correlation_id, created_at) VALUES (?,?,?,?)",
    ).run(id, JSON.stringify({ ...action, workflow_node: nodeExecId }), correlation, now());
  });
  audit("wf.approval_requested", {
    admin: ownerId,
    approvalId: id,
    correlation,
    status: "pending",
  });
  return id;
}

async function executeNode(node, nodeExec, ctx) {
  const { run, outputs, owner } = ctx;
  const config = node.config || {};
  switch (node.type) {
    case "start":
      return { output: { started: true } };
    case "end":
      return { output: { ended: true } };
    case "tool": {
      // Política antes da ferramenta (deny/require_approval); callTool revalida can()/D9.
      const { toolPolicyVerdict } = await import("./policies.js");
      const scope = config.scope || null;
      const verdict = toolPolicyVerdict(owner, {
        tool: config.tool,
        scope,
        principal: ctx.principal,
      });
      if (verdict.decision === "deny")
        throw Object.assign(new Error(`wf_policy_denied`), { policyReason: verdict.reason });
      const input = resolveValue(config.input || {}, outputs);
      const { callTool } = await import("./tools.js");
      const effective =
        ctx.autonomy === "full" && verdict.force_approval ? "confirm" : ctx.autonomy;
      const output = await callTool(config.tool, input, {
        autonomy: effective,
        pending: ctx.pending,
        principal: ctx.principal,
        correlation: ctx.correlation,
      });
      return {
        output: {
          tool: config.tool,
          result: String(output).slice(0, 4000),
          pending: ctx.pending.length,
        },
      };
    }
    case "knowledge_search": {
      const { khSearch } = await import("./knowledge.js");
      const res = await khSearch(owner, {
        query: resolveValue(config.query, outputs),
        notebookId: config.notebook_id || null,
        libraryId: config.library_id || null,
        limit: Math.min(Number(config.limit) || 5, 10),
      });
      return {
        output: {
          results: res.items.map((i) => ({
            source_id: i.source_id,
            title: i.source_title,
            chunk: i.chunk_index,
            score: i.score,
            snippet: (i.content || i.snippet || "").slice(0, 500),
            citation: i.citation,
          })),
        },
      };
    }
    case "transform": {
      const { khTransform } = await import("./knowledge.js");
      const out = await khTransform(owner, {
        op: config.op,
        sourceIds: resolveValue(config.source_ids, outputs) || [],
        prompt: resolveValue(config.prompt, outputs) || "",
      });
      return {
        output: {
          transform_id: out.id,
          result: String(out.result).slice(0, 4000),
          citations: out.citations,
        },
      };
    }
    case "agent": {
      const { startRun } = await import("./workforce.js");
      const usage = parseJson(
        db.prepare("SELECT usage_json FROM wf_runs WHERE id = ?").get(run.id).usage_json,
        {},
      );
      if ((Number(usage.agent_runs) || 0) >= WF_BUDGET.max_agent_runs)
        throw new Error("wf_agent_budget_exhausted");
      usage.agent_runs = (Number(usage.agent_runs) || 0) + 1;
      db.prepare("UPDATE wf_runs SET usage_json = ? WHERE id = ?").run(
        JSON.stringify(usage),
        run.id,
      );
      const started = startRun({
        adminId: owner,
        definitionId: config.definition_id,
        objective: resolveValue(config.objective, outputs) || run.objective,
        principal: ctx.principal,
        agentRunner: ctx.agentRunner,
      });
      if (started.error) throw new Error(`wf_agent_start_failed:${started.error}`);
      return {
        output: { agent_run: started.run.id, status: started.run.status },
        agentRunId: started.run.id,
      };
    }
    case "subworkflow": {
      const usage = parseJson(
        db.prepare("SELECT usage_json FROM wf_runs WHERE id = ?").get(run.id).usage_json,
        {},
      );
      if ((Number(usage.agent_runs) || 0) >= WF_BUDGET.max_agent_runs)
        throw new Error("wf_agent_budget_exhausted");
      usage.agent_runs = (Number(usage.agent_runs) || 0) + 1;
      db.prepare("UPDATE wf_runs SET usage_json = ? WHERE id = ?").run(
        JSON.stringify(usage),
        run.id,
      );
      const child = await startWorkflowRun(owner, config.definition_id, {
        objective: resolveValue(config.objective, outputs) || run.objective,
        principal: ctx.principal,
        depth: (ctx.depth || 0) + 1,
        agentRunner: ctx.agentRunner,
      });
      if (child.error) throw new Error(`wf_agent_start_failed:${child.error}`);
      return {
        output: { workflow_run: child.run?.id || null, status: child.run?.status || child.error },
        agentRunId: child.run?.id || null,
      };
    }
    case "condition": {
      return { output: { result: conditionTrue(config, outputs) } };
    }
    case "approval": {
      const approvalId = createWorkflowApproval(owner, nodeExec.id, config, run.id);
      setNodeStatus(nodeExec.id, "running", "waiting_approval", { approvalId });
      emit(run.id, "approval_pending", node.id, { approvalId });
      return { waiting: true, waitingKind: "approval" };
    }
    case "wait": {
      const until = config.until
        ? new Date(config.until)
        : new Date(Date.now() + (Number(config.duration_ms) || 0));
      if (until.getTime() > Date.now()) {
        setNodeStatus(nodeExec.id, "running", "waiting_dependency", {
          wakeAt: until.toISOString(),
        });
        return { waiting: true, waitingKind: "dependency" };
      }
      return { output: { waited: true } };
    }
    default:
      throw new Error(`wf_node_type_unknown:${node.type}`);
  }
}

/** Executa uma onda de nós prontos (paralelismo limitado a MAX_PARALLEL). */
async function runReadyWave(ctx, readyNodes) {
  const results = [];
  for (let i = 0; i < readyNodes.length; i += MAX_PARALLEL) {
    const wave = readyNodes.slice(i, i + MAX_PARALLEL);
    results.push(...(await Promise.all(wave.map((n) => executeNodeWithState(ctx, n)))));
  }
  return results;
}

async function executeNodeWithState(ctx, node) {
  const { run } = ctx;
  let exec = db
    .prepare("SELECT * FROM wf_node_executions WHERE run_id = ? AND node_id = ?")
    .get(run.id, node.id);
  if (!exec) {
    db.prepare(
      "INSERT INTO wf_node_executions (id, run_id, node_id, node_type, status, created_at, updated_at) VALUES (?,?,?,?, 'pending', ?, ?)",
    ).run(uid(), run.id, node.id, node.type, now(), now());
    exec = db
      .prepare("SELECT * FROM wf_node_executions WHERE run_id = ? AND node_id = ?")
      .get(run.id, node.id);
  }
  if (["completed", "skipped"].includes(exec.status))
    return { done: true, output: exec.output ?? {} };
  if (
    !setNodeStatus(exec.id, exec.status === "pending" ? "pending" : "running", "running", {
      attempt: exec.attempt + 1,
    })
  ) {
    return { waiting: true }; // outro executor cuida (transição falhou)
  }
  emit(run.id, "node_started", node.id, { type: node.type, attempt: exec.attempt + 1 });
  try {
    const result = await executeNode(node, exec, ctx);
    if (result?.waiting) return result;
    setNodeStatus(exec.id, "running", "completed", { output: result?.output ?? {} });
    emit(run.id, "node_completed", node.id, {});
    if (result?.agentRunId)
      setNodeStatus(exec.id, "completed", "completed", { agentRunId: result.agentRunId });
    return { done: true, output: result?.output };
  } catch (e) {
    const code = e?.message || "wf_node_error";
    setNodeStatus(exec.id, "running", "failed", { errorCode: code.slice(0, 60) });
    emit(run.id, "node_failed", node.id, { error: code.slice(0, 60) });
    return { failed: true, error: code };
  }
}

/**
 * Executa um workflow run até bloquear (aprovação/wait) ou terminar. Determinístico: nós com
 * dependências completas; condition escolhe arestas por `when`; paralelismo limitado.
 */
export async function executeWorkflowRun(runId, { depth = 0, agentRunner = null } = {}) {
  if (depth > WF_BUDGET.max_depth) throw new Error("wf_depth_exceeded");
  const row = db.prepare("SELECT * FROM wf_runs WHERE id = ?").get(runId);
  if (!row) return null;
  // Retomada: queued (início), waiting_dependency (wait expirado) e running (resumido após
  // aprovação D9 resolvida pelo tick) — nós concluídos são pulados (checkpoint por nó).
  if (!["queued", "waiting_dependency", "running"].includes(row.status))
    return getWfRun(row.owner_admin_id, runId);
  if (row.status !== "running" && !setRunStatus(runId, row.status, "running", { started: true }))
    return getWfRun(row.owner_admin_id, runId);
  const version = db
    .prepare("SELECT graph FROM wf_definition_versions WHERE definition_id = ? AND version = ?")
    .get(row.definition_id, row.definition_version);
  const graph = parseJson(version?.graph, null);
  if (!graph) {
    setRunStatus(runId, "running", "failed", {
      finished: true,
      errorCode: "wf_definition_missing",
    });
    return;
  }
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges || []) adj.get(e.from)?.push(e);

  activeWfRuns.add(runId);
  try {
    const outputs = new Map();
    // Retomada: reconstrói saídas persistidas dos nós concluídos (condições dependem delas).
    for (const ne of db
      .prepare(
        "SELECT node_id, output_json FROM wf_node_executions WHERE run_id = ? AND output_json IS NOT NULL",
      )
      .all(runId)) {
      outputs.set(ne.node_id, parseJson(ne.output_json, {}));
    }
    const startedAt = Date.now();
    let nodeCount = 0;
    let current = graph.nodes.find((n) => n.type === "start")?.id;
    let lastConditionPath = null;
    while (current) {
      if (db.prepare("SELECT status FROM wf_runs WHERE id = ?").get(runId).status === "cancelled")
        break;
      if (Date.now() - startedAt > WF_BUDGET.runtime_ms) {
        setRunStatus(runId, "running", "failed", { finished: true, errorCode: "wf_timeout" });
        emit(runId, "timeout", current, {});
        return getWfRun(row.owner_admin_id, runId);
      }
      nodeCount++;
      if (nodeCount > WF_BUDGET.max_nodes) {
        setRunStatus(runId, "running", "failed", {
          finished: true,
          errorCode: "wf_node_budget_exhausted",
        });
        return getWfRun(row.owner_admin_id, runId);
      }
      const node = nodes.get(current);
      const ctx = {
        run: row,
        outputs,
        owner: row.owner_admin_id,
        depth,
        agentRunner,
        // Principal efetivo: classe "bot" criada pelo backend, com os ESCOPOS derivados das
        // allowed_tools declaradas na definição — a ferramenta real ainda passa por can()/
        // política/D9 no callTool, e nós agent recebem a interseção da Fase 1.
        principal: {
          type: "bot",
          botId: `wf:${runId}`,
          adminId: row.owner_admin_id,
          scopes: workflowScopes(getWfDefinitionInternal(row.definition_id)),
        },
        pending: [],
        correlation: runId,
      };
      const result = await executeNodeWithState(ctx, node);
      if (result?.failed) {
        // Propagação de falha: nó falho interrompe o run (nada executa depois do erro).
        setRunStatus(runId, "running", "failed", {
          finished: true,
          errorCode: String(result.error).slice(0, 60),
        });
        emit(runId, "failed", node.id, { error: String(result.error).slice(0, 60) });
        return getWfRun(row.owner_admin_id, runId);
      }
      if (result?.waiting) {
        setRunStatus(
          runId,
          "running",
          result.waitingKind === "dependency" ? "waiting_dependency" : "waiting_approval",
        );
        return getWfRun(row.owner_admin_id, runId);
      }
      const out = result?.output ?? {};
      outputs.set(node.id, out);
      const edges = adj.get(node.id) || [];
      if (node.type === "condition") {
        const path = out.result ? "true" : "false";
        lastConditionPath = path;
        const next = edges.find((e) => e.when === path);
        current = next?.to || null;
        if (!next) {
          setRunStatus(runId, "running", "completed", { finished: true });
          emit(runId, "completed", node.id, {});
          break;
        }
      } else {
        // Execução: nós agent/subworkflow em paralelo quando fan-out (limitado).
        const fanout = edges.filter((e) => !e.when || e.when === lastConditionPath);
        if (fanout.length > 1) {
          const wave = fanout.map((e) => nodes.get(e.to)).filter(Boolean);
          await runReadyWave(ctx, wave);
          current = "end";
          // Após fan-out, segue para um end (grafo em paralelo termina no primeiro end).
          const endNode = graph.nodes.find((n) => n.type === "end");
          current = endNode?.id || null;
        } else {
          current = edges[0]?.to || null;
        }
      }
      if (current && nodes.get(current)?.type === "end") {
        const endExec = await executeNodeWithState(ctx, nodes.get(current));
        outputs.set(current, endExec?.output ?? {});
        setRunStatus(runId, "running", "completed", { finished: true });
        emit(runId, "completed", current, {});
        current = null;
      }
    }
    return getWfRun(row.owner_admin_id, runId);
  } finally {
    activeWfRuns.delete(runId);
  }
}

// ---------- API de runs ----------

export async function startWorkflowRun(
  adminId,
  definitionId,
  { objective = "", idempotencyKey = null, principal, depth = 0, agentRunner = null } = {},
) {
  const def = getDefinition(adminId, definitionId);
  if (!def) return { error: "not_found" };
  if (def.status !== "published") return { error: "wf_not_published" };
  const policy = evaluatePolicies(adminId, {
    kind: "workflow",
    target: definitionId,
    admin: adminId,
  });
  if (policy.decision === "deny") {
    audit("wf.start_denied", { admin: adminId, ids: [definitionId], status: "policy_denied" });
    return { error: "wf_policy_denied" };
  }
  if (policy.decision === "require_approval") {
    // Fail-closed: início de workflow não tem caminho D9 — negação explícita (ADR-WF-002).
    audit("wf.start_denied", {
      admin: adminId,
      ids: [definitionId],
      status: "require_approval_unsupported",
    });
    return { error: "wf_require_approval_unsupported" };
  }
  const text = clean(objective, 2000);
  if (idempotencyKey) {
    const existing = db
      .prepare("SELECT * FROM wf_runs WHERE owner_admin_id = ? AND idempotency_key = ?")
      .get(adminId, clean(idempotencyKey, 200));
    if (existing) return { run: runRow(existing), deduplicated: true };
  }
  const id = uid();
  const ts = now();
  tx(() => {
    db.prepare(
      "INSERT INTO wf_runs (id, definition_id, definition_version, owner_admin_id, objective, status, budget_json, idempotency_key, created_at, updated_at) VALUES (?,?,?,?,?,'queued',?,?,?,?)",
    ).run(
      id,
      definitionId,
      def.current_version,
      adminId,
      text,
      JSON.stringify(WF_BUDGET),
      idempotencyKey ? clean(idempotencyKey, 200) : null,
      ts,
      ts,
    );
    assignNew("wf_run", id, adminId);
  });
  emit(id, "created", null, { definition: definitionId, version: def.current_version });
  audit("wf.run_created", { admin: adminId, ids: [id], correlation: id });
  const out = await executeWorkflowRun(id, { depth, agentRunner }).catch(() =>
    getWfRun(adminId, id),
  );
  return { run: out || getWfRun(adminId, id) };
}

const runRow = (r) =>
  r && { ...r, budget: parseJson(r.budget_json, {}), usage: parseJson(r.usage_json, {}) };

export function getWfRun(adminId, id) {
  if (!owns(adminId, "wf_run", id)) return null;
  const row = runRow(db.prepare("SELECT * FROM wf_runs WHERE id = ?").get(id));
  if (!row) return null;
  return {
    ...row,
    nodes: db
      .prepare("SELECT * FROM wf_node_executions WHERE run_id = ? ORDER BY created_at")
      .all(id)
      .map(nodeRow),
    events: db
      .prepare("SELECT id, at, kind, node_id, detail FROM wf_events WHERE run_id = ? ORDER BY id")
      .all(id)
      .map((e) => ({ ...e, detail: parseJson(e.detail, {}) })),
  };
}

export function listWfRuns(
  adminId,
  { limit = 50, offset = 0, status = null, definitionId = null } = {},
) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const clauses = ["owner_admin_id = ?"];
  const vals = [adminId];
  if (status && RUN_STATUSES.has(status)) {
    clauses.push("status = ?");
    vals.push(status);
  }
  if (definitionId) {
    clauses.push("definition_id = ?");
    vals.push(definitionId);
  }
  const rows = db
    .prepare(
      `SELECT * FROM wf_runs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...vals, lim + 1, Math.max(Number(offset) || 0, 0));
  return { items: rows.slice(0, lim).map(runRow), has_more: rows.length > lim };
}

/** Cancelamento cooperativo: nós pendentes são cancelados; efeito iniciado não é revertido. */
export function cancelWfRun(adminId, id) {
  if (!owns(adminId, "wf_run", id)) return { error: "not_found" };
  const row = db.prepare("SELECT * FROM wf_runs WHERE id = ?").get(id);
  if (!row) return { error: "not_found" };
  if (["completed", "failed", "cancelled"].includes(row.status))
    return { run: getWfRun(adminId, id), unchanged: true };
  if (row.status === "unknown") return { error: "wf_reconcile_required" };
  const ts = now();
  tx(() => {
    db.prepare(
      "UPDATE wf_node_executions SET status='cancelled', updated_at=? WHERE run_id=? AND status IN ('pending','running','waiting_dependency')",
    ).run(ts, id);
    db.prepare("UPDATE wf_runs SET status='cancelled', finished_at=?, updated_at=? WHERE id=?").run(
      ts,
      ts,
      id,
    );
  });
  emit(id, "cancelled", null, {});
  audit("wf.run_cancelled", { admin: adminId, ids: [id], correlation: id });
  return { run: getWfRun(adminId, id) };
}

/** Boot: runs `running` órfãos (processo morreu no meio) → `unknown`. `waiting_dependency`/
 *  `waiting_approval` são estados reais persistidos (wake_at/aprovação) e permanecem;
 *  `queued` não tem incerteza de efeito — retoma a execução. */
export function recoverWfRuns() {
  const orphans = db
    .prepare("SELECT id FROM wf_runs WHERE status = 'running'")
    .all()
    .filter((r) => !activeWfRuns.has(r.id));
  const ts = now();
  for (const o of orphans) {
    db.prepare(
      "UPDATE wf_runs SET status='unknown', error_code='interrupted', updated_at=? WHERE id=?",
    ).run(ts, o.id);
    db.prepare(
      "UPDATE wf_node_executions SET status='unknown', updated_at=? WHERE run_id=? AND status = 'running'",
    ).run(ts, o.id);
  }
  if (orphans.length)
    audit("wf.runs_interrupted", {
      count: orphans.length,
      ids: orphans.slice(0, 50).map((o) => o.id),
    });
  // Runs enfileirados: retoma (nada executou — sem risco de replay).
  const queued = db.prepare("SELECT id FROM wf_runs WHERE status = 'queued'").all();
  for (const q of queued) executeWorkflowRun(q.id).catch(() => {});
  return orphans.length;
}

/**
 * Reconciliação de `unknown` por evidência: nós com aprovação pendente → waiting_approval;
 * nós com efeito iniciado não confirmado permanecem unknown (decisão do operador decide
 * apenas estados seguros); sem efeito pendente → falha not_executed.
 */
export function reconcileWfRun(adminId, id) {
  if (!owns(adminId, "wf_run", id)) return { error: "not_found" };
  const run = db.prepare("SELECT * FROM wf_runs WHERE id = ?").get(id);
  if (!run) return { error: "not_found" };
  if (run.status !== "unknown") return { error: "wf_reconcile_not_unknown" };
  const ts = now();
  const nodes = db.prepare("SELECT * FROM wf_node_executions WHERE run_id = ?").all(id);
  let pendingApproval = null;
  for (const n of nodes) {
    if (n.status === "unknown" && n.approval_id) {
      const ap = db.prepare("SELECT status FROM approvals WHERE id = ?").get(n.approval_id);
      if (ap?.status === "pending") pendingApproval = n;
    }
  }
  if (pendingApproval) {
    db.prepare(
      "UPDATE wf_node_executions SET status='waiting_approval', updated_at=? WHERE id=?",
    ).run(ts, pendingApproval.id);
    db.prepare("UPDATE wf_runs SET status='waiting_approval', updated_at=? WHERE id=?").run(ts, id);
    emit(id, "reconciled", pendingApproval.node_id, { outcome: "awaiting_approval" });
    audit("wf.run_reconciled", { admin: adminId, ids: [id], status: "awaiting_approval" });
    return { outcome: "awaiting_approval", run: getWfRun(adminId, id) };
  }
  const ranNodes = nodes.filter((n) => n.status === "unknown");
  const executedExternal = ranNodes.some((n) => n.approval_id);
  if (!executedExternal) {
    db.prepare(
      "UPDATE wf_node_executions SET status='failed', error_code='not_executed', updated_at=? WHERE run_id=? AND status='unknown'",
    ).run(ts, id);
    db.prepare(
      "UPDATE wf_runs SET status='failed', error_code='not_executed', finished_at=?, updated_at=? WHERE id=?",
    ).run(ts, ts, id);
    emit(id, "reconciled", null, { outcome: "not_executed" });
    audit("wf.run_reconciled", { admin: adminId, ids: [id], status: "failed" });
    return { outcome: "not_executed", run: getWfRun(adminId, id) };
  }
  return { outcome: "undetermined", run: getWfRun(adminId, id) };
}

/** Tick do executor: retoma runs waiting_dependency com wake_at expirado e runs
 *  waiting_approval cuja aprovação D9 foi resolvida (approved → retoma; rejected → failed). */
export function tickWfRuns({ agentRunner = null } = {}) {
  const ts = now();
  // Aprovações resolvidas: retoma ou falha o run.
  const waiting = db
    .prepare(
      "SELECT n.id AS node_exec, n.run_id, n.approval_id, n.node_id FROM wf_node_executions n JOIN wf_runs r ON r.id = n.run_id WHERE r.status = 'waiting_approval' AND n.status = 'waiting_approval' AND n.approval_id IS NOT NULL",
    )
    .all();
  for (const w of waiting) {
    const ap = db.prepare("SELECT status FROM approvals WHERE id = ?").get(w.approval_id);
    if (!ap || ap.status === "pending") continue;
    if (ap.status === "done" || ap.status === "approved") {
      db.prepare(
        "UPDATE wf_node_executions SET status='completed', output_json=?, updated_at=? WHERE id=?",
      ).run(JSON.stringify({ approved: true }), ts, w.node_exec);
      emit(w.run_id, "approval_resolved", w.node_id, { outcome: "approved" });
      db.prepare("UPDATE wf_runs SET status='running', updated_at=? WHERE id=?").run(ts, w.run_id);
      const run = db.prepare("SELECT * FROM wf_runs WHERE id=?").get(w.run_id);
      executeWorkflowRun(run.id, { agentRunner }).catch(() => {});
    } else {
      db.prepare(
        "UPDATE wf_node_executions SET status='failed', error_code='approval_rejected', updated_at=? WHERE id=?",
      ).run(ts, w.node_exec);
      db.prepare(
        "UPDATE wf_runs SET status='failed', error_code='approval_rejected', finished_at=?, updated_at=? WHERE id=?",
      ).run(ts, ts, w.run_id);
      emit(w.run_id, "approval_resolved", w.node_id, { outcome: "rejected" });
      audit("wf.run_failed", {
        admin: runOwner(w.run_id),
        ids: [w.run_id],
        status: "approval_rejected",
      });
    }
  }
  // Waits expirados: retoma.
  const due = db
    .prepare(
      "SELECT n.run_id, n.id AS node_exec FROM wf_node_executions n JOIN wf_runs r ON r.id = n.run_id WHERE r.status = 'waiting_dependency' AND n.status = 'waiting_dependency' AND n.wake_at <= ?",
    )
    .all(ts);
  for (const d of due) {
    db.prepare(
      "UPDATE wf_node_executions SET status='completed', output_json=?, updated_at=? WHERE id=?",
    ).run(JSON.stringify({ waited: true }), ts, d.node_exec);
    db.prepare("UPDATE wf_runs SET status='running', updated_at=? WHERE id=?").run(ts, d.run_id);
    executeWorkflowRun(d.run_id, { agentRunner }).catch(() => {});
  }
  return { resumed: waiting.length + due.length };
}

const runOwner = (runId) =>
  db.prepare("SELECT owner_admin_id FROM wf_runs WHERE id = ?").get(runId)?.owner_admin_id;
