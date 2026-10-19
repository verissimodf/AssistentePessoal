import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck, Upload } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { inspectSkill, type SkillVerdict } from "@/lib/bridge";
import { useI18n, type TKey } from "@/lib/i18n";

export const Route = createFileRoute("/skills")({
  head: () => ({
    meta: [
      { title: "Skills — Jarvis" },
      {
        name: "description",
        content:
          "Inspeção de segurança de Skills candidatas (análise estática). Não instala nem ativa nada.",
      },
      { property: "og:title", content: "Skills — Jarvis" },
      { property: "og:description", content: "Barreira de segurança pré-instalação de Skills." },
    ],
  }),
  component: SkillsPage,
});

/** Decisão do gate → rótulo (conjunto fechado do contrato HTTP). */
const decisionKey = (d: string): TKey =>
  d === "passed"
    ? "sk_dec_passed"
    : d === "failed"
      ? "sk_dec_failed"
      : d === "incomplete"
        ? "sk_dec_incomplete"
        : "sk_dec_blocked";
const decisionClass = (d: string) =>
  d === "passed"
    ? "border-chart-3 text-chart-3"
    : d === "failed"
      ? "border-destructive text-destructive"
      : "border-accent text-accent";

/**
 * Erro da chamada → chave de mensagem (conjunto fechado). `api()` lança "<status>: <corpo>" e
 * `inspectSkill` lança "bridge_offline". Mostramos só status + código de erro conhecido do
 * backend — nunca o corpo bruto (que poderia conter detalhes internos).
 */
const errorKey = (e: unknown): TKey => {
  const msg = String((e as Error)?.message ?? "");
  if (msg === "bridge_offline") return "sk_err_offline";
  const status = msg.slice(0, 4).replace(/\D/g, "");
  if (status === "401") return "sk_err_401";
  if (status === "413") return "sk_err_413";
  if (status === "400") {
    if (msg.includes("skill_manifest_must_be_skill_md")) return "sk_err_name";
    if (msg.includes("skill_file_required") || msg.includes("skill_file_empty")) return "sk_err_file";
    return "sk_err_400";
  }
  return "sk_err_generic";
};

export function SkillsPage() {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<SkillVerdict | null>(null);
  const [errorKeyState, setErrorKeyState] = useState<TKey | null>(null);

  const pick = (f: File | undefined) => {
    setFile(f ?? null);
    setVerdict(null);
    setErrorKeyState(null);
  };

  const inspect = async () => {
    if (!file || busy) return;
    // O backend exige o nome exato SKILL.md (fonte da verdade). Aqui só antecipamos a mensagem.
    if (file.name.toLowerCase() !== "skill.md") {
      setErrorKeyState("sk_err_name");
      return;
    }
    setBusy(true);
    setErrorKeyState(null);
    try {
      const v = await inspectSkill(file);
      setVerdict(v);
      toast.success(t("sk_done"));
    } catch (e) {
      // Falha explícita (offline, 401, 400, 413, rede) — nunca falso sucesso nem fallback demo.
      setVerdict(null);
      setErrorKeyState(errorKey(e));
      toast.error(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  // Campos são exibidos APENAS quando presentes na resposta real — sem inventar valores.
  const hash = verdict?.artifact?.hash?.digest ?? null;
  const scannerVersion = verdict?.scan?.version ?? null;
  const decision = verdict?.result?.decision ?? null;
  // Sem histórico: não existe endpoint de consulta de vereditos e nada é simulado aqui.

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("sk_title")} sub={t("sk_sub")} />

      <p className="mb-6 rounded-lg border border-accent bg-accent/10 px-4 py-3 text-sm text-foreground" role="note" data-testid="sk-notice">
        {t("sk_notice")}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".md,text/markdown"
            className="hidden"
            aria-label={t("sk_pick")}
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <span className="inline-flex items-center gap-2 rounded-md border border-input bg-secondary px-4 py-2 text-sm hover:bg-secondary/80">
            <Upload className="h-4 w-4" />
            {t("sk_pick")}
          </span>
        </label>
        <Button size="sm" onClick={inspect} disabled={busy || !file}>
          <ShieldCheck className="h-4 w-4" />
          {busy ? t("sk_busy") : t("sk_inspect")}
        </Button>
        {file && <span className="text-xs text-muted-foreground">{file.name}</span>}
      </div>

      {!file && !verdict && !errorKeyState && (
        <p className="mt-6 text-sm text-muted-foreground" data-testid="sk-empty">{t("sk_empty")}</p>
      )}

      {errorKeyState && (
        <p className="mt-6 text-sm text-destructive" role="alert" data-testid="sk-error">{t(errorKeyState)}</p>
      )}

      {verdict && decision && (
        <div className="mt-6 max-w-2xl rounded-lg border border-border p-4" data-testid="sk-verdict">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={decisionClass(decision)} data-testid="sk-decision">
              {t(decisionKey(decision))}
            </Badge>
            <span className="text-xs text-muted-foreground">{t("sk_done")} {verdict.finishedAt}</span>
          </div>
          <p className="mt-3 text-sm">{verdict.result?.reason}</p>

          <dl className="mt-4 space-y-1 text-sm">
            {hash && (<><dt className="text-muted-foreground">{t("sk_hash")}</dt><dd className="font-mono text-xs break-all" data-testid="sk-hash">{hash}</dd></>)}
            {scannerVersion && (<><dt className="text-muted-foreground">{t("sk_scanner")}</dt><dd data-testid="sk-scanner">{verdict.scan?.scanner} {scannerVersion}</dd></>)}
            {typeof verdict.result?.issueCount === "number" && (
              <><dt className="text-muted-foreground">{t("sk_findings")}</dt><dd data-testid="sk-findings">{verdict.result.issueCount}</dd></>
            )}
            {typeof verdict.scan?.coveragePercent === "number" && (
              <><dt className="text-muted-foreground">{t("sk_coverage")}</dt><dd data-testid="sk-coverage">{verdict.scan.coveragePercent}%</dd></>
            )}
          </dl>

          <div className="mt-4" data-testid="sk-constraints">
            <div className="text-xs font-medium text-muted-foreground">{t("sk_constraints")}</div>
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              <li>{t("sk_c_perms")}</li>
              <li>{t("sk_c_activation")}</li>
              <li>{t("sk_c_exec")}</li>
              <li>{t("sk_c_review")}</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
