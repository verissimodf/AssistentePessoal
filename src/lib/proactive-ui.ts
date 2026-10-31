// Helper de UI do Proactive Studio (Fase 7) — arquivo separado para manter a rota
// exportando apenas componentes (react-refresh/only-export-components).
import type {
  PrConditionLeaf,
  PrConditionNode,
  PrRuleBody,
  PrTrigger,
  PrTriggerKind,
} from "@/lib/bridge";

export type PrUiBadge = {
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
  className: string;
};

/** Rótulos padrão (pt-BR) de estados de regra proativa. */
export const DEFAULT_PR_RULE_LABELS: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  disabled: "Desativada",
  expired: "Expirada",
  failed: "Falhou",
};

/** Rótulos padrão (pt-BR) de status de oportunidade. */
export const DEFAULT_PR_OPP_LABELS: Record<string, string> = {
  detected: "Detectada",
  evaluating: "Avaliando",
  recommended: "Recomendada",
  dismissed: "Ignorada",
  snoozed: "Adiada",
  accepted: "Aceita",
  executing: "Em execução",
  completed: "Concluída",
  failed: "Falhou",
  expired: "Expirada",
};

/** Fontes válidas de gatilho por evento (mesma lista do servidor). */
export const PR_EVENT_SOURCES = [
  "workflow",
  "research",
  "learning",
  "kh",
  "workforce",
  "mm",
  "computer",
  "manual",
  "system",
] as const;

/** Operadores válidos de folha de condição (mesma lista do servidor). */
export const PR_CONDITION_OPS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "exists",
  "missing",
  "in",
] as const;

/**
 * Estado de regra → badge: active/resumed = verde, draft = azul, paused/expired = amarelo,
 * disabled = cinza, failed/unknown = vermelho. Rótulos por parâmetro (default pt-BR).
 */
export function prRuleStatusBadge(
  state: string,
  labels: Record<string, string> = DEFAULT_PR_RULE_LABELS,
): PrUiBadge {
  const colors: Record<string, { variant: PrUiBadge["variant"]; className: string }> = {
    draft: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    active: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    paused: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    disabled: { variant: "outline", className: "text-muted-foreground" },
    expired: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    failed: { variant: "destructive", className: "" },
  };
  const hit = colors[state] ?? {
    variant: "destructive" as const,
    className: "ring-2 ring-destructive/50",
  };
  return { variant: hit.variant, label: labels[state] ?? state, className: hit.className };
}

/**
 * Status de oportunidade → badge: recommended/accepted/executing = verde (recommended amarelo?),
 * detected = azul, evaluating/snoozed = amarelo, dismissed/expired = cinza,
 * completed = verde, failed = vermelho. Rótulos por parâmetro (default pt-BR).
 */
export function prOpportunityStatusBadge(
  status: string,
  labels: Record<string, string> = DEFAULT_PR_OPP_LABELS,
): PrUiBadge {
  const colors: Record<string, { variant: PrUiBadge["variant"]; className: string }> = {
    detected: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    evaluating: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    recommended: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    dismissed: { variant: "outline", className: "text-muted-foreground" },
    snoozed: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    accepted: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    executing: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    completed: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    failed: { variant: "destructive", className: "" },
    expired: { variant: "outline", className: "text-muted-foreground" },
  };
  const hit = colors[status] ?? {
    variant: "destructive" as const,
    className: "ring-2 ring-destructive/50",
  };
  return { variant: hit.variant, label: labels[status] ?? status, className: hit.className };
}

// ---------- formulário de regra (gatilho) — validação pura, chaves i18n estáveis ----------

/** Estado do formulário de gatilho da regra (a rota converte em PrTrigger). */
export type PrTriggerForm = {
  kind: PrTriggerKind | string;
  source: string;
  eventKind: string;
  temporalType: "daily" | "weekly" | "interval" | "date";
  time: string;
  weekday: number;
  intervalMinutes: number;
  date: string;
};

export const DEFAULT_PR_TRIGGER_FORM: PrTriggerForm = {
  kind: "event",
  source: "workflow",
  eventKind: "",
  temporalType: "daily",
  time: "08:00",
  weekday: 1,
  intervalMinutes: 60,
  date: "",
};

/**
 * Valida o formulário de gatilho. Retorna chaves i18n estáveis (pr_err_*) ou null.
 * Campos extras (condições, workflow) são opcionais e ficam para o servidor.
 */
export function validatePrTriggerForm(f: PrTriggerForm): string | null {
  if (f.kind === "event") {
    if (!f.source.trim()) return "pr_err_source_required";
    if (!f.eventKind.trim()) return "pr_err_event_kind_required";
    return null;
  }
  if (f.kind === "temporal") {
    switch (f.temporalType) {
      case "daily":
        return /^\d{2}:\d{2}$/.test(f.time.trim()) ? null : "pr_err_time_required";
      case "weekly":
        if (!/^\d{2}:\d{2}$/.test(f.time.trim())) return "pr_err_time_required";
        if (!(f.weekday >= 0 && f.weekday <= 6)) return "pr_err_weekday_required";
        return null;
      case "interval":
        return f.intervalMinutes >= 1 ? null : "pr_err_interval_min";
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date.trim())) return "pr_err_date_required";
        return /^\d{2}:\d{2}$/.test(f.time.trim()) ? null : "pr_err_time_required";
      default:
        return "pr_err_temporal_type";
    }
  }
  // contextual: não há campos obrigatórios adicionais hoje
  return null;
}

/** Converte o formulário validado no corpo do trigger (mesma forma do servidor). */
export function prTriggerFromForm(f: PrTriggerForm): PrTrigger | null {
  if (validatePrTriggerForm(f) !== null) return null;
  if (f.kind === "event") return { source: f.source.trim(), eventKind: f.eventKind.trim() };
  if (f.kind === "temporal") {
    switch (f.temporalType) {
      case "daily":
        return { type: "daily", time: f.time.trim() };
      case "weekly":
        return { type: "weekly", time: f.time.trim(), weekday: f.weekday };
      case "interval":
        return { type: "interval", intervalMs: Math.round(f.intervalMinutes * 60_000) };
      case "date":
        return { type: "date", date: f.date.trim(), time: f.time.trim() };
    }
  }
  return { kind: "contextual" };
}

// ---------- condições: folhas simples + grupo all/any ----------

export type PrConditionFormLeaf = { op: string; fact: string; value: string };

/** Operadores que NÃO usam `value` (a UI oculta o campo). */
export function prConditionNeedsValue(op: string): boolean {
  return op !== "exists" && op !== "missing";
}

/**
 * Valida UMA folha. Retorna chave i18n (pr_err_*) ou null.
 * - fact sempre obrigatório; value obrigatório exceto exists/missing.
 */
export function validatePrConditionLeaf(leaf: PrConditionFormLeaf): string | null {
  if (!(PR_CONDITION_OPS as readonly string[]).includes(leaf.op)) return "pr_err_op_invalid";
  if (!leaf.fact.trim()) return "pr_err_fact_required";
  if (prConditionNeedsValue(leaf.op) && !leaf.value.trim()) return "pr_err_value_required";
  return null;
}

/** Folha de formulário → nó do servidor (value: JSON se possível, senão string). */
export function prConditionFromLeaf(leaf: PrConditionFormLeaf): PrConditionLeaf | null {
  if (validatePrConditionLeaf(leaf) !== null) return null;
  if (!prConditionNeedsValue(leaf.op))
    return { op: leaf.op as PrConditionLeaf["op"], fact: leaf.fact.trim() };
  let value: unknown = leaf.value.trim();
  try {
    value = JSON.parse(leaf.value);
  } catch {
    /* string crua — é uma escolha válida */
  }
  return { op: leaf.op as PrConditionLeaf["op"], fact: leaf.fact.trim(), value };
}

/**
 * Constrói a árvore de condições: grupo `all`/`any` com as folhas válidas.
 * Retorna null se não houver folhas (condições são opcionais) ou se alguma for inválida.
 */
export function prConditionTreeFromLeaves(
  leaves: PrConditionFormLeaf[],
  mode: "all" | "any",
): PrConditionNode | null {
  const valid = leaves.filter((l) => l.fact.trim() !== "" || l.value.trim() !== "");
  if (valid.length === 0) return null;
  const nodes: PrConditionNode[] = [];
  for (const l of valid) {
    const n = prConditionFromLeaf(l);
    if (!n) return null; // folha inválida: não constrói árvore parcial
    nodes.push(n);
  }
  return mode === "all" ? { all: nodes } : { any: nodes };
}

// ---------- nível de autonomia (0–3; NUNCA sobrepõe o Policy Engine/D9) ----------

/** Chaves i18n do nível: `pr_level_${n}` (nome) e `pr_level_${n}_desc` (descrição). */
export function prLevelInfo(level: number): { nameKey: string; descKey: string; known: boolean } {
  const n = Number.isInteger(level) && level >= 0 && level <= 3 ? level : 0;
  return {
    nameKey: `pr_level_${n}`,
    descKey: `pr_level_${n}_desc`,
    known: Number.isInteger(level) && level >= 0 && level <= 3,
  };
}

// ---------- resumo do gatilho (uma linha, para a lista de regras) ----------

/** Resumo legível do gatilho — rótulos por parâmetro (default pt-BR). */
export function prTriggerSummary(
  trigger: PrTrigger | null | undefined,
  labels: {
    event: string;
    temporal: string;
    daily: string;
    weekly: string;
    interval: string;
    date: string;
    contextual: string;
    weekdays: string[];
    unknown: string;
  },
): string {
  const tr = (trigger ?? {}) as Record<string, unknown>;
  if (typeof tr["source"] === "string" && typeof tr["eventKind"] === "string")
    return `${labels.event}: ${tr["source"]}.${tr["eventKind"]}`;
  const type = tr["type"];
  if (type === "daily")
    return `${labels.temporal}: ${labels.daily} ${String(tr["time"] ?? "")}`.trim();
  if (type === "weekly") {
    const wd = typeof tr["weekday"] === "number" ? (labels.weekdays[tr["weekday"]] ?? "?") : "?";
    return `${labels.temporal}: ${labels.weekly} ${wd} ${String(tr["time"] ?? "")}`.trim();
  }
  if (type === "interval") {
    const ms = typeof tr["intervalMs"] === "number" ? tr["intervalMs"] : NaN;
    const min = Number.isFinite(ms) ? Math.round(ms / 60_000) : null;
    return `${labels.temporal}: ${labels.interval} ${min !== null ? `${min} min` : ""}`.trim();
  }
  if (type === "date")
    return `${labels.temporal}: ${labels.date} ${String(tr["date"] ?? "")} ${String(tr["time"] ?? "")}`.trim();
  if (tr["kind"] === "contextual") return labels.contextual;
  return labels.unknown;
}

/** Corpo completo da regra a partir do formulário (já validado) — null se inválido. */
export function prRuleBodyFromForm(input: {
  name: string;
  description: string;
  form: PrTriggerForm;
  leaves: PrConditionFormLeaf[];
  mode: "all" | "any";
  workflowId: string;
  execution: "manual" | "auto";
  maxExecutions: number | null;
  cooldownMs: number | null;
  validFrom: string;
  validUntil: string;
}): { error: string | null; body: PrRuleBody | null } {
  const name = input.name.trim();
  if (!name) return { error: "pr_err_name_required", body: null };
  const trigger = prTriggerFromForm(input.form);
  if (!trigger)
    return { error: validatePrTriggerForm(input.form) ?? "pr_err_trigger_invalid", body: null };
  const conditions = prConditionTreeFromLeaves(input.leaves, input.mode);
  return {
    error: null,
    body: {
      name,
      ...(input.description.trim() ? { description: input.description.trim() } : {}),
      triggerKind: input.form.kind as PrTriggerKind,
      trigger,
      ...(conditions ? { conditions } : {}),
      ...(input.workflowId.trim() ? { workflowId: input.workflowId.trim() } : {}),
      execution: input.execution,
      ...(input.maxExecutions != null ? { maxExecutions: input.maxExecutions } : {}),
      ...(input.cooldownMs != null ? { cooldownMs: input.cooldownMs } : {}),
      ...(input.validFrom ? { validFrom: input.validFrom } : {}),
      ...(input.validUntil ? { validUntil: input.validUntil } : {}),
    },
  };
}
