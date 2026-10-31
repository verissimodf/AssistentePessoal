import { describe, expect, it } from "vitest";

import {
  DEFAULT_PR_OPP_LABELS,
  DEFAULT_PR_RULE_LABELS,
  DEFAULT_PR_TRIGGER_FORM,
  PR_CONDITION_OPS,
  PR_EVENT_SOURCES,
  prConditionNeedsValue,
  prConditionTreeFromLeaves,
  prLevelInfo,
  prOpportunityStatusBadge,
  prRuleBodyFromForm,
  prRuleStatusBadge,
  prTriggerFromForm,
  prTriggerSummary,
  validatePrConditionLeaf,
  validatePrTriggerForm,
  type PrConditionFormLeaf,
  type PrTriggerForm,
} from "@/lib/proactive-ui";

// ---------- badges de estado (regra e oportunidade) ----------

describe("prRuleStatusBadge", () => {
  it("cobre todos os estados de regra com rótulos pt-BR padrão", () => {
    for (const s of Object.keys(DEFAULT_PR_RULE_LABELS)) {
      const b = prRuleStatusBadge(s);
      expect(b.label).toBe(DEFAULT_PR_RULE_LABELS[s]);
      expect(b.label).not.toBe(s); // nunca devolve a chave crua
    }
  });

  it("active=verde, draft=azul, paused/expired=amarelo, failed=destrutivo, disabled=muted", () => {
    expect(prRuleStatusBadge("active").className).toContain("emerald");
    expect(prRuleStatusBadge("draft").className).toContain("blue");
    for (const s of ["paused", "expired"])
      expect(prRuleStatusBadge(s).className).toContain("yellow");
    expect(prRuleStatusBadge("failed").variant).toBe("destructive");
    expect(prRuleStatusBadge("disabled").className).toContain("text-muted-foreground");
  });

  it("estado desconhecido → badge destrutivo com anel e rótulo recebido", () => {
    const b = prRuleStatusBadge("zap", { zap: "Zap" });
    expect(b.variant).toBe("destructive");
    expect(b.className).toContain("ring-2");
    expect(b.label).toBe("Zap");
    expect(prRuleStatusBadge("zap").label).toBe("zap"); // sem rótulo: chave crua
  });
});

describe("prOpportunityStatusBadge", () => {
  it("cobre todos os status com rótulos pt-BR padrão", () => {
    for (const s of Object.keys(DEFAULT_PR_OPP_LABELS)) {
      const b = prOpportunityStatusBadge(s);
      expect(b.label).toBe(DEFAULT_PR_OPP_LABELS[s]);
    }
  });

  it("recommended/accepted/executing=verde, failed=destrutivo, dismissed/expired=muted", () => {
    for (const s of ["recommended", "accepted", "executing", "completed"]) {
      expect(prOpportunityStatusBadge(s).className).toContain("emerald");
    }
    expect(prOpportunityStatusBadge("failed").variant).toBe("destructive");
    for (const s of ["dismissed", "expired"]) {
      expect(prOpportunityStatusBadge(s).className).toContain("text-muted-foreground");
    }
  });
});

// ---------- validação do formulário de gatilho ----------

const f = (p: Partial<PrTriggerForm>): PrTriggerForm => ({ ...DEFAULT_PR_TRIGGER_FORM, ...p });

describe("validatePrTriggerForm", () => {
  it("evento exige fonte e tipo de evento", () => {
    expect(
      validatePrTriggerForm(f({ kind: "event", source: "workflow", eventKind: "completed" })),
    ).toBeNull();
    expect(validatePrTriggerForm(f({ kind: "event", source: "", eventKind: "x" }))).toBe(
      "pr_err_source_required",
    );
    expect(validatePrTriggerForm(f({ kind: "event", source: "wf", eventKind: " " }))).toBe(
      "pr_err_event_kind_required",
    );
  });

  it("temporal: daily/weekly exigem HH:MM; weekly também exige weekday 0–6", () => {
    expect(
      validatePrTriggerForm(f({ kind: "temporal", temporalType: "daily", time: "08:00" })),
    ).toBeNull();
    expect(validatePrTriggerForm(f({ kind: "temporal", temporalType: "daily", time: "8h" }))).toBe(
      "pr_err_time_required",
    );
    expect(
      validatePrTriggerForm(
        f({ kind: "temporal", temporalType: "weekly", time: "08:00", weekday: 1 }),
      ),
    ).toBeNull();
    expect(
      validatePrTriggerForm(
        f({ kind: "temporal", temporalType: "weekly", time: "08:00", weekday: 7 }),
      ),
    ).toBe("pr_err_weekday_required");
  });

  it("temporal: intervalo mínimo de 1 minuto; date exige AAAA-MM-DD e hora", () => {
    expect(
      validatePrTriggerForm(f({ kind: "temporal", temporalType: "interval", intervalMinutes: 60 })),
    ).toBeNull();
    expect(
      validatePrTriggerForm(
        f({ kind: "temporal", temporalType: "interval", intervalMinutes: 0.5 }),
      ),
    ).toBe("pr_err_interval_min");
    expect(
      validatePrTriggerForm(f({ kind: "temporal", temporalType: "date", date: "2026-01-01" })),
    ).toBeNull();
    expect(
      validatePrTriggerForm(f({ kind: "temporal", temporalType: "date", date: "01/01/2026" })),
    ).toBe("pr_err_date_required");
    expect(
      validatePrTriggerForm(
        f({ kind: "temporal", temporalType: "date", date: "2026-01-01", time: "" }),
      ),
    ).toBe("pr_err_time_required");
  });

  it("contextual não tem campos obrigatórios", () => {
    expect(validatePrTriggerForm(f({ kind: "contextual" }))).toBeNull();
  });
});

describe("prTriggerFromForm", () => {
  it("evento → {source, eventKind}; inválido → null", () => {
    expect(prTriggerFromForm(f({ kind: "event", source: "research", eventKind: "done" }))).toEqual({
      source: "research",
      eventKind: "done",
    });
    expect(prTriggerFromForm(f({ kind: "event", source: "research", eventKind: "" }))).toBeNull();
  });

  it("temporal: interval em minutos → intervalMs em ms (mínimo 60s respeitado pelo formulário)", () => {
    expect(
      prTriggerFromForm(f({ kind: "temporal", temporalType: "interval", intervalMinutes: 2 })),
    ).toEqual({
      type: "interval",
      intervalMs: 120_000,
    });
    expect(
      prTriggerFromForm(f({ kind: "temporal", temporalType: "weekly", weekday: 3, time: "07:15" })),
    ).toEqual({
      type: "weekly",
      time: "07:15",
      weekday: 3,
    });
  });
});

describe("prTriggerSummary", () => {
  const labels = {
    event: "Evento",
    temporal: "Temporal",
    daily: "Diário",
    weekly: "Semanal",
    interval: "Intervalo",
    date: "Data",
    contextual: "Contextual",
    weekdays: ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"],
    unknown: "Desconhecido",
  };

  it("evento: fonte.tipo", () => {
    expect(prTriggerSummary({ source: "workflow", eventKind: "completed" }, labels)).toBe(
      "Evento: workflow.completed",
    );
  });

  it("temporal: daily/weekly/interval/date legíveis", () => {
    expect(prTriggerSummary({ type: "daily", time: "08:00" }, labels)).toBe(
      "Temporal: Diário 08:00",
    );
    expect(prTriggerSummary({ type: "weekly", weekday: 1, time: "09:00" }, labels)).toBe(
      "Temporal: Semanal Segunda 09:00",
    );
    expect(prTriggerSummary({ type: "interval", intervalMs: 3_600_000 }, labels)).toBe(
      "Temporal: Intervalo 60 min",
    );
    expect(prTriggerSummary({ type: "date", date: "2026-05-01", time: "10:00" }, labels)).toBe(
      "Temporal: Data 2026-05-01 10:00",
    );
  });

  it("contextual e gatilho vazio/inválido não quebram", () => {
    expect(prTriggerSummary({ kind: "contextual" }, labels)).toBe("Contextual");
    expect(prTriggerSummary(undefined, labels)).toBe("Desconhecido");
    expect(prTriggerSummary({ type: "zap" }, labels)).toBe("Desconhecido");
  });
});

// ---------- condições: folhas e grupos ----------

describe("prConditionNeedsValue", () => {
  it("exists/missing não usam valor; os demais usam", () => {
    for (const op of ["exists", "missing"]) expect(prConditionNeedsValue(op)).toBe(false);
    for (const op of PR_CONDITION_OPS) {
      if (op !== "exists" && op !== "missing") expect(prConditionNeedsValue(op)).toBe(true);
    }
  });
});

describe("validatePrConditionLeaf", () => {
  const leaf = (p: Partial<PrConditionFormLeaf>): PrConditionFormLeaf => ({
    op: "eq",
    fact: "",
    value: "",
    ...p,
  });

  it("exige fato sempre e valor quando aplicável", () => {
    expect(validatePrConditionLeaf(leaf({ op: "eq", fact: "a.b", value: "x" }))).toBeNull();
    expect(validatePrConditionLeaf(leaf({ op: "exists", fact: "a.b" }))).toBeNull();
    expect(validatePrConditionLeaf(leaf({ op: "eq", fact: "", value: "x" }))).toBe(
      "pr_err_fact_required",
    );
    expect(validatePrConditionLeaf(leaf({ op: "eq", fact: "a.b", value: "" }))).toBe(
      "pr_err_value_required",
    );
    expect(validatePrConditionLeaf(leaf({ op: "zap", fact: "a", value: "b" }))).toBe(
      "pr_err_op_invalid",
    );
  });
});

describe("prConditionTreeFromLeaves", () => {
  it("sem folhas preenchidas → null (condições são opcionais)", () => {
    expect(prConditionTreeFromLeaves([{ op: "eq", fact: "", value: "" }], "all")).toBeNull();
  });

  it("grupo all com folha JSON e folha string crua", () => {
    const tree = prConditionTreeFromLeaves(
      [
        { op: "eq", fact: "wf.status", value: '"completed"' },
        { op: "contains", fact: "resumo", value: "erro" },
      ],
      "all",
    );
    expect(tree).toEqual({
      all: [
        { op: "eq", fact: "wf.status", value: "completed" },
        { op: "contains", fact: "resumo", value: "erro" },
      ],
    });
  });

  it("grupo any e folha exists sem valor", () => {
    const tree = prConditionTreeFromLeaves([{ op: "exists", fact: "x.flag", value: "" }], "any");
    expect(tree).toEqual({ any: [{ op: "exists", fact: "x.flag" }] });
  });

  it("folha inválida não gera árvore parcial", () => {
    expect(prConditionTreeFromLeaves([{ op: "eq", fact: "a", value: "" }], "all")).toBeNull();
  });
});

// ---------- nível de autonomia (0–3) ----------

describe("prLevelInfo", () => {
  it("níveis válidos produzem chaves i18n estáveis", () => {
    for (const n of [0, 1, 2, 3]) {
      const info = prLevelInfo(n);
      expect(info.nameKey).toBe(`pr_level_${n}`);
      expect(info.descKey).toBe(`pr_level_${n}_desc`);
      expect(info.known).toBe(true);
    }
  });

  it("fora do intervalo → degrada para o nível 0 e marca known=false", () => {
    for (const n of [-1, 4, 99]) {
      const info = prLevelInfo(n);
      expect(info.known).toBe(false);
      expect(info.nameKey).toBe("pr_level_0");
    }
  });
});

// ---------- corpo completo da regra ----------

describe("prRuleBodyFromForm", () => {
  it("exige nome", () => {
    const out = prRuleBodyFromForm({
      name: "  ",
      description: "",
      form: f({ kind: "event", source: "system", eventKind: "boot" }),
      leaves: [],
      mode: "all",
      workflowId: "",
      execution: "manual",
      maxExecutions: null,
      cooldownMs: null,
      validFrom: "",
      validUntil: "",
    });
    expect(out.error).toBe("pr_err_name_required");
    expect(out.body).toBeNull();
  });

  it("monta o corpo com gatilho, condições opcionais e limites", () => {
    const out = prRuleBodyFromForm({
      name: "Resumo diário",
      description: "todos os dias",
      form: f({ kind: "temporal", temporalType: "daily", time: "07:00" }),
      leaves: [{ op: "eq", fact: "a.b", value: '"c"' }],
      mode: "all",
      workflowId: "wf_1",
      execution: "auto",
      maxExecutions: 5,
      cooldownMs: 60000,
      validFrom: "",
      validUntil: "",
    });
    expect(out.error).toBeNull();
    expect(out.body).toEqual({
      name: "Resumo diário",
      description: "todos os dias",
      triggerKind: "temporal",
      trigger: { type: "daily", time: "07:00" },
      conditions: { all: [{ op: "eq", fact: "a.b", value: "c" }] },
      workflowId: "wf_1",
      execution: "auto",
      maxExecutions: 5,
      cooldownMs: 60000,
    });
  });

  it("gatilho inválido propaga a chave de erro estável", () => {
    const out = prRuleBodyFromForm({
      name: "x",
      description: "",
      form: f({ kind: "temporal", temporalType: "interval", intervalMinutes: 0 }),
      leaves: [],
      mode: "all",
      workflowId: "",
      execution: "manual",
      maxExecutions: null,
      cooldownMs: null,
      validFrom: "",
      validUntil: "",
    });
    expect(out.error).toBe("pr_err_interval_min");
    expect(out.body).toBeNull();
  });
});

// ---------- constantes compartilhadas com o servidor ----------

describe("constantes", () => {
  it("fontes e operadores cobrem a API", () => {
    for (const s of ["workflow", "research", "kh", "manual", "system"]) {
      expect(PR_EVENT_SOURCES).toContain(s);
    }
    for (const op of ["eq", "contains", "exists", "missing", "in"]) {
      expect(PR_CONDITION_OPS).toContain(op);
    }
  });
});
