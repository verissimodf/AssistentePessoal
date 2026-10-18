import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  listApprovals,
  listExecutions,
  loadAudit,
  loadDiagnostics,
  loadSessionFocus,
  saveSessionFocus,
  useBridgeStatus,
  type ApprovalRow,
  type AuditRow,
  type ExecutionRow,
  type SessionFocus,
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

// Metadados de build reais: um campo `unknown`/ausente significa "o build não os injetou" — o
// painel diz "Não registrado" em vez de derivar uma versão do branch atual (que pode não ser
// a árvore que a imagem realmente contém).
type Health = { ok?: boolean; version?: string; commit?: string; buildTime?: string; setupRequired?: boolean };

const UNKNOWN_RE = /^unknown$/i;
const known = (v?: string | null): string | null =>
  typeof v === "string" && v.trim() && !UNKNOWN_RE.test(v.trim()) ? v.trim() : null;

// Foco da sessão normalizado: um payload parcial/inesperado vira estado VAZIO explícito em vez
// de campo `undefined` (input não controlado) ou de um objetivo de demonstração.
const normFocus = (f: Partial<SessionFocus> | null | undefined): SessionFocus => ({
  objective: typeof f?.objective === "string" ? f.objective : "",
  summary: typeof f?.summary === "string" ? f.summary : "",
  decisions: Array.isArray(f?.decisions) ? f.decisions.filter((d): d is string => typeof d === "string") : [],
  updatedAt: typeof f?.updatedAt === "string" ? f.updatedAt : null,
});

function OverviewPage() {
  const { t } = useI18n();
  const online = useBridgeStatus();
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [diag, setDiag] = useState<{
    versao?: {
      app?: string | null;
      commit?: string | null;
      buildTime?: string | null;
      banco?: number | null;
      node?: string | null;
      uptimeSegundos?: number;
    };
  } | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRow[] | null>(null);
  const [execs, setExecs] = useState<ExecutionRow[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [at, setAt] = useState<string>("");

  // Foco da sessão: objetivo/resumo/decisões EXPLÍCITOS (editáveis, por dono, persistidos no
  // backend). `null` = offline/indisponível — nunca um objetivo de demonstração.
  const [focus, setFocus] = useState<SessionFocus | null>(null);
  const [draft, setDraft] = useState<{ objective: string; summary: string; decisions: string[] }>({
    objective: "",
    summary: "",
    decisions: [],
  });
  const [decInput, setDecInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [focusErr, setFocusErr] = useState<string | null>(null);
  // O rascunho é carregado uma única vez: "Atualizar" não apaga o que o administrador está a digitar.
  const draftLoaded = useRef(false);

  const load = async () => {
    setLoading(true);
    const [h, d, a, e, au, sf] = await Promise.all([
      online ? api<Health>("/api/health").catch(() => null) : Promise.resolve(null),
      loadDiagnostics(),
      listApprovals(),
      listExecutions(),
      loadAudit(),
      loadSessionFocus().catch(() => null),
    ]);
    setHealth(h);
    setDiag(d);
    setApprovals(a);
    setExecs(e);
    setAudit(au);
    const f = sf === null ? null : normFocus(sf);
    setFocus(f);
    if (f && !draftLoaded.current) {
      draftLoaded.current = true;
      setDraft({ objective: f.objective, summary: f.summary, decisions: [...f.decisions] });
    }
    setAt(new Date().toISOString());
    setLoading(false);
  };
  useEffect(() => {
    load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [online]);

  const edit = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSavedAt(null);
    setFocusErr(null);
  };
  const addDecision = () => {
    const v = decInput.trim();
    if (!v) return;
    edit({ decisions: [...draft.decisions, v] });
    setDecInput("");
  };
  const dropDecision = (i: number) => edit({ decisions: draft.decisions.filter((_, x) => x !== i) });
  const saveFocus = async () => {
    setSaving(true);
    setFocusErr(null);
    try {
      const next = normFocus(await saveSessionFocus(draft));
      setFocus(next);
      setDraft({ objective: next.objective, summary: next.summary, decisions: [...next.decisions] });
      setSavedAt(new Date().toISOString());
    } catch {
      setFocusErr(t("ov_focus_err"));
    } finally {
      setSaving(false);
    }
  };

  const pending = (approvals ?? []).filter((a) => a.status === "pending" || a.status === "running");
  // Atenção = falha/interrupção/desconhecido OU pós-condição comprovadamente FALHOU.
  // `unverified` num shell concluído é o estado normal (não há pós-condição genérica), então
  // não é alerta — só `failed` (evidência de falha do objetivo) entra aqui.
  const attention = (execs ?? []).filter(
    (e) => ATTENTION.has(e.state) || e.verification === "failed",
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
                {/* Release = manifesto; se o build não injetou, mostra "Não registrado" e nunca
                    deriva do branch atual (a imagem pode conter outra árvore). */}
                {known(health?.version) ?? known(diag?.versao?.app) ?? t("ov_not_recorded")}
              </span>
            </div>
            <div className="text-muted-foreground">
              {t("ov_schema")}:{" "}
              <span className="font-mono text-foreground">{diag?.versao?.banco ?? "—"}</span>
            </div>
            <div className="text-muted-foreground">
              {t("ov_commit")}:{" "}
              {/* SHA reais injetados pelo build (`--build-arg GIT_SHA` → label OCI + JSON). */}
              <span className="font-mono text-foreground">
                {known(health?.commit) ?? known(diag?.versao?.commit) ?? t("ov_not_recorded")}
              </span>
            </div>
            {known(health?.buildTime) && (
              <div className="text-muted-foreground">
                {t("ov_build_time")}:{" "}
                <span className="font-mono text-foreground">{known(health?.buildTime)}</span>
              </div>
            )}
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
          <CardTitle className="text-sm">{t("ov_focus")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {focus === null ? (
            // Sem backend não há foco a mostrar — indisponível, nunca um objetivo de demonstração.
            <p className="text-sm text-muted-foreground">{t("ov_unavailable")}</p>
          ) : (
            <>
              <div className="space-y-1">
                <p className="hud-label text-xs text-muted-foreground">{t("goal")}</p>
                <Textarea
                  rows={2}
                  maxLength={500}
                  aria-label={t("goal")}
                  placeholder={t("ov_focus_none")}
                  value={draft.objective}
                  onChange={(e) => edit({ objective: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <p className="hud-label text-xs text-muted-foreground">{t("ov_focus_sum")}</p>
                <Textarea
                  rows={4}
                  maxLength={4000}
                  aria-label={t("ov_focus_sum")}
                  value={draft.summary}
                  onChange={(e) => edit({ summary: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <p className="hud-label text-xs text-muted-foreground">{t("ov_focus_dec")}</p>
                {draft.decisions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("ov_none")}</p>
                ) : (
                  <ul className="space-y-1">
                    {draft.decisions.map((d, i) => (
                      <li key={`${i}-${d}`} className="flex items-center gap-2 text-sm">
                        <span className="flex-1">{d}</span>
                        <Button size="sm" variant="ghost" aria-label={t("delete")} onClick={() => dropDecision(i)}>
                          ×
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <Input
                    value={decInput}
                    maxLength={400}
                    aria-label={t("ov_focus_dec")}
                    placeholder={t("ov_focus_dec")}
                    onChange={(e) => setDecInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addDecision();
                      }
                    }}
                  />
                  <Button size="sm" variant="outline" onClick={addDecision}>
                    {t("add")}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={saveFocus} disabled={saving || !online}>
                  {t("save")}
                </Button>
                {savedAt && (
                  <span className="text-xs text-chart-3">
                    {t("ov_focus_saved")} · {new Date(savedAt).toLocaleTimeString()}
                  </span>
                )}
                {focusErr && <span className="text-xs text-destructive">{focusErr}</span>}
                <span className="text-xs text-muted-foreground">
                  {focus.updatedAt ? new Date(focus.updatedAt).toLocaleString() : "—"}
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

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
            {/* Derivado de dados reais (aprovações/execuções), não de texto editável. */}
            {t("ov_pending")} → {nextAction} · {t("ov_derived")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
