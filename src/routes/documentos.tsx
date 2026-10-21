import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/bridge";

export const Route = createFileRoute("/documentos")({
  head: () => ({
    meta: [
      { title: "Documentos — Jarvis" },
      { name: "description", content: "Documentos TXT locais, privados por administrador e consultáveis pelo agente." },
      { property: "og:title", content: "Documentos — Jarvis" },
      { property: "og:description", content: "Gestão documental local do seu assistente Jarvis." },
    ],
  }),
  component: DocumentsPage,
});

type Doc = { id: string; name: string; mime: string; size: number; created_at: string };

function DocumentsPage() {
  const [items, setItems] = useState<Doc[]>([]);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState("");
  const refresh = () =>
    api<Doc[]>("/api/documents").then(setItems).catch((e) => setMsg(String(e.message || e)));

  useEffect(() => { refresh(); }, []);

  const save = async (n: string, text: string) => {
    await api("/api/documents", { method: "POST", body: JSON.stringify({ name: n, mime: "text/plain", content: text }) });
    setMsg(`Salvo: ${n}`);
    refresh();
  };
  const onFile = async (file?: File) => { if (file) await save(file.name, await file.text()).catch((e) => setMsg(String(e.message || e))); };
  const search = async () => {
    if (!q.trim()) return refresh();
    const r = await api<{ id: string; name: string; snippet: string }[]>(`/api/documents/search?q=${encodeURIComponent(q)}`);
    setItems(r.map((x) => ({ id: x.id, name: x.name, mime: "text/plain", size: 0, created_at: "" })));
  };
  const view = async (id: string) => {
    const d = await api<{ name: string; content: string }>(`/api/documents/${id}`);
    setMsg(`${d.name}:\n${d.content.slice(0, 1000)}`);
  };
  const del = async (id: string) => { await api(`/api/documents/${id}`, { method: "DELETE" }); refresh(); };

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title="Documentos" sub="Documentos TXT privados, indexados e consultáveis pelo agente.">
        <Input placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} className="w-64" />
      </PageHeader>
      <div className="hud-panel mb-6 flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <Input placeholder="nome.txt" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="file" accept=".txt,text/plain" onChange={(e) => onFile(e.target.files?.[0])} />
          <Button onClick={() => name.trim() && content.trim() && save(name, content)}><Upload className="mr-2 h-4 w-4" />Salvar</Button>
        </div>
        <textarea
          className="min-h-24 rounded-md border bg-background p-2 text-sm"
          placeholder="Conteúdo do documento (TXT)"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        {msg && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{msg}</pre>}
      </div>
      <div className="space-y-2">
        {items.map((d) => (
          <div key={d.id} className="hud-panel flex items-center justify-between gap-2 p-3">
            <button className="flex items-center gap-2 text-left" onClick={() => view(d.id)}>
              <FileText className="h-4 w-4" />
              <span className="font-medium">{d.name}</span>
            </button>
            <Button variant="ghost" size="icon" onClick={() => del(d.id)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        {items.length === 0 && <p className="text-sm text-muted-foreground">Nenhum documento.</p>}
      </div>
    </div>
  );
}
