// Helper de UI da Workforce (evolução Fase 1) — arquivo separado para manter a rota
// exportando apenas componentes (react-refresh/only-export-components).
export type WfBadge = {
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
  className: string;
  verified: boolean;
};

export const DEFAULT_STATUS_LABELS: Record<string, string> = {
  queued: "Na fila",
  running: "Em execução",
  awaiting_approval: "Aguardando aprovação",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
  unknown: "Desconhecido",
};

/** Status do run → badge (variante, cor, rótulo) + flag de verificação do resultado. */
export function workforceStatusBadge(
  status: string,
  verification?: string,
  labels: Record<string, string> = DEFAULT_STATUS_LABELS,
): WfBadge {
  const colors: Record<string, { variant: WfBadge["variant"]; className: string }> = {
    queued: { variant: "outline", className: "" },
    running: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    awaiting_approval: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    completed: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    failed: { variant: "destructive", className: "" },
    cancelled: { variant: "outline", className: "text-muted-foreground" },
    unknown: { variant: "destructive", className: "ring-2 ring-destructive/50" },
  };
  const hit = colors[status] ?? {
    variant: "destructive" as const,
    className: "ring-2 ring-destructive/50",
  };
  return {
    variant: hit.variant,
    label: labels[status] ?? labels["unknown"] ?? "Desconhecido",
    className: hit.className,
    verified: verification === "verified",
  };
}
