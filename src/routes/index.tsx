import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Check,
  History,
  Mic,
  Plus,
  RotateCcw,
  Send,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar3D, type AvatarState } from "@/components/Avatar3D";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  api,
  chatConversation,
  deleteConversation,
  listConversations,
  loadSettings,
  openConversation,
  type ConversationSummary,
  type PendingAction,
  type Settings,
  type ToolCall,
} from "@/lib/bridge";
import {
  formatConversationDate,
  getStoredActive,
  newClientMsgId,
  pickActiveConversation,
  storeActive,
} from "@/lib/conversations";
import { speechLang, useI18n, type TKey } from "@/lib/i18n";
import { listenOnce, speak, stopSpeaking, useWake } from "@/lib/voice";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Conversa — Jarvis" },
      {
        name: "description",
        content: "Converse por voz ou texto com seu assistente Jarvis local.",
      },
      { property: "og:title", content: "Conversa — Jarvis" },
      {
        property: "og:description",
        content: "Converse por voz ou texto com seu assistente Jarvis local.",
      },
    ],
  }),
  component: ChatPage,
});

type Meta = {
  reasoning?: string | undefined;
  tools?: ToolCall[] | undefined;
  pending?: PendingAction[] | undefined;
};
type Msg = {
  role: "user" | "assistant";
  content: string;
  meta?: Meta | undefined;
  clientMsgId?: string | undefined;
  failed?: boolean | undefined;
};

export function ChatPage() {
  const { t, lang } = useI18n();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [state, setState] = useState<AvatarState>("idle");
  const [level, setLevel] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [wakeOn, setWakeOn] = useState(false);
  // Fase H: histórico persistente — o servidor é a fonte da verdade; aqui só a seleção local.
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [listError, setListError] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);
  // Seleção de modelo por conversa: fixada na criação; nunca altera as outras conversas.
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [pin, setPin] = useState<string>("");
  const endRef = useRef<HTMLDivElement>(null);
  const sl = speechLang(lang);

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);
  useEffect(() => {
    api<{ id: string; name: string }[]>("/api/agents")
      .then((a) => setAgents(a.map(({ id, name }) => ({ id, name }))))
      .catch(() => {});
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const refreshList = async () => {
    try {
      setConvs(await listConversations());
      setListError(false);
    } catch {
      setListError(true);
    }
  };

  /** Abre a conversa (do servidor). Se não existir mais, limpa a seleção e volta para a lista. */
  const loadMessages = async (id: string) => {
    setMsgsLoading(true);
    try {
      const { conversation, messages } = await openConversation(id);
      setActiveId(conversation.id);
      storeActive(conversation.id);
      setPin(conversation.agent_id || "");
      setMsgs(
        messages.map((m) => {
          const msg: Msg = { role: m.role, content: m.content };
          if (m.meta)
            msg.meta = {
              reasoning: m.meta.reasoning,
              tools: m.meta.tools,
              pending: m.meta.pending,
            };
          return msg;
        }),
      );
    } catch {
      storeActive(null);
      setActiveId(null);
      setMsgs([]);
      await refreshList();
    } finally {
      setMsgsLoading(false);
    }
  };

  // Ao carregar (ou recarregar) a página: mantém a conversa selecionada se ela ainda existir;
  // senão abre a mais recente; sem conversas, começa uma nova — nunca apaga as anteriores.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await listConversations();
        if (!alive) return;
        setConvs(list);
        const pick = pickActiveConversation(getStoredActive(), list);
        if (pick) await loadMessages(pick);
      } catch {
        if (alive) setListError(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newChat = () => {
    setActiveId(null);
    storeActive(null);
    setMsgs([]);
    setSheetOpen(false);
  };

  const abortCtrlRef = useRef<AbortController | null>(null);

  const handleBargeIn = () => {
    if (state === "speaking") {
      stopSpeaking();
      abortCtrlRef.current?.abort();
      abortCtrlRef.current = null;
      api("/api/router/telemetry/voice", {
        method: "POST",
        body: JSON.stringify({ isBargeIn: true }),
      }).catch(() => {});
      voice();
    }
  };

  const send = async (text: string, viaVoice = false, retry?: Msg) => {
    const content = text.trim();
    if (!content || state === "thinking") return;
    const clientMsgId = retry?.clientMsgId || newClientMsgId();
    if (retry) setMsgs((m) => m.map((x) => (x === retry ? { ...x, failed: false } : x)));
    else setMsgs((m) => [...m, { role: "user", content, clientMsgId }]);
    setInput("");
    setState("thinking");
    try {
      const r = await chatConversation(activeId, content, clientMsgId, pin || undefined);
      if (r.conversation) {
        const conv = r.conversation;
        setActiveId(conv.id);
        storeActive(conv.id);
        setPin(conv.agent_id || "");
        setConvs((prev) => [conv, ...prev.filter((c) => c.id !== conv.id)]);
      }
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: r.reply,
          meta: { reasoning: r.reasoning, tools: r.tools, pending: r.pending },
        },
      ]);
      if (viaVoice) {
        setState("speaking");
        const ac = new AbortController();
        abortCtrlRef.current = ac;
        const voiceStart = performance.now();
        await speak(r.reply, sl, settings?.voice?.tts || "browser", setLevel, ac.signal);
        const voiceLatency = Math.round(performance.now() - voiceStart);
        api("/api/router/telemetry/voice", {
          method: "POST",
          body: JSON.stringify({ latencyMs: voiceLatency, isBargeIn: false }),
        }).catch(() => {});
      }
    } catch {
      // A mensagem do usuário foi preservada no servidor; oferecer retry com o MESMO id (sem duplicar).
      setMsgs((m) =>
        m.map((x) =>
          x.clientMsgId === clientMsgId && x.role === "user" ? { ...x, failed: true } : x,
        ),
      );
      toast.error(t("send_failed"));
    } finally {
      setState("idle");
    }
  };

  const voice = async () => {
    setState("listening");
    try {
      const said = await listenOnce(sl, settings?.voice?.stt || "browser");
      if (said) await send(said, true);
      else setState("idle");
    } catch (e) {
      toast.error(String((e as Error).message));
      setState("idle");
    }
  };

  const v = settings?.voice;
  const mic = useWake({
    enabled: wakeOn && (state === "idle" || state === "speaking"),
    clap: !!v?.wake?.clap,
    word: !!v?.wake?.word,
    hotkey: !!v?.wake?.hotkey,
    sensitivity: v?.sensitivity ?? 6,
    name: settings?.general?.agentName || "Jarvis",
    lang: sl,
    isSpeaking: state === "speaking",
    onWake: voice,
    onBargeIn: handleBargeIn,
  });

  const decide = async (id: string, approve: boolean, i: number, k: number) => {
    try {
      // O estado final vem do BACKEND (done|error|interrupted|denied): a interface NUNCA declara
      // sucesso quando o resultado é desconhecido ou falhou (ver docs/EXECUCAO-VERIFICAVEL.md).
      const r = await api<{ output: string; status?: string }>(`/api/approvals/${id}`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
      setMsgs((m) =>
        m.map((x, j) =>
          j === i
            ? {
                ...x,
                content: x.content + `\n\n\`\`\`\n${r.output}\n\`\`\``,
                meta: {
                  ...x.meta,
                  pending: (x.meta?.pending || []).map((p, q) =>
                    q === k ? { ...p, status: r.status || (approve ? "done" : "denied") } : p,
                  ),
                },
              }
            : x,
        ),
      );
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  /** Exclusão com confirmação: o servidor verifica a propriedade e remove tudo em transação. */
  const doDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      await deleteConversation(target.id);
      toast.success(t("conversation_deleted"));
      const list = await listConversations();
      setConvs(list);
      if (activeId === target.id) {
        const next = pickActiveConversation(null, list);
        if (next) await loadMessages(next);
        else {
          setActiveId(null);
          storeActive(null);
          setMsgs([]);
        }
      }
    } catch {
      // 404 = já não existia; a lista (servidor) é a fonte da verdade.
      await refreshList();
      if (activeId === target.id) {
        setActiveId(null);
        storeActive(null);
        setMsgs([]);
      }
    }
  };

  const stateLabel = {
    idle: t("idle"),
    listening: t("listening"),
    thinking: t("thinking"),
    speaking: t("speaking"),
  }[state];

  return (
    <div className="grid h-[calc(100vh-56px)] grid-rows-[280px_1fr] md:h-screen md:grid-cols-[minmax(320px,42%)_1fr] md:grid-rows-1">
      <section className="relative flex flex-col items-center justify-center border-b border-border md:border-b-0 md:border-r">
        <div className="absolute inset-0">
          <Avatar3D state={state} level={state === "listening" ? mic * 2 : level} />
        </div>
        <div className="pointer-events-none absolute bottom-6 text-center">
          <div className="hud-label">status</div>
          <div className="font-display text-lg text-primary text-glow">{stateLabel}</div>
        </div>
        <div className="absolute left-4 top-4 flex flex-col gap-2">
          <Button
            size="sm"
            variant={wakeOn ? "default" : "outline"}
            onClick={() => setWakeOn((w) => !w)}
          >
            {wakeOn ? "● " : "○ "}
            {t("wake_methods")}
          </Button>
        </div>
      </section>

      <section className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <span className="hud-label">
            {t("nav_chat")} · {settings?.general?.agentName || "Jarvis"}
          </span>
          <div className="flex items-center gap-1">
            <select
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              disabled={activeId !== null}
              aria-label={t("model")}
              title={t("model")}
              className="h-8 max-w-[150px] truncate rounded-md border border-input bg-secondary px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            >
              <option value="">{t("agent_default")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <Button size="sm" variant="ghost" onClick={() => setSheetOpen(true)}>
              <History className="h-4 w-4" />
              {t("conversations")}
              {convs.length ? ` (${convs.length})` : ""}
            </Button>
            <Button size="sm" variant="ghost" onClick={newChat}>
              <Plus className="h-4 w-4" />
              {t("new_chat")}
            </Button>
          </div>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          {msgsLoading && (
            <p className="text-center text-sm text-muted-foreground">{t("loading")}</p>
          )}
          {!msgsLoading && msgs.length === 0 && (
            <div className="mx-auto mt-16 max-w-md text-center text-sm text-muted-foreground">
              <p className="font-display text-xl text-foreground">“{t("placeholder")}”</p>
              <p className="mt-3">{t("local_only")}</p>
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="ml-auto flex max-w-[80%] flex-col items-end gap-1">
                <div
                  className={`rounded-lg px-4 py-2 text-sm ${m.failed ? "border border-destructive/60 bg-destructive/10 text-foreground" : "bg-primary text-primary-foreground"}`}
                >
                  {m.content}
                </div>
                {m.failed && (
                  <Button size="sm" variant="outline" onClick={() => send(m.content, false, m)}>
                    <RotateCcw className="h-3 w-3" />
                    {t("retry")}
                  </Button>
                )}
              </div>
            ) : (
              <div key={i} className="max-w-[90%] space-y-2">
                {m.meta?.reasoning && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="hud-label cursor-pointer">{t("reasoning")}</summary>
                    <p className="mt-1 whitespace-pre-wrap">{m.meta.reasoning}</p>
                  </details>
                )}
                {!!m.meta?.tools?.length && (
                  <details className="hud-panel px-3 py-2 text-xs">
                    <summary className="flex cursor-pointer items-center gap-2">
                      <Wrench className="h-3 w-3" />
                      {t("tools_used")}: {m.meta.tools.map((x) => x.name).join(", ")}
                    </summary>
                    {m.meta.tools.map((x, k) => (
                      <pre key={k} className="mt-2 overflow-x-auto font-mono text-muted-foreground">
                        {x.name}({JSON.stringify(x.input)}){"\n"}→{" "}
                        {String(x.output ?? "").slice(0, 600)}
                      </pre>
                    ))}
                  </details>
                )}
                <div className="prose prose-sm prose-invert max-w-none text-foreground">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
                {m.meta?.pending?.map((p, k) =>
                  !p.status || p.status === "pending" ? (
                    <div
                      key={p.id}
                      className="hud-panel flex flex-wrap items-center gap-3 border-accent px-3 py-2 text-sm"
                    >
                      <span className="hud-label">{t("pending_action")}</span>
                      <code className="font-mono text-accent">{p.command}</code>
                      <Button size="sm" onClick={() => decide(p.id, true, i, k)}>
                        <Check className="h-3 w-3" />
                        {t("approve")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => decide(p.id, false, i, k)}>
                        <X className="h-3 w-3" />
                        {t("deny")}
                      </Button>
                    </div>
                  ) : (
                    <div key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="hud-label">{t("pending_action")}</span>
                      <code className="font-mono text-muted-foreground">{p.command}</code>
                      <span
                        className={
                          p.status === "done" ? "text-muted-foreground" : "text-destructive"
                        }
                      >
                        {t(`approval_${p.status}` as TKey)}
                      </span>
                    </div>
                  ),
                )}
              </div>
            ),
          )}
          <div ref={endRef} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 border-t border-border p-4"
        >
          <Button
            type="button"
            size="icon"
            variant={state === "listening" ? "default" : "outline"}
            onClick={
              state === "speaking"
                ? () => {
                    speechSynthesis.cancel();
                    setState("idle");
                  }
                : voice
            }
            aria-label={t("mic")}
          >
            {state === "speaking" ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={t("placeholder")}
            rows={1}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-md border border-input bg-secondary px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <Button type="submit" size="icon" disabled={state === "thinking"} aria-label={t("send")}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </section>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="flex w-[320px] flex-col p-0">
          <SheetHeader className="border-b border-border px-4 py-3 text-left">
            <SheetTitle className="hud-label">{t("conversations")}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {listError && (
              <div className="p-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setListError(false);
                    void refreshList();
                  }}
                >
                  {t("retry")}
                </Button>
              </div>
            )}
            {!listError && convs.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">{t("no_conversations")}</p>
            )}
            {convs.map((c) => (
              <div
                key={c.id}
                className={`flex items-center gap-1 rounded-md px-2 py-2 hover:bg-secondary ${c.id === activeId ? "bg-secondary" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSheetOpen(false);
                    void loadMessages(c.id);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="truncate text-sm text-foreground">{c.title}</div>
                  <div className="hud-label">{formatConversationDate(c.updated_at, lang)}</div>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("delete_conversation")}
                  onClick={() => setDeleteTarget(c)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="border-t border-border p-3">
            <Button size="sm" variant="outline" className="w-full" onClick={newChat}>
              <Plus className="h-4 w-4" />
              {t("new_chat")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete_conversation")}</AlertDialogTitle>
            <AlertDialogDescription>{t("delete_conversation_confirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doDelete()}>{t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
