import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Eye, ListChecks, Monitor, Play, Plus, Square, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  closeCiSession,
  executeCiPlan,
  getCiSession,
  listCiProcedures,
  listCiSessions,
  observeCiSession,
  openCiSession,
  planCiSession,
  ping,
  reuseCiProcedure,
  type CiExecuteResult,
  type CiObserveResult,
  type CiPlanResult,
  type CiPlanStep,
  type CiProcedure,
  type CiSession,
  type CiSessionSummary,
} from "@/lib/bridge";
import { ciStatusBadge } from "@/lib/computer-ui";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/computer")({
  head: () => ({
    meta: [
      { title: "Computer Studio — Jarvis" },
      {
        name: "description",
        content:
          "Sessões de navegador observáveis: observação com hash, planos one-shot verificados e memória procedural — escritas sob aprovação D9.",
      },
      { property: "og:title", content: "Computer Studio — Jarvis" },
      {
        property: "og:description",
        content:
          "Computer Studio local: observar, planejar, executar com aprovação humana e reutilizar procedimentos.",
      },
    ],
  }),
  component: ComputerPage,
});

/** Alvo/verificação do passo podem vir como objeto ou string — exibição estável. */
const showVal = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};

export function ComputerPage() {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<CiSessionSummary[] | null>(null);
  const [procedures, setProcedures] = useState<CiProcedure[] | null>(null);
  const [objective, setObjective] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, CiSession>>({});
  const [observeOut, setObserveOut] = useState<Record<string, CiObserveResult>>({});
  const [planOut, setPlanOut] = useState<Record<string, CiPlanResult>>({});
  const [reuseOut, setReuseOut] = useState<Record<string, CiPlanStep[]>>({});
  const [busy, setBusy] = useState(false);

  // Rótulos i18n para os três grupos de status (chaves do dict).
  const statusLabels: Record<string, string> = {
    active: t("ci_status_active"),
    closed: t("ci_status_closed"),
    failed: t("ci_status_failed"),
    planned: t("ci_act_planned"),
    running: t("ci_act_running"),
    succeeded: t("ci_act_succeeded"),
    verification_pending: t("ci_act_verification_pending"),
    unknown: t("ci_act_unknown"),
    reconciling: t("ci_act_reconciling"),
    cancelled: t("ci_act_cancelled"),
    blocked: t("ci_act_blocked"),
    observed: t("ci_proc_observed"),
    inferred: t("ci_proc_inferred"),
    tested: t("ci_proc_tested"),
    validated: t("ci_proc_validated"),
    deprecated: t("ci_proc_deprecated"),
  };

  const refreshSessions = () => listCiSessions().then((s) => setSessions(s ?? []));
  const refreshProcedures = () => listCiProcedures().then((p) => setProcedures(p ?? []));

  useEffect(() => {
    refreshSessions().catch(() => undefined);
    refreshProcedures().catch(() => undefined);
  }, []);

  const gated = async () => {
    if (await ping()) return true;
    toast.info(t("demo_hint"));
    return false;
  };

  const createSession = async () => {
    if (!objective.trim()) return;
    if (!(await gated())) return;
    setBusy(true);
    try {
      const s = await openCiSession({ objective: objective.trim(), environment: "browser" });
      if (s?.id) {
        toast.success(t("ci_created"));
        setOpenId(s.id);
        setDetails((m) => ({ ...m, [s.id]: s }));
        setObjective("");
        refreshSessions();
      }
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const toggleSession = (id: string) => {
    const open = openId === id;
    setOpenId(open ? null : id);
    if (!open && !details[id]) {
      getCiSession(id)
        .then((d) => d && setDetails((m) => ({ ...m, [id]: d })))
        .catch(() => undefined);
    }
  };

  const reloadDetail = (id: string) =>
    getCiSession(id)
      .then((d) => d && setDetails((m) => ({ ...m, [id]: d })))
      .catch(() => undefined);

  const observe = async (id: string) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      const out = await observeCiSession(id);
      if (out) {
        setObserveOut((m) => ({ ...m, [id]: out }));
        toast.success(t("ci_observed_toast"));
        reloadDetail(id);
      }
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const plan = async (id: string) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      const out = await planCiSession(id);
      if (out) {
        setPlanOut((m) => ({ ...m, [id]: out }));
        toast.success(t("ci_planned_toast"));
        reloadDetail(id);
      }
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const execute = async (id: string, planId: string) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      const out: CiExecuteResult = (await executeCiPlan(planId)) ?? {};
      if (out.waiting_approval) toast.info(t("ci_execute_waiting"));
      else if (out.done) toast.success(t("ci_executed_toast"));
      else toast.info(t("ci_execute_partial"));
      reloadDetail(id);
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const closeSession = async (id: string) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      await closeCiSession(id);
      toast.success(t("ci_closed_toast"));
      refreshSessions();
      reloadDetail(id);
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const reuse = async (p: CiProcedure) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      const out = await reuseCiProcedure(p.id);
      if (out) {
        setReuseOut((m) => ({ ...m, [p.id]: out.steps }));
        toast.success(t("ci_reused_toast"));
      }
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  /** Plano executável: último plano da sessão ainda em 'planned'/'executing'. */
  const runnablePlan = (d: CiSession | undefined) =>
    d?.plans?.filter((p) => p.status === "planned" || p.status === "executing").at(-1) ?? null;

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("ci_title")} sub={t("ci_sub")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {/* Sessões */}
          <section>
            <div className="hud-label mb-2">{t("ci_sessions")}</div>
            {sessions !== null && sessions.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("ci_empty")}</p>
            )}
            <div className="space-y-3">
              {(sessions ?? []).map((s) => {
                const badge = ciStatusBadge(s.status, statusLabels);
                const open = openId === s.id;
                const detail = details[s.id];
                const runnable = runnablePlan(detail);
                const ob = observeOut[s.id];
                const pl = planOut[s.id];
                return (
                  <div key={s.id} className="hud-panel p-4" data-testid="ci-session-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={badge.variant} className={badge.className}>
                        {badge.label}
                      </Badge>
                      <span className="flex-1 text-sm">{s.objective || s.id}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleSession(s.id)}
                        aria-expanded={open}
                      >
                        {open ? "−" : "+"}
                      </Button>
                    </div>
                    <div className="hud-label mt-2 text-xs">
                      {s.environment} · {s.created_at}
                      {s.closed_at ? ` · ${s.closed_at}` : ""}
                    </div>
                    {open && (
                      <div className="mt-3 space-y-4 border-t border-border pt-3 text-sm">
                        {/* Ações da sessão */}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || s.status !== "active"}
                            onClick={() => observe(s.id)}
                          >
                            <Eye className="h-3 w-3" />
                            {t("ci_observe")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || s.status !== "active"}
                            onClick={() => plan(s.id)}
                          >
                            <ListChecks className="h-3 w-3" />
                            {t("ci_plan")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || !runnable}
                            onClick={() => runnable && execute(s.id, runnable.id)}
                          >
                            <Play className="h-3 w-3" />
                            {t("ci_execute")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || s.status !== "active"}
                            onClick={() => closeSession(s.id)}
                          >
                            <Square className="h-3 w-3" />
                            {t("ci_close_session")}
                          </Button>
                        </div>

                        {/* Nota D9: escritas dependem de aprovação humana */}
                        <p className="text-xs text-muted-foreground">
                          {t("ci_d9_note")}{" "}
                          <a href="/approvals" className="underline underline-offset-2">
                            {t("ci_approvals_link")}
                          </a>
                        </p>

                        {/* Última observação (conteúdo da interface é DADO NÃO CONFIÁVEL) */}
                        {ob && (
                          <div className="space-y-1" data-testid="ci-observation">
                            <div className="hud-label">{t("ci_last_observation")}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {t("ci_hash")}: {ob.hash} · {showVal(ob.dims)}
                            </div>
                            <pre className="max-h-48 overflow-auto rounded-md border border-border bg-secondary/50 p-2 text-xs whitespace-pre-wrap">
                              {ob.content}
                            </pre>
                          </div>
                        )}

                        {/* Observações persistidas (hash + dims) */}
                        <div>
                          <div className="hud-label">{t("ci_observations")}</div>
                          {(detail?.observations ?? []).length === 0 && (
                            <p className="text-xs text-muted-foreground">
                              {t("ci_no_observations")}
                            </p>
                          )}
                          <ul className="space-y-1 text-xs">
                            {(detail?.observations ?? []).map((o) => (
                              <li key={o.id} className="font-mono">
                                {o.created_at} · {o.kind} · {o.observation_hash.slice(0, 12)}… ·{" "}
                                {showVal(o.dims)}
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* Último plano gerado (passos com alvo/verificação/why) */}
                        {pl && (
                          <div className="space-y-2" data-testid="ci-plan">
                            <div className="hud-label">{t("ci_last_plan")}</div>
                            {pl.steps.map((st, i) => (
                              <div
                                key={i}
                                className="space-y-0.5 rounded-md border border-border p-2 text-xs"
                              >
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="font-mono text-[10px]">
                                    {st.action}
                                  </Badge>
                                  <span className="font-mono">{showVal(st.target)}</span>
                                </div>
                                <div className="text-muted-foreground">
                                  {t("ci_step_expected")}: {showVal(st.expected)}
                                </div>
                                <div className="text-muted-foreground">
                                  {t("ci_step_why")}: {st.why}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Planos persistidos */}
                        <div>
                          <div className="hud-label">{t("ci_plans")}</div>
                          {(detail?.plans ?? []).length === 0 && (
                            <p className="text-xs text-muted-foreground">{t("ci_no_plans")}</p>
                          )}
                          <ul className="space-y-1 text-xs">
                            {(detail?.plans ?? []).map((p) => {
                              const pb = ciStatusBadge(p.status, statusLabels);
                              return (
                                <li key={p.id} className="flex flex-wrap items-center gap-2">
                                  <Badge variant={pb.variant} className={pb.className}>
                                    {pb.label}
                                  </Badge>
                                  <span className="font-mono">{p.id}</span>
                                  <span className="text-muted-foreground">
                                    {(p.steps ?? []).length} · {p.created_at}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Procedimentos (memória procedural) */}
          <section>
            <div className="hud-label mb-2">{t("ci_procedures")}</div>
            {procedures !== null && procedures.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("ci_no_procedures")}</p>
            )}
            <div className="space-y-3">
              {(procedures ?? []).map((p) => {
                const badge = ciStatusBadge(p.status, statusLabels);
                const rsteps = reuseOut[p.id];
                return (
                  <div key={p.id} className="hud-panel p-4" data-testid="ci-procedure-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={badge.variant} className={badge.className}>
                        {badge.label}
                      </Badge>
                      <span className="flex-1 text-sm">{p.name}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || p.status === "deprecated"}
                        onClick={() => reuse(p)}
                      >
                        <Undo2 className="h-3 w-3" />
                        {t("ci_reuse")}
                      </Button>
                    </div>
                    {p.goal && <p className="mt-1 text-sm text-muted-foreground">{p.goal}</p>}
                    <div className="hud-label mt-2 text-xs">
                      {t("ci_proc_version")} {p.version} ·{" "}
                      <span className="text-emerald-600">
                        ✓ {p.success_count} {t("ci_proc_ok")}
                      </span>{" "}
                      ·{" "}
                      <span className="text-destructive">
                        ✗ {p.fail_count} {t("ci_proc_fail")}
                      </span>
                    </div>
                    {rsteps && (
                      <div
                        className="mt-2 space-y-2 border-t border-border pt-2"
                        data-testid="ci-reuse"
                      >
                        <div className="hud-label text-xs">{t("ci_proc_steps")}</div>
                        {rsteps.map((st, i) => (
                          <div key={i} className="text-xs">
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {st.action}
                            </Badge>{" "}
                            <span className="font-mono">{showVal(st.target)}</span>
                            <span className="text-muted-foreground"> — {st.why}</span>
                          </div>
                        ))}
                        <p className="text-[10px] text-muted-foreground">{t("ci_reuse_note")}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Nova sessão */}
        <aside className="hud-panel space-y-3 self-start p-4" data-testid="ci-form">
          <div className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            <div className="hud-label">{t("ci_new")}</div>
          </div>
          <Textarea
            rows={3}
            placeholder={t("ci_objective")}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("ci_env_note")}</p>
          <Button className="w-full" onClick={createSession} disabled={!objective.trim() || busy}>
            <Plus className="h-3 w-3" />
            {t("ci_create")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("ci_d9_note_short")}</p>
        </aside>
      </div>
    </div>
  );
}
