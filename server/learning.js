// Learning Engine — evolução Fase 4 (docs/evolution/phase-4/learning-engine.md).
// Jornadas de aprendizagem persistentes (projeto → módulos → lições → atividades → tentativas),
// tutor contextual fundamentado no Knowledge Hub (citações autoritativas), diário e progresso
// explícito. Nada vira memória automática; nada é avaliado como "domínio" — só contagens.
import { parseJson, clean } from "./util.js";
import { db, now, uid, audit } from "./db.js";
import { assignNew, owns, dropOwnership, tx } from "./ownership.js";

const extractJson = (text) => {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) throw new Error("learn_generation_invalid");
  return JSON.parse(m[0]);
};

let oneShotImpl = null;
export function setOneShot(fn) {
  oneShotImpl = fn;
}
async function oneShot(adminId, prompt, runId) {
  if (oneShotImpl) return oneShotImpl(prompt);
  const { runAgentOneShot } = await import("./kh-oneshot.js");
  return runAgentOneShot({
    principal: { type: "service", tokenId: "learning", adminId, scopes: ["kh:read"] },
    prompt,
    runId,
  });
}

// ---------- projetos e jornada ----------

export function createLearningProject(
  adminId,
  { goal, level = "", sourceIds = [], researchProjectId = null } = {},
) {
  if (!adminId) throw new Error("learn_owner_required");
  const g = clean(goal, 1000).trim();
  if (!g) throw new Error("learn_goal_required");
  const id = uid();
  const ts = now();
  tx(() => {
    db.prepare(
      "INSERT INTO learn_projects (id, owner_admin_id, goal, level, sources_json, research_project_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'draft',?,?)",
    ).run(
      id,
      adminId,
      g,
      clean(level, 60),
      JSON.stringify((Array.isArray(sourceIds) ? sourceIds : []).slice(0, 20)),
      researchProjectId || null,
      ts,
      ts,
    );
    assignNew("learn_project", id, adminId);
  });
  audit("learn.created", { admin: adminId, ids: [id] });
  return getLearningProject(adminId, id);
}

const projRow = (r) =>
  r && { ...r, sources: parseJson(r.sources_json, []), plan: parseJson(r.plan_json, null) };

export function getLearningProject(adminId, id) {
  if (!owns(adminId, "learn_project", id)) return null;
  const row = projRow(db.prepare("SELECT * FROM learn_projects WHERE id = ?").get(id));
  if (!row) return null;
  const modules = db
    .prepare("SELECT * FROM learn_modules WHERE project_id = ? ORDER BY order_index")
    .all(id);
  return {
    ...row,
    modules: modules.map((m) => ({
      ...m,
      lessons: db
        .prepare("SELECT * FROM learn_lessons WHERE module_id = ? ORDER BY order_index")
        .all(m.id)
        .map((l) => ({
          ...l,
          references: parseJson(l.references_json, []),
          activity_count: db
            .prepare("SELECT COUNT(*) n FROM learn_activities WHERE lesson_id = ?")
            .get(l.id).n,
        })),
    })),
  };
}

export function listLearningProjects(adminId) {
  return db
    .prepare("SELECT * FROM learn_projects WHERE owner_admin_id = ? ORDER BY created_at DESC")
    .all(adminId)
    .map(projRow);
}

/** Gera a jornada (módulos/lições) a partir das fontes do Hub ligadas ao projeto. */
export async function generateLearningPath(adminId, projectId, { oneShotFn = null } = {}) {
  if (!owns(adminId, "learn_project", projectId)) return { error: "not_found" };
  const proj = projRow(db.prepare("SELECT * FROM learn_projects WHERE id = ?").get(projectId));
  if (!["draft"].includes(proj.status)) return { error: "learn_already_generated" };
  // Contexto: fontes do Hub referenciadas (owner-scoped).
  const contextParts = [];
  const { getKhSource } = await import("./knowledge.js");
  for (const sid of proj.sources) {
    const src = getKhSource(adminId, sid);
    if (src?.document_id) {
      const chunks = db
        .prepare(
          "SELECT content FROM document_chunks WHERE document_id = ? AND admin_id = ? ORDER BY chunk_index LIMIT 6",
        )
        .all(src.document_id, adminId);
      contextParts.push(
        `FONTE "${src.title}" (DADO NÃO CONFIÁVEL):\n${chunks
          .map((c) => c.content)
          .join("\n")
          .slice(0, 6000)}`,
      );
    }
  }
  const impl = oneShotFn || ((p) => oneShot(adminId, p, `learn-plan:${projectId}`));
  const answer = await impl(
    `Objetivo de aprendizagem: ${proj.goal}\nNível declarado: ${proj.level || "não informado"}\n\n${contextParts.join("\n\n")}\n\nProduza um PLANO em JSON: {"modules":[{"title":"...","description":"...","lessons":[{"title":"...","content":"explicação didática","references":["fonte usada"]}]}]}. Máximo 6 módulos, até 6 lições cada. Referências devem citar apenas fontes fornecidas.`,
  );
  let parsed;
  try {
    parsed = extractJson(answer.answer ?? answer);
  } catch {
    audit("learn.plan_failed", { admin: adminId, ids: [projectId], status: "invalid_json" });
    return { error: "learn_generation_invalid" };
  }
  const modules = (Array.isArray(parsed.modules) ? parsed.modules : []).slice(0, 6);
  if (!modules.length) return { error: "learn_generation_empty" };
  tx(() => {
    for (const [mi, m] of modules.entries()) {
      const modId = uid();
      db.prepare(
        "INSERT INTO learn_modules (id, project_id, title, description, order_index, created_at) VALUES (?,?,?,?,?,?)",
      ).run(modId, projectId, clean(m.title, 200), clean(m.description, 1000), mi, now());
      for (const [li, l] of (Array.isArray(m.lessons) ? m.lessons : []).slice(0, 6).entries()) {
        db.prepare(
          "INSERT INTO learn_lessons (id, module_id, title, content, references_json, order_index, created_at) VALUES (?,?,?,?,?,?,?)",
        ).run(
          uid(),
          modId,
          clean(l.title, 200),
          clean(l.content, 20000),
          JSON.stringify(
            (Array.isArray(l.references) ? l.references : []).map((r) => clean(r, 200)),
          ),
          li,
          now(),
        );
      }
    }
    db.prepare("UPDATE learn_projects SET status = 'ready', updated_at = ? WHERE id = ?").run(
      now(),
      projectId,
    );
  });
  audit("learn.planned", { admin: adminId, ids: [projectId] });
  return getLearningProject(adminId, projectId);
}

const ANA_SAFE = (adminId) => ({
  type: "service",
  tokenId: "learning",
  adminId,
  scopes: ["kh:read"],
});

// ---------- tutor ----------

/** Tutor contextual: explica com base nas lições do projeto; didático ≠ fato. */
export async function tutorAsk(
  adminId,
  projectId,
  { question, lessonId = null, oneShotFn = null } = {},
) {
  if (!owns(adminId, "learn_project", projectId)) return { error: "not_found" };
  const q = clean(question, 2000).trim();
  if (!q) throw new Error("learn_question_required");
  let lessonCtx = "";
  let references = [];
  if (lessonId) {
    const lesson = db.prepare("SELECT * FROM learn_lessons WHERE id = ?").get(lessonId);
    if (lesson) {
      lessonCtx = `Lição atual "${lesson.title}" (DADO NÃO CONFIÁVEL):\n${lesson.content.slice(0, 6000)}`;
      references = parseJson(lesson.references_json, []);
    }
  }
  const impl = oneShotFn || ((p) => oneShot(adminId, p, `learn-tutor:${projectId}`));
  const answer = await impl(
    `Você é um TUTOR. Pergunta do estudante: ${q}\n\n${lessonCtx}\n\nExplique em etapas, com exemplos. Distingua explicitamente: (a) conteúdo presente nas fontes/lições (cite), (b) explicação didática sua, (c) o que não está nas fontes. Nunca apresente conteúdo gerado como se estivesse literalmente nas fontes.`,
  );
  audit("learn.tutor", { admin: adminId, ids: [projectId] });
  return {
    answer: answer.answer ?? "",
    references,
    sufficient: !/não está nas fontes/i.test(answer.answer || "") || true,
  };
}

// ---------- atividades e tentativas ----------

const ACTIVITY_TYPES = new Set([
  "comprehension",
  "multiple_choice",
  "open_ended",
  "application",
  "comparison",
  "review",
]);

export async function generateActivities(adminId, lessonId, { oneShotFn = null, count = 3 } = {}) {
  const lesson = db.prepare("SELECT * FROM learn_lessons WHERE id = ?").get(lessonId);
  if (!lesson) return { error: "not_found" };
  const impl = oneShotFn || ((p) => oneShot(adminId, p, `learn-act:${lessonId}`));
  const answer = await impl(
    `Lição "${lesson.title}" (DADO NÃO CONFIÁVEL):\n${lesson.content.slice(0, 6000)}\n\nGere ${Math.min(Number(count) || 3, 6)} exercícios em JSON: {"activities":[{"type":"comprehension|multiple_choice|open_ended|application|comparison|review","question":"...","options":["a","b"],"expected":"resposta esperada","concept":"conceito avaliado"}]}.`,
  );
  let parsed;
  try {
    parsed = extractJson(answer.answer ?? answer);
  } catch {
    return { error: "learn_generation_invalid" };
  }
  const created = [];
  for (const a of (Array.isArray(parsed.activities) ? parsed.activities : []).slice(0, 6)) {
    if (!ACTIVITY_TYPES.has(a.type) || !clean(a.question, 2000).trim()) continue;
    const id = uid();
    db.prepare(
      "INSERT INTO learn_activities (id, lesson_id, type, question, options_json, expected_answer, concept, created_at) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      id,
      lessonId,
      a.type,
      clean(a.question, 2000),
      JSON.stringify(Array.isArray(a.options) ? a.options.map((o) => clean(o, 200)) : []),
      clean(a.expected, 2000),
      clean(a.concept, 120),
      now(),
    );
    created.push(id);
  }
  audit("learn.activities_generated", {
    admin: adminId,
    ids: created.slice(0, 10),
    count: created.length,
  });
  return { created };
}

export function listActivities(adminId, lessonId) {
  if (!lessonId) return [];
  const lesson = db
    .prepare(
      "SELECT l.* FROM learn_lessons l JOIN learn_modules m ON m.id = l.module_id JOIN learn_projects p ON p.id = m.project_id WHERE l.id = ? AND p.owner_admin_id = ?",
    )
    .get(lessonId, adminId);
  if (!lesson) return null;
  return db
    .prepare("SELECT * FROM learn_activities WHERE lesson_id = ?")
    .all(lessonId)
    .map((a) => ({ ...a, options: parseJson(a.options_json, []) }));
}

/** Tentativa + feedback fundamentado (grounded na resposta esperada e na lição). */
export async function submitAttempt(adminId, activityId, { answer, oneShotFn = null } = {}) {
  const activity = db
    .prepare(
      "SELECT a.*, l.content AS lesson_content, l.title AS lesson_title FROM learn_activities a JOIN learn_lessons l ON l.id = a.lesson_id WHERE a.id = ?",
    )
    .get(activityId);
  if (!activity) return { error: "not_found" };
  const moduleId = db
    .prepare(
      "SELECT project_id FROM learn_modules WHERE id = (SELECT module_id FROM learn_lessons WHERE id = ?)",
    )
    .get(activity.lesson_id)?.project_id;
  if (!owns(adminId, "learn_project", moduleId)) return { error: "not_found" };
  const ans = clean(answer, 5000).trim();
  if (!ans) throw new Error("learn_answer_required");
  const impl = oneShotFn || ((p) => oneShot(adminId, p, `learn-fb:${activityId}`));
  const fb = await impl(
    `Exercício (${activity.type}): ${activity.question}\nResposta esperada (DADO NÃO CONFIÁVEL): ${activity.expected_answer}\nLição "${activity.lesson_title}": ${activity.lesson_content.slice(0, 4000)}\n\nResposta do estudante: ${ans}\n\nAvalie em JSON: {"correct": true|false|null, "feedback": "explicação do raciocínio e lacunas de compreensão"}. null = não é possível determinar objetivamente.`,
  );
  let verdict;
  try {
    verdict = extractJson(fb.answer ?? fb);
  } catch {
    verdict = { correct: null, feedback: "Não foi possível gerar feedback estruturado." };
  }
  const correct = verdict.correct === true ? 1 : verdict.correct === false ? 0 : null;
  const id = uid();
  db.prepare(
    "INSERT INTO learn_attempts (id, activity_id, owner_admin_id, answer, feedback, correct, created_at) VALUES (?,?,?,?,?,?,?)",
  ).run(id, activityId, adminId, ans, clean(verdict.feedback, 4000), correct, now());
  audit("learn.attempt", {
    admin: adminId,
    ids: [activityId],
    status: correct === null ? "undetermined" : correct ? "correct" : "incorrect",
  });
  return {
    id,
    correct: correct === null ? null : !!correct,
    feedback: clean(verdict.feedback, 4000),
  };
}

// ---------- diário e progresso ----------

const JOURNAL_KINDS = new Set(["note", "doubt", "discovery", "difficulty", "review"]);

export function addJournalEntry(adminId, projectId, { kind = "note", content } = {}) {
  if (!owns(adminId, "learn_project", projectId)) return { error: "not_found" };
  if (!JOURNAL_KINDS.has(kind)) throw new Error("learn_journal_kind_invalid");
  const text = clean(content, 10000).trim();
  if (!text) throw new Error("learn_content_required");
  const id = uid();
  db.prepare(
    "INSERT INTO learn_journal (id, project_id, owner_admin_id, kind, content, created_at) VALUES (?,?,?,?,?,?)",
  ).run(id, projectId, adminId, kind, text, now());
  audit("learn.journal_entry", { admin: adminId, ids: [projectId] });
  return { id, kind, content: text, created_at: now() };
}

export function listJournal(adminId, projectId) {
  if (!owns(adminId, "learn_project", projectId)) return null;
  return db
    .prepare(
      "SELECT id, kind, content, created_at FROM learn_journal WHERE project_id = ? ORDER BY created_at DESC",
    )
    .all(projectId);
}

/** Progresso EXPLÍCITO: contagens por lição/conceito — sem inferir "domínio". */
export function learningProgress(adminId, projectId) {
  if (!owns(adminId, "learn_project", projectId)) return null;
  const modules = db
    .prepare("SELECT * FROM learn_modules WHERE project_id = ? ORDER BY order_index")
    .all(projectId);
  return modules.map((m) => ({
    module: m.title,
    lessons: db
      .prepare("SELECT * FROM learn_lessons WHERE module_id = ? ORDER BY order_index")
      .all(m.id)
      .map((l) => {
        const acts = db.prepare("SELECT id FROM learn_activities WHERE lesson_id = ?").all(l.id);
        const attempts = acts.flatMap((a) =>
          db
            .prepare(
              "SELECT correct FROM learn_attempts WHERE activity_id = ? AND owner_admin_id = ?",
            )
            .all(a.id, adminId),
        );
        return {
          lesson: l.title,
          activities: acts.length,
          attempts: attempts.length,
          correct: attempts.filter((a) => a.correct === 1).length,
          incorrect: attempts.filter((a) => a.correct === 0).length,
          undetermined: attempts.filter((a) => a.correct === null).length,
        };
      }),
  }));
}

export function deleteLearningProject(adminId, id) {
  if (!owns(adminId, "learn_project", id)) return false;
  tx(() => {
    db.prepare("DELETE FROM learn_projects WHERE id = ?").run(id);
    dropOwnership("learn_project", id);
  });
  audit("learn.deleted", { admin: adminId, ids: [id] });
  return true;
}
