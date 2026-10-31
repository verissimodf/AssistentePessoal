import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, Globe, Library, Plus, Telescope } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createResearch,
  deepenResearch,
  executeResearch,
  getResearch,
  getResearchReport,
  listResearch,
  planResearch,
  ping,
  type ResearchEvidence,
  type ResearchProject,
  type ResearchReport,
} from "@/lib/bridge";
import { evidenceTypeBadge, labelFrom, researchStatusBadge } from "@/lib/research-ui";
import { useI18n, type TKey } from "@/lib/i18n";

export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [
      { title: "Deep Research — Jarvis" },
      {
        name: "description",
        content:
          "Investigações com plano-hipótese, fontes com qualidade, evidências verbatim e relatório citado.",
      },
      { property: "og:title", content: "Deep Research — Jarvis" },
      {
        property: "og:description",
        content:
          "Deep Research local: plano de subperguntas, coleta de evidências e relatório com citações.",
      },
    ],
  }),
  component: ResearchPage,
});

const STATUS_KEYS: Record<string, TKey> = {
  draft: "rs_status_draft",
  planning: "rs_status_planning",
  running: "rs_status_running",
  waiting: "rs_status_waiting",
  completed: "rs_status_completed",
  partial: "rs_status_partial",
  inconclusive: "rs_status_inconclusive",
  failed: "rs_status_failed",
  cancelled: "rs_status_cancelled",
  unknown: "rs_status_unknown",
};

const EV_KEYS: Record<string, TKey> = {
  direct: "rs_ev_direct",
  indirect: "rs_ev_indirect",
  inference: "rs_ev_inference",
  hypothesis: "rs_ev_hypothesis",
  gap: "rs_ev_gap",
};

const CS_KEYS: Record<string, TKey> = {
  supported: "rs_cs_supported",
  unsupported: "rs_cs_unsupported",
  contested: "rs_cs_contested",
  inferred: "rs_cs_inferred",
};

const QUALITY_KEYS: Record<string, TKey> = {
  full: "rs_quality_full",
  partial: "rs_quality_partial",
  snippet_only: "rs_quality_snippet_only",
  failed: "rs_quality_failed",
};

const OriginIcon = ({ origin }: { origin: string }) =>
  origin === "hub" ? (
    <Library className="h-4 w-4 text-muted-foreground" aria-label="hub" />
  ) : (
    <Globe className="h-4 w-4 text-muted-foreground" aria-label="web" />
  );

export function ResearchPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<ResearchProject[] | null>(null);
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ResearchProject | null>(null);
  const [deepenQ, setDeepenQ] = useState("");
  const [report, setReport] = useState<ResearchReport | null>(null);

  const statusLabels: Record<string, string> = Object.fromEntries(
    Object.entries(STATUS_KEYS).map(([k, key]) => [k, t(key)]),
  );
  const evLabels: Record<string, string> = Object.fromEntries(
    Object.entries(EV_KEYS).map(([k, key]) => [k, t(key)]),
  );

  const refresh = () =>
    listResearch()
      .then((r) => setItems(r?.items ?? []))
      .catch(() => undefined);

  useEffect(() => {
    refresh();
  }, []);

  const gated = async () => {
    if (await ping()) return true;
    toast.info(t("demo_hint"));
    return false;
  };

  const open = (id: string) => {
    setOpenId(id);
    setReport(null);
    getResearch(id)
      .then((r) => setDetail(r))
      .catch(() => undefined);
  };

  const close = () => {
    setOpenId(null);
    setDetail(null);
    setReport(null);
    refresh();
  };

  const create = async () => {
    if (!question.trim()) return;
    if (!(await gated())) return;
    try {
      const proj = await createResearch({
        question: question.trim(),
        ...(scope.trim() ? { scope: scope.trim() } : {}),
      });
      toast.success(t("rs_created"));
      setQuestion("");
      setScope("");
      if (proj) open(proj.id);
      refresh();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const refreshDetail = (id: string) =>
    getResearch(id)
      .then((r) => setDetail(r))
      .catch(() => undefined);

  const plan = async (id: string) => {
    if (!(await gated())) return;
    try {
      await planResearch(id);
      toast.success(t("rs_planned"));
      refreshDetail(id);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const execute = async (id: string) => {
    if (!(await gated())) return;
    try {
      await executeResearch(id);
      toast.success(t("rs_executed"));
      refreshDetail(id);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const deepen = async (id: string) => {
    if (!deepenQ.trim()) return;
    if (!(await gated())) return;
    try {
      await deepenResearch(id, deepenQ.trim());
      toast.success(t("rs_deepened"));
      setDeepenQ("");
      refreshDetail(id);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const loadReport = async (id: string) => {
    if (!(await gated())) return;
    try {
      setReport(await getResearchReport(id));
      toast.success(t("rs_report_loaded"));
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const evBadge = (e: ResearchEvidence) => evidenceTypeBadge(e.type, evLabels);

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("rs_title")} sub={t("rs_sub")} />

      {openId && detail ? (
        <div className="space-y-6" data-testid="rs-detail">
          <Button size="sm" variant="outline" onClick={close}>
            {t("rs_back")}
          </Button>

          <section className="hud-panel space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {(() => {
                const badge = researchStatusBadge(detail.status, statusLabels);
                return (
                  <Badge variant={badge.variant} className={badge.className}>
                    {badge.label}
                  </Badge>
                );
              })()}
              <span className="flex-1 text-lg">{detail.question}</span>
            </div>
            {detail.scope_text && (
              <p className="text-sm text-muted-foreground">{detail.scope_text}</p>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" variant="outline" onClick={() => plan(detail.id)}>
                {t("rs_plan_btn")}
              </Button>
              <Button size="sm" onClick={() => execute(detail.id)}>
                {t("rs_execute")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Input
                className="min-w-[220px] flex-1"
                placeholder={t("rs_deepen_question")}
                value={deepenQ}
                onChange={(e) => setDeepenQ(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => deepen(detail.id)}
                disabled={!deepenQ.trim()}
              >
                <Plus className="h-3 w-3" />
                {t("rs_deepen")}
              </Button>
            </div>
          </section>

          {/* Plano — hipótese de investigação, nunca fato */}
          <section className="hud-panel space-y-2 p-4" data-testid="rs-plan">
            <div className="hud-label">{t("rs_plan")}</div>
            {detail.plan ? (
              <div className="space-y-2 text-sm">
                <div>
                  <div className="hud-label text-xs">{t("rs_subquestions")}</div>
                  <ul className="list-disc space-y-1 pl-5">
                    {detail.plan.subquestions.map((sq, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">
                          {t("rs_ev_hypothesis")}
                        </Badge>
                        {sq}
                      </li>
                    ))}
                  </ul>
                </div>
                {detail.plan.strategy && (
                  <p>
                    <span className="hud-label text-xs">{t("rs_strategy")}: </span>
                    {detail.plan.strategy}
                  </p>
                )}
                {detail.plan.sufficiency && (
                  <p>
                    <span className="hud-label text-xs">{t("rs_sufficiency")}: </span>
                    {detail.plan.sufficiency}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("rs_no_plan")}</p>
            )}
            <p className="text-xs text-muted-foreground">{t("rs_plan_hint")}</p>
          </section>

          {/* Fontes com origem (web/hub) e qualidade */}
          <section data-testid="rs-sources">
            <div className="hud-label mb-2">{t("rs_sources")}</div>
            {detail.sources.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("rs_none")}</p>
            )}
            <div className="space-y-2">
              {detail.sources.map((s) => (
                <div key={s.id} className="hud-panel p-3" data-testid="rs-source-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <OriginIcon origin={s.origin} />
                    <span className="flex-1 text-sm">{s.title}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {s.origin === "hub" ? t("rs_origin_hub") : t("rs_origin_web")}
                    </Badge>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {t("rs_quality")}: {labelFrom(QUALITY_KEYS, s.quality, t)}
                    </Badge>
                    {s.domain && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {s.domain}
                      </Badge>
                    )}
                  </div>
                  {s.url && (
                    <a
                      className="mt-1 block truncate text-xs text-primary hover:underline"
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {s.url}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Evidências — citações verbatim com tipo */}
          <section data-testid="rs-evidence">
            <div className="hud-label mb-2">{t("rs_evidence")}</div>
            {detail.evidence.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("rs_none")}</p>
            )}
            <div className="space-y-2">
              {detail.evidence.map((e) => {
                const badge = evBadge(e);
                return (
                  <div key={e.id} className="hud-panel p-3" data-testid="rs-evidence-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={badge.variant} className={badge.className}>
                        {badge.label}
                      </Badge>
                      {e.location && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {e.location}
                        </span>
                      )}
                    </div>
                    <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-secondary/50 p-2 text-xs">
                      {e.quote}
                    </pre>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Afirmações */}
          <section data-testid="rs-claims">
            <div className="hud-label mb-2">{t("rs_claims")}</div>
            {detail.claims.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("rs_none")}</p>
            )}
            <div className="space-y-2">
              {detail.claims.map((c) => (
                <div key={c.id} className="hud-panel p-3" data-testid="rs-claim-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {labelFrom(CS_KEYS, c.status, t)}
                    </Badge>
                    <span className="flex-1 text-sm">{c.statement}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Conflitos */}
          <section data-testid="rs-conflicts">
            <div className="hud-label mb-2">{t("rs_conflicts")}</div>
            {detail.conflicts.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("rs_none")}</p>
            )}
            <div className="space-y-2">
              {detail.conflicts.map((c) => (
                <div key={c.id} className="hud-panel p-3" data-testid="rs-conflict-row">
                  <p className="text-sm">{c.description}</p>
                  {c.resolution && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("rs_resolution")}: {c.resolution}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Relatório: markdown em <pre> + citações numeradas */}
          <section className="hud-panel space-y-3 p-4" data-testid="rs-report-panel">
            <div className="flex flex-wrap items-center gap-2">
              <div className="hud-label flex-1">{t("rs_report")}</div>
              <div className="flex flex-wrap gap-1">
                {detail.reports.map((r) => (
                  <Badge key={r.id} variant="outline" className="font-mono text-[10px]">
                    <FileText className="mr-1 h-3 w-3" />v{r.version}
                  </Badge>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => loadReport(detail.id)}>
                {t("rs_load_report")}
              </Button>
            </div>
            {report ? (
              <div className="space-y-3" data-testid="rs-report">
                <pre className="whitespace-pre-wrap rounded-md border border-border bg-secondary/50 p-3 text-sm">
                  {report.content}
                </pre>
                <div>
                  <div className="hud-label">{t("rs_citations")}</div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {report.citations.map((c) => (
                      <li key={c.n}>
                        [{c.n}] ({c.origin === "hub" ? t("rs_origin_hub") : t("rs_origin_web")}){" "}
                        {c.title}
                        {c.domain ? ` · ${c.domain}` : ""}
                        {c.url ? (
                          <>
                            {" — "}
                            <a
                              className="text-primary hover:underline"
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {c.url}
                            </a>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("rs_no_report")}</p>
            )}
          </section>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Lista de investigações */}
          <section>
            <div className="hud-label mb-2">{t("rs_list")}</div>
            {items !== null && items.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("rs_empty")}</p>
            )}
            <div className="space-y-3">
              {(items ?? []).map((p) => {
                const badge = researchStatusBadge(p.status, statusLabels);
                return (
                  <div key={p.id} className="hud-panel p-4" data-testid="rs-row">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={badge.variant} className={badge.className}>
                        {badge.label}
                      </Badge>
                      <span className="flex-1 text-sm">{p.question}</span>
                      <Button size="sm" variant="outline" onClick={() => open(p.id)}>
                        <Telescope className="h-3 w-3" />
                        {t("rs_open")}
                      </Button>
                    </div>
                    <div className="hud-label mt-2 text-xs">
                      {t("rs_sources")}: {p.sources.length} · {t("rs_evidence")}:{" "}
                      {p.evidence.length} · {t("rs_reports")}: {p.reports.length}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Nova investigação */}
          <aside className="hud-panel space-y-3 self-start p-4" data-testid="rs-form">
            <div className="hud-label">{t("rs_new")}</div>
            <Textarea
              rows={3}
              placeholder={t("rs_question")}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Textarea
              rows={2}
              placeholder={t("rs_scope")}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
            <Button className="w-full" onClick={create} disabled={!question.trim()}>
              <Plus className="h-3 w-3" />
              {t("rs_create")}
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}
