import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Star, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { collection, type Agent } from "@/lib/bridge";
import { CHAT_PROVIDERS, TEMPLATES, TOOLS } from "@/lib/catalog";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/agentes")({
  head: () => ({
    meta: [
      { title: "Agentes — Jarvis" },
      { name: "description", content: "Crie agentes personalizados com instruções, modelo e ferramentas." },
      { property: "og:title", content: "Agentes — Jarvis" },
      { property: "og:description", content: "Agentes personalizáveis do Jarvis." },
    ],
  }),
  component: AgentsPage,
});

const store = collection<Agent>("agents");
const blank: Partial<Agent> = { name: "", instructions: "", provider: "ollama", model: "llama3.1", tools: ["remember", "recall", "web_search"] };

function AgentsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Agent[]>([]);
  const [edit, setEdit] = useState<Partial<Agent>>(blank);
  const refresh = () => store.list().then(setItems);
  useEffect(() => { refresh(); }, []);

  const save = async () => {
    if (!edit.name) return;
    await store.save(edit);
    setEdit(blank);
    refresh();
  };
  const activate = async (a: Agent) => {
    for (const x of items) if (x.active && x.id !== a.id) await store.save({ ...x, active: false });
    await store.save({ ...a, active: true });
    refresh();
  };

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("agents_title")} sub={t("agents_sub")} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-3">
          {items.map((a) => (
            <div key={a.id} className="hud-panel flex items-start gap-4 p-4">
              <div className="flex-1 cursor-pointer" onClick={() => setEdit(a)}>
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg">{a.name}</span>
                  {a.active && <span className="rounded bg-primary px-2 text-xs text-primary-foreground">{t("active")}</span>}
                </div>
                <div className="hud-label mt-1">{a.provider} · {a.model} · {a.tools?.join(", ")}</div>
                <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{a.instructions}</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => activate(a)} aria-label={t("set_active")}><Star className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={async () => { await store.remove(a.id); refresh(); }} aria-label={t("delete")}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
        <div className="hud-panel space-y-3 p-4">
          <Input placeholder={t("name")} value={edit.name || ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <div className="flex gap-2">
            <select className="flex-1 rounded-md border border-input bg-secondary px-2 text-sm" value={edit.provider} onChange={(e) => setEdit({ ...edit, provider: e.target.value })}>
              {CHAT_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Input placeholder={t("model")} value={edit.model || ""} onChange={(e) => setEdit({ ...edit, model: e.target.value })} />
          </div>
          <Textarea rows={7} placeholder={t("instructions")} value={edit.instructions || ""} onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} />
          <div>
            <div className="hud-label mb-2">{t("templates")}</div>
            <div className="flex flex-wrap gap-1">
              {TEMPLATES.map((tp) => (
                <button key={tp.name} type="button" className="rounded border border-border px-2 py-1 text-xs hover:border-primary"
                  onClick={() => setEdit({ ...edit, instructions: [edit.instructions, tp.text].filter(Boolean).join("\n\n") })}>+ {tp.name}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="hud-label mb-2">{t("tools")}</div>
            <div className="flex flex-wrap gap-1">
              {TOOLS.map((tool) => {
                const on = edit.tools?.includes(tool);
                return (
                  <button key={tool} type="button" onClick={() => setEdit({ ...edit, tools: on ? edit.tools!.filter((x) => x !== tool) : [...(edit.tools || []), tool] })}
                    className={`rounded px-2 py-1 font-mono text-xs ${on ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"}`}>{tool}</button>
                );
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={save} className="flex-1">{t("save")}</Button>
            <Button variant="outline" onClick={() => setEdit(blank)}>{t("cancel")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
