import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createWorkforceAgent,
  deleteWorkforceAgent,
  listWorkforceAgents,
  listWorkforceRuns,
  listWorkforceTemplates,
  ping,
  reconcileWorkforceRun,
  runWorkforceAgent,
  cancelWorkforceRun,
  updateWorkforceAgent,
  type WorkforceDefinition,
  type WorkforceRun,
  type WorkforceTemplate,
} from "@/lib/bridge";
import { workforceStatusBadge } from "@/lib/workforce";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/workforce")({
  head: () => ({
    meta: [
      { title: "Agent Workforce — Jarvis" },
      {
        name: "description",
        content: "Especialistas com escopo, orçamento e execuções de workforce verificáveis.",
      },
      { property: "og:title", content: "Agent Workforce — Jarvis" },
      { property: "og:description", content: "Orquestração local de agentes do Jarvis." },
    ],
  }),
  component: WorkforcePage,
});

// Conjunto fechado: as ferramentas e escopos permitidos são validados pelo servidor,
// então a UI só oferece opções conhecidas.
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

const WF_SCOPES = [
  "web",
  "web:write",
  "host:run",
  "comms:read",
  "comms:send",
  "documents:read",
  "documents:write",
  "memories:read",
  "memories:write",
  "skills:read",
  "workforce:run",
] as const;

const WF_ROLES = ["orchestrator", "specialist", "worker"] as const;

type WfForm = {
  id?: string;
  name: string;
  role: (typeof WF_ROLES)[number];
  description: string;
  instructions: string;
  permitted_tools: string[];
  permission_scopes: string[];
  max_tool_calls: number;
  max_model_calls: number;
  runtime_minutes: number;
  max_depth: number;
  max_children: number;
};

const blank: WfForm = {
  name: "",
  role: "specialist",
  description: "",
  instructions: "",
  permitted_tools: [],
  permission_scopes: [],
  max_tool_calls: 25,
  max_model_calls: 40,
  runtime_minutes: 5,
  max_depth: 3,
  max_children: 8,
};

const toForm = (d: WorkforceDefinition): WfForm => ({
  id: d.id,
  name: d.name,
  role: d.role,
  description: d.description,
  instructions: d.instructions,
  permitted_tools: [...d.permitted_tools],
  permission_scopes: [...d.permission_scopes],
  max_tool_calls: d.resource_budget.max_tool_calls,
  max_model_calls: d.resource_budget.max_model_calls,
  runtime_minutes: Math.round(d.resource_budget.runtime_ms / 60000),
  max_depth: d.resource_budget.max_depth,
  max_children: d.resource_budget.max_children,
});

const CANCELABLE = new Set(["queued", "running", "awaiting_approval"]);

export function WorkforcePage() {
  const { t } = useI18n();
  const [defs, setDefs] = useState<WorkforceDefinition[] | null>(null);
  const [runs, setRuns] = useState<WorkforceRun[] | null>(null);
  const [templates, setTemplates] = useState<WorkforceTemplate[] | null>(null);
  const [edit, setEdit] = useState<WfForm>(blank);
  const [runDefId, setRunDefId] = useState<string>("");
  const [objective, setObjective] = useState("");
  const [openRun, setOpenRun] = useState<string | null>(null);

  const statusLabels: Record<string, string> = {
    queued: t("wf_status_queued"),
    running: t("wf_status_running"),
    awaiting_approval: t("wf_status_awaiting_approval"),
    completed: t("wf_status_completed"),
    failed: t("wf_status_failed"),
    cancelled: t("wf_status_cancelled"),
    unknown: t("wf_status_unknown"),
  };

  const refreshAgents = () => listWorkforceAgents().then((d) => setDefs(d ?? []));
  const refreshRuns = () => listWorkforceRuns().then((r) => setRuns(r?.items ?? []));

  useEffect(() => {
    refreshAgents().catch(() => undefined);
    refreshRuns().catch(() => undefined);
    listWorkforceTemplates().then((tpl) => setTemplates(tpl));
  }, []);

  const gated = async () => {
    if (await ping()) return true;
    toast.info(t("demo_hint"));
    return false;
  };

  const save = async () => {
    if (!edit.name.trim()) return;
    if (!(await gated())) return;
    const body = {
      name: edit.name.trim(),
      role: edit.role,
      description: edit.description,
      instructions: edit.instructions,
      permitted_tools: edit.permitted_tools,
      permission_scopes: edit.permission_scopes,
      resource_budget: {
        max_tool_calls: edit.max_tool_calls,
        max_model_calls: edit.max_model_calls,
        runtime_ms: Math.max(0, Math.round(edit.runtime_minutes * 60000)),
        max_depth: edit.max_depth,
        max_children: edit.max_children,
      },
    };
    try {
      if (edit.id) await updateWorkforceAgent(edit.id, body);
      else await createWorkforceAgent(body);
      toast.success(t("saved"));
      setEdit(blank);
      refreshAgents();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const toggleEnabled = async (d: WorkforceDefinition) => {
    if (!(await gated())) return;
    try {
      await updateWorkforceAgent(d.id, { name: d.name, enabled: !d.enabled });
      refreshAgents();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const remove = async (d: WorkforceDefinition) => {
    if (!(await gated())) return;
    try {
      await deleteWorkforceAgent(d.id);
      toast.success(t("wf_deleted"));
      refreshAgents();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const startRun = async () => {
    if (!runDefId || !objective.trim()) return;
    if (!(await gated())) return;
    try {
      await runWorkforceAgent(runDefId, objective.trim());
      toast.success(t("wf_run_started"));
      setObjective("");
      refreshRuns();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const cancelRun = async (r: WorkforceRun) => {
    if (!(await gated())) return;
    try {
      await cancelWorkforceRun(r.id);
      toast.success(t("wf_cancelled"));
      refreshRuns();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const reconcile = async (r: WorkforceRun) => {
    if (!(await gated())) return;
    try {
      await reconcileWorkforceRun(r.id);
      toast.success(t("wf_reconciled"));
      refreshRuns();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const applyTemplate = async (tpl: WorkforceTemplate) => {
    if (!(await gated())) return;
    try {
      await createWorkforceAgent({ ...tpl, name: tpl.name });
      toast.success(t("saved"));
      refreshAgents();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const roleLabel = (role: string): string =>
    role === "orchestrator"
      ? t("wf_role_orchestrator")
      : role === "worker"
        ? t("wf_role_worker")
        : t("wf_role_specialist");

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("wf_title")} sub={t("wf_sub")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {/* Executar */}
          <section className="hud-panel space-y-2 p-4" data-testid="wf-run-panel">
            <div className="hud-label">{t("wf_run")}</div>
            <select
              className="w-full rounded-md border border-input bg-secondary p-2 text-sm"
              value={runDefId}
              onChange={(e) => setRunDefId(e.target.value)}
              aria-label={t("wf_agents")}
            >
              <option value="">—</option>
              {(defs ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <Textarea
              rows={2}
              placeholder={t("wf_objective")}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
            />
            <Button size="sm" onClick={startRun} disabled={!runDefId || !objective.trim()}>
              <Play className="h-3 w-3" />
              {t("wf_run")}
            </Button>
          </section>

          {/* Catálogo de especialistas */}
          <section>
            <div className="hud-label mb-2">{t("wf_agents")}</div>
            {defs !== null && defs.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("wf_empty")}</p>
            )}
            <div className="space-y-3">
              {(defs ?? []).map((d) => (
                <div key={d.id} className="hud-panel p-4" data-testid="wf-agent-card">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-display text-lg">{d.name}</span>
                        <Badge variant="outline">{roleLabel(d.role)}</Badge>
                        {!d.enabled && (
                          <Badge variant="secondary" className="text-muted-foreground">
                            <Pause className="mr-1 h-3 w-3" />
                            {t("wf_status_cancelled")}
                          </Badge>
                        )}
                      </div>
                      {d.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{d.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {d.permitted_tools.map((tool) => (
                          <Badge key={tool} variant="secondary" className="font-mono text-[10px]">
                            {tool}
                          </Badge>
                        ))}
                        {d.permission_scopes.map((sc) => (
                          <Badge key={sc} variant="outline" className="font-mono text-[10px]">
                            {sc}
                          </Badge>
                        ))}
                      </div>
                      <div className="hud-label mt-2">
                        {t("wf_budget")}: ≤{d.resource_budget.max_tool_calls} ·{" "}
                        {Math.round(d.resource_budget.runtime_ms / 60000)} min
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEdit(toForm(d))}>
                        <Pencil className="h-3 w-3" />
                        {t("wf_edit")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRunDefId(d.id)}>
                        <Play className="h-3 w-3" />
                        {t("wf_run")}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={d.enabled ? t("pause") : t("resume")}
                        onClick={() => toggleEnabled(d)}
                      >
                        {d.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("delete")}
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

          {/* Execuções */}
          <section>
            <div className="hud-label mb-2">{t("wf_runs")}</div>
            {runs !== null && runs.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("wf_no_runs")}</p>
            )}
            <div className="space-y-3">
              {(runs ?? []).map((r) => {
                const badge = workforceStatusBadge(r.status, r.verification, statusLabels);
                const open = openRun === r.id;
                return (
                  <div key={r.id} className="hud-panel p-4" data-testid="wf-run-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={badge.variant} className={badge.className}>
                        {badge.label}
                      </Badge>
                      {r.verification === "verified" && (
                        <Badge
                          variant="secondary"
                          className="border-emerald-500/40 bg-emerald-500/15 text-emerald-600"
                          data-testid="wf-verified"
                        >
                          <Check className="mr-1 h-3 w-3" />
                          {t("wf_verified")}
                        </Badge>
                      )}
                      {r.verification === "partial" && (
                        <Badge variant="outline">{t("wf_partial")}</Badge>
                      )}
                      {r.verification === "unverified" && (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t("wf_unverified")}
                        </Badge>
                      )}
                      <span className="flex-1 text-sm">{r.objective}</span>
                      {CANCELABLE.has(r.status) && (
                        <Button size="sm" variant="outline" onClick={() => cancelRun(r)}>
                          {t("wf_cancel")}
                        </Button>
                      )}
                      {r.status === "unknown" && (
                        <Button size="sm" variant="outline" onClick={() => reconcile(r)}>
                          {t("wf_reconcile")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpenRun(open ? null : r.id)}
                        aria-expanded={open}
                      >
                        {open ? "−" : "+"}
                      </Button>
                    </div>
                    {r.status === "unknown" && (
                      <p className="mt-2 text-xs text-destructive">{t("wf_unknown_hint")}</p>
                    )}
                    {open && (
                      <div className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
                        <div className="hud-label">
                          {t("wf_depth")}: {r.depth} · {t("wf_usage")}: {r.usage?.tool_calls ?? 0} /{" "}
                          {r.usage?.model_calls ?? 0} / {r.usage?.estimated_tokens ?? 0}
                        </div>
                        {r.children.length > 0 && (
                          <div>
                            <div className="hud-label">{t("wf_children")}</div>
                            {r.children.map((c) => (
                              <div key={c.id} className="flex items-center gap-2 py-1 text-xs">
                                <Badge variant="outline" className="font-mono text-[10px]">
                                  {c.status}
                                </Badge>
                                <span>{c.verification}</span>
                                <span className="text-muted-foreground">
                                  d{c.depth} · {c.definition ?? "—"}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                        {r.result?.limitations?.length ? (
                          <div>
                            <div className="hud-label">{t("wf_limitations")}</div>
                            <ul className="list-disc pl-5 text-xs text-muted-foreground">
                              {r.result.limitations.map((l, i) => (
                                <li key={i}>{l}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {r.result?.output ? (
                          <div>
                            <div className="hud-label">{t("wf_output")}</div>
                            <pre className="whitespace-pre-wrap rounded-md border border-border bg-secondary/50 p-2 font-mono text-xs">
                              {r.result.output}
                            </pre>
                          </div>
                        ) : null}
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

          {/* Modelos prontos */}
          {templates !== null && templates.length > 0 && (
            <section className="hud-panel p-4" data-testid="wf-templates">
              <div className="hud-label mb-2">{t("wf_templates")}</div>
              <div className="space-y-3">
                {templates.map((tpl) => (
                  <div
                    key={tpl.key}
                    className="flex items-start gap-3 border-t border-border pt-2 first:border-0 first:pt-0"
                  >
                    <div className="flex-1">
                      <div className="text-sm font-medium">{tpl.name}</div>
                      <p className="text-xs text-muted-foreground">{tpl.description}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {tpl.permission_scopes.map((sc) => (
                          <Badge key={sc} variant="outline" className="font-mono text-[10px]">
                            {sc}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => applyTemplate(tpl)}>
                      {t("wf_use_template")}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Formulário lateral */}
        <aside className="hud-panel space-y-3 self-start p-4" data-testid="wf-form">
          <div className="hud-label">{edit.id ? t("wf_edit") : t("wf_new_agent")}</div>
          <Input
            placeholder={t("name")}
            value={edit.name}
            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          />
          <label className="hud-label block">{t("wf_role")}</label>
          <select
            className="w-full rounded-md border border-input bg-secondary p-2 text-sm"
            value={edit.role}
            onChange={(e) => setEdit({ ...edit, role: e.target.value as WfForm["role"] })}
          >
            {WF_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
          <Input
            placeholder={t("goal")}
            value={edit.description}
            onChange={(e) => setEdit({ ...edit, description: e.target.value })}
          />
          <Textarea
            rows={4}
            placeholder={t("wf_instructions")}
            value={edit.instructions}
            onChange={(e) => setEdit({ ...edit, instructions: e.target.value })}
          />
          <label className="hud-label block">{t("wf_tools")}</label>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {WF_TOOLS.map((tool) => {
              const on = edit.permitted_tools.includes(tool);
              return (
                <label key={tool} className="flex items-center gap-2 font-mono">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setEdit({
                        ...edit,
                        permitted_tools: on
                          ? edit.permitted_tools.filter((x) => x !== tool)
                          : [...edit.permitted_tools, tool],
                      })
                    }
                  />
                  {tool}
                </label>
              );
            })}
          </div>
          <label className="hud-label block">{t("wf_scopes")}</label>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {WF_SCOPES.map((sc) => {
              const on = edit.permission_scopes.includes(sc);
              return (
                <label key={sc} className="flex items-center gap-2 font-mono">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setEdit({
                        ...edit,
                        permission_scopes: on
                          ? edit.permission_scopes.filter((x) => x !== sc)
                          : [...edit.permission_scopes, sc],
                      })
                    }
                  />
                  {sc}
                </label>
              );
            })}
          </div>
          <label className="hud-label block">{t("wf_budget")}</label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              {t("wf_budget_tools")}
              <Input
                type="number"
                min={1}
                value={edit.max_tool_calls}
                onChange={(e) => setEdit({ ...edit, max_tool_calls: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs">
              {t("wf_budget_model")}
              <Input
                type="number"
                min={1}
                value={edit.max_model_calls}
                onChange={(e) => setEdit({ ...edit, max_model_calls: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs">
              {t("wf_runtime_minutes")}
              <Input
                type="number"
                min={1}
                value={edit.runtime_minutes}
                onChange={(e) => setEdit({ ...edit, runtime_minutes: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs">
              {t("wf_budget_depth")}
              <Input
                type="number"
                min={1}
                max={5}
                value={edit.max_depth}
                onChange={(e) => setEdit({ ...edit, max_depth: Number(e.target.value) })}
              />
            </label>
            <label className="text-xs">
              {t("wf_budget_children")}
              <Input
                type="number"
                min={0}
                value={edit.max_children}
                onChange={(e) => setEdit({ ...edit, max_children: Number(e.target.value) })}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">{t("wf_create_hint")}</p>
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
