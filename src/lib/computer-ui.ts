// Helper de UI do Computer Studio (Fase 5) — arquivo separado para manter a rota
// exportando apenas componentes (react-refresh/only-export-components).
export type CiUiBadge = {
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
  className: string;
};

/** Rótulos padrão (pt-BR) de sessões, ações de plano e procedimentos. */
export const DEFAULT_CI_LABELS: Record<string, string> = {
  // sessões
  active: "Ativa",
  closed: "Encerrada",
  failed: "Falhou",
  // ações de plano
  planned: "Planejada",
  running: "Em execução",
  succeeded: "Bem-sucedida",
  verification_pending: "Aguardando aprovação",
  unknown: "Desconhecida",
  reconciling: "Reconciliando",
  cancelled: "Cancelada",
  blocked: "Bloqueada",
  // procedimentos
  observed: "Observado",
  inferred: "Inferido",
  tested: "Testado",
  validated: "Validado",
  deprecated: "Descontinuado",
};

/**
 * Status → badge (uma função, um mapa de cores por grupo):
 *  - sessões: active = verde, closed = cinza, failed = vermelho;
 *  - ações: running = azul, verification_pending/reconciling = amarelo,
 *    succeeded = verde, failed/unknown/blocked = vermelho (unknown com anel),
 *    planned/cancelled = cinza;
 *  - procedimentos: observed = cinza, inferred = amarelo, tested = azul,
 *    validated = verde, deprecated = vermelho.
 * Rótulos recebidos como parâmetro (com default pt-BR) — nenhuma label fixa aqui.
 */
export function ciStatusBadge(
  status: string,
  labels: Record<string, string> = DEFAULT_CI_LABELS,
): CiUiBadge {
  const colors: Record<string, { variant: CiUiBadge["variant"]; className: string }> = {
    // sessões
    active: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    closed: { variant: "outline", className: "text-muted-foreground" },
    failed: { variant: "destructive", className: "" },
    // ações de plano
    planned: { variant: "outline", className: "" },
    running: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    succeeded: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    verification_pending: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    unknown: { variant: "destructive", className: "ring-2 ring-destructive/50" },
    reconciling: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    cancelled: { variant: "outline", className: "text-muted-foreground" },
    blocked: { variant: "destructive", className: "" },
    // procedimentos
    observed: { variant: "outline", className: "text-muted-foreground" },
    inferred: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    tested: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    validated: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    deprecated: { variant: "destructive", className: "" },
  };
  const hit = colors[status] ?? { variant: "outline" as const, className: "text-muted-foreground" };
  return { variant: hit.variant, label: labels[status] ?? status, className: hit.className };
}
