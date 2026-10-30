// Helper de UI do Workflow/Policy Studio (Fase 3) — arquivo separado para manter a rota
// exportando apenas componentes (react-refresh/only-export-components).
export type WfUiBadge = {
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
  className: string;
};

/** Rótulos padrão (pt-BR) de status de run/nó do Workflow Studio. */
export const DEFAULT_WF3_RUN_LABELS: Record<string, string> = {
  pending: "Pendente",
  queued: "Na fila",
  running: "Em execução",
  waiting_approval: "Aguardando aprovação",
  waiting_dependency: "Aguardando dependência",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
  unknown: "Desconhecido",
};

/** Rótulos padrão (pt-BR) de efeito de política. */
export const DEFAULT_WF3_EFFECT_LABELS: Record<string, string> = {
  allow: "Permitir",
  deny: "Negar",
  require_approval: "Exigir aprovação",
};

/**
 * Status de run (ou nó) do Workflow Studio → badge:
 *  - running = azul; waiting_* = amarelo; completed = verde;
 *  - failed/unknown = vermelho (unknown com anel); queued/cancelled = cinza.
 * Rótulos são recebidos como parâmetro (com default pt-BR) — nenhuma label fixa aqui.
 */
export function wfRunStatusBadge(
  status: string,
  labels: Record<string, string> = DEFAULT_WF3_RUN_LABELS,
): WfUiBadge {
  const colors: Record<string, { variant: WfUiBadge["variant"]; className: string }> = {
    pending: { variant: "outline", className: "" },
    queued: { variant: "outline", className: "" },
    running: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    waiting_approval: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    waiting_dependency: {
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
  };
}

/**
 * Efeito de política → badge: deny = vermelho, require_approval = amarelo, allow = verde.
 * Rótulos recebidos como parâmetro (com default pt-BR).
 */
export function wfEffectBadge(
  effect: string,
  labels: Record<string, string> = DEFAULT_WF3_EFFECT_LABELS,
): WfUiBadge {
  const colors: Record<string, { variant: WfUiBadge["variant"]; className: string }> = {
    allow: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    deny: { variant: "destructive", className: "" },
    require_approval: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
  };
  const hit = colors[effect] ?? {
    variant: "outline" as const,
    className: "text-muted-foreground",
  };
  return { variant: hit.variant, label: labels[effect] ?? effect, className: hit.className };
}

/** Descrição curta (pt) de um nó do grafo a partir do tipo e da configuração. */
export function describeNode(
  type: string,
  config: Record<string, unknown> | null | undefined,
): string {
  const cfg = config ?? {};
  switch (type) {
    case "start":
      return "Início do fluxo.";
    case "end":
      return "Fim do fluxo.";
    case "agent":
      return `Executa o especialista "${String(cfg["definition_id"] ?? "?")}"${
        cfg["objective"] ? ` com o objetivo "${String(cfg["objective"])}"` : ""
      }.`;
    case "tool":
      return `Chama a ferramenta "${String(cfg["tool"] ?? "?")}".`;
    case "condition":
      return `Condição: ${String(cfg["left"] ?? "?")} ${String(cfg["op"] ?? "?")} ${String(cfg["right"] ?? "")}.`;
    case "transform":
      return `Transformação "${String(cfg["op"] ?? "?")}" sobre as fontes selecionadas.`;
    case "knowledge_search":
      return `Pesquisa no acervo: "${String(cfg["query"] ?? "?")}".`;
    case "approval":
      return `Solicita aprovação humana: ${String(cfg["description"] ?? "sem descrição")}.`;
    case "wait":
      return cfg["until"]
        ? `Espera até ${String(cfg["until"])}.`
        : `Espera ${String(cfg["duration_ms"] ?? 0)} ms.`;
    case "subworkflow":
      return `Executa o subworkflow "${String(cfg["definition_id"] ?? "?")}".`;
    default:
      return "Nó desconhecido.";
  }
}
