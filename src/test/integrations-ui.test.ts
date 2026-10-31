import { describe, expect, it } from "vitest";

import {
  DEFAULT_IF_EVENT_LABELS,
  DEFAULT_IF_INTEGRATION_LABELS,
  DEFAULT_IF_TRUST_LABELS,
  IF_CALENDAR_ADAPTERS,
  IF_SIGNATURE_WINDOW_MS,
  IF_WEBHOOK_ADAPTERS,
  ifAllowedEventTypesFromText,
  ifErrorCode,
  ifErrorCodeLabel,
  ifEventStatusBadge,
  ifIngressPath,
  ifIntegrationStatusBadge,
  ifSyncSummary,
  ifTrustBadge,
  formatIfSignatureWindow,
  isIANAZone,
  validateIfCalendarAccountForm,
  validateIfIntegrationForm,
  validateIfProducerForm,
  validateIfTimezone,
} from "@/lib/integrations-ui";

// ---------- badges de estado (integração, evento, proveniência) ----------

describe("ifIntegrationStatusBadge", () => {
  it("cobre todos os estados com rótulos pt-BR padrão", () => {
    for (const s of Object.keys(DEFAULT_IF_INTEGRATION_LABELS)) {
      const b = ifIntegrationStatusBadge(s);
      expect(b.label).toBe(DEFAULT_IF_INTEGRATION_LABELS[s]);
      expect(b.label).not.toBe(s); // nunca devolve a chave crua
    }
  });

  it("active=verde, configured=azul, degraded=amarelo, error=destrutivo, disabled=muted", () => {
    expect(ifIntegrationStatusBadge("active").className).toContain("emerald");
    expect(ifIntegrationStatusBadge("configured").className).toContain("blue");
    expect(ifIntegrationStatusBadge("degraded").className).toContain("yellow");
    expect(ifIntegrationStatusBadge("error").variant).toBe("destructive");
    for (const s of ["unconfigured", "disabled"]) {
      expect(ifIntegrationStatusBadge(s).className).toContain("text-muted-foreground");
    }
  });

  it("estado desconhecido → badge destrutivo com anel e rótulo recebido", () => {
    const b = ifIntegrationStatusBadge("zap", { zap: "Zap" });
    expect(b.variant).toBe("destructive");
    expect(b.className).toContain("ring-2");
    expect(b.label).toBe("Zap");
    expect(ifIntegrationStatusBadge("zap").label).toBe("zap"); // sem rótulo: chave crua
  });
});

describe("ifEventStatusBadge", () => {
  it("cobre todos os status com rótulos pt-BR padrão", () => {
    for (const s of Object.keys(DEFAULT_IF_EVENT_LABELS)) {
      expect(ifEventStatusBadge(s).label).toBe(DEFAULT_IF_EVENT_LABELS[s]);
    }
  });

  it("forwarded=verde, received/normalized=azul, duplicate=amarelo, rejected=muted, error=destrutivo", () => {
    expect(ifEventStatusBadge("forwarded").className).toContain("emerald");
    for (const s of ["received", "normalized"]) {
      expect(ifEventStatusBadge(s).className).toContain("blue");
    }
    expect(ifEventStatusBadge("duplicate").className).toContain("yellow");
    expect(ifEventStatusBadge("rejected").className).toContain("text-muted-foreground");
    expect(ifEventStatusBadge("error").variant).toBe("destructive");
  });
});

describe("ifTrustBadge", () => {
  it("authenticated = verde com rótulo traduzido", () => {
    const b = ifTrustBadge("authenticated");
    expect(b.variant).toBe("secondary");
    expect(b.className).toContain("emerald");
    expect(b.label).toBe(DEFAULT_IF_TRUST_LABELS["authenticated"]);
  });

  it("proveniência desconhecida/ausente → cinza com valor cru (nunca verde)", () => {
    expect(ifTrustBadge("unverified").className).toContain("text-muted-foreground");
    expect(ifTrustBadge("unverified").label).toBe("unverified");
    expect(ifTrustBadge("").label).toBe("?");
  });
});

// ---------- códigos de erro estáveis ----------

describe("ifErrorCode / ifErrorCodeLabel", () => {
  it('extrai o código do corpo do erro do bridge ("503: {\\"error\\":\\"…\\"}")', () => {
    const e = new Error('503: {"error":"cal_provider_unavailable"}');
    expect(ifErrorCode(e)).toBe("cal_provider_unavailable");
    expect(ifErrorCode(new Error('400: {"error":"if_rate_limited"}'))).toBe("if_rate_limited");
    expect(ifErrorCode(new Error("pr_invalid_timezone"))).toBe("pr_invalid_timezone");
    expect(ifErrorCode(new Error("sem codigo"))).toBeNull();
    expect(ifErrorCode(null)).toBeNull();
  });

  it("rótulo: tradução quando existe, código cru senão", () => {
    const labels = { if_rate_limited: "Limite excedido" };
    expect(ifErrorCodeLabel("if_rate_limited", labels)).toBe("Limite excedido");
    expect(ifErrorCodeLabel("if_zap", labels)).toBe("if_zap");
    expect(ifErrorCodeLabel(null, labels)).toBe("");
  });
});

// ---------- validações de formulário ----------

describe("validateIfIntegrationForm", () => {
  it("exige kind válido, adaptador da lista do kind e nome", () => {
    expect(
      validateIfIntegrationForm({ kind: "webhook", adapter: "webhook", name: "Stripe" }),
    ).toBeNull();
    expect(
      validateIfIntegrationForm({ kind: "calendar", adapter: "fixture", name: "Agenda" }),
    ).toBeNull();
    expect(validateIfIntegrationForm({ kind: "zap", adapter: "webhook", name: "x" })).toBe(
      "if_err_kind_required",
    );
    expect(validateIfIntegrationForm({ kind: "calendar", adapter: "webhook", name: "x" })).toBe(
      "if_err_adapter_required",
    );
    expect(validateIfIntegrationForm({ kind: "webhook", adapter: "webhook", name: "  " })).toBe(
      "if_err_name_required",
    );
  });

  it("adaptadores válidos espelham o servidor", () => {
    expect(IF_WEBHOOK_ADAPTERS).toContain("webhook");
    expect(IF_CALENDAR_ADAPTERS).toContain("fixture");
    expect(IF_CALENDAR_ADAPTERS).toContain("google");
    expect(IF_CALENDAR_ADAPTERS).not.toContain("webhook");
  });
});

describe("validateIfCalendarAccountForm", () => {
  it("exige integração, provider válido e conta", () => {
    expect(
      validateIfCalendarAccountForm({
        integrationId: "it1",
        provider: "google",
        providerAccount: "eu@gmail.com",
      }),
    ).toBeNull();
    expect(
      validateIfCalendarAccountForm({
        integrationId: " ",
        provider: "google",
        providerAccount: "a",
      }),
    ).toBe("if_err_integration_required");
    expect(
      validateIfCalendarAccountForm({
        integrationId: "it1",
        provider: "zap",
        providerAccount: "a",
      }),
    ).toBe("if_err_adapter_required");
    expect(
      validateIfCalendarAccountForm({
        integrationId: "it1",
        provider: "fixture",
        providerAccount: "",
      }),
    ).toBe("if_err_account_required");
  });
});

describe("validateIfProducerForm", () => {
  it("exige nome do produtor", () => {
    expect(validateIfProducerForm({ name: "Stripe" })).toBeNull();
    expect(validateIfProducerForm({ name: "  " })).toBe("if_err_name_required");
  });
});

// ---------- timezone IANA (mesma regra fail-closed do servidor) ----------

describe("isIANAZone / validateIfTimezone", () => {
  it("aceita zonas IANA reais e UTC", () => {
    for (const tz of ["America/Sao_Paulo", "Europe/Lisbon", "UTC", "Asia/Tokyo"]) {
      expect(isIANAZone(tz)).toBe(true);
      expect(validateIfTimezone(tz)).toBeNull();
    }
  });

  it("rejeita lixo e vazio — nunca degrada para UTC em silêncio", () => {
    for (const tz of ["", "  ", "Sao_Paulo", "America/NaoExiste", "GMT+3"]) {
      expect(isIANAZone(tz)).toBe(false);
    }
    expect(validateIfTimezone("")).toBe("if_err_timezone_required");
    expect(validateIfTimezone("  ")).toBe("if_err_timezone_required");
    expect(validateIfTimezone("America/NaoExiste")).toBe("if_err_timezone_invalid");
  });
});

// ---------- janela de assinatura e formatação ----------

describe("formatIfSignatureWindow", () => {
  it("espelha a janela do servidor (max_clock_skew_ms = 5 min)", () => {
    expect(IF_SIGNATURE_WINDOW_MS).toBe(5 * 60 * 1000);
    const w = formatIfSignatureWindow(IF_SIGNATURE_WINDOW_MS);
    expect(w.minutes).toBe(5);
    expect(w.text).toBe("5 min");
  });

  it("valores arbitrários e negativos são saneados", () => {
    expect(formatIfSignatureWindow(90_000).minutes).toBe(2); // arredonda
    expect(formatIfSignatureWindow(0).text).toBe("0 min");
    expect(formatIfSignatureWindow(-1000).minutes).toBe(0);
  });
});

describe("ifSyncSummary", () => {
  it("resume upserted/cancelled/cursor em uma linha", () => {
    expect(
      ifSyncSummary(
        { upserted: 3, cancelled: 1, cursor: 42, testOnly: true },
        { created: "criados", cancelled: "cancelados", cursor: "Cursor" },
      ),
    ).toBe("3 criados · 1 cancelados · Cursor: 42");
  });

  it("cursor ausente é omitido", () => {
    expect(
      ifSyncSummary(
        { upserted: 0, cancelled: 0, cursor: null },
        { created: "criados", cancelled: "cancelados", cursor: "Cursor" },
      ),
    ).toBe("0 criados · 0 cancelados");
  });
});

// ---------- ingress e tipos permitidos ----------

describe("ifIngressPath", () => {
  it("monta a URL pública SEM segredo, escapando o id", () => {
    expect(ifIngressPath("abc123")).toBe("/api/if/webhooks/abc123");
    expect(ifIngressPath("a/b?c")).toBe("/api/if/webhooks/a%2Fb%3Fc");
  });
});

describe("ifAllowedEventTypesFromText", () => {
  it("divide por vírgula/linha, remove vazios e limita a 50", () => {
    expect(
      ifAllowedEventTypesFromText("pedido.criado, pedido.pago\n\n pagamento.recusado"),
    ).toEqual(["pedido.criado", "pedido.pago", "pagamento.recusado"]);
    expect(ifAllowedEventTypesFromText("")).toEqual([]);
    const many = Array.from({ length: 60 }, (_, i) => `t${i}`).join(",");
    expect(ifAllowedEventTypesFromText(many)).toHaveLength(50);
  });
});
