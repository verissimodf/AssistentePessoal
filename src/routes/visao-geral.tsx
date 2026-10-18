import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  api,
  listApprovals,
  listExecutions,
  loadAudit,
  loadDiagnostics,
  useBridgeStatus,
  type ApprovalRow,
  type AuditRow,
  type ExecutionRow,
} from "@/lib/bridge";
import { useI18n, type TKey } from "@/lib/i18n";

export const Route = createFileRoute("/visao-geral")({
  head: () => ({
    meta: [
      { title: "Visão geral — Jarvis" },
      {
        name: "description",
        content:
          "Estado operacional do Jarvis: saúde, versão, aprovações pendentes, execuções e auditoria.",
      },
      { property: "og:title", content: "Visão geral — Jarvis" },
      { property: "og:description", content: "Painel operacional do Jarvis." },
    ],
  }),
  component: OverviewPage,
});

const ATTENTION = new Set(["failed", "error", "timeout", "overflow", "unknown"]);
const stateKey = (s: string): TKey =>
  s === "completed"
    ? "st_completed"
    : s === "failed" || s === "error"
      ? "st_failed"
      : s === "denied" || s === "cancelled"
        ? "st_denied"
        : s === "timeout" || s === "overflow"
          ? "st_interrupted"
          : "st_unknown";

type Health = { ok?: boolean; version?: string; setupRequired?: boolean };

function OverviewPage() {
  const { t } = useI18n();
  const online = useBridgeStatus();
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [diag, setDiag] = useState<{
    versao?: {
      app?: string | null;
      banco?: number | null;
      node?: string | null;
      uptimeSegundos?: number;
    };
  } | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRow[] | null>(null);
  const [execs, setExecs] = useState<ExecutionRow[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [at, setAt] = useState<string>("");

  const load = async () => {
    setLoading(true);
    const [h, d, a, e, au] = await Promise.all([
      online ? api<Health>("/api/health").catch(() => null) : Promise.resolve(null),
      loadDiagnostics(),
      listApprovals(),
      listExecutions(),
      loadAudit(),
    ]);
    setHealth(h);
    setDiag(d);
    setApprovals(a);
    setExecs(e);
    setAudit(au);
    setAt(new Date().toISOString());
    setLoading(false);
  };
  useEffect(() => {
    load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [online]);

  const pending = (approvals ?? []).filter((a) => a.status === "pending" || a.status === "running");
  const attention = (execs ?? []).filter(
    (e) => ATTENTION.has(e.state) || e.verification === "unverified",
  );
  const nextAction = pending.length ? `${t("ov_pending")}: ${pending.length}` : "—";

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("ov_title")} sub={t("ov_sub")}>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {t("refresh")}
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("ov_health")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${online && health?.ok ? "bg-chart-3" : "bg-accent"}`}
              />
              <span>
                {online ? (health?.ok ? "ok" : t("ov_unavailable")) : t("ov_unavailable")}
              </span>
            </div>
            <div className="text-muted-foreground">
              {t("ov_release")}:{" "}
              <span className="font-mono text-foreground">
                {health?.version ?? diag?.versao?.app ?? "—"}
              </span>
            </div>
            <div className="text-muted-foreground">
              {t("ov_schema")}:{" "}
              <span className="font-mono text-foreground">{diag?.versao?.banco ?? "—"}</span>
            </div>
            <div className="text-muted-foreground">
              {t("ov_commit")}:{" "}
              <span className="font-mono text-foreground">{t("ov_not_recorded")}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("ov_pending")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="text-2xl font-semibold">
              {approvals === null ? "—" : pending.length}
            </div>
            <div className="text-muted-foreground">
              {approvals === null
                ? t("ov_unavailable")
                : pending.length
                  ? pending
                      .slice(0, 2)
                      .map((p) => p.command)
                      .join(" · ")
                  : t("ov_none")}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("ov_attention")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="text-2xl font-semibold">{execs === null ? "—" : attention.length}</div>
            <div className="text-muted-foreground">
              {execs === null
                ? t("ov_unavailable")
                : attention.length
                  ? `${t(stateKey(attention[0]!.state))} · ${attention[0]!.kind}`
                  : t("ov_none")}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{t("ov_last_update")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="font-mono text-xs">{at ? new Date(at).toLocaleString() : "—"}</div>
            <div className="text-muted-foreground">
              {t("ov_uptime")}: {diag?.versao?.uptimeSegundos ?? "—"}s
            </div>
            <div className="text-muted-foreground">
              {t("ov_recent")}: {audit === null ? t("ov_unavailable") : audit.length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("ov_attention")}</CardTitle>
        </CardHeader>
        <CardContent>
          {execs === null ? (
            <p className="text-sm text-muted-foreground">{t("ov_unavailable")}</p>
          ) : attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("ov_none")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {attention.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <Badge variant="outline" className="border-accent text-accent">
                    {t(stateKey(e.state))}
                  </Badge>
                  <span className="font-mono text-xs">{e.kind}</span>
                  <span className="text-muted-foreground text-xs">
                    {new Date(e.at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("ov_recent")}</CardTitle>
        </CardHeader>
        <CardContent>
          {audit === null ? (
            <p className="text-sm text-muted-foreground">{t("ov_unavailable")}</p>
          ) : audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("ov_none")}</p>
          ) : (
            <ul className="space-y-1 font-mono text-xs text-muted-foreground">
              {audit.slice(0, 10).map((r) => (
                <li key={r.id}>
                  {new Date(r.at).toLocaleString()} · {r.kind}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {t("ov_pending")} → {nextAction}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
