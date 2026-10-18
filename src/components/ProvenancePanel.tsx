// Proveniência das configurações (P0.2) — mostra DE ONDE vem cada valor efetivo:
//   padrão (fábrica) · pessoal (registro deste administrador) · global (política da instalação)
// e as variáveis de ambiente do processo. O servidor NUNCA devolve valores: segredos aparecem
// apenas como marca `secret`, e variáveis sensíveis só como "definida/não definida" com a
// indicação de que o valor não é exibido. Sem backend → "Indisponível (offline)".
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { loadProvenance, type Provenance } from "@/lib/bridge";
import { useI18n, type TKey } from "@/lib/i18n";

const ORIGIN_KEY: Record<Provenance["keys"][number]["origin"], TKey> = {
  default: "pv_origin_default",
  personal: "pv_origin_personal",
  global: "pv_origin_global",
};

export function ProvenancePanel() {
  const { t } = useI18n();
  const [prov, setProv] = useState<Provenance | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    loadProvenance()
      .then((p) => alive && setProv(p))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!loaded) return null;
  if (prov === null) return <p className="text-sm text-muted-foreground">{t("ov_unavailable")}</p>;

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">{t("pv_sub")}</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="hud-label border-b border-border/60 text-left">
              <th className="py-1 pr-4">{t("pv_path")}</th>
              <th className="py-1 pr-4">{t("pv_origin")}</th>
              <th className="py-1 pr-4">{t("pv_class")}</th>
            </tr>
          </thead>
          <tbody>
            {prov.keys.map((k) => (
              <tr key={k.path} className="border-b border-border/30">
                <td className="py-1 pr-4 font-mono text-xs">
                  {k.path}
                  {k.secret && (
                    <Badge variant="outline" className="ml-2 align-middle">
                      {t("pv_secret")}
                    </Badge>
                  )}
                </td>
                <td className="py-1 pr-4">{t(ORIGIN_KEY[k.origin])}</td>
                <td className="py-1 pr-4 text-muted-foreground">{k.class}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="hud-label mb-1">{t("pv_env")}</div>
        <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
          {prov.env.reported.map((e) => (
            <li key={e.name}>
              {e.name} = {e.set ? e.value : t("pv_env_unset")}
            </li>
          ))}
          {prov.env.presenceOnly.map((e) => (
            <li key={e.name}>
              {e.name} — {e.set ? t("pv_env_set") : t("pv_env_unset")} · {t("pv_env_hidden")}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
