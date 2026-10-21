import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { collection, type Memory } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/memoria")({
  head: () => ({
    meta: [
      { title: "Memória — Jarvis" },
      { name: "description", content: "Fatos e notas guardados localmente que o Jarvis consulta para decidir." },
      { property: "og:title", content: "Memória — Jarvis" },
      { property: "og:description", content: "Memória local do seu assistente Jarvis." },
    ],
  }),
  component: MemoryPage,
});

const store = collection<Memory>("memories");

function MemoryPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Memory[]>([]);
  const [q, setQ] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const refresh = () => store.list(q).then(setItems);
  useEffect(() => { refresh(); }, [q]);

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("memory_title")} sub={t("memory_sub")}>
        <Input placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
      </PageHeader>
      <form
        className="hud-panel mb-6 flex flex-col gap-3 p-4 md:flex-row"
        onSubmit={async (e) => { e.preventDefault(); if (!content.trim()) return; await store.save({ content, tags }); setContent(""); setTags(""); refresh(); }}
      >
        <Input placeholder={t("content")} value={content} onChange={(e) => setContent(e.target.value)} className="flex-1" />
        <Input placeholder={t("tags")} value={tags} onChange={(e) => setTags(e.target.value)} className="md:w-48" />
        <Button type="submit">{t("add")}</Button>
      </form>
      {items.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((m) => (
          <div key={m.id} className="hud-panel group flex flex-col gap-2 p-4">
            <p className="text-sm">{m.content}</p>
            <div className="mt-auto flex items-center justify-between">
              <span className="hud-label">{m.tags || "—"} · {new Date(m.created_at).toLocaleDateString()}</span>
              <Button size="icon" variant="ghost" onClick={async () => { await store.remove(m.id); refresh(); }} aria-label={t("delete")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
