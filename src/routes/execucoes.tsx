import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listExecutions, type ExecutionRow } from "@/lib/bridge";
import { useI18n, type TKey } from "@/lib/i18n";

export const Route = createFileRoute("/execucoes")({
  head: () => ({
    meta: [
      { title: "Execuções — Jarvis" },
      {
        name: "description",
        content:
          "Ledger de execução por operação: estado técnico, código de saída e verificação da pós-condição.",
      },
      { property: "og:title", content: "Execuções — Jarvis" },
      { property: "og:description", content: "Ledger de execução e evidências do Jarvis." },
    ],
  }),
  component: ExecutionsPage,
});

/** Estado técnico do processo → rótulo (conjunto fechado do ledger). */
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
const verifKey = (v: string): TKey =>
  v === "verified"
    ? "vf_verified"
    : v === "unverified"
      ? "vf_unverified"
      : v === "failed"
        ? "vf_failed"
        : "vf_unknown";
const stateClass = (s: string) =>
  s === "completed"
    ? "border-chart-3 text-chart-3"
    : s === "failed" || s === "error"
      ? "border-destructive text-destructive"
      : "border-accent text-accent";

function ExecutionsPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<ExecutionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    setRows(await listExecutions()); // null = indisponível (offline); nunca dados de demonstração
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("ex_title")} sub={t("ex_sub")}>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {t("refresh")}
        </Button>
      </PageHeader>

      {rows === null ? (
        <p className="text-sm text-muted-foreground">{t("ov_unavailable")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("ex_empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary/60 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t("col_at")}</th>
                <th className="px-3 py-2">{t("ex_op")}</th>
                <th className="px-3 py-2">{t("col_state")}</th>
                <th className="px-3 py-2">{t("col_exit")}</th>
                <th className="px-3 py-2">{t("col_verif")}</th>
                <th className="px-3 py-2">{t("col_corr")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-border/60">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-muted-foreground">
                    {new Date(e.at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.kind}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={stateClass(e.state)}>
                      {t(stateKey(e.state))}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.exitCode ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    <span
                      className={
                        e.verification === "verified" ? "text-chart-3" : "text-muted-foreground"
                      }
                    >
                      {t(verifKey(e.verification))}
                    </span>
                    <span className="ml-1 text-muted-foreground">· {e.verifiedBy}</span>
                  </td>
                  <td
                    className="px-3 py-2 font-mono text-[10px] text-muted-foreground"
                    title={e.correlation ?? ""}
                  >
                    {e.correlation ? `${e.correlation.slice(0, 8)}…` : "—"}
                    {e.auditId ? <span className="ml-1">· #{e.auditId}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
