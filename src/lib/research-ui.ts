// Helper de UI do Deep Research / Learning Studio (Fase 4) — arquivo separado para
// manter a rota exportando apenas componentes (react-refresh/only-export-components).
export type RsBadge = {
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
  className: string;
};

/** Rótulos padrão (pt-BR) de status de projeto de pesquisa. */
export const DEFAULT_RESEARCH_STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  planning: "Planejando",
  running: "Em execução",
  waiting: "Aguardando",
  completed: "Concluído",
  partial: "Parcial",
  inconclusive: "Inconclusivo",
  failed: "Falhou",
  cancelled: "Cancelado",
  unknown: "Desconhecido",
};

/** Rótulos padrão (pt-BR) de tipo de evidência. */
export const DEFAULT_EVIDENCE_TYPE_LABELS: Record<string, string> = {
  direct: "Direta",
  indirect: "Indireta",
  inference: "Inferência",
  hypothesis: "Hipótese",
  gap: "Lacuna",
};

/** Rótulos padrão (pt-BR) de veredito de tentativa de exercício. */
export const DEFAULT_ATTEMPT_LABELS: Record<"true" | "false" | "null", string> = {
  true: "Correto",
  false: "Incorreto",
  null: "Indeterminado",
};

/**
 * Rótulo com fallback para o valor bruto quando a chave não está no mapa
 * (preserva o tipo de chave do dicionário i18n).
 */
export function labelFrom<K extends string>(
  map: Record<string, K>,
  value: string,
  t: (k: K) => string,
): string {
  const key = map[value];
  return key ? t(key) : value;
}

/**
 * Status de projeto de pesquisa → badge:
 *  - running/planning = azul; completed = verde;
 *  - partial/inconclusive/waiting = amarelo;
 *  - failed/cancelled = vermelho; unknown = vermelho com anel; draft = cinza.
 * Rótulos são recebidos como parâmetro (com default pt-BR) — nenhuma label fixa aqui.
 */
export function researchStatusBadge(
  status: string,
  labels: Record<string, string> = DEFAULT_RESEARCH_STATUS_LABELS,
): RsBadge {
  const colors: Record<string, { variant: RsBadge["variant"]; className: string }> = {
    draft: { variant: "outline", className: "" },
    planning: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    running: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    waiting: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    completed: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    partial: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    inconclusive: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    failed: { variant: "destructive", className: "" },
    cancelled: { variant: "destructive", className: "" },
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
  };
}

/**
 * Tipo de evidência → badge: direct = verde; indirect = azul; inference = amarelo;
 * hypothesis = cinza; gap = vermelho (indica o que falta, não um fato).
 * Rótulos recebidos como parâmetro (com default pt-BR).
 */
export function evidenceTypeBadge(
  type: string,
  labels: Record<string, string> = DEFAULT_EVIDENCE_TYPE_LABELS,
): RsBadge {
  const colors: Record<string, { variant: RsBadge["variant"]; className: string }> = {
    direct: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    indirect: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    inference: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    hypothesis: { variant: "outline", className: "text-muted-foreground" },
    gap: { variant: "destructive", className: "" },
  };
  const hit = colors[type] ?? {
    variant: "outline" as const,
    className: "text-muted-foreground",
  };
  return { variant: hit.variant, label: labels[type] ?? type, className: hit.className };
}

/**
 * Veredito de tentativa de exercício (true/false/null) → badge:
 * correct = verde, incorrect = vermelho, undetermined (null) = amarelo.
 * Rótulos recebidos como parâmetro (com default pt-BR).
 */
export function learnAttemptBadge(
  correct: boolean | null,
  labels: Record<string, string> = DEFAULT_ATTEMPT_LABELS,
): RsBadge {
  const key = correct === true ? "true" : correct === false ? "false" : "null";
  const colors: Record<string, { variant: RsBadge["variant"]; className: string }> = {
    true: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    false: { variant: "destructive", className: "" },
    null: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
  };
  const hit = colors[key] ?? { variant: "outline" as const, className: "text-muted-foreground" };
  return {
    variant: hit.variant,
    label: labels[key] ?? String(correct),
    className: hit.className,
  };
}
