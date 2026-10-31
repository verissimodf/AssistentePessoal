// Learning Engine (evolução Fase 4): jornada, tutor com citações, exercícios, tentativas
// com feedback, diário, progresso explícito, ownership e isolamento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), "jarvis-learn-"));
process.env.JARVIS_NO_LISTEN = "1";
const { db } = await import("../server/db.js");
const { createAuth } = await import("../server/auth.js");
const auth = createAuth(db, { dataDir: process.env.JARVIS_DATA_DIR });
auth.setupFirstAdmin({
  token: auth.ensureBootstrap().token,
  username: "ana",
  password: "senha-muito-forte-1",
});
const ADMIN = auth.validateSession(
  auth.login({ username: "ana", password: "senha-muito-forte-1", ip: "127.0.0.1" }).sid,
);

const learn = await import("../server/learning.js");
const kh = await import("../server/knowledge.js");

// Fixture one-shot: plano/tutor/atividades/feedback determinísticos.
const fixture =
  (overrides = {}) =>
  async (prompt) => {
    if (prompt.includes("PLANO em JSON")) {
      return {
        answer: JSON.stringify({
          modules: [
            {
              title: "Fundamentos de SQL",
              description: "básico",
              lessons: [
                {
                  title: "SELECT básico",
                  content: "SELECT recupera linhas de uma tabela.",
                  references: ["Apostila SQL"],
                },
                {
                  title: "WHERE e filtros",
                  content: "WHERE filtra linhas por condição.",
                  references: ["Apostila SQL"],
                },
              ],
            },
            {
              title: "JOINs",
              description: "relações",
              lessons: [
                {
                  title: "INNER JOIN",
                  content: "INNER JOIN combina tabelas por chave.",
                  references: ["Apostila SQL"],
                },
              ],
            },
          ],
        }),
      };
    }
    if (prompt.includes("TUTOR")) {
      return {
        answer: `Vamos por etapas: (1) SELECT lê linhas — isso está na lição "SELECT básico"; (2) explicação didática minha: pense numa peneira. O que NÃO está nas fontes: desempenho em produção.`,
      };
    }
    if (prompt.includes("exercícios em JSON")) {
      return {
        answer: JSON.stringify({
          activities: [
            {
              type: "comprehension",
              question: "O que faz o SELECT?",
              expected: "recupera linhas",
              concept: "select",
            },
            {
              type: "multiple_choice",
              question: "WHERE serve para?",
              options: ["filtrar linhas", "criar tabelas"],
              expected: "filtrar linhas",
              concept: "where",
            },
            {
              type: "open_ended",
              question: "Explique INNER JOIN.",
              expected: "combina tabelas por chave",
              concept: "join",
            },
          ],
        }),
      };
    }
    if (prompt.includes("Avalie em JSON")) {
      return {
        answer: JSON.stringify({
          correct: prompt.includes("recupera linhas"),
          feedback: "Correto: SELECT recupera linhas; o conceito é 'select'.",
        }),
      };
    }
    return { answer: "ok" };
  };

test("jornada: criação, plano (módulos/lições com referências), ownership", async () => {
  const proj = learn.createLearningProject(ADMIN.adminId, {
    goal: "Aprender SQL",
    level: "iniciante",
  });
  assert.equal(proj.status, "draft");
  assert.equal(learn.getLearningProject("admin-fantasma", proj.id), null);
  // Sem fonte do Hub ainda: plano gerado a partir do objetivo (fixture).
  const out = await learn.generateLearningPath(ADMIN.adminId, proj.id, { oneShotFn: fixture() });
  assert.equal(out.status, "ready");
  assert.equal(out.modules.length, 2);
  assert.equal(out.modules[0].lessons.length, 2);
  assert.deepEqual(out.modules[0].lessons[0].references, ["Apostila SQL"]);
  // Regenerar jornada existente é recusado (idempotência de plano).
  assert.equal(
    (await learn.generateLearningPath(ADMIN.adminId, proj.id, { oneShotFn: fixture() })).error,
    "learn_already_generated",
  );
});

test("integração Hub: fontes do acervo entram no plano com proveniência", async () => {
  const lib = kh.createLibrary(ADMIN.adminId, {
    name: "Estudos-" + Math.random().toString(36).slice(2, 6),
  });
  const nb = kh.createNotebook(ADMIN.adminId, {
    libraryId: lib.id,
    name: "SQL-" + Math.random().toString(36).slice(2, 6),
  });
  const { source } = await kh.createSource(ADMIN.adminId, {
    notebookId: nb.id,
    type: "text",
    title: "Apostila SQL",
    content: "SELECT recupera linhas. WHERE filtra. JOIN combina tabelas.",
  });
  const proj = learn.createLearningProject(ADMIN.adminId, {
    goal: "SQL prático",
    sourceIds: [source.id],
  });
  const generated = await learn.generateLearningPath(ADMIN.adminId, proj.id, {
    oneShotFn: fixture(),
  });
  assert.equal(generated.status, "ready");
  const stored = JSON.parse(
    db.prepare("SELECT sources_json FROM learn_projects WHERE id = ?").get(proj.id).sources_json,
  );
  assert.deepEqual(stored, [source.id]);
});

test("tutor: cita lições; didático diferenciado de fato", async () => {
  const proj = learn.createLearningProject(ADMIN.adminId, { goal: "SQL", level: "básico" });
  const ready = await learn.generateLearningPath(ADMIN.adminId, proj.id, { oneShotFn: fixture() });
  const lesson = ready.modules[0].lessons[0];
  const out = await learn.tutorAsk(ADMIN.adminId, proj.id, {
    question: "Como funciona o SELECT?",
    lessonId: lesson.id,
    oneShotFn: fixture(),
  });
  assert.ok(out.answer.includes("etapas"));
  assert.deepEqual(out.references, ["Apostila SQL"]);
});

test("exercícios + tentativas: feedback fundamentado e progresso explícito (sem inventar domínio)", async () => {
  const proj = learn.createLearningProject(ADMIN.adminId, { goal: "SQL avançado" });
  const ready = await learn.generateLearningPath(ADMIN.adminId, proj.id, { oneShotFn: fixture() });
  const lesson = ready.modules[0].lessons[0];
  const acts = await learn.generateActivities(ADMIN.adminId, lesson.id, { oneShotFn: fixture() });
  assert.equal(acts.created.length, 3);
  const list = learn.listActivities(ADMIN.adminId, lesson.id);
  assert.equal(list.length, 3);
  const mc = list.find((a) => a.type === "multiple_choice");
  assert.deepEqual(mc.options, ["filtrar linhas", "criar tabelas"]);
  // Tentativa correta e incorreta.
  const ok = await learn.submitAttempt(ADMIN.adminId, mc.id, {
    answer: "recupera linhas",
    oneShotFn: fixture(),
  });
  assert.equal(ok.correct, true);
  assert.match(ok.feedback, /SELECT/);
  const bad = await learn.submitAttempt(ADMIN.adminId, mc.id, {
    answer: "deleta tabelas",
    oneShotFn: async (p) => ({
      answer: JSON.stringify({ correct: false, feedback: "Não: WHERE filtra." }),
    }),
  });
  assert.equal(bad.correct, false);
  // Resposta indeterminável → correct null (nunca chutado).
  const und = await learn.submitAttempt(ADMIN.adminId, mc.id, {
    answer: "hmm",
    oneShotFn: async () => ({ answer: JSON.stringify({ correct: null, feedback: "ambíguo" }) }),
  });
  assert.equal(und.correct, null);
  // Progresso: contagens reais, sem rótulos de "domínio".
  const progress = learn.learningProgress(ADMIN.adminId, proj.id);
  assert.equal(progress[0].lessons[0].attempts, 3);
  assert.equal(progress[0].lessons[0].correct, 1);
  assert.equal(progress[0].lessons[0].incorrect, 1);
  assert.equal(progress[0].lessons[0].undetermined, 1);
  assert.ok(!JSON.stringify(progress).includes("domínio"));
});

test("diário: entradas do usuário não são fatos; isolamento cross-owner", async () => {
  auth.reauth(ADMIN, "senha-muito-forte-1");
  auth.createAdmin(ADMIN, {
    username: "bia-learn",
    password: "senha-muito-forte-2",
    currentPassword: "senha-muito-forte-1",
  });
  const BIA = auth.validateSession(
    auth.login({ username: "bia-learn", password: "senha-muito-forte-2", ip: "127.0.0.1" }).sid,
  );
  const proj = learn.createLearningProject(ADMIN.adminId, { goal: "História" });
  const entry = learn.addJournalEntry(ADMIN.adminId, proj.id, {
    kind: "doubt",
    content: "Não entendi a causa da guerra.",
  });
  assert.equal(entry.kind, "doubt");
  assert.throws(
    () => learn.addJournalEntry(ADMIN.adminId, proj.id, { kind: "fato", content: "x" }),
    /learn_journal_kind_invalid/,
  );
  // BIA não vê nem escreve no diário de ana.
  assert.equal(learn.listJournal(BIA.adminId, proj.id), null);
  assert.equal(
    learn.addJournalEntry(BIA.adminId, proj.id, { kind: "note", content: "x" }).error,
    "not_found",
  );
  // progresso também é isolado.
  assert.equal(learn.learningProgress(BIA.adminId, proj.id), null);
});
