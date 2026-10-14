import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Pause, Play, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, collection, ping, type Agent, type Bot, type Run } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/bots")({
  head: () => ({
    meta: [
      { title: "Bots autônomos — Jarvis" },
      { name: "description", content: "Configure bots que executam ações autônomas por agenda ou gatilho." },
      { property: "og:title", content: "Bots autônomos — Jarvis" },
      { property: "og:description", content: "Automação local com o Jarvis." },
    ],
  }),
  component: BotsPage,
});

const store = collection<Bot>("bots");
const agents = collection<Agent>("agents");
const blank: Partial<Bot> = { name: "", goal: "", agent_id: "jarvis", trigger_type: "daily", trigger_value: "08:00", autonomy: "confirm", max_steps: 8, enabled: true };

function BotsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Bot[]>([]);
  const [ags, setAgs] = useState<Agent[]>([]);
  const [edit, setEdit] = useState<Partial<Bot>>(blank);
  const [runs, setRuns] = useState<Run[]>([]);
  const refresh = () => store.list().then(setItems);
  useEffect(() => { refresh(); agents.list().then(setAgs); }, []);

  const triggers = [["daily", t("t_daily")], ["interval", t("t_interval")], ["voice", t("t_voice")], ["file", t("t_file")], ["message", t("t_message")]] as const;
  const autonomy = [["confirm", t("a_confirm")], ["safe", t("a_safe")], ["full", t("a_full")]] as const;

  const runNow = async (b: Bot) => {
    if (!(await ping())) { toast.info(t("demo_hint")); return; }
    try {
      await api(`/api/bots/${b.id}/run`, { method: "POST" });
      toast.success(t("run_now"));
      setRuns(await api<Run[]>(`/api/bots/${b.id}/runs`));
    } catch (e) { toast.error(String((e as Error).message)); }
  };

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("bots_title")} sub={t("bots_sub")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          {items.map((b) => (
            <div key={b.id} className="hud-panel p-4">
              <div className="flex items-start gap-3">
                <Zap className={`mt-1 h-4 w-4 ${b.enabled ? "text-accent" : "text-muted-foreground"}`} />
                <div className="flex-1 cursor-pointer" onClick={() => setEdit(b)}>
                  <div className="font-display text-lg">{b.name}</div>
                  <div className="hud-label mt-1">{triggers.find((x) => x[0] === b.trigger_type)?.[1]} {b.trigger_value} · {autonomy.find((x) => x[0] === b.autonomy)?.[1]} · ≤{b.max_steps}</div>
                  <p className="mt-2 text-sm text-muted-foreground">{b.goal}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => runNow(b)}><Play className="h-3 w-3" />{t("run_now")}</Button>
                <Button size="icon" variant="ghost" onClick={async () => { await store.save({ ...b, enabled: !b.enabled }); refresh(); }} aria-label={b.enabled ? t("pause") : t("resume")}>
                  {b.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </Button>
                <Button size="icon" variant="ghost" onClick={async () => { await store.remove(b.id); refresh(); }} aria-label={t("delete")}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
          {runs.length > 0 && (
            <div className="hud-panel p-4">
              <div className="hud-label mb-2">{t("runs")}</div>
              {runs.map((r) => <pre key={r.id} className="mb-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">[{r.started_at}] {r.status}: {r.output}</pre>)}
            </div>
          )}
        </div>
        <div className="hud-panel space-y-3 p-4">
          <Input placeholder={t("name")} value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Textarea rows={4} placeholder={t("goal")} value={edit.goal || ""} onChange={(e) => setEdit({ ...edit, goal: e.target.value })} />
          <label className="hud-label block">{t("nav_agents")}</label>
          <select className="w-full rounded-md border border-input bg-secondary p-2 text-sm" value={edit.agent_id} onChange={(e) => setEdit({ ...edit, agent_id: e.target.value })}>
            {ags.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <label className="hud-label block">{t("trigger")}</label>
          <div className="flex gap-2">
            <select className="flex-1 rounded-md border border-input bg-secondary p-2 text-sm" value={edit.trigger_type} onChange={(e) => setEdit({ ...edit, trigger_type: e.target.value as Bot["trigger_type"] })}>
              {triggers.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
            </select>
            <Input className="w-36" value={edit.trigger_value || ""} onChange={(e) => setEdit({ ...edit, trigger_value: e.target.value })} placeholder="08:00 / 30 / frase / caminho" />
          </div>
          <label className="hud-label block">{t("autonomy")}</label>
          <select className="w-full rounded-md border border-input bg-secondary p-2 text-sm" value={edit.autonomy} onChange={(e) => setEdit({ ...edit, autonomy: e.target.value as Bot["autonomy"] })}>
            {autonomy.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
          <label className="hud-label block">{t("max_steps")}</label>
          <Input type="number" min={1} max={50} value={edit.max_steps ?? 8} onChange={(e) => setEdit({ ...edit, max_steps: Number(e.target.value) })} />
          <div className="flex gap-2">
            <Button className="flex-1" onClick={async () => { if (!edit.name) return; await store.save(edit); setEdit(blank); refresh(); }}>{t("save")}</Button>
            <Button variant="outline" onClick={() => setEdit(blank)}>{t("cancel")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
