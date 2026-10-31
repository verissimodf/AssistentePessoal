import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  Check,
  Clock,
  GitBranch,
  Play,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  acceptPrOpportunity,
  activatePrRule,
  createPrRule,
  disablePrRule,
  dismissPrNotification,
  dismissPrOpportunity,
  getPrControls,
  getPrMetrics,
  getPrOpportunityTrail,
  listPrEvents,
  listPrNotifications,
  listPrOpportunities,
  listPrRules,
  listWorkflows,
  markPrNotificationRead,
  pausePrRule,
  ping,
  resumePrRule,
  runPrRule,
  savePrControls,
  snoozePrOpportunity,
  testPrRule,
  updatePrRule,
  type PrControls,
  type PrEvent,
  type PrMetrics,
  type PrNotification,
  type PrOpportunity,
  type PrRule,
  type WfDefinition,
} from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";
import { wfRunStatusBadge } from "@/lib/workflow-ui";
import {
  DEFAULT_PR_TRIGGER_FORM,
  PR_CONDITION_OPS,
  PR_EVENT_SOURCES,
  prConditionTreeFromLeaves,
  prLevelInfo,
  prOpportunityStatusBadge,
  prRuleBodyFromForm,
  prRuleStatusBadge,
  prTriggerSummary,
  validatePrConditionLeaf,
  validatePrTriggerForm,
  type PrConditionFormLeaf,
  type PrTriggerForm,
} from "@/lib/proactive-ui";

export const Route = createFileRoute("/proactive")({
  head: () => ({
    meta: [
      { title: "Proactive Studio — Jarvis" },
      {
        name: "description",
        content:
          "Regras proativas, oportunidades com justificativa e evidências, trilhas de execução e controles de autonomia — o Policy Engine e a aprovação humana (D9) sempre prevalecem.",
      },
      { property: "og:title", content: "Proactive Studio — Jarvis" },
      {
        property: "og:description",
        content:
          "Proatividade observável: dry-run sem efeitos, correlação oportunidade→run→aprovações e níveis de autonomia nunca sobre o Policy Engine.",
      },
    ],
  }),
  component: ProactivePage,
});

/** Campo numérico de formulário: "" → null (opcional). */
const numOrNull = (v: string): number | null => {
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};

/** Folha de condição vazia para o editor. */
const emptyLeaf = (): PrConditionFormLeaf => ({ op: "eq", fact: "", value: "" });

const selectCls = "w-full rounded-md border border-input bg-secondary p-2 text-sm";

export function ProactivePage() {
  const { t } = useI18n();
  const [tab, setTab] = useState("dashboard");

  // dados carregados do serviço local (null = carregando/indisponível)
  const [metrics, setMetrics] = useState<PrMetrics | null>(null);
  const [notifications, setNotifications] = useState<PrNotification[] | null>(null);
  const [rules, setRules] = useState<PrRule[] | null>(null);
  const [workflows, setWorkflows] = useState<WfDefinition[] | null>(null);
  const [opportunities, setOpportunities] = useState<PrOpportunity[] | null>(null);
  const [oppFilter, setOppFilter] = useState<"pending" | "all">("pending");
  const [trails, setTrails] = useState<
    Record<string, Awaited<ReturnType<typeof getPrOpportunityTrail>>>
  >({});
  const [events, setEvents] = useState<PrEvent[] | null>(null);
  const [controls, setControls] = useState<PrControls | null>(null);
  const [busy, setBusy] = useState(false);

  // formulário de regra
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerForm, setTriggerForm] = useState<PrTriggerForm>(DEFAULT_PR_TRIGGER_FORM);
  const [mode, setMode] = useState<"all" | "any">("all");
  const [leaves, setLeaves] = useState<PrConditionFormLeaf[]>([emptyLeaf()]);
  const [workflowId, setWorkflowId] = useState("");
  const [execution, setExecution] = useState<"manual" | "auto">("manual");
  const [maxExecutions, setMaxExecutions] = useState("");
  const [cooldownMs, setCooldownMs] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // dry-run por regra
  const [testFor, setTestFor] = useState<string | null>(null);
  const [testFacts, setTestFacts] = useState("{}");
  const [testResult, setTestResult] = useState<Awaited<ReturnType<typeof testPrRule>>>(null);
  const [dismissReasons, setDismissReasons] = useState<Record<string, string>>({});

  // controles (locais sobre os carregados)
  const [ctrlLevel, setCtrlLevel] = useState(1);
  const [ctrlPaused, setCtrlPaused] = useState(false);
  const [ctrlMaxHour, setCtrlMaxHour] = useState("2");
  const [ctrlCooldown, setCtrlCooldown] = useState("600000");
  const [ctrlMaxPending, setCtrlMaxPending] = useState("10");
  const [ctrlLoaded, setCtrlLoaded] = useState(false);

  const refreshAll = () => {
    getPrMetrics()
      .then((m) => setMetrics(m))
      .catch(() => undefined);
    listPrNotifications()
      .then((n) => setNotifications(n ?? []))
      .catch(() => undefined);
    listPrRules()
      .then((r) => setRules(r ?? []))
      .catch(() => undefined);
    listWorkflows()
      .then((w) => setWorkflows(w ?? []))
      .catch(() => undefined);
    listPrOpportunities(undefined, 200)
      .then((o) => setOpportunities(o ?? []))
      .catch(() => undefined);
    listPrEvents(50)
      .then((e) => setEvents(e ?? []))
      .catch(() => undefined);
    getPrControls()
      .then((c) => {
        if (c) {
          setControls(c);
          setCtrlLevel(c.level);
          setCtrlPaused(c.paused);
          setCtrlMaxHour(String(c.maxExecutionsPerHour));
          setCtrlCooldown(String(c.cooldownMs));
          setCtrlMaxPending(String(c.maxPendingOpportunities));
        }
        setCtrlLoaded(true);
      })
      .catch(() => setCtrlLoaded(true));
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const gated = async () => {
    if (await ping()) return true;
    toast.info(t("demo_hint"));
    return false;
  };

  const fail = (e: unknown) =>
    toast.error(`${t("pr_action_fail")} — ${String((e as Error).message)}`);

  // Rótulos i18n para os helpers puros (badges e resumo de gatilho)
  const ruleLabels: Record<string, string> = {
    draft: t("pr_rule_draft"),
    active: t("pr_rule_active"),
    paused: t("pr_rule_paused"),
    disabled: t("pr_rule_disabled"),
    expired: t("pr_rule_expired"),
    failed: t("pr_rule_failed"),
  };
  const oppLabels: Record<string, string> = {
    detected: t("pr_opp_detected"),
    evaluating: t("pr_opp_evaluating"),
    recommended: t("pr_opp_recommended"),
    dismissed: t("pr_opp_dismissed"),
    snoozed: t("pr_opp_snoozed"),
    accepted: t("pr_opp_accepted"),
    executing: t("pr_opp_executing"),
    completed: t("pr_opp_completed"),
    failed: t("pr_opp_failed"),
    expired: t("pr_opp_expired"),
  };
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
  const summaryLabels = {
    event: t("pr_trigger_event"),
    temporal: t("pr_trigger_temporal"),
    daily: t("pr_temporal_daily"),
    weekly: t("pr_temporal_weekly"),
    interval: t("pr_temporal_interval"),
    date: t("pr_temporal_date"),
    contextual: t("pr_trigger_contextual"),
    weekdays: [
      t("pr_wd_0"),
      t("pr_wd_1"),
      t("pr_wd_2"),
      t("pr_wd_3"),
      t("pr_wd_4"),
      t("pr_wd_5"),
      t("pr_wd_6"),
    ],
    unknown: t("st_unknown"),
  };

  // Filtro de oportunidades: pendentes = não terminais
  const PENDING_OPP = new Set([
    "detected",
    "evaluating",
    "recommended",
    "snoozed",
    "accepted",
    "executing",
  ]);
  const visibleOpps = (opportunities ?? []).filter((o) =>
    oppFilter === "all" ? true : PENDING_OPP.has(o.status),
  );

  // ---------- ações ----------

  const saveRule = async () => {
    if (!(await gated())) return;
    const { error, body } = prRuleBodyFromForm({
      name,
      description,
      form: triggerForm,
      leaves,
      mode,
      workflowId,
      execution,
      maxExecutions: numOrNull(maxExecutions),
      cooldownMs: numOrNull(cooldownMs),
      validFrom,
      validUntil,
    });
    if (error || !body) {
      setFormError(error ?? "pr_err_trigger_invalid");
      return;
    }
    // folhas visíveis inválidas também bloqueiam (feedback antes do servidor)
    for (const l of leaves) {
      if (!l.fact.trim() && !l.value.trim()) continue;
      const leafErr = validatePrConditionLeaf(l);
      if (leafErr) {
        setFormError(leafErr);
        return;
      }
    }
    setBusy(true);
    setFormError(null);
    try {
      if (editingId) await updatePrRule(editingId, body);
      else await createPrRule(body);
      toast.success(editingId ? t("pr_updated") : t("pr_created"));
      resetForm();
      setFormOpen(false);
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setTriggerForm(DEFAULT_PR_TRIGGER_FORM);
    setMode("all");
    setLeaves([emptyLeaf()]);
    setWorkflowId("");
    setExecution("manual");
    setMaxExecutions("");
    setCooldownMs("");
    setValidFrom("");
    setValidUntil("");
    setFormError(null);
  };

  const startEdit = (r: PrRule) => {
    setEditingId(r.id);
    setName(r.name);
    setDescription(r.description ?? "");
    const tr = (r.trigger ?? {}) as Record<string, unknown>;
    const next: PrTriggerForm = { ...DEFAULT_PR_TRIGGER_FORM, kind: r.trigger_kind };
    if (r.trigger_kind === "event") {
      next.source = String(tr["source"] ?? "workflow");
      next.eventKind = String(tr["eventKind"] ?? "");
    } else if (r.trigger_kind === "temporal") {
      const type = String(tr["type"] ?? "daily");
      next.temporalType = (
        ["daily", "weekly", "interval", "date"].includes(type) ? type : "daily"
      ) as PrTriggerForm["temporalType"];
      next.time = String(tr["time"] ?? "08:00");
      next.weekday = typeof tr["weekday"] === "number" ? tr["weekday"] : 1;
      next.intervalMinutes =
        typeof tr["intervalMs"] === "number"
          ? Math.max(1, Math.round(tr["intervalMs"] / 60_000))
          : 60;
      next.date = String(tr["date"] ?? "");
    }
    setTriggerForm(next);
    // condições: reconstruir folhas planas a partir da árvore (all/any com folhas)
    const cond = r.conditions as Record<string, unknown> | null;
    const arr =
      cond && Array.isArray(cond["all"])
        ? cond["all"]
        : cond && Array.isArray(cond["any"])
          ? cond["any"]
          : null;
    if (arr) {
      setMode("all" in (cond as object) ? "all" : "any");
      const flat = arr
        .filter(
          (n): n is Record<string, unknown> =>
            typeof n === "object" && n !== null && !("all" in n) && !("any" in n) && !("not" in n),
        )
        .map((n) => ({
          op: String(n["op"] ?? "eq"),
          fact: String(n["fact"] ?? ""),
          value:
            n["value"] === undefined
              ? ""
              : typeof n["value"] === "string"
                ? n["value"]
                : JSON.stringify(n["value"]),
        }));
      setLeaves(flat.length ? flat : [emptyLeaf()]);
    } else {
      setLeaves([emptyLeaf()]);
    }
    setWorkflowId(r.workflow_id ?? "");
    setExecution(r.execution === "auto" ? "auto" : "manual");
    setMaxExecutions(r.max_executions == null ? "" : String(r.max_executions));
    setCooldownMs(r.cooldown_ms == null ? "" : String(r.cooldown_ms));
    setValidFrom(r.valid_from ? r.valid_from.slice(0, 10) : "");
    setValidUntil(r.valid_until ? r.valid_until.slice(0, 10) : "");
    setFormOpen(true);
    setTab("rules");
  };

  const changeState = async (r: PrRule, action: "activate" | "pause" | "resume" | "disable") => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      if (action === "activate") await activatePrRule(r.id);
      else if (action === "pause") await pausePrRule(r.id);
      else if (action === "resume") await resumePrRule(r.id);
      else await disablePrRule(r.id);
      toast.success(t("pr_state_changed"));
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (r: PrRule) => {
    if (!(await gated())) return;
    let facts: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(testFacts || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) facts = parsed;
    } catch {
      toast.error(t("pr_test_facts"));
      return;
    }
    setBusy(true);
    try {
      const out = await testPrRule(r.id, facts);
      setTestResult(out);
      if (!out) toast.error(t("pr_load_fail"));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (r: PrRule) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      await runPrRule(r.id);
      toast.success(t("pr_ran"));
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const acceptOpp = async (o: PrOpportunity) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      await acceptPrOpportunity(o.id);
      toast.success(t("pr_accepted"));
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const dismissOpp = async (o: PrOpportunity) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      await dismissPrOpportunity(o.id, dismissReasons[o.id] || undefined);
      toast.success(t("pr_dismissed"));
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const snoozeOpp = async (o: PrOpportunity, hours: number) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      await snoozePrOpportunity(o.id, Math.max(1, Math.round(hours * 3_600_000)));
      toast.success(t("pr_snoozed"));
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const loadTrail = (o: PrOpportunity) => {
    if (trails[o.id]) {
      setTrails((m) => {
        const { [o.id]: _drop, ...rest } = m;
        return rest;
      });
      return;
    }
    getPrOpportunityTrail(o.id)
      .then((tr) => tr && setTrails((m) => ({ ...m, [o.id]: tr })))
      .catch(() => undefined);
  };

  const saveControls = async () => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      const saved = await savePrControls({
        level: ctrlLevel,
        paused: ctrlPaused,
        ...(numOrNull(ctrlMaxHour) != null
          ? { maxExecutionsPerHour: numOrNull(ctrlMaxHour)! }
          : {}),
        ...(numOrNull(ctrlCooldown) != null ? { cooldownMs: numOrNull(ctrlCooldown)! } : {}),
        ...(numOrNull(ctrlMaxPending) != null
          ? { maxPendingOpportunities: numOrNull(ctrlMaxPending)! }
          : {}),
      });
      if (saved) setControls(saved);
      toast.success(t("pr_controls_saved"));
      refreshAll();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const level = prLevelInfo(ctrlLevel);

  // Cards de métricas reais
  const metricCards: { label: string; value: number }[] = metrics
    ? [
        { label: t("pr_m_rules_active"), value: metrics.rules_active },
        { label: t("pr_m_opps_produced"), value: metrics.opportunities_produced },
        { label: t("pr_m_opps_accepted"), value: metrics.opportunities_accepted },
        { label: t("pr_m_workflows"), value: metrics.workflows_started },
        { label: t("pr_m_completed"), value: metrics.executions_completed },
        { label: t("pr_m_failed"), value: metrics.executions_failed },
        { label: t("pr_m_duplicates"), value: metrics.duplicates_blocked },
        { label: t("pr_m_unread"), value: metrics.notifications_unread },
        { label: t("pr_m_events_received"), value: metrics.events_received },
      ]
    : [];

  const oppWithRun = (opportunities ?? []).filter((o) => o.workflow_run_id);

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("pr_title")} sub={t("pr_sub")} />
      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="border border-border bg-secondary/60 p-1">
          <TabsTrigger value="dashboard" className="flex items-center gap-2">
            <BarChart3 className="h-3.5 w-3.5" />
            {t("pr_tab_dashboard")}
          </TabsTrigger>
          <TabsTrigger value="rules" className="flex items-center gap-2">
            <GitBranch className="h-3.5 w-3.5" />
            {t("pr_tab_rules")}
          </TabsTrigger>
          <TabsTrigger value="opps" className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            {t("pr_tab_opps")}
          </TabsTrigger>
          <TabsTrigger value="execs" className="flex items-center gap-2">
            <Play className="h-3.5 w-3.5" />
            {t("pr_tab_execs")}
          </TabsTrigger>
          <TabsTrigger value="controls" className="flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t("pr_tab_controls")}
          </TabsTrigger>
        </TabsList>

        {/* ---------- PAINEL ---------- */}
        <TabsContent value="dashboard" className="space-y-6 focus-visible:outline-none">
          {metrics ? (
            <div
              className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5"
              data-testid="pr-metrics"
            >
              {metricCards.map((m) => (
                <div key={m.label} className="hud-panel p-3">
                  <div className="text-2xl font-semibold">{m.value}</div>
                  <div className="hud-label text-xs">{m.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("pr_load_fail")}</p>
          )}

          <section>
            <div className="hud-label mb-2">{t("pr_notifications")}</div>
            {notifications !== null && notifications.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("pr_no_notifications")}</p>
            )}
            <div className="space-y-2">
              {(notifications ?? []).map((n) => (
                <div
                  key={n.id}
                  className="hud-panel flex flex-wrap items-center gap-2 p-3"
                  data-testid="pr-notification"
                >
                  <Bell
                    className={`h-3.5 w-3.5 ${n.read_at ? "text-muted-foreground" : "text-primary"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm">{n.title || n.type}</span>
                      {!n.read_at && (
                        <Badge variant="secondary" className="text-[10px]">
                          {t("pr_m_unread")}
                        </Badge>
                      )}
                    </div>
                    {n.body && <p className="truncate text-xs text-muted-foreground">{n.body}</p>}
                  </div>
                  {!n.read_at && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        markPrNotificationRead(n.id)
                          .then(() => refreshAll())
                          .catch(fail)
                      }
                    >
                      <Check className="h-3 w-3" />
                      {t("pr_notif_mark_read")}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      dismissPrNotification(n.id)
                        .then(() => refreshAll())
                        .catch(fail)
                    }
                  >
                    <X className="h-3 w-3" />
                    {t("pr_notif_dismiss")}
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="hud-label mb-2">{t("pr_events")}</div>
            {events !== null && events.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("pr_no_events")}</p>
            )}
            <ul className="space-y-1 text-xs">
              {(events ?? []).map((e) => (
                <li key={e.id} className="font-mono">
                  {e.created_at} · {e.kind}
                  {e.source ? ` · ${e.source}` : ""}
                  {e.dedupe_key ? " · dedupe" : ""}
                </li>
              ))}
            </ul>
          </section>
        </TabsContent>

        {/* ---------- REGRAS ---------- */}
        <TabsContent
          value="rules"
          className="grid gap-6 lg:grid-cols-[1fr_400px] focus-visible:outline-none"
        >
          <div className="space-y-6">
            <section>
              <div className="hud-label mb-2">{t("pr_rules")}</div>
              {rules !== null && rules.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("pr_rules_empty")}</p>
              )}
              <div className="space-y-3">
                {(rules ?? []).map((r) => {
                  const badge = prRuleStatusBadge(r.state, ruleLabels);
                  return (
                    <div key={r.id} className="hud-panel p-4" data-testid="pr-rule-row">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={badge.variant} className={badge.className}>
                          {badge.label}
                        </Badge>
                        <span className="flex-1 text-sm">{r.name}</span>
                        <span className="hud-label text-xs">
                          {t("pr_rule_version")} {r.version} · {r.execution}
                        </span>
                      </div>
                      <div className="hud-label mt-2 text-xs">
                        {prTriggerSummary(r.trigger, summaryLabels)}
                        {` · ${t("pr_rule_exec_count")}: ${r.execution_count}`}
                        {r.max_executions != null ? ` / ${r.max_executions}` : ""}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {t("pr_rule_last_run")}: {r.last_run_at ?? t("pr_rule_never")} ·{" "}
                        {t("pr_rule_next_run")}: {r.next_run_at ?? t("pr_rule_never")}
                        {r.last_error ? ` · ${t("pr_rule_last_error")}: ${r.last_error}` : ""}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {r.state !== "active" && r.state !== "paused" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => changeState(r, "activate")}
                          >
                            <Play className="h-3 w-3" />
                            {t("pr_activate")}
                          </Button>
                        )}
                        {r.state === "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => changeState(r, "pause")}
                          >
                            <Clock className="h-3 w-3" />
                            {t("pause")}
                          </Button>
                        )}
                        {r.state === "paused" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => changeState(r, "resume")}
                          >
                            <Play className="h-3 w-3" />
                            {t("resume")}
                          </Button>
                        )}
                        {r.state !== "disabled" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => changeState(r, "disable")}
                          >
                            <X className="h-3 w-3" />
                            {t("pr_disable")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setTestFor(testFor === r.id ? null : r.id);
                            setTestResult(null);
                          }}
                        >
                          <Check className="h-3 w-3" />
                          {t("pr_test")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => runNow(r)}
                        >
                          <Play className="h-3 w-3" />
                          {t("pr_run")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => startEdit(r)}
                        >
                          {t("pr_edit")}
                        </Button>
                      </div>

                      {testFor === r.id && (
                        <div
                          className="mt-3 space-y-2 rounded-md border border-border p-3"
                          data-testid="pr-test"
                        >
                          <div className="hud-label text-xs">{t("pr_test_facts")}</div>
                          <Textarea
                            rows={2}
                            value={testFacts}
                            onChange={(e) => setTestFacts(e.target.value)}
                          />
                          <p className="text-[10px] text-muted-foreground">
                            {t("pr_test_facts_hint")}
                          </p>
                          <Button size="sm" disabled={busy} onClick={() => runTest(r)}>
                            {t("pr_test")}
                          </Button>
                          {testResult && (
                            <div className="space-y-1 text-xs">
                              <div className="flex items-center gap-2">
                                <Badge variant={testResult.wouldTrigger ? "secondary" : "outline"}>
                                  {testResult.wouldTrigger
                                    ? t("pr_test_would_trigger")
                                    : t("pr_test_would_not")}
                                </Badge>
                                <span className="text-muted-foreground">
                                  {testResult.conditionsMet
                                    ? t("pr_test_conditions_met")
                                    : t("pr_test_conditions_not_met")}
                                </span>
                              </div>
                              <div className="text-muted-foreground">
                                {testResult.wouldAutoStart
                                  ? t("pr_test_auto_start")
                                  : t("pr_test_no_auto")}
                              </div>
                              {testResult.reasons?.length > 0 && (
                                <div>
                                  <div className="hud-label">{t("pr_test_reasons")}</div>
                                  <ul className="list-disc pl-4">
                                    {testResult.reasons.map((rr, i) => (
                                      <li key={i}>{rr}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {testResult.note && (
                                <div className="text-muted-foreground">
                                  {t("pr_test_note")}: {testResult.note}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Histórico de versões */}
                      {(r.versions ?? []).length > 0 && (
                        <div className="mt-3 border-t border-border pt-2">
                          <div className="hud-label text-xs">{t("pr_rule_versions")}</div>
                          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            {r.versions.map((v) => (
                              <li key={v.version} className="font-mono">
                                v{v.version}
                                {v.created_at ? ` · ${v.created_at}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Formulário de regra */}
          <aside className="hud-panel space-y-3 self-start p-4" data-testid="pr-rule-form">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              <div className="hud-label">{editingId ? t("pr_rule_edit") : t("pr_rule_new")}</div>
            </div>
            <Input placeholder={t("name")} value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              placeholder={t("pr_justification")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            {/* Gatilho */}
            <div className="hud-label">{t("pr_trigger")}</div>
            <select
              className={selectCls}
              value={triggerForm.kind}
              onChange={(e) => setTriggerForm({ ...triggerForm, kind: e.target.value })}
              aria-label={t("pr_trigger")}
            >
              <option value="event">{t("pr_trigger_event")}</option>
              <option value="temporal">{t("pr_trigger_temporal")}</option>
              <option value="contextual">{t("pr_trigger_contextual")}</option>
            </select>

            {triggerForm.kind === "event" && (
              <div className="space-y-2">
                <select
                  className={selectCls}
                  value={triggerForm.source}
                  onChange={(e) => setTriggerForm({ ...triggerForm, source: e.target.value })}
                  aria-label={t("pr_source")}
                >
                  {PR_EVENT_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Input
                  placeholder={t("pr_event_kind")}
                  value={triggerForm.eventKind}
                  onChange={(e) => setTriggerForm({ ...triggerForm, eventKind: e.target.value })}
                />
              </div>
            )}

            {triggerForm.kind === "temporal" && (
              <div className="space-y-2">
                <select
                  className={selectCls}
                  value={triggerForm.temporalType}
                  onChange={(e) =>
                    setTriggerForm({
                      ...triggerForm,
                      temporalType: e.target.value as PrTriggerForm["temporalType"],
                    })
                  }
                  aria-label={t("pr_temporal_type")}
                >
                  <option value="daily">{t("pr_temporal_daily")}</option>
                  <option value="weekly">{t("pr_temporal_weekly")}</option>
                  <option value="interval">{t("pr_temporal_interval")}</option>
                  <option value="date">{t("pr_temporal_date")}</option>
                </select>
                {triggerForm.temporalType !== "interval" && (
                  <Input
                    placeholder={t("pr_time")}
                    value={triggerForm.time}
                    onChange={(e) => setTriggerForm({ ...triggerForm, time: e.target.value })}
                  />
                )}
                {triggerForm.temporalType === "weekly" && (
                  <select
                    className={selectCls}
                    value={triggerForm.weekday}
                    onChange={(e) =>
                      setTriggerForm({ ...triggerForm, weekday: Number(e.target.value) })
                    }
                    aria-label={t("pr_weekday")}
                  >
                    {summaryLabels.weekdays.map((w, i) => (
                      <option key={i} value={i}>
                        {w}
                      </option>
                    ))}
                  </select>
                )}
                {triggerForm.temporalType === "interval" && (
                  <Input
                    type="number"
                    min={1}
                    placeholder={t("pr_interval_min")}
                    value={String(triggerForm.intervalMinutes)}
                    onChange={(e) =>
                      setTriggerForm({
                        ...triggerForm,
                        intervalMinutes: Number(e.target.value || "0"),
                      })
                    }
                  />
                )}
                {triggerForm.temporalType === "date" && (
                  <Input
                    placeholder={t("pr_when_date")}
                    value={triggerForm.date}
                    onChange={(e) => setTriggerForm({ ...triggerForm, date: e.target.value })}
                  />
                )}
              </div>
            )}

            {/* Condições (editor simples de folhas + grupo) */}
            <div className="hud-label">{t("pr_conditions")}</div>
            <select
              className={selectCls}
              value={mode}
              onChange={(e) => setMode(e.target.value === "any" ? "any" : "all")}
              aria-label={t("pr_conditions")}
            >
              <option value="all">{t("pr_mode_all")}</option>
              <option value="any">{t("pr_mode_any")}</option>
            </select>
            {leaves.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1">
                <select
                  className="rounded-md border border-input bg-secondary p-1 text-xs"
                  value={l.op}
                  onChange={(e) =>
                    setLeaves(leaves.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))
                  }
                  aria-label={`${t("pr_cond_op")} ${i + 1}`}
                >
                  {PR_CONDITION_OPS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                <Input
                  className="w-32 flex-1"
                  placeholder={t("pr_cond_fact")}
                  value={l.fact}
                  onChange={(e) =>
                    setLeaves(leaves.map((x, j) => (j === i ? { ...x, fact: e.target.value } : x)))
                  }
                />
                {l.op !== "exists" && l.op !== "missing" && (
                  <Input
                    className="w-28 flex-1"
                    placeholder={t("pr_cond_value")}
                    value={l.value}
                    onChange={(e) =>
                      setLeaves(
                        leaves.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                      )
                    }
                  />
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("pr_cond_remove")}
                  onClick={() => setLeaves(leaves.filter((_, j) => j !== i))}
                  disabled={leaves.length === 1}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
                {validatePrConditionLeaf(l) && (l.fact.trim() || l.value.trim()) && (
                  <span className="w-full text-[10px] text-destructive">
                    {t(validatePrConditionLeaf(l) as never)}
                  </span>
                )}
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLeaves([...leaves, emptyLeaf()])}
              disabled={busy}
            >
              <Plus className="h-3 w-3" />
              {t("pr_cond_add")}
            </Button>

            {/* Alvo e limites */}
            <select
              className={selectCls}
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              aria-label={t("pr_workflow")}
            >
              <option value="">{t("pr_workflow_none")}</option>
              {(workflows ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select
              className={selectCls}
              value={execution}
              onChange={(e) => setExecution(e.target.value === "auto" ? "auto" : "manual")}
              aria-label={t("pr_execution")}
            >
              <option value="manual">{t("pr_exec_manual")}</option>
              <option value="auto">{t("pr_exec_auto")}</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                placeholder={t("pr_max_executions")}
                value={maxExecutions}
                onChange={(e) => setMaxExecutions(e.target.value)}
              />
              <Input
                type="number"
                placeholder={t("pr_cooldown_ms")}
                value={cooldownMs}
                onChange={(e) => setCooldownMs(e.target.value)}
              />
              <Input
                placeholder={t("pr_valid_from")}
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
              <Input
                placeholder={t("pr_valid_until")}
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </div>

            {formError && (
              <p className="text-xs text-destructive" data-testid="pr-form-error">
                {t(formError as never)}
              </p>
            )}
            <Button className="w-full" onClick={saveRule} disabled={busy || !name.trim()}>
              <Plus className="h-3 w-3" />
              {editingId ? t("save") : t("pr_rule_new")}
            </Button>
            {editingId && (
              <Button className="w-full" variant="ghost" onClick={resetForm} disabled={busy}>
                {t("cancel")}
              </Button>
            )}
            {validatePrTriggerForm(triggerForm) && (
              <p className="text-[10px] text-muted-foreground">
                {t(validatePrTriggerForm(triggerForm) as never)}
              </p>
            )}
          </aside>
        </TabsContent>

        {/* ---------- OPORTUNIDADES ---------- */}
        <TabsContent value="opps" className="space-y-4 focus-visible:outline-none">
          <div className="flex items-center gap-2">
            <select
              className={`${selectCls} max-w-48`}
              value={oppFilter}
              onChange={(e) => setOppFilter(e.target.value === "all" ? "all" : "pending")}
              aria-label={t("pr_opps")}
            >
              <option value="pending">{t("pr_status_pending")}</option>
              <option value="all">{t("pr_status_all")}</option>
            </select>
          </div>
          {opportunities !== null && visibleOpps.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("pr_opps_empty")}</p>
          )}
          <div className="space-y-3">
            {visibleOpps.map((o) => {
              const badge = prOpportunityStatusBadge(o.status, oppLabels);
              const pending = PENDING_OPP.has(o.status);
              return (
                <div key={o.id} className="hud-panel p-4" data-testid="pr-opp-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badge.variant} className={badge.className}>
                      {badge.label}
                    </Badge>
                    <span className="flex-1 text-sm">
                      {t("pr_kind")}: {o.kind} · {t("pr_priority")}: {o.priority}
                    </span>
                    <span className="hud-label text-xs">{o.created_at}</span>
                  </div>
                  {/* A recomendação explica POR QUÊ: justificativa e evidências sempre visíveis */}
                  {o.justification && (
                    <div className="mt-2 text-sm">
                      <span className="hud-label text-xs">{t("pr_justification")}: </span>
                      {o.justification}
                    </div>
                  )}
                  {(o.evidence ?? []).length > 0 && (
                    <div className="mt-2">
                      <div className="hud-label text-xs">{t("pr_evidence")}</div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {o.evidence.map((ev, i) => (
                          <li key={i}>{typeof ev === "string" ? ev : JSON.stringify(ev)}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {o.snoozed_until && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {t("pr_snoozed_until")}: {o.snoozed_until}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {pending && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => acceptOpp(o)}
                        >
                          <Play className="h-3 w-3" />
                          {t("pr_accept")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => dismissOpp(o)}
                        >
                          <X className="h-3 w-3" />
                          {t("pr_dismiss")}
                        </Button>
                        <Input
                          className="max-w-40 text-xs"
                          placeholder={t("pr_dismiss_reason")}
                          value={dismissReasons[o.id] ?? ""}
                          onChange={(e) =>
                            setDismissReasons((m) => ({ ...m, [o.id]: e.target.value }))
                          }
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => snoozeOpp(o, 24)}
                        >
                          <Clock className="h-3 w-3" />
                          {t("pr_snooze")} 24h
                        </Button>
                      </>
                    )}
                    {o.workflow_run_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTab("execs");
                          loadTrail(o);
                        }}
                      >
                        {t("pr_open_run")}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ---------- EXECUÇÕES (trilha) ---------- */}
        <TabsContent value="execs" className="space-y-4 focus-visible:outline-none">
          {opportunities !== null && oppWithRun.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("pr_execs_empty")}</p>
          )}
          <div className="space-y-3">
            {oppWithRun.map((o) => {
              const badge = prOpportunityStatusBadge(o.status, oppLabels);
              const tr = trails[o.id];
              const runBadge = wfRunStatusBadge(tr?.run?.status ?? "unknown", runStatusLabels);
              return (
                <div key={o.id} className="hud-panel p-4" data-testid="pr-exec-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={badge.variant} className={badge.className}>
                      {badge.label}
                    </Badge>
                    <span className="flex-1 text-sm font-mono text-xs">{o.workflow_run_id}</span>
                    <Button size="sm" variant="outline" onClick={() => loadTrail(o)}>
                      {tr ? "−" : "+"}
                      {t("pr_trail")}
                    </Button>
                  </div>
                  {tr && (
                    <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
                      <div className="flex items-center gap-2">
                        <Badge variant={runBadge.variant} className={runBadge.className}>
                          {runBadge.label}
                        </Badge>
                        <span className="font-mono">
                          {t("pr_trail_run")}: {tr.run?.id ?? o.workflow_run_id}
                        </span>
                      </div>
                      <div>
                        <div className="hud-label">{t("pr_trail_approvals")}</div>
                        {(tr.approvals ?? []).length === 0 ? (
                          <p className="text-muted-foreground">{t("pr_trail_no_approvals")}</p>
                        ) : (
                          <ul className="space-y-0.5 font-mono">
                            {tr.approvals.map((a, i) => (
                              <li key={i}>
                                {a.approval_id} · {a.node_id ?? "—"} · {a.status}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <a
                        href={`/workflows?run=${encodeURIComponent(o.workflow_run_id ?? "")}`}
                        className="underline underline-offset-2"
                      >
                        {t("pr_open_run")}
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ---------- CONTROLES ---------- */}
        <TabsContent value="controls" className="max-w-2xl space-y-6 focus-visible:outline-none">
          <section className="hud-panel space-y-4 p-4" data-testid="pr-controls">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              <div className="hud-label">{t("pr_controls")}</div>
            </div>

            {/* Nível de autonomia (0–3) */}
            <div className="space-y-2">
              <div className="hud-label">{t("pr_level")}</div>
              {[0, 1, 2, 3].map((n) => {
                const info = prLevelInfo(n);
                return (
                  <label key={n} className="flex items-start gap-2 text-sm">
                    <input
                      type="radio"
                      name="pr-level"
                      value={n}
                      checked={ctrlLevel === n}
                      onChange={() => setCtrlLevel(n)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-medium">{t(info.nameKey as never)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t(info.descKey as never)}
                      </span>
                    </span>
                  </label>
                );
              })}
              <p className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-muted-foreground">
                {t("pr_level_note")}
              </p>
            </div>

            {/* Pausa global */}
            <div className="flex items-center gap-3">
              <Switch
                checked={ctrlPaused}
                onCheckedChange={setCtrlPaused}
                aria-label={t("pr_paused_global")}
              />
              <span className="text-sm">{t("pr_paused_global")}</span>
            </div>

            {/* Limites */}
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <Input
                type="number"
                min={0}
                placeholder={t("pr_max_exec_hour")}
                value={ctrlMaxHour}
                onChange={(e) => setCtrlMaxHour(e.target.value)}
                aria-label={t("pr_max_exec_hour")}
              />
              <Input
                type="number"
                min={0}
                placeholder={t("pr_cooldown_ms")}
                value={ctrlCooldown}
                onChange={(e) => setCtrlCooldown(e.target.value)}
                aria-label={t("pr_cooldown_ms")}
              />
              <Input
                type="number"
                min={0}
                placeholder={t("pr_max_pending")}
                value={ctrlMaxPending}
                onChange={(e) => setCtrlMaxPending(e.target.value)}
                aria-label={t("pr_max_pending")}
              />
            </div>

            <Button onClick={saveControls} disabled={busy || !ctrlLoaded}>
              <Check className="h-3 w-3" />
              {t("save")}
            </Button>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
