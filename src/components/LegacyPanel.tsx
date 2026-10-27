// Phase 2: unowned (pre-Phase-2) data. Shows metadata only (type, id, date, key names) and lets
// the signed-in admin explicitly claim items. The server re-validates everything.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/bridge";
import { useI18n, type Lang } from "@/lib/i18n";

type Item = { id: string; date: string | null };
type Inv = {
  resources: Record<string, Item[]>;
  settings: {
    present: boolean;
    claimed?: boolean;
    keys?: { key: string; class: string; secret: boolean }[];
  };
};

const TX: Record<Lang, Record<string, string>> = {
  pt: {
    title: "Dados antigos sem proprietário",
    hint: "Ficam bloqueados até um administrador assumi-los. Só metadados são exibidos; ao assumir, os itens passam a ser seus e a ação é auditada.",
    none: "Nenhum item pendente.",
    claim: "Assumir selecionados",
    settings: "Configurações antigas (bloco inteiro)",
    claimSettings: "Assumir configurações",
    confirm:
      "Confirma assumir estes itens? A ação é registrada e não pode ser desfeita pelo painel.",
    confirmSettings:
      "Confirma assumir todo o bloco de configurações antigas? Só é permitido se você ainda não tiver configurações pessoais.",
    memory: "Memórias",
    agent: "Agentes",
    bot: "Bots",
    run: "Execuções",
    approval: "Aprovações",
    claimed: "já assumidas",
  },
  en: {
    title: "Old data without owner",
    hint: "Blocked until an administrator claims it. Only metadata is shown; claiming makes the items yours and is audited.",
    none: "No pending items.",
    claim: "Claim selected",
    settings: "Old settings (whole block)",
    claimSettings: "Claim settings",
    confirm: "Claim these items? The action is logged and cannot be undone from the panel.",
    confirmSettings:
      "Claim the whole old settings block? Only allowed if you have no personal settings yet.",
    memory: "Memories",
    agent: "Agents",
    bot: "Bots",
    run: "Runs",
    approval: "Approvals",
    claimed: "already claimed",
  },
  es: {
    title: "Datos antiguos sin propietario",
    hint: "Quedan bloqueados hasta que un administrador los asuma. Solo se muestran metadatos; al asumirlos pasan a ser tuyos y se audita.",
    none: "No hay elementos pendientes.",
    claim: "Asumir seleccionados",
    settings: "Configuración antigua (bloque completo)",
    claimSettings: "Asumir configuración",
    confirm:
      "¿Asumir estos elementos? La acción se registra y no se puede deshacer desde el panel.",
    confirmSettings:
      "¿Asumir todo el bloque de configuración antigua? Solo si aún no tienes configuración personal.",
    memory: "Memorias",
    agent: "Agentes",
    bot: "Bots",
    run: "Ejecuciones",
    approval: "Aprobaciones",
    claimed: "ya asumida",
  },
};

export function LegacyPanel() {
  const { lang } = useI18n();
  const x = (k: string) => TX[lang][k] ?? k;
  const [inv, setInv] = useState<Inv | null>(null);
  const [sel, setSel] = useState<Record<string, string[]>>({});
  const load = async () => {
    setInv(await api<Inv>("/api/legacy"));
    setSel({});
  };
  useEffect(() => {
    load().catch(() => undefined);
  }, []);
  if (!inv) return null;

  const run = async (f: () => Promise<unknown>) => {
    try {
      await f();
      await load();
      toast.success("OK");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const types = Object.entries(inv.resources).filter(([, l]) => l.length);
  const toggle = (t: string, id: string, on: boolean) =>
    setSel((s) => ({
      ...s,
      [t]: on ? [...(s[t] || []), id] : (s[t] || []).filter((i) => i !== id),
    }));

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4 md:col-span-2">
      <h3 className="hud-label">{x("title")}</h3>
      <p className="text-xs text-muted-foreground">{x("hint")}</p>
      {!types.length && !(inv.settings.present && !inv.settings.claimed) && (
        <p className="text-sm text-muted-foreground">{x("none")}</p>
      )}
      {types.map(([t, list]) => (
        <div key={t} className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-display text-sm">
              {x(t)} ({list.length})
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={!sel[t]?.length}
              onClick={() =>
                window.confirm(x("confirm")) &&
                run(() =>
                  api("/api/legacy/claim", {
                    method: "POST",
                    body: JSON.stringify({ type: t, ids: sel[t], confirm: "ASSUMIR" }),
                  }),
                )
              }
            >
              {x("claim")}
            </Button>
          </div>
          <div className="max-h-40 overflow-auto">
            {list.map((i) => (
              <label key={i.id} className="flex items-center gap-2 font-mono text-xs">
                <input
                  type="checkbox"
                  checked={!!sel[t]?.includes(i.id)}
                  onChange={(e) => toggle(t, i.id, e.target.checked)}
                />
                {i.id}
                {i.date ? ` · ${i.date}` : ""}
              </label>
            ))}
          </div>
        </div>
      ))}
      {inv.settings.present && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-display text-sm">
              {x("settings")}
              {inv.settings.claimed ? ` — ${x("claimed")}` : ""}
            </span>
            {!inv.settings.claimed && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  window.confirm(x("confirmSettings")) &&
                  run(() =>
                    api("/api/legacy/settings/claim", {
                      method: "POST",
                      body: JSON.stringify({ confirm: "ASSUMIR CONFIGURACOES" }),
                    }),
                  )
                }
              >
                {x("claimSettings")}
              </Button>
            )}
          </div>
          <div className="max-h-40 overflow-auto font-mono text-xs text-muted-foreground">
            {inv.settings.keys?.map((k) => (
              <div key={k.key}>
                {k.key} · {k.class}
                {k.secret ? " · 🔒" : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
