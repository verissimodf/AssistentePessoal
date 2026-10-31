import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AudioLines, FileUp, Mic, MicOff, Play, Send, Square } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  closeMmSession,
  createConversation,
  getMmSession,
  interruptMmTurn,
  listConversations,
  listMmEvents,
  listMmSessions,
  openMmSession,
  sendMmTurn,
  speakMmTurn,
  startMmCapture,
  stopMmCapture,
  submitMmAudio,
  submitMmText,
  updateMmTranscript,
  ping,
  type ConversationSummary,
  type MmSession,
  type MmSessionSummary,
  type MmTurn,
} from "@/lib/bridge";
import {
  avatarStateFromTurn,
  describeTurnState,
  mmTurnBadgeClass,
  useAudioPlaying,
  voiceCaptureAvailable,
} from "@/lib/multimodal-ui";
import { speechLang, useI18n, type TKey } from "@/lib/i18n";

export const Route = createFileRoute("/multimodal")({
  head: () => ({
    meta: [
      { title: "Multimodal Studio — Jarvis" },
      {
        name: "description",
        content:
          "Voz e texto na mesma conversa: captura de microfone explícita, transcrição candidata com correção e envio confirmado.",
      },
      { property: "og:title", content: "Multimodal Studio — Jarvis" },
      {
        property: "og:description",
        content:
          "Studio multimodal local: captura explícita de áudio, transcrição corrigível e fala sincronizada ao áudio real.",
      },
    ],
  }),
  component: MultimodalPage,
});

/** Turnos ainda em andamento (um ativo por sessão, garantido pelo servidor). */
const ACTIVE_TURN_STATES = new Set([
  "listening",
  "transcribing",
  "processing",
  "generating",
  "speaking",
]);
/** Estados em que a transcrição ainda pode ser editada/corrigida (contrato do servidor). */
const EDITABLE_STATES = new Set(["listening", "idle", "transcribing", "interrupted"]);
/** Estados que aceitam o envio confirmado (contrato do servidor). */
const SENDABLE_STATES = new Set(["listening", "idle", "transcribing"]);

export function MultimodalPage() {
  const { t, lang } = useI18n();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [newConvTitle, setNewConvTitle] = useState("");
  const [convId, setConvId] = useState("");
  const [pastSessions, setPastSessions] = useState<MmSessionSummary[]>([]);
  const [session, setSession] = useState<MmSession | null>(null);
  const [busy, setBusy] = useState(false);

  // captura de microfone (SEMPRE explícita: getUserMedia só no clique)
  const [micOn, setMicOn] = useState(false);
  const micRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; turnId: string } | null>(
    null,
  );
  const fileRef = useRef<HTMLInputElement>(null);

  // reprodução da resposta — o avatar "speaking" SÓ existe com este <audio> tocando
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioPlaying = useAudioPlaying(audioEl);

  // entrada de texto + edição inline da transcrição
  const [textDraft, setTextDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // polling de eventos (2s) enquanto a sessão está ativa
  const lastEventIdRef = useRef(0);

  const refreshConversations = () =>
    listConversations()
      .then((c) => setConversations(c ?? []))
      .catch(() => undefined);
  const refreshPastSessions = () =>
    listMmSessions(20)
      .then((s) => setPastSessions(s ?? []))
      .catch(() => undefined);

  const loadDetail = (id: string) =>
    getMmSession(id)
      .then((d) => {
        if (!d) return;
        setSession(d);
        const last = d.events?.at(-1);
        if (last) {
          lastEventIdRef.current = Math.max(lastEventIdRef.current, last.id);
        }
      })
      .catch(() => undefined);

  useEffect(() => {
    refreshConversations();
    refreshPastSessions();
  }, []);

  // Higiene: ao desmontar, encerra tracks do microfone e libera o áudio.
  useEffect(
    () => () => {
      micRef.current?.stream.getTracks().forEach((tr) => tr.stop());
      micRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!session || session.status !== "active") return;
    let cancelled = false;
    const id = setInterval(async () => {
      const evs = await listMmEvents(session.id, lastEventIdRef.current);
      if (cancelled || !evs?.length) return;
      const last = evs.at(-1);
      if (last) lastEventIdRef.current = Math.max(lastEventIdRef.current, last.id);
      loadDetail(session.id);
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session?.id, session?.status]); /* eslint-disable-line react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!audioEl || !audioUrl) return;
    audioEl.play().catch(() => undefined);
  }, [audioEl, audioUrl]);

  const gated = async () => {
    if (await ping()) return true;
    toast.info(t("demo_hint"));
    return false;
  };

  const stateLabel = (state: string) => t(describeTurnState(state) as TKey);

  const stopAudio = () => {
    audioEl?.pause();
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
  };

  /** Para a gravação local: onstop encerra as tracks, para o turno no servidor e envia o Blob. */
  const stopMic = () => {
    const mic = micRef.current;
    if (!mic) return;
    micRef.current = null;
    try {
      mic.recorder.stop();
    } catch {
      mic.stream.getTracks().forEach((tr) => tr.stop());
      setMicOn(false);
    }
  };

  const startMic = async () => {
    if (!session || session.status !== "active" || micRef.current) return;
    if (!voiceCaptureAvailable()) {
      toast.info(t("mm_voice_unavailable"));
      return;
    }
    if (!(await gated())) return;
    setBusy(true);
    try {
      // Turno em escuta no servidor ANTES de abrir o microfone (falha limpa se houver turno ativo).
      const turn = await startMmCapture(session.id);
      if (!turn) throw new Error("mm_turn_concurrent");
      const sid = session.id;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
      } catch (e) {
        await stopMmCapture(turn.id).catch(() => undefined);
        throw e;
      }
      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"].find((x) =>
        MediaRecorder.isTypeSupported(x),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size) chunks.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setMicOn(false);
        const type = recorder.mimeType.split(";")[0] || "audio/webm";
        const ext = type.includes("ogg")
          ? "ogg"
          : type.includes("mp4")
            ? "m4a"
            : type.includes("wav")
              ? "wav"
              : "webm";
        stopMmCapture(turn.id)
          .catch(() => undefined)
          .then(() =>
            submitMmAudio(
              sid,
              new Blob(chunks, { type }),
              speechLang(lang).split("-")[0],
              `speech.${ext}`,
            ),
          )
          .then(() => {
            toast.success(t("mm_uploaded_toast"));
            loadDetail(sid);
          })
          .catch((e) => {
            toast.error(String((e as Error).message));
            loadDetail(sid);
          });
      };
      recorder.start(250);
      micRef.current = { recorder, stream, turnId: turn.id };
      setMicOn(true);
      loadDetail(sid);
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const onFilePicked = async (file: File) => {
    if (!session || session.status !== "active") return;
    if (!(await gated())) return;
    setBusy(true);
    try {
      await submitMmAudio(
        session.id,
        file,
        speechLang(lang).split("-")[0],
        file.name || "audio.webm",
      );
      toast.success(t("mm_uploaded_toast"));
      loadDetail(session.id);
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const createConv = async () => {
    if (!newConvTitle.trim()) return;
    if (!(await gated())) return;
    setBusy(true);
    try {
      const c = await createConversation(newConvTitle.trim());
      if (c?.id) {
        toast.success(t("mm_conversation_created"));
        setConvId(c.id);
        setNewConvTitle("");
        refreshConversations();
      }
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const openSession = async () => {
    if (!convId) return;
    if (!(await gated())) return;
    setBusy(true);
    try {
      const s = await openMmSession({ conversationId: convId });
      if (s?.id) {
        lastEventIdRef.current = 0;
        setSession(s);
        toast.success(t("mm_session_created"));
        refreshPastSessions();
      }
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const submitText = async () => {
    if (!session || !textDraft.trim()) return;
    if (!(await gated())) return;
    setBusy(true);
    try {
      await submitMmText(session.id, textDraft.trim());
      setTextDraft("");
      toast.success(t("mm_text_registered"));
      loadDetail(session.id);
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const saveTranscript = async (turn: MmTurn) => {
    if (!session || !editText.trim()) return;
    if (!(await gated())) return;
    setBusy(true);
    try {
      await updateMmTranscript(turn.id, editText.trim());
      setEditId(null);
      setEditText("");
      toast.success(t("mm_saved_toast"));
      loadDetail(session.id);
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const send = async (turn: MmTurn) => {
    if (!session) return;
    if (!(await gated())) return;
    setBusy(true);
    try {
      await sendMmTurn(turn.id);
      toast.success(t("mm_sent_toast"));
      loadDetail(session.id);
    } catch (e) {
      toast.error(String((e as Error).message));
      loadDetail(session.id);
    } finally {
      setBusy(false);
    }
  };

  const speak = async (turn: MmTurn) => {
    if (!(await gated())) return;
    setBusy(true);
    try {
      const blob = await speakMmTurn(turn.id);
      if (!blob) return;
      stopAudio();
      setAudioUrl(URL.createObjectURL(blob));
      loadDetail(turn.session_id);
    } catch (e) {
      toast.error(String((e as Error).message));
      loadDetail(turn.session_id);
    } finally {
      setBusy(false);
    }
  };

  const interrupt = async (turn: MmTurn) => {
    if (!session) return;
    stopAudio();
    if (micRef.current) stopMic();
    if (!(await gated())) return;
    setBusy(true);
    try {
      await interruptMmTurn(turn.id);
      toast.info(t("mm_interrupted_toast"));
      loadDetail(session.id);
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const closeSession = async () => {
    if (!session) return;
    stopAudio();
    if (micRef.current) stopMic();
    if (!(await gated())) return;
    setBusy(true);
    try {
      await closeMmSession(session.id);
      toast.success(t("mm_closed_toast"));
      loadDetail(session.id);
      refreshPastSessions();
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  /** Turno que define o estado do avatar: o mais recente ainda ativo; senão o último. */
  const avatarTurn =
    session?.turns.filter((x) => ACTIVE_TURN_STATES.has(x.state)).at(-1) ?? session?.turns.at(-1);
  const avatarState = session
    ? avatarStateFromTurn(avatarTurn?.state ?? "idle", micOn, session.status, audioPlaying)
    : "unavailable";
  const voiceOk = voiceCaptureAvailable();

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("mm_title")} sub={t("mm_sub")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Sessão ativa */}
          {session ? (
            <section className="hud-panel space-y-4 p-4" data-testid="mm-session">
              <div className="flex flex-wrap items-center gap-2">
                <Avatar
                  state={avatarState}
                  label={`${t("mm_title")} — ${stateLabel(avatarTurn?.state ?? "idle")}`}
                  className="h-16 w-16"
                />
                <div className="flex-1">
                  <div className="hud-label">{t("mm_session_active")}</div>
                  <div className="hud-label mt-1 text-xs">{session.id}</div>
                </div>
                {micOn && (
                  <Badge
                    variant="destructive"
                    className="ring-2 ring-destructive/50"
                    data-testid="mm-recording-badge"
                  >
                    ● {t("mm_recording_badge")}
                  </Badge>
                )}
                <Badge variant="outline" className={mmTurnBadgeClass(session.status)}>
                  {session.status === "active" ? t("mm_status_active") : t("mm_status_closed")}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || session.status !== "active"}
                  onClick={closeSession}
                >
                  <Square className="h-3 w-3" />
                  {t("mm_close_session")}
                </Button>
              </div>

              {/* aviso vivo para leitores de tela durante a captura */}
              <p aria-live="polite" className="sr-only">
                {micOn ? t("mm_recording_badge") : ""}
              </p>

              {/* Captura de voz explícita + upload + texto */}
              <div className="flex flex-wrap items-center gap-2">
                {micOn ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={stopMic}
                    data-testid="btn-mm-mic-stop"
                  >
                    <MicOff className="h-3 w-3" />
                    {t("mm_mic_stop")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || session.status !== "active"}
                    onClick={startMic}
                    data-testid="btn-mm-mic-start"
                  >
                    <Mic className="h-3 w-3" />
                    {t("mm_mic_start")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || session.status !== "active"}
                  onClick={() => fileRef.current?.click()}
                >
                  <FileUp className="h-3 w-3" />
                  {t("mm_upload_audio")}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) onFilePicked(f);
                  }}
                />
              </div>
              {!voiceOk && (
                <p className="text-xs text-destructive" role="note">
                  {t("mm_voice_unavailable")}
                </p>
              )}

              <div className="space-y-2">
                <div className="hud-label">{t("mm_text_label")}</div>
                <Textarea
                  rows={2}
                  placeholder={t("mm_text_placeholder")}
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={busy || !textDraft.trim() || session.status !== "active"}
                  onClick={submitText}
                >
                  <Send className="h-3 w-3" />
                  {t("mm_send_text")}
                </Button>
                <p className="text-xs text-muted-foreground">{t("mm_upload_hint")}</p>
              </div>

              {/* Turnos */}
              <div className="space-y-3">
                <div className="hud-label">{t("mm_turns")}</div>
                {(session.turns ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("mm_no_turns")}</p>
                )}
                {(session.turns ?? []).map((turn) => {
                  const editable =
                    session.status === "active" &&
                    !!turn.transcript?.text &&
                    EDITABLE_STATES.has(turn.state);
                  const sendable =
                    session.status === "active" &&
                    !!turn.transcript?.text &&
                    SENDABLE_STATES.has(turn.state);
                  return (
                    <div
                      key={turn.id}
                      className="space-y-2 rounded-md border border-border p-3"
                      data-testid="mm-turn"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={mmTurnBadgeClass(turn.state)}>
                          {stateLabel(turn.state)}
                        </Badge>
                        <span className="hud-label text-xs">
                          #{turn.seq} · {turn.input_kind} · {turn.created_at}
                        </span>
                        <div className="flex-1" />
                        {session.status === "active" &&
                          (ACTIVE_TURN_STATES.has(turn.state) || turn.state === "completed") && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => interrupt(turn)}
                            >
                              <Square className="h-3 w-3" />
                              {t("mm_interrupt")}
                            </Button>
                          )}
                      </div>

                      {/* Transcrição candidata — NUNCA envia sozinha */}
                      {turn.transcript?.text && (
                        <div className="space-y-1">
                          <div className="hud-label text-xs">{t("mm_transcript_label")}</div>
                          {editId === turn.id ? (
                            <div className="space-y-1">
                              <Textarea
                                rows={2}
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                              />
                              <Button
                                size="sm"
                                disabled={busy || !editText.trim()}
                                onClick={() => saveTranscript(turn)}
                              >
                                {t("mm_save_transcript")}
                              </Button>
                            </div>
                          ) : (
                            <p className="text-sm whitespace-pre-wrap">{turn.transcript.text}</p>
                          )}
                        </div>
                      )}
                      {turn.error_code && (
                        <p className="text-xs text-destructive">
                          {t("mm_error_code")}: {turn.error_code}
                        </p>
                      )}

                      {/* Resposta + latência observada */}
                      {turn.output_text && (
                        <div className="space-y-1">
                          <div className="hud-label text-xs">{t("mm_reply")}</div>
                          <p className="text-sm whitespace-pre-wrap">{turn.output_text}</p>
                          {typeof turn.latency?.["generation_ms"] === "number" && (
                            <p className="hud-label text-xs">
                              {t("mm_latency")}: {turn.latency["generation_ms"]} ms
                            </p>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {editable && editId !== turn.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              setEditId(turn.id);
                              setEditText(turn.transcript?.text ?? "");
                            }}
                          >
                            {t("mm_edit_transcript")}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          disabled={busy || !sendable}
                          onClick={() => send(turn)}
                          data-testid="btn-mm-send"
                        >
                          <Send className="h-3 w-3" />
                          {t("mm_send")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || session.status !== "active" || !turn.output_text}
                          onClick={() => speak(turn)}
                        >
                          <Play className="h-3 w-3" />
                          {t("mm_speak")}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">{t("mm_note")}</p>
              </div>

              {/* áudio real da resposta: o estado "speaking" só existe enquanto ele toca */}
              <audio
                data-testid="mm-audio"
                ref={setAudioEl}
                src={audioUrl ?? undefined}
                className="hidden"
              />
            </section>
          ) : (
            <section className="hud-panel p-4">
              <div className="flex items-center gap-2">
                <AudioLines className="h-4 w-4" />
                <div className="hud-label">{t("mm_title")}</div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{t("mm_sub")}</p>
            </section>
          )}

          {/* Sessões anteriores */}
          <section>
            <div className="hud-label mb-2">{t("mm_sessions")}</div>
            {pastSessions.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("mm_no_sessions")}</p>
            )}
            <div className="space-y-2">
              {pastSessions.map((s) => (
                <div
                  key={s.id}
                  className="hud-panel flex flex-wrap items-center gap-2 p-3"
                  data-testid="mm-session-row"
                >
                  <Badge
                    variant={s.status === "active" ? "secondary" : "outline"}
                    className={
                      s.status === "active"
                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600"
                        : "text-muted-foreground"
                    }
                  >
                    {s.status === "active" ? t("mm_status_active") : t("mm_status_closed")}
                  </Badge>
                  <span className="flex-1 font-mono text-xs">{s.id}</span>
                  <span className="hud-label text-xs">
                    {s.conversation_id} · {s.created_at}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Conversa + abertura de sessão */}
        <aside className="hud-panel space-y-3 self-start p-4" data-testid="mm-form">
          <div className="flex items-center gap-2">
            <AudioLines className="h-4 w-4" />
            <div className="hud-label">{t("mm_conversation")}</div>
          </div>
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("mm_no_conversations")}</p>
          )}
          <select
            value={convId}
            onChange={(e) => setConvId(e.target.value)}
            className="w-full rounded-md border border-input bg-secondary px-2 py-1.5 text-sm"
            aria-label={t("mm_conversation")}
          >
            <option value="">—</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title || c.id}
              </option>
            ))}
          </select>
          <Input
            placeholder={t("mm_conversation_new")}
            value={newConvTitle}
            onChange={(e) => setNewConvTitle(e.target.value)}
          />
          <Button
            className="w-full"
            variant="outline"
            disabled={busy || !newConvTitle.trim()}
            onClick={createConv}
          >
            {t("mm_create_conversation")}
          </Button>
          <Button
            className="w-full"
            disabled={busy || !convId || session?.status === "active"}
            onClick={openSession}
          >
            <AudioLines className="h-3 w-3" />
            {t("mm_open_session")}
          </Button>
        </aside>
      </div>
    </div>
  );
}
