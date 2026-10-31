// Utilitários compartilhados — Fase 9 (consolidação): deduplicação dos helpers antes
// re-implementados em ~10 módulos (auditoria arquitetural, §1). Comportamento IDÊNTICO
// ao das cópias substituídas; nenhum contrato alterado.

/** JSON de texto → objeto; null/undefined/JSON inválido/não-objeto → fallback. */
export const parseJson = (t, f) => {
  if (t === null || t === undefined) return f;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? v : f;
  } catch {
    return f;
  }
};

/** String segura com teto de tamanho (sanitize de campos de texto). */
export const clean = (v, max) => String(v ?? "").slice(0, max);
