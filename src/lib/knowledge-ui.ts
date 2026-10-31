// Helper de UI do Knowledge Hub (Fase 2) — arquivo separado para manter a rota
// exportando apenas componentes (react-refresh/only-export-components).
export type KhBadge = {
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
  className: string;
};

export const DEFAULT_INGEST_LABELS: Record<string, string> = {
  pending: "Pendente",
  processing: "Processando",
  indexed: "Indexado",
  partial: "Parcial",
  failed: "Falhou",
  deleted: "Excluída",
};

/**
 * ingest_status da fonte → badge (variante, rótulo, cor):
 *  - pending/processing/partial = amarelo; indexed = verde;
 *  - failed = vermelho; deleted = cinza.
 * Rótulos são recebidos como parâmetro (com default pt-BR) — nenhuma label fixa aqui.
 */
export function khStatusBadge(
  status: string,
  labels: Record<string, string> = DEFAULT_INGEST_LABELS,
): KhBadge {
  const colors: Record<string, { variant: KhBadge["variant"]; className: string }> = {
    pending: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    processing: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    indexed: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    partial: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    failed: { variant: "destructive", className: "" },
    deleted: { variant: "outline", className: "text-muted-foreground" },
  };
  const hit = colors[status] ?? {
    variant: "outline" as const,
    className: "text-muted-foreground",
  };
  return {
    variant: hit.variant,
    label: labels[status] ?? status,
    className: hit.className,
  };
}
