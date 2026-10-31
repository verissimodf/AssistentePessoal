import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GraduationCap, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  addJournalEntry,
  createLearning,
  generateLearningActivities,
  generateLearningPath,
  getLearning,
  getLearningProgress,
  listJournal,
  listLearning,
  listLearningActivities,
  ping,
  submitLearningAttempt,
  tutorAsk,
  type LearnActivity,
  type LearnJournalEntry,
  type LearnProject,
  type LearnProjectDetail,
  type LearnProgressRow,
} from "@/lib/bridge";
import { learnAttemptBadge, labelFrom } from "@/lib/research-ui";
import { useI18n, type TKey } from "@/lib/i18n";

export const Route = createFileRoute("/learning")({
  head: () => ({
    meta: [
      { title: "Learning Studio — Jarvis" },
      {
        name: "description",
        content:
          "Jornadas de aprendizagem com tutor citável, exercícios com tentativas, diário e progresso por contagens.",
      },
      { property: "og:title", content: "Learning Studio — Jarvis" },
      {
        property: "og:description",
        content:
          "Learning Studio local: módulos/lições a partir das fontes do Hub, tutor, diário e contagens explícitas.",
      },
    ],
  }),
  component: LearningPage,
});

const JOURNAL_KINDS = ["note", "doubt", "discovery", "difficulty", "review"] as const;

const JK_KEYS: Record<string, TKey> = {
  note: "lr_jk_note",
  doubt: "lr_jk_doubt",
  discovery: "lr_jk_discovery",
  difficulty: "lr_jk_difficulty",
  review: "lr_jk_review",
};

export function LearningPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<LearnProject[] | null>(null);
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LearnProjectDetail | null>(null);
  const [tutorQ, setTutorQ] = useState("");
  const [tutorLesson, setTutorLesson] = useState("");
  const [tutorAnswer, setTutorAnswer] = useState<string | null>(null);
  const [acts, setActs] = useState<Record<string, LearnActivity[]>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [verdicts, setVerdicts] = useState<
    Record<string, { correct: boolean | null; feedback: string }>
  >({});
  const [journal, setJournal] = useState<LearnJournalEntry[]>([]);
  const [jk, setJk] = useState<(typeof JOURNAL_KINDS)[number]>("note");
  const [jContent, setJContent] = useState("");
  const [progress, setProgress] = useState<LearnProgressRow[] | null>(null);

  const refresh = () =>
    listLearning()
      .then((r) => setItems(r ?? []))
      .catch(() => undefined);

  useEffect(() => {
    refresh();
  }, []);

  const gated = async () => {
    if (await ping()) return true;
    toast.info(t("demo_hint"));
    return false;
  };

  const open = (id: string) => {
    setOpenId(id);
    getLearning(id)
      .then((d) => {
        setDetail(d);
        setJournal([]);
        setProgress(null);
        setTutorAnswer(null);
        setTutorLesson("");
        setActs({});
        setVerdicts({});
      })
      .catch(() => undefined);
    listJournal(id)
      .then((j) => setJournal(j ?? []))
      .catch(() => undefined);
    getLearningProgress(id)
      .then((p) => setProgress(p))
      .catch(() => undefined);
  };

  const close = () => {
    setOpenId(null);
    setDetail(null);
    refresh();
  };

  const create = async () => {
    if (!goal.trim()) return;
    if (!(await gated())) return;
    try {
      const proj = await createLearning({
        goal: goal.trim(),
        ...(level.trim() ? { level: level.trim() } : {}),
      });
      toast.success(t("lr_created"));
      setGoal("");
      setLevel("");
      if (proj) open(proj.id);
      refresh();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const generatePath = async (id: string) => {
    if (!(await gated())) return;
    try {
      const d = await generateLearningPath(id);
      toast.success(t("lr_path_generated"));
      if (d) setDetail(d);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const refreshActs = (lessonId: string) =>
    listLearningActivities(lessonId)
      .then((a) => setActs((m) => ({ ...m, [lessonId]: a ?? [] })))
      .catch(() => undefined);

  const genActs = async (lessonId: string) => {
    if (!(await gated())) return;
    try {
      await generateLearningActivities(lessonId, 3);
      toast.success(t("lr_acts_generated"));
      refreshActs(lessonId);
      // activity_count do detalhe fica defasado; recarrega o projeto.
      if (openId)
        getLearning(openId)
          .then((d) => d && setDetail(d))
          .catch(() => undefined);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const submit = async (activityId: string) => {
    const answer = (answers[activityId] ?? "").trim();
    if (!answer) return;
    if (!(await gated())) return;
    try {
      const out = await submitLearningAttempt(activityId, answer);
      toast.success(t("lr_attempt_saved"));
      if (out) setVerdicts((m) => ({ ...m, [activityId]: out }));
      if (openId)
        getLearningProgress(openId)
          .then((p) => setProgress(p))
          .catch(() => undefined);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const ask = async () => {
    if (!openId || !tutorQ.trim()) return;
    if (!(await gated())) return;
    try {
      const out = await tutorAsk(openId, {
        question: tutorQ.trim(),
        ...(tutorLesson ? { lesson_id: tutorLesson } : {}),
      });
      toast.success(t("lr_tutor_answered"));
      if (out) setTutorAnswer(out.answer);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const addJournal = async () => {
    if (!openId || !jContent.trim()) return;
    if (!(await gated())) return;
    try {
      await addJournalEntry(openId, { kind: jk, content: jContent.trim() });
      toast.success(t("lr_journal_added"));
      setJContent("");
      listJournal(openId)
        .then((j) => setJournal(j ?? []))
        .catch(() => undefined);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const allLessons = (detail?.modules ?? []).flatMap((m) => m.lessons);

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("lr_title")} sub={t("lr_sub")} />

      {openId && detail ? (
        <div className="space-y-6" data-testid="lr-detail">
          <Button size="sm" variant="outline" onClick={close}>
            {t("rs_back")}
          </Button>

          <section className="hud-panel space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {detail.status === "ready" ? t("lr_status_ready") : t("lr_status_draft")}
              </Badge>
              <span className="flex-1 text-lg">{detail.goal}</span>
            </div>
            {detail.level && <p className="text-sm text-muted-foreground">{detail.level}</p>}
            <div className="pt-2">
              <Button size="sm" onClick={() => generatePath(detail.id)}>
                <Sparkles className="h-3 w-3" />
                {t("lr_generate_path")}
              </Button>
            </div>
          </section>

          {/* Módulos e lições */}
          <section data-testid="lr-modules">
            <div className="hud-label mb-2">{t("lr_modules")}</div>
            {detail.modules.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("lr_no_modules")}</p>
            )}
            <div className="space-y-3">
              {detail.modules.map((m) => (
                <div key={m.id} className="hud-panel p-4" data-testid="lr-module-row">
                  <div className="font-display text-base">{m.title}</div>
                  {m.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
                  )}
                  <div className="mt-3 space-y-3">
                    {m.lessons.map((l) => (
                      <div
                        key={l.id}
                        className="rounded-md border border-border p-3"
                        data-testid="lr-lesson-row"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex-1 text-sm font-medium">{l.title}</span>
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {l.activity_count} {t("lr_activities_n")}
                          </Badge>
                          <Button size="sm" variant="outline" onClick={() => genActs(l.id)}>
                            <Plus className="h-3 w-3" />
                            {t("lr_generate_acts")}
                          </Button>
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap text-sm">{l.content}</pre>
                        {l.references.length > 0 && (
                          <div className="mt-2">
                            <div className="hud-label text-xs">{t("lr_references")}</div>
                            <ul className="space-y-0.5 text-xs text-muted-foreground">
                              {l.references.map((r, i) => (
                                <li key={i}>· {r}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Exercícios da lição */}
                        <div className="mt-3 space-y-2" data-testid="lr-activities">
                          <div className="hud-label text-xs">{t("lr_activities")}</div>
                          {(acts[l.id] ?? []).map((a) => {
                            const v = verdicts[a.id];
                            const ab = learnAttemptBadge(v ? v.correct : null);
                            return (
                              <div
                                key={a.id}
                                className="space-y-1 rounded-md border border-border p-2"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="font-mono text-[10px]">
                                    {a.type}
                                  </Badge>
                                  {a.concept && (
                                    <Badge variant="secondary" className="font-mono text-[10px]">
                                      {a.concept}
                                    </Badge>
                                  )}
                                  <span className="flex-1 text-sm">{a.question}</span>
                                </div>
                                {a.options.length > 0 && (
                                  <ul className="list-disc pl-5 text-xs text-muted-foreground">
                                    {a.options.map((o, i) => (
                                      <li key={i}>{o}</li>
                                    ))}
                                  </ul>
                                )}
                                <Textarea
                                  rows={2}
                                  placeholder={t("lr_answer")}
                                  value={answers[a.id] ?? ""}
                                  onChange={(e) =>
                                    setAnswers((mm) => ({ ...mm, [a.id]: e.target.value }))
                                  }
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => submit(a.id)}
                                    disabled={!(answers[a.id] ?? "").trim()}
                                  >
                                    {t("lr_submit")}
                                  </Button>
                                  {v && (
                                    <>
                                      <Badge variant={ab.variant} className={ab.className}>
                                        {ab.label}
                                      </Badge>
                                      <p className="flex-1 text-xs text-muted-foreground">
                                        {v.feedback}
                                      </p>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Tutor */}
          <section className="hud-panel space-y-2 p-4" data-testid="lr-tutor-panel">
            <div className="hud-label">{t("lr_tutor")}</div>
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-md border border-input bg-secondary p-2 text-sm"
                value={tutorLesson}
                onChange={(e) => setTutorLesson(e.target.value)}
                aria-label={t("lr_lesson")}
              >
                <option value="">{t("lr_lesson")}</option>
                {allLessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
              <Input
                className="min-w-[200px] flex-1"
                placeholder={t("lr_tutor_question")}
                value={tutorQ}
                onChange={(e) => setTutorQ(e.target.value)}
              />
              <Button size="sm" onClick={ask} disabled={!tutorQ.trim()}>
                {t("lr_tutor_ask")}
              </Button>
            </div>
            {tutorAnswer && (
              <div className="rounded-md border border-border p-3" data-testid="lr-tutor-answer">
                <div className="hud-label">{t("lr_tutor_answer")}</div>
                <pre className="whitespace-pre-wrap text-sm">{tutorAnswer}</pre>
              </div>
            )}
          </section>

          {/* Diário */}
          <section className="hud-panel space-y-2 p-4" data-testid="lr-journal-panel">
            <div className="hud-label">{t("lr_journal")}</div>
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-md border border-input bg-secondary p-2 text-sm"
                value={jk}
                onChange={(e) => setJk(e.target.value as (typeof JOURNAL_KINDS)[number])}
                aria-label={t("lr_journal_kind")}
              >
                {JOURNAL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(JK_KEYS[k]!)}
                  </option>
                ))}
              </select>
              <Input
                className="min-w-[200px] flex-1"
                placeholder={t("lr_journal_content")}
                value={jContent}
                onChange={(e) => setJContent(e.target.value)}
              />
              <Button size="sm" onClick={addJournal} disabled={!jContent.trim()}>
                {t("lr_journal_add")}
              </Button>
            </div>
            <div className="space-y-2">
              {journal.map((j) => (
                <div
                  key={j.id}
                  className="rounded-md border border-border p-2"
                  data-testid="lr-journal-row"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {labelFrom(JK_KEYS, j.kind, t)}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{j.created_at}</span>
                  </div>
                  <p className="mt-1 text-sm">{j.content}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Progresso: contagens explícitas, sem rótulo de domínio */}
          <section className="hud-panel space-y-2 p-4" data-testid="lr-progress-panel">
            <div className="hud-label">{t("lr_progress")}</div>
            {!progress && <p className="text-sm text-muted-foreground">{t("lr_no_modules")}</p>}
            <div className="space-y-3">
              {(progress ?? []).map((row, i) => (
                <div key={i} data-testid="lr-progress-row">
                  <div className="hud-label text-xs">{row.module}</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 font-normal">{t("lr_lessons")}</th>
                        <th className="py-1 font-normal">{t("lr_col_activities")}</th>
                        <th className="py-1 font-normal">{t("lr_col_attempts")}</th>
                        <th className="py-1 font-normal">{t("lr_col_correct")}</th>
                        <th className="py-1 font-normal">{t("lr_col_incorrect")}</th>
                        <th className="py-1 font-normal">{t("lr_col_undetermined")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.lessons.map((l, j) => (
                        <tr key={j} className="border-t border-border font-mono">
                          <td className="py-1 font-sans">{l.lesson}</td>
                          <td className="py-1">{l.activities}</td>
                          <td className="py-1">{l.attempts}</td>
                          <td className="py-1">{l.correct}</td>
                          <td className="py-1">{l.incorrect}</td>
                          <td className="py-1">{l.undetermined}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* Lista de jornadas */}
          <section>
            <div className="hud-label mb-2">{t("lr_journeys")}</div>
            {items !== null && items.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("lr_empty")}</p>
            )}
            <div className="space-y-3">
              {(items ?? []).map((p) => (
                <div key={p.id} className="hud-panel p-4" data-testid="lr-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {p.status === "ready" ? t("lr_status_ready") : t("lr_status_draft")}
                    </Badge>
                    <span className="flex-1 text-sm">{p.goal}</span>
                    <Button size="sm" variant="outline" onClick={() => open(p.id)}>
                      <GraduationCap className="h-3 w-3" />
                      {t("lr_open")}
                    </Button>
                  </div>
                  {p.level && <p className="mt-1 text-xs text-muted-foreground">{p.level}</p>}
                </div>
              ))}
            </div>
          </section>

          {/* Nova jornada */}
          <aside className="hud-panel space-y-3 self-start p-4" data-testid="lr-form">
            <div className="hud-label">{t("lr_new")}</div>
            <Textarea
              rows={3}
              placeholder={t("lr_goal")}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
            <Input
              placeholder={t("lr_level")}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            />
            <Button className="w-full" onClick={create} disabled={!goal.trim()}>
              <Plus className="h-3 w-3" />
              {t("lr_create")}
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}
