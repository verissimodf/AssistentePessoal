// Fase I — Diagnóstico Operacional (etapas 1–3): aba SOMENTE LEITURA.
// A rota /api/diagnostics é restrita à sessão administrativa verificada e não dispara
// sondas externas; esta tela apenas apresenta o inventário tipado (estado + evidência +
// limitação). Não há nenhuma ação de mutação aqui além de recarregar a leitura.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  loadDiagnostics,
  useAuthState,
  type DiagnosticInventory,
  type DiagnosticItem,
} from "@/lib/bridge";
import { useI18n, type Lang } from "@/lib/i18n";

const TX: Record<Lang, Record<string, string>> = {
  pt: {
    demo: "Disponível apenas com o Jarvis local conectado (sessão administrativa).",
    refresh: "Atualizar",
    generated: "Gerado em",
    health_ok: "Serviço operacional",
    health_att: "Requer atenção",
    total: "itens",
    pendings: "pendências",
    sem_data: "sem data",
    carregando: "Carregando…",
    erro_carregar: "Falha ao carregar",
    f_impl: "Implementado",
    f_hab: "Habilitado",
    f_test: "Testado",
    confianca: "Confiança",
    sec_servico: "Serviço e banco",
    sec_ferramenta: "Ferramentas",
    sec_acesso: "Permissões",
    sec_integracao: "Integrações e modelos",
    sec_automacao: "Automações",
    sec_dados: "Dados",
    testes: "Testes referenciados",
    riscos: "Riscos identificados",
    oportunidades: "Oportunidades",
    decisoes: "Decisões e pendências registradas",
    notas: "Notas",
  },
  en: {
    demo: "Available only with local Jarvis connected (admin session).",
    refresh: "Refresh",
    generated: "Generated at",
    health_ok: "Service operational",
    health_att: "Needs attention",
    total: "items",
    pendings: "pending",
    sem_data: "no date",
    carregando: "Loading…",
    erro_carregar: "Failed to load",
    f_impl: "Implemented",
    f_hab: "Enabled",
    f_test: "Tested",
    confianca: "Confidence",
    sec_servico: "Service & database",
    sec_ferramenta: "Tools",
    sec_acesso: "Permissions",
    sec_integracao: "Integrations & models",
    sec_automacao: "Automations",
    sec_dados: "Data",
    testes: "Referenced tests",
    riscos: "Identified risks",
    oportunidades: "Opportunities",
    decisoes: "Recorded decisions & pending items",
    notas: "Notes",
  },
  es: {
    demo: "Disponible solo con Jarvis local conectado (sesión administrativa).",
    refresh: "Actualizar",
    generated: "Generado en",
    health_ok: "Servicio operativo",
    health_att: "Requiere atención",
    total: "ítems",
    pendings: "pendientes",
    sem_data: "sin fecha",
    carregando: "Cargando…",
    erro_carregar: "Fallo al cargar",
    f_impl: "Implementado",
    f_hab: "Habilitado",
    f_test: "Probado",
    confianca: "Confianza",
    sec_servico: "Servicio y base",
    sec_ferramenta: "Herramientas",
    sec_acesso: "Permisos",
    sec_integracao: "Integraciones y modelos",
    sec_automacao: "Automatizaciones",
    sec_dados: "Datos",
    testes: "Pruebas referenciadas",
    riscos: "Riesgos identificados",
    oportunidades: "Oportunidades",
    decisoes: "Decisiones y pendientes registrados",
    notas: "Notas",
  },
};

const CORES: Record<string, string> = {
  OPERACIONAL: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
  HABILITADO: "border-sky-500/40 bg-sky-500/15 text-sky-400",
  TESTADO: "border-teal-500/40 bg-teal-500/15 text-teal-400",
  IMPLEMENTADO: "border-slate-500/40 bg-slate-500/15 text-slate-300",
  "NÃO TESTADO": "border-amber-500/40 bg-amber-500/15 text-amber-400",
  BLOQUEADO: "border-red-500/40 bg-red-500/15 text-red-400",
  INDISPONÍVEL: "border-orange-500/40 bg-orange-500/15 text-orange-400",
  DESCONHECIDO: "border-zinc-500/40 bg-zinc-500/15 text-zinc-400",
};

const ORDEM: Array<[string, string]> = [
  ["servico", "sec_servico"],
  ["ferramenta", "sec_ferramenta"],
  ["acesso", "sec_acesso"],
  ["integracao", "sec_integracao"],
  ["automacao", "sec_automacao"],
  ["dados", "sec_dados"],
];

function ItemCard({ it, x }: { it: DiagnosticItem; x: (k: string) => string }) {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{it.nome}</h4>
        <span
          className={`rounded border px-2 py-0.5 text-[11px] font-medium ${CORES[it.estado] || CORES["DESCONHECIDO"]}`}
        >
          {it.estado}
        </span>
      </header>
      <div className="flex flex-wrap gap-1 text-[10px] text-muted-foreground">
        <span className="rounded bg-secondary px-1.5 py-0.5">
          {x("f_impl")}: {it.flags.implementado ? "sim" : "não"}
        </span>
        <span className="rounded bg-secondary px-1.5 py-0.5">
          {x("f_hab")}: {it.flags.habilitado ? "sim" : "não"}
        </span>
        <span className="rounded bg-secondary px-1.5 py-0.5">
          {x("f_test")}: {it.flags.testado ? "sim" : "não"}
        </span>
        <span className="rounded bg-secondary px-1.5 py-0.5">
          {x("confianca")}: {it.confianca}
        </span>
      </div>
      {it.detalhes && (
        <p className="break-words font-mono text-[11px] text-muted-foreground">
          {Object.entries(it.detalhes)
            .filter(([, v]) => v !== null && v !== undefined)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(" · ")}
        </p>
      )}
      <ul className="space-y-1">
        {it.evidencias.map((e, i) => (
          <li key={i} className="text-[11px] text-muted-foreground">
            <span className="font-mono">[{e.metodo}]</span> {e.ref}
            {e.data ? ` · ${new Date(e.data).toLocaleString()}` : ` · ${x("sem_data")}`}
            {e.nota ? <span className="opacity-80"> — {e.nota}</span> : null}
          </li>
        ))}
      </ul>
      {it.limitacoes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-amber-500/90">
          {it.limitacoes.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DiagnosticoPanel() {
  const state = useAuthState();
  const { lang } = useI18n();
  const x = (k: string) => TX[lang][k] ?? TX.pt[k] ?? k;
  const [inv, setInv] = useState<DiagnosticInventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = async () => {
    setBusy(true);
    setErro(null);
    try {
      setInv(await loadDiagnostics());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (state === "ok") carregar().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (state !== "ok") return <p className="text-sm text-muted-foreground">{x("demo")}</p>;

  const listas: Array<[string, string[]]> = inv
    ? [
        ["riscos", inv.riscos],
        ["oportunidades", inv.oportunidades],
        ["decisoes", inv.decisoesHumanas],
        ["notas", inv.notas],
      ]
    : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => carregar()} disabled={busy}>
          {x("refresh")}
        </Button>
        {inv && (
          <span
            className={`rounded border px-2 py-0.5 text-xs ${inv.resumo.saude === "ok" ? CORES["OPERACIONAL"] : CORES["NÃO TESTADO"]}`}
          >
            {inv.resumo.saude === "ok" ? x("health_ok") : x("health_att")}
          </span>
        )}
        {inv && (
          <span className="text-xs text-muted-foreground">
            {x("generated")} {new Date(inv.generatedAt).toLocaleString()} · {inv.resumo.total}{" "}
            {x("total")} · {inv.resumo.pendencias} {x("pendings")}
          </span>
        )}
        {inv && (
          <span className="font-mono text-[11px] text-muted-foreground">
            app {inv.versao.app ?? "?"} · schema {inv.versao.banco ?? "?"} · {inv.versao.node ?? ""}
          </span>
        )}
      </header>

      {erro && (
        <p className="text-sm text-red-400">
          {x("erro_carregar")}: {erro}
        </p>
      )}
      {!inv && (
        <p className="text-sm text-muted-foreground">{busy ? x("carregando") : x("demo")}</p>
      )}

      {inv &&
        ORDEM.map(([cat, chave]) => {
          const itens = inv.itens.filter((i) => i.categoria === cat);
          if (!itens.length) return null;
          return (
            <section key={cat} className="space-y-3">
              <h3 className="hud-label">{x(chave)}</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {itens.map((it) => (
                  <ItemCard key={it.id} it={it} x={x} />
                ))}
              </div>
            </section>
          );
        })}

      {inv && (
        <section className="space-y-2">
          <h3 className="hud-label">{x("testes")}</h3>
          <div className="flex flex-wrap gap-1">
            {inv.testes.map((t) => (
              <span
                key={t.arquivo}
                title={t.area}
                className="rounded bg-secondary px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {t.arquivo.replace("tests/", "")}
              </span>
            ))}
          </div>
        </section>
      )}

      {inv &&
        listas.map(([chave, lista]) => (
          <section key={chave} className="space-y-2">
            <h3 className="hud-label">{x(chave)}</h3>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {lista.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
