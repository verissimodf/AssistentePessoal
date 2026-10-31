// Helper de UI do Integration Studio (Fase 8) — arquivo separado para manter a rota
// exportando apenas componentes (react-refresh/only-export-components).
// Tudo aqui é PURO: formatadores, validações e rótulos testáveis sem DOM.

export type IfUiBadge = {
  variant: "default" | "secondary" | "destructive" | "outline";
  label: string;
  className: string;
};

/** Rótulos padrão (pt-BR) de estado de integração. */
export const DEFAULT_IF_INTEGRATION_LABELS: Record<string, string> = {
  unconfigured: "Não configurada",
  configured: "Configurada",
  active: "Ativa",
  degraded: "Degradada",
  disabled: "Desativada",
  error: "Erro",
};

/** Rótulos padrão (pt-BR) de status do Event Inspector. */
export const DEFAULT_IF_EVENT_LABELS: Record<string, string> = {
  received: "Recebido",
  normalized: "Normalizado",
  forwarded: "Encaminhado",
  duplicate: "Duplicado",
  rejected: "Rejeitado",
  error: "Erro",
};

/** Rótulos padrão (pt-BR) de proveniência (trust_level). */
export const DEFAULT_IF_TRUST_LABELS: Record<string, string> = {
  authenticated: "Autenticado",
};

/** Adaptadores válidos por kind — mesma lista do servidor (ADAPTERS). */
export const IF_WEBHOOK_ADAPTERS = ["webhook"] as const;
export const IF_CALENDAR_ADAPTERS = ["fixture", "google"] as const;

/**
 * Janela de assinatura HMAC do servidor (max_clock_skew_ms): timestamps fora da
 * janela são rejeitados com if_timestamp_expired. Espelhada aqui só para a dica da UI.
 */
export const IF_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Estado de integração → badge: active = verde, configured = azul, degraded = amarelo,
 * unconfigured/disabled = cinza, error = vermelho. Rótulos por parâmetro (default pt-BR).
 */
export function ifIntegrationStatusBadge(
  status: string,
  labels: Record<string, string> = DEFAULT_IF_INTEGRATION_LABELS,
): IfUiBadge {
  const colors: Record<string, { variant: IfUiBadge["variant"]; className: string }> = {
    unconfigured: { variant: "outline", className: "text-muted-foreground" },
    configured: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    active: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    degraded: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    disabled: { variant: "outline", className: "text-muted-foreground" },
    error: { variant: "destructive", className: "" },
  };
  const hit = colors[status] ?? {
    variant: "destructive" as const,
    className: "ring-2 ring-destructive/50",
  };
  return { variant: hit.variant, label: labels[status] ?? status, className: hit.className };
}

/**
 * Status do inspector → badge: forwarded = verde, received/normalized = azul,
 * duplicate = amarelo, rejected = cinza, error = vermelho.
 */
export function ifEventStatusBadge(
  status: string,
  labels: Record<string, string> = DEFAULT_IF_EVENT_LABELS,
): IfUiBadge {
  const colors: Record<string, { variant: IfUiBadge["variant"]; className: string }> = {
    received: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    normalized: {
      variant: "secondary",
      className: "border-blue-500/40 bg-blue-500/15 text-blue-500",
    },
    forwarded: {
      variant: "secondary",
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    },
    duplicate: {
      variant: "secondary",
      className: "border-yellow-500/40 bg-yellow-500/15 text-yellow-600",
    },
    rejected: { variant: "outline", className: "text-muted-foreground" },
    error: { variant: "destructive", className: "" },
  };
  const hit = colors[status] ?? {
    variant: "destructive" as const,
    className: "ring-2 ring-destructive/50",
  };
  return { variant: hit.variant, label: labels[status] ?? status, className: hit.className };
}

/** Proveniência → badge: authenticated = verde; desconhecida = cinza com o valor cru. */
export function ifTrustBadge(
  trustLevel: string,
  labels: Record<string, string> = DEFAULT_IF_TRUST_LABELS,
): IfUiBadge {
  const label = labels[trustLevel];
  if (trustLevel !== "" && label !== undefined) {
    return {
      variant: "secondary",
      label,
      className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600",
    };
  }
  return { variant: "outline", label: trustLevel || "?", className: "text-muted-foreground" };
}

/** Rótulo de um código de erro estável: tradução quando existe, o código cru senão. */
export function ifErrorCodeLabel(
  code: string | null | undefined,
  labels: Record<string, string>,
): string {
  if (!code) return "";
  return labels[code] ?? code;
}

/**
 * Extrai o código de erro estável (if_/cal_/pr_ + sufixo) de um erro do bridge — o `api()`
 * lança `Error("<status>: <corpo>", ...)` e o corpo é JSON `{"error":"<código>"}`.
 */
export function ifErrorCode(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = msg.match(/\b((?:if|cal|pr)_[a-z0-9_]+)\b/);
  return m?.[1] ?? null;
}

// ---------- validações de formulário (chaves i18n estáveis, if_err_*) ----------

/** Valida a criação de integração. Retorna chave i18n (if_err_*) ou null. */
export function validateIfIntegrationForm(f: {
  kind: string;
  adapter: string;
  name: string;
}): string | null {
  if (f.kind !== "webhook" && f.kind !== "calendar") return "if_err_kind_required";
  const valid = f.kind === "webhook" ? IF_WEBHOOK_ADAPTERS : IF_CALENDAR_ADAPTERS;
  if (!(valid as readonly string[]).includes(f.adapter)) return "if_err_adapter_required";
  if (!f.name.trim()) return "if_err_name_required";
  return null;
}

/** Valida a conexão de conta de calendário. Retorna chave i18n ou null. */
export function validateIfCalendarAccountForm(f: {
  integrationId: string;
  provider: string;
  providerAccount: string;
}): string | null {
  if (!f.integrationId.trim()) return "if_err_integration_required";
  if (!(IF_CALENDAR_ADAPTERS as readonly string[]).includes(f.provider))
    return "if_err_adapter_required";
  if (!f.providerAccount.trim()) return "if_err_account_required";
  return null;
}

/** Valida a criação de produtor de webhook. Retorna chave i18n ou null. */
export function validateIfProducerForm(f: { name: string }): string | null {
  return f.name.trim() ? null : "if_err_name_required";
}

/**
 * Validação IANA de timezone — MESMA regra do servidor (Intl.DateTimeFormat; fail-closed):
 * inválida nunca é aceita silenciosamente nem degradada para UTC.
 */
export function isIANAZone(tz: string): boolean {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz.trim(),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return true;
  } catch {
    return false;
  }
}

/** Timezone do formulário temporal: chave i18n (if_err_timezone_*) ou null. */
export function validateIfTimezone(tz: string): string | null {
  if (!tz.trim()) return "if_err_timezone_required";
  return isIANAZone(tz) ? null : "if_err_timezone_invalid";
}

/**
 * Janela de assinatura HMAC (clock skew máximo, ms) → texto curto para a dica da aba
 * Webhooks (ex.: 300_000 → { minutes: 5, text: "5 min" }).
 */
export function formatIfSignatureWindow(skewMs: number): { minutes: number; text: string } {
  const minutes = Math.max(0, Math.round(skewMs / 60_000));
  return { minutes, text: `${minutes} min` };
}

/** Resumo do sync em uma linha: "3 criados · 1 cancelado · cursor: 42". */
export function ifSyncSummary(
  res: {
    upserted: number;
    cancelled: number;
    cursor: number | string | null;
    testOnly?: boolean;
  },
  labels: { created: string; cancelled: string; cursor: string },
): string {
  const parts = [`${res.upserted} ${labels.created}`, `${res.cancelled} ${labels.cancelled}`];
  if (res.cursor !== null && res.cursor !== undefined)
    parts.push(`${labels.cursor}: ${String(res.cursor)}`);
  return parts.join(" · ");
}

/** URL de ingress público de um produtor (o segredo NUNCA entra na URL). */
export function ifIngressPath(producerId: string): string {
  return `/api/if/webhooks/${encodeURIComponent(producerId)}`;
}

/** Tipos de evento permitidos a partir do texto cru do formulário (vírgula/linha). */
export function ifAllowedEventTypesFromText(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .slice(0, 50);
}
