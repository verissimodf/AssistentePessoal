// Foco da sessão (P0.2) — objetivo, resumo e decisões do administrador, persistidos por DONO.
//
// Regras:
//   - leitura e escrita usam SEMPRE o `adminId` autenticado da sessão: um administrador nunca
//     lê nem grava o foco de outro (isolamento por dono, sem herança de registros legados);
//   - o conteúdo é texto de trabalho do painel, validado por limite de tamanho — nunca segredo,
//     credencial, caminho ou cookie; a auditoria guarda apenas o dono e a contagem de decisões,
//     nunca o texto escrito (privacidade do administrador);
//   - pendências e "próximo passo" NÃO são editáveis nem persistidos: derivam de aprovações e
//     execuções reais no painel (rótulo "derivado"), para não fabricar estado a partir do texto.
//
// Tabela criada pela migração v11 (`session_focus`).
import { db, now, audit } from "./db.js";
import { AuthError } from "./auth.js";

export const LIMITS = { objective: 500, summary: 4000, decisions: 20, decision: 400 };

export const emptyFocus = () => ({ objective: "", summary: "", decisions: [], updatedAt: null });

const text = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

// Uma decisão malformada não derruba a leitura: é descartada, o resto permanece.
const parseDecisions = (raw) => {
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((d) => typeof d === "string" && d.trim()).slice(0, LIMITS.decisions);
  } catch {
    return [];
  }
};

const bytes = (s) => Buffer.byteLength(s, "utf8");

const tooLong = (code, value, max) => {
  if (bytes(value) > max) throw new AuthError(400, code);
};

export function getSessionFocus(adminId) {
  if (!adminId) return emptyFocus();
  const row = db
    .prepare(
      "SELECT objective, summary, decisions, updated_at FROM session_focus WHERE admin_id = ?",
    )
    .get(adminId);
  if (!row) return emptyFocus();
  return {
    objective: row.objective ?? "",
    summary: row.summary ?? "",
    decisions: parseDecisions(row.decisions ?? "[]"),
    updatedAt: row.updated_at ?? null,
  };
}

/** Grava o foco do PRÓPRIO administrador da sessão. Parciais ausentes viram "" (estado explícito
 *  de "sem objetivo"), nunca um valor herdado de outro dono ou de uma versão anterior. */
export function updateSessionFocus(adminId, body = {}) {
  if (!adminId) throw new AuthError(401, "unauthenticated");
  const objective = text(body.objective).trim();
  const summary = text(body.summary);
  tooLong("objective_too_long", objective, LIMITS.objective);
  tooLong("summary_too_long", summary, LIMITS.summary);

  const rawDecisions = body.decisions;
  if (rawDecisions !== undefined && !Array.isArray(rawDecisions))
    throw new AuthError(400, "decisions_not_array");
  // Só texto entra: número/objeto não é "decisão" e é descartado em vez de virar string.
  const decisions = (Array.isArray(rawDecisions) ? rawDecisions : [])
    .filter((d) => typeof d === "string")
    .map((d) => d.trim())
    .filter(Boolean);
  if (decisions.length > LIMITS.decisions) throw new AuthError(400, "too_many_decisions");
  for (const d of decisions) tooLong("decision_too_long", d, LIMITS.decision);

  const at = now();
  db.prepare(
    `INSERT INTO session_focus (admin_id, objective, summary, decisions, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(admin_id) DO UPDATE SET
       objective = excluded.objective,
       summary = excluded.summary,
       decisions = excluded.decisions,
       updated_at = excluded.updated_at`,
  ).run(adminId, objective, summary, JSON.stringify(decisions), at);

  // Auditoria SEM conteúdo: só o dono e a contagem de decisões (o texto é privado).
  audit("session_focus.updated", { admin: adminId, count: decisions.length });
  return getSessionFocus(adminId);
}
