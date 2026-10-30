import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Pencil, Play, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelWorkflowRun,
  createWorkflow,
  deleteWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  listWorkflowVersions,
  listWorkflows,
  ping,
  publishWorkflow,
  reconcileWorkflowRun,
  runWorkflow,
  updateWorkflow,
  type WfDefinition,
  type WfGraph,
  type WfGraphEdge,
  type WfNodeExecution,
  type WfNodeType,
  type WfRun,
  type WfRunSummary,
} from "@/lib/bridge";
import { describeNode, wfRunStatusBadge } from "@/lib/workflow-ui";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/workflows")({
  head: () => ({
    meta: [
      { title: "Workflow Studio — Jarvis" },
      {
        name: "description",
        content:
          "Workflows duráveis com grafo versionado, execuções persistentes e reconciliação verificável.",
      },
      { property: "og:title", content: "Workflow Studio — Jarvis" },
      {
        property: "og:description",
        content:
          "Studio de workflows: grafo por lista, publicação imutável e execuções auditáveis.",
      },
    ],
  }),
  component: WorkflowsPage,
});

// Conjunto fechado: mesmas ferramentas do Workforce — o servidor valida e deriva os escopos.
const WF_TOOLS = [
  "web_search",
  "fetch_url",
  "document_search",
  "remember",
  "recall",
  "run_command",
  "cli_agent",
  "send_email",
  "read_email",
  "read_calendar",
  "delegate_agent",
  "load_skill",
] as const;

const NODE_TYPES: WfNodeType[] = [
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
];
const NODES_WITH_CONFIG = new Set<WfNodeType>([
  "agent",
  "tool",
  "condition",
  "transform",
  "knowledge_search",
  "approval",
  "wait",
  "subworkflow",
]);
const CONDITION_OPS = ["eq", "ne", "gt", "lt", "contains"] as const;
const TRANSFORM_OPS = ["summary", "topics", "concepts", "compare", "synthesize"] as const;
const TERMINAL_RUN = new Set(["completed", "failed", "cancelled"]);

type NodeDraft = { id: string; type: WfNodeType; config: Record<string, string> };
type EdgeDraft = { from: string; to: string; when: "" | "true" | "false" };
type GraphForm = {
  id?: string;
  name: string;
  description: string;
  allowed_tools: string[];
  nodes: NodeDraft[];
  edges: EdgeDraft[];
};

const blank: GraphForm = {
  name: "",
  description: "",
  allowed_tools: [],
  nodes: [
    { id: "start", type: "start", config: {} },
    { id: "end", type: "end", config: {} },
  ],
  edges: [{ from: "start", to: "end", when: "" }],
};

/** Valor do servidor → string de input (objetos viram JSON; null/undefined viram vazio). */
const str = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};

const toDrafts = (graph: WfGraph | null): { nodes: NodeDraft[]; edges: EdgeDraft[] } => ({
  nodes: (graph?.nodes ?? []).map((n) => ({
    id: n.id,
    type: n.type as WfNodeType,
    config: Object.fromEntries(Object.entries(n.config ?? {}).map(([k, v]) => [k, str(v)])),
  })),
  edges: (graph?.edges ?? []).map((e) => ({
    from: e.from,
    to: e.to,
    when: e.when === "true" || e.when === "false" ? e.when : "",
  })),
});

type BuildResult = { graph: WfGraph } | { error: string };

/** Converte o formulário (strings) de volta no grafo tipado que o servidor valida. */
const buildGraph = (f: GraphForm): BuildResult => {
  let badInput = false;
  const nodes: WfGraph["nodes"] = [];
  for (const n of f.nodes) {
    const c = n.config;
    const config: Record<string, unknown> = {};
    switch (n.type) {
      case "agent":
      case "subworkflow":
        if (c["definition_id"]) config["definition_id"] = c["definition_id"];
        if (c["objective"]) config["objective"] = c["objective"];
        break;
      case "tool": {
        if (c["tool"]) config["tool"] = c["tool"];
        if (c["input"]) {
          try {
            config["input"] = JSON.parse(c["input"]);
          } catch {
            badInput = true; // JSON inválido: aborta antes de bater no servidor
          }
        }
        break;
      }
      case "condition":
        if (c["left"]) config["left"] = c["left"];
        if (c["op"]) config["op"] = c["op"];
        if (c["right"]) config["right"] = c["right"];
        break;
      case "transform":
        if (c["op"]) config["op"] = c["op"];
        config["source_ids"] = c["source_ids"]
          ? c["source_ids"]
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
        if (c["prompt"]) config["prompt"] = c["prompt"];
        break;
      case "knowledge_search":
        if (c["query"]) config["query"] = c["query"];
        if (c["notebook_id"]) config["notebook_id"] = c["notebook_id"];
        if (c["library_id"]) config["library_id"] = c["library_id"];
        if (c["limit"]) config["limit"] = Number(c["limit"]) || undefined;
        break;
      case "approval":
        if (c["description"]) config["description"] = c["description"];
        break;
      case "wait":
        if (c["duration_ms"]) config["duration_ms"] = Number(c["duration_ms"]) || undefined;
        if (c["until"]) config["until"] = c["until"];
        break;
      default:
        break;
    }
    nodes.push({
      id: n.id,
      type: n.type,
      ...(Object.keys(config).length ? { config } : {}),
    });
  }
  if (badInput) return { error: "json" };
  const isCondition = new Set(f.nodes.filter((n) => n.type === "condition").map((n) => n.id));
  const edges: WfGraphEdge[] = f.edges
    .filter((e) => e.from && e.to && e.from !== e.to)
    .map((e) =>
      isCondition.has(e.from) && (e.when === "true" || e.when === "false")
        ? { from: e.from, to: e.to, when: e.when }
        : { from: e.from, to: e.to },
    );
  return { graph: { nodes, edges } };
};

export function WorkflowsPage() {
  const { t } = useI18n();
  const [defs, setDefs] = useState<WfDefinition[] | null>(null);
  const [runs, setRuns] = useState<WfRunSummary[] | null>(null);
  const [edit, setEdit] = useState<GraphForm>(blank);
  const [runDefId, setRunDefId] = useState("");
  const [objective, setObjective] = useState("");
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<Record<string, WfRun>>({});

  const nodeTypeLabel = (type: string): string => t(`wf3_nt_${type}` as Parameters<typeof t>[0]);
  const runStatusLabels: Record<string, string> = {
    queued: t("wf3_rs_queued"),
    running: t("wf3_rs_running"),
    waiting_approval: t("wf3_rs_waiting_approval"),
    waiting_dependency: t("wf3_rs_waiting_dependency"),
    completed: t("wf3_rs_completed"),
    failed: t("wf3_rs_failed"),
    cancelled: t("wf3_rs_cancelled"),
    unknown: t("wf3_rs_unknown"),
  };

  const refreshDefs = () => listWorkflows().then((d) => setDefs(d ?? []));
  const refreshRuns = () => listWorkflowRuns({ limit: 50 }).then((r) => setRuns(r?.items ?? []));

  useEffect(() => {
    refreshDefs().catch(() => undefined);
    refreshRuns().catch(() => undefined);
  }, []);

  const gated = async () => {
    if (await ping()) return true;
    toast.info(t("demo_hint"));
    return false;
  };

  const save = async () => {
    if (!edit.name.trim()) return;
    const ids = edit.nodes.map((n) => n.id.trim());
    if (ids.some((id) => !id)) {
      toast.error(t("wf3_graph_invalid"));
      return;
    }
    if (new Set(ids).size !== ids.length) {
      toast.error(t("wf3_graph_invalid"));
      return;
    }
    const built = buildGraph(edit);
    if ("error" in built) {
      toast.error(t("wf3_graph_invalid"));
      return;
    }
    if (!(await gated())) return;
    const body = {
      name: edit.name.trim(),
      description: edit.description,
      allowed_tools: edit.allowed_tools,
      graph: built.graph,
    };
    try {
      // Um grafo novo via PUT cria uma nova versão de trabalho (publicadas ficam imutáveis).
      if (edit.id) await updateWorkflow(edit.id, body);
      else await createWorkflow(body);
      toast.success(t("saved"));
      setEdit(blank);
      refreshDefs();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const startEdit = (d: WfDefinition) => {
    listWorkflowVersions(d.id)
      .then((versions) => {
        const current =
          versions?.find((v) => v.version === d.current_version) ??
          versions?.[versions.length - 1] ??
          null;
        const drafts = toDrafts(current?.graph ?? null);
        setEdit({
          id: d.id,
          name: d.name,
          description: d.description ?? "",
          allowed_tools: [...d.allowed_tools],
          ...drafts,
        });
      })
      .catch(() => undefined);
  };

  const publish = async (d: WfDefinition) => {
    if (!(await gated())) return;
    try {
      await publishWorkflow(d.id);
      toast.success(t("wf3_published_toast"));
      refreshDefs();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const remove = async (d: WfDefinition) => {
    if (!(await gated())) return;
    try {
      await deleteWorkflow(d.id);
      toast.success(t("wf3_deleted"));
      refreshDefs();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const startRun = async () => {
    if (!runDefId || !objective.trim()) return;
    if (!(await gated())) return;
    try {
      const out = await runWorkflow(runDefId, objective.trim());
      if (out?.deduplicated) toast.info(t("wf3_run_started"));
      else toast.success(t("wf3_run_started"));
      setObjective("");
      refreshRuns();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const toggleRun = (id: string) => {
    const open = openRun === id;
    setOpenRun(open ? null : id);
    if (!open && !runDetail[id]) {
      getWorkflowRun(id)
        .then((r) => r && setRunDetail((m) => ({ ...m, [id]: r })))
        .catch(() => undefined);
    }
  };

  const dropDetail = (id: string) =>
    setRunDetail((m) => {
      const copy = { ...m };
      delete copy[id];
      return copy;
    });

  const cancelRun = async (r: WfRunSummary) => {
    if (!(await gated())) return;
    try {
      await cancelWorkflowRun(r.id);
      toast.success(t("wf3_cancelled"));
      dropDetail(r.id);
      refreshRuns();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const reconcileRun = async (r: WfRunSummary) => {
    if (!(await gated())) return;
    try {
      await reconcileWorkflowRun(r.id);
      toast.success(t("wf3_reconciled"));
      dropDetail(r.id);
      refreshRuns();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const setNode = (idx: number, patch: Partial<NodeDraft>) =>
    setEdit({
      ...edit,
      nodes: edit.nodes.map((n, i) => (i === idx ? { ...n, ...patch } : n)),
    });
  const setNodeCfg = (idx: number, key: string, value: string) =>
    setEdit({
      ...edit,
      nodes: edit.nodes.map((n, i) =>
        i === idx ? { ...n, config: { ...n.config, [key]: value } } : n,
      ),
    });
  const setEdge = (idx: number, patch: Partial<EdgeDraft>) =>
    setEdit({
      ...edit,
      edges: edit.edges.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    });

  const addNode = () => {
    const id = `n${edit.nodes.length + 1}`;
    setEdit({
      ...edit,
      nodes: [...edit.nodes, { id, type: "tool", config: {} }],
    });
  };

  /** Config específica por tipo de nó — só os campos que o servidor interpreta. */
  const nodeConfigFields = (idx: number, n: NodeDraft) => {
    switch (n.type) {
      case "agent":
      case "subworkflow":
        return (
          <>
            <Input
              placeholder={t("wf3_cfg_definition")}
              value={n.config["definition_id"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "definition_id", e.target.value)}
            />
            <Input
              placeholder={t("wf3_cfg_objective")}
              value={n.config["objective"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "objective", e.target.value)}
            />
          </>
        );
      case "tool":
        return (
          <>
            <select
              className="w-full rounded-md border border-input bg-secondary p-2 text-sm"
              value={n.config["tool"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "tool", e.target.value)}
              aria-label={t("wf3_cfg_tool")}
            >
              <option value="">—</option>
              {WF_TOOLS.map((tool) => (
                <option key={tool} value={tool}>
                  {tool}
                </option>
              ))}
            </select>
            <Textarea
              rows={2}
              placeholder={t("wf3_cfg_input")}
              value={n.config["input"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "input", e.target.value)}
            />
          </>
        );
      case "condition":
        return (
          <>
            <Input
              placeholder={t("wf3_cfg_left")}
              value={n.config["left"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "left", e.target.value)}
            />
            <select
              className="w-full rounded-md border border-input bg-secondary p-2 text-sm"
              value={n.config["op"] ?? "eq"}
              onChange={(e) => setNodeCfg(idx, "op", e.target.value)}
              aria-label={t("wf3_cfg_left")}
            >
              {CONDITION_OPS.map((op) => (
                <option key={op} value={op}>
                  {t(`wf3_op_${op}` as Parameters<typeof t>[0])}
                </option>
              ))}
            </select>
            <Input
              placeholder={t("wf3_cfg_right")}
              value={n.config["right"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "right", e.target.value)}
            />
          </>
        );
      case "transform":
        return (
          <>
            <select
              className="w-full rounded-md border border-input bg-secondary p-2 text-sm"
              value={n.config["op"] ?? "summary"}
              onChange={(e) => setNodeCfg(idx, "op", e.target.value)}
              aria-label={t("wf3_node_type")}
            >
              {TRANSFORM_OPS.map((op) => (
                <option key={op} value={op}>
                  {t(`kh_op_${op}` as Parameters<typeof t>[0])}
                </option>
              ))}
            </select>
            <Input
              placeholder={t("wf3_cfg_source_ids")}
              value={n.config["source_ids"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "source_ids", e.target.value)}
            />
            <Input
              placeholder={t("wf3_cfg_prompt")}
              value={n.config["prompt"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "prompt", e.target.value)}
            />
          </>
        );
      case "knowledge_search":
        return (
          <>
            <Input
              placeholder={t("wf3_cfg_query")}
              value={n.config["query"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "query", e.target.value)}
            />
            <Input
              placeholder={t("wf3_cfg_notebook")}
              value={n.config["notebook_id"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "notebook_id", e.target.value)}
            />
            <Input
              placeholder={t("wf3_cfg_library")}
              value={n.config["library_id"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "library_id", e.target.value)}
            />
            <Input
              type="number"
              min={1}
              max={10}
              placeholder={t("wf3_cfg_limit")}
              value={n.config["limit"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "limit", e.target.value)}
            />
          </>
        );
      case "approval":
        return (
          <Input
            placeholder={t("wf3_cfg_description")}
            value={n.config["description"] ?? ""}
            onChange={(e) => setNodeCfg(idx, "description", e.target.value)}
          />
        );
      case "wait":
        return (
          <>
            <Input
              type="number"
              min={0}
              placeholder={t("wf3_cfg_duration")}
              value={n.config["duration_ms"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "duration_ms", e.target.value)}
            />
            <Input
              placeholder={t("wf3_cfg_until")}
              value={n.config["until"] ?? ""}
              onChange={(e) => setNodeCfg(idx, "until", e.target.value)}
            />
          </>
        );
      default:
        return null;
    }
  };

  const publishedDefs = (defs ?? []).filter((d) => d.status === "published");

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("wf3_title")} sub={t("wf3_sub")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {/* Executar workflow publicado */}
          <section className="hud-panel space-y-2 p-4" data-testid="wf3-run-panel">
            <div className="hud-label">{t("wf3_run_title")}</div>
            <select
              className="w-full rounded-md border border-input bg-secondary p-2 text-sm"
              value={runDefId}
              onChange={(e) => setRunDefId(e.target.value)}
              aria-label={t("wf3_select_workflow")}
            >
              <option value="">—</option>
              {publishedDefs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} (v{d.current_version})
                </option>
              ))}
            </select>
            <Textarea
              rows={2}
              placeholder={t("wf3_objective")}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
            <Button size="sm" onClick={startRun} disabled={!runDefId || !objective.trim()}>
              <Play className="h-3 w-3" />
              {t("wf3_run")}
            </Button>
          </section>

          {/* Catálogo de workflows */}
          <section>
            <div className="hud-label mb-2">{t("wf3_definitions")}</div>
            {defs !== null && defs.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("wf3_empty")}</p>
            )}
            <div className="space-y-3">
              {(defs ?? []).map((d) => (
                <div key={d.id} className="hud-panel p-4" data-testid="wf3-def-card">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-lg">{d.name}</span>
                        {d.status === "published" ? (
                          <Badge
                            variant="secondary"
                            className="border-emerald-500/40 bg-emerald-500/15 text-emerald-600"
                          >
                            {t("wf3_status_published")}
                          </Badge>
                        ) : (
                          <Badge variant="outline">{t("wf3_status_draft")}</Badge>
                        )}
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {t("wf3_version")} {d.current_version}
                        </Badge>
                      </div>
                      {d.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{d.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {d.allowed_tools.map((tool) => (
                          <Badge key={tool} variant="secondary" className="font-mono text-[10px]">
                            {tool}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button size="sm" variant="outline" onClick={() => startEdit(d)}>
                        <Pencil className="h-3 w-3" />
                        {t("wf3_edit")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => publish(d)}>
                        <Upload className="h-3 w-3" />
                        {t("wf3_publish")}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("wf3_delete")}
                        onClick={() => remove(d)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Histórico de execuções */}
          <section>
            <div className="hud-label mb-2">{t("wf3_runs")}</div>
            {runs !== null && runs.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("wf3_no_runs")}</p>
            )}
            <div className="space-y-3">
              {(runs ?? []).map((r) => {
                const badge = wfRunStatusBadge(r.status, runStatusLabels);
                const open = openRun === r.id;
                const detail = runDetail[r.id];
                return (
                  <div key={r.id} className="hud-panel p-4" data-testid="wf3-run-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={badge.variant} className={badge.className}>
                        {badge.label}
                      </Badge>
                      <span className="flex-1 text-sm">{r.objective}</span>
                      {!TERMINAL_RUN.has(r.status) && r.status !== "unknown" && (
                        <Button size="sm" variant="outline" onClick={() => cancelRun(r)}>
                          {t("wf3_cancel")}
                        </Button>
                      )}
                      {r.status === "unknown" && (
                        <Button size="sm" variant="outline" onClick={() => reconcileRun(r)}>
                          {t("wf3_reconcile")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleRun(r.id)}
                        aria-expanded={open}
                      >
                        {open ? "−" : "+"}
                      </Button>
                    </div>
                    <div className="hud-label mt-2 text-xs">
                      {t("wf3_version")} {r.definition_version} · {t("wf3_usage")}:{" "}
                      {r.usage?.["tool_calls"] ?? 0} / {r.usage?.["model_calls"] ?? 0} /{" "}
                      {r.usage?.["estimated_tokens"] ?? 0}
                    </div>
                    {r.status === "unknown" && (
                      <p className="mt-2 text-xs text-destructive">{t("wf_unknown_hint")}</p>
                    )}
                    {open && (
                      <div className="mt-3 space-y-3 border-t border-border pt-3 text-sm">
                        <div>
                          <div className="hud-label">{t("wf3_run_nodes")}</div>
                          {(detail?.nodes ?? []).length === 0 && (
                            <p className="text-xs text-muted-foreground">{t("loading")}</p>
                          )}
                          <div className="space-y-1">
                            {(detail?.nodes ?? []).map((n: WfNodeExecution) => {
                              const nb = wfRunStatusBadge(n.status, runStatusLabels);
                              return (
                                <div
                                  key={n.id}
                                  className="flex flex-wrap items-center gap-2 py-1 text-xs"
                                >
                                  <Badge variant={nb.variant} className={nb.className}>
                                    {nb.label}
                                  </Badge>
                                  <span className="font-mono">{n.node_id}</span>
                                  <Badge variant="outline" className="font-mono text-[10px]">
                                    {nodeTypeLabel(n.node_type)}
                                  </Badge>
                                  <span className="text-muted-foreground">
                                    {t("wf3_attempt")} {n.attempt}
                                  </span>
                                  {n.approval_id && (
                                    <span className="font-mono text-[10px]">
                                      {t("wf3_approval")}: {n.approval_id}
                                    </span>
                                  )}
                                  {n.agent_run_id && (
                                    <span className="font-mono text-[10px]">
                                      {t("wf3_agent_run")}: {n.agent_run_id}
                                    </span>
                                  )}
                                  {n.wake_at && (
                                    <span className="font-mono text-[10px]">
                                      {t("wf3_wake_at")}: {n.wake_at}
                                    </span>
                                  )}
                                  {n.error_code && (
                                    <span className="font-mono text-[10px] text-destructive">
                                      {n.error_code}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <div>
                          <div className="hud-label">{t("wf3_events")}</div>
                          <ul className="space-y-1 text-xs text-muted-foreground">
                            {(detail?.events ?? []).map((ev) => (
                              <li key={ev.id} className="font-mono">
                                {ev.at} · {ev.kind}
                                {ev.node_id ? ` · ${ev.node_id}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                        {r.error_code && (
                          <p className="font-mono text-xs text-destructive">{r.error_code}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Editor estruturado do grafo (lista — sem canvas visual) */}
        <aside className="hud-panel space-y-3 self-start p-4" data-testid="wf3-form">
          <div className="hud-label">{edit.id ? t("wf3_edit") : t("wf3_new")}</div>
          <Input
            placeholder={t("wf3_name")}
            value={edit.name}
            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          />
          <Input
            placeholder={t("wf3_description")}
            value={edit.description}
            onChange={(e) => setEdit({ ...edit, description: e.target.value })}
          />
          <label className="hud-label block">{t("wf3_allowed_tools")}</label>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {WF_TOOLS.map((tool) => {
              const on = edit.allowed_tools.includes(tool);
              return (
                <label key={tool} className="flex items-center gap-2 font-mono">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setEdit({
                        ...edit,
                        allowed_tools: on
                          ? edit.allowed_tools.filter((x) => x !== tool)
                          : [...edit.allowed_tools, tool],
                      })
                    }
                  />
                  {tool}
                </label>
              );
            })}
          </div>

          <div className="hud-label">{t("wf3_nodes")}</div>
          {edit.nodes.map((n, idx) => (
            <div key={idx} className="space-y-2 rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <Input
                  className="w-28 font-mono text-xs"
                  placeholder={t("wf3_node_id")}
                  value={n.id}
                  onChange={(e) => setNode(idx, { id: e.target.value })}
                />
                <select
                  className="flex-1 rounded-md border border-input bg-secondary p-2 text-sm"
                  value={n.type}
                  onChange={(e) => setNode(idx, { type: e.target.value as WfNodeType })}
                  aria-label={t("wf3_node_type")}
                >
                  {NODE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {nodeTypeLabel(type)}
                    </option>
                  ))}
                </select>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("wf3_remove")}
                  onClick={() =>
                    setEdit({ ...edit, nodes: edit.nodes.filter((_, i) => i !== idx) })
                  }
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">{describeNode(n.type, {})}</p>
              {NODES_WITH_CONFIG.has(n.type) && (
                <div className="grid gap-1">{nodeConfigFields(idx, n)}</div>
              )}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={addNode}>
            <Plus className="h-3 w-3" />
            {t("wf3_add_node")}
          </Button>

          <div className="hud-label">{t("wf3_edges")}</div>
          {edit.edges.map((e, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <select
                className="w-24 rounded-md border border-input bg-secondary p-1 text-xs"
                value={e.from}
                onChange={(ev) => setEdge(idx, { from: ev.target.value })}
                aria-label={t("wf3_from")}
              >
                <option value="">—</option>
                {edit.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">→</span>
              <select
                className="w-24 rounded-md border border-input bg-secondary p-1 text-xs"
                value={e.to}
                onChange={(ev) => setEdge(idx, { to: ev.target.value })}
                aria-label={t("wf3_to")}
              >
                <option value="">—</option>
                {edit.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </select>
              {edit.nodes.find((n) => n.id === e.from)?.type === "condition" && (
                <select
                  className="w-20 rounded-md border border-input bg-secondary p-1 text-xs"
                  value={e.when}
                  onChange={(ev) => setEdge(idx, { when: ev.target.value as EdgeDraft["when"] })}
                  aria-label={t("wf3_when")}
                >
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("wf3_remove")}
                onClick={() => setEdit({ ...edit, edges: edit.edges.filter((_, i) => i !== idx) })}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          {edit.nodes.length >= 1 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setEdit({ ...edit, edges: [...edit.edges, { from: "", to: "", when: "" }] })
              }
            >
              <Plus className="h-3 w-3" />
              {t("wf3_add_edge")}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t("wf3_graph_hint")}</p>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={save}>
              {t("save")}
            </Button>
            <Button variant="outline" onClick={() => setEdit(blank)}>
              {t("cancel")}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
