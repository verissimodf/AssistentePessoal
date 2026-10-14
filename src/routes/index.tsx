import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Mic, Plus, Send, Square, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar3D, type AvatarState } from "@/components/Avatar3D";
import { Button } from "@/components/ui/button";
import { api, chat, loadSettings, type ChatReply, type Settings } from "@/lib/bridge";
import { speechLang, useI18n } from "@/lib/i18n";
import { listenOnce, speak, useWake } from "@/lib/voice";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Conversa — Jarvis" },
      { name: "description", content: "Converse por voz ou texto com seu assistente Jarvis local." },
      { property: "og:title", content: "Conversa — Jarvis" },
      { property: "og:description", content: "Converse por voz ou texto com seu assistente Jarvis local." },
    ],
  }),
  component: ChatPage,
});

type Msg = { role: "user" | "assistant"; content: string; meta?: ChatReply };

function ChatPage() {
  const { t, lang } = useI18n();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [state, setState] = useState<AvatarState>("idle");
  const [level, setLevel] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [wakeOn, setWakeOn] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const sl = speechLang(lang);

  useEffect(() => { loadSettings().then(setSettings); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const send = async (text: string, viaVoice = false) => {
    if (!text.trim()) return;
    const next: Msg[] = [...msgs, { role: "user", content: text }];
    setMsgs(next);
    setInput("");
    setState("thinking");
    try {
      const r = await chat(next.map(({ role, content }) => ({ role, content })));
      setMsgs([...next, { role: "assistant", content: r.reply, meta: r }]);
      if (viaVoice) {
        setState("speaking");
        await speak(r.reply, sl, settings?.voice?.tts || "browser", setLevel);
      }
    } catch (e) {
      toast.error(String((e as Error).message));
    } finally {
      setState("idle");
    }
  };

  const voice = async () => {
    setState("listening");
    try {
      const said = await listenOnce(sl);
      if (said) await send(said, true);
      else setState("idle");
    } catch (e) {
      toast.error(String((e as Error).message));
      setState("idle");
    }
  };

  const v = settings?.voice;
  const mic = useWake({
    enabled: wakeOn && state === "idle",
    clap: !!v?.wake?.clap, word: !!v?.wake?.word, hotkey: !!v?.wake?.hotkey,
    sensitivity: v?.sensitivity ?? 6, name: settings?.general?.agentName || "Jarvis", lang: sl,
    onWake: voice,
  });

  const decide = async (id: string, approve: boolean, i: number) => {
    try {
      const r = await api<{ output: string }>(`/api/approvals/${id}`, { method: "POST", body: JSON.stringify({ approve }) });
      setMsgs((m) => m.map((x, j) => j === i ? { ...x, content: x.content + `\n\n\`\`\`\n${r.output}\n\`\`\``, meta: { ...x.meta!, pending: [] } } : x));
    } catch (e) { toast.error(String((e as Error).message)); }
  };

  const stateLabel = { idle: t("idle"), listening: t("listening"), thinking: t("thinking"), speaking: t("speaking") }[state];

  return (
    <div className="grid h-[calc(100vh-56px)] grid-rows-[280px_1fr] md:h-screen md:grid-cols-[minmax(320px,42%)_1fr] md:grid-rows-1">
      <section className="relative flex flex-col items-center justify-center border-b border-border md:border-b-0 md:border-r">
        <div className="absolute inset-0"><Avatar3D state={state} level={state === "listening" ? mic * 2 : level} /></div>
        <div className="pointer-events-none absolute bottom-6 text-center">
          <div className="hud-label">status</div>
          <div className="font-display text-lg text-primary text-glow">{stateLabel}</div>
        </div>
        <div className="absolute left-4 top-4 flex flex-col gap-2">
          <Button size="sm" variant={wakeOn ? "default" : "outline"} onClick={() => setWakeOn((w) => !w)}>
            {wakeOn ? "● " : "○ "}{t("wake_methods")}
          </Button>
        </div>
      </section>

      <section className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <span className="hud-label">{t("nav_chat")} · {settings?.general?.agentName || "Jarvis"}</span>
          <Button size="sm" variant="ghost" onClick={() => setMsgs([])}><Plus className="h-4 w-4" />{t("new_chat")}</Button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          {msgs.length === 0 && (
            <div className="mx-auto mt-16 max-w-md text-center text-sm text-muted-foreground">
              <p className="font-display text-xl text-foreground">“{t("placeholder")}”</p>
              <p className="mt-3">{t("local_only")}</p>
            </div>
          )}
          {msgs.map((m, i) => m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[80%] rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">{m.content}</div>
          ) : (
            <div key={i} className="max-w-[90%] space-y-2">
              {m.meta?.reasoning && (
                <details className="text-xs text-muted-foreground"><summary className="hud-label cursor-pointer">{t("reasoning")}</summary><p className="mt-1 whitespace-pre-wrap">{m.meta.reasoning}</p></details>
              )}
              {!!m.meta?.tools?.length && (
                <details className="hud-panel px-3 py-2 text-xs">
                  <summary className="flex cursor-pointer items-center gap-2"><Wrench className="h-3 w-3" />{t("tools_used")}: {m.meta.tools.map((x) => x.name).join(", ")}</summary>
                  {m.meta.tools.map((x, k) => <pre key={k} className="mt-2 overflow-x-auto font-mono text-muted-foreground">{x.name}({JSON.stringify(x.input)}){"\n"}→ {String(x.output ?? "").slice(0, 600)}</pre>)}
                </details>
              )}
              <div className="prose prose-sm prose-invert max-w-none text-foreground"><ReactMarkdown>{m.content}</ReactMarkdown></div>
              {m.meta?.pending?.map((p) => (
                <div key={p.id} className="hud-panel flex flex-wrap items-center gap-3 border-accent px-3 py-2 text-sm">
                  <span className="hud-label">{t("pending_action")}</span>
                  <code className="font-mono text-accent">{p.command}</code>
                  <Button size="sm" onClick={() => decide(p.id, true, i)}><Check className="h-3 w-3" />{t("approve")}</Button>
                  <Button size="sm" variant="outline" onClick={() => decide(p.id, false, i)}><X className="h-3 w-3" />{t("deny")}</Button>
                </div>
              ))}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2 border-t border-border p-4">
          <Button type="button" size="icon" variant={state === "listening" ? "default" : "outline"} onClick={state === "speaking" ? () => { speechSynthesis.cancel(); setState("idle"); } : voice} aria-label={t("mic")}>
            {state === "speaking" ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder={t("placeholder")}
            rows={1}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-md border border-input bg-secondary px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <Button type="submit" size="icon" disabled={state === "thinking"} aria-label={t("send")}><Send className="h-4 w-4" /></Button>
        </form>
      </section>
    </div>
  );
}
