import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Download, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, collection, ping, type Memory } from "@/lib/bridge";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/memoria")({
  head: () => ({
    meta: [
      { title: "Memória — Jarvis" },
      {
        name: "description",
        content: "Fatos e notas guardados localmente que o Jarvis consulta para decidir.",
      },
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
  const [editing, setEditing] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState(90);
  const [retentionEnabled, setRetentionEnabled] = useState(false);
  const [expiringCount, setExpiringCount] = useState(0);
  const [quarantined, setQuarantined] = useState<
    Array<{ id: string; content: string; purgeAfter: string }>
  >([]);
  const refresh = useCallback(() => store.list(q).then(setItems), [q]);
  const refreshRetention = useCallback(async () => {
    if (!(await ping())) return;
    const r = await api<{
      policy: { enabled: boolean; retentionDays: number | null };
      preview: { expiringCount: number };
    }>(`/api/memories/retention?days=${retentionDays}`);
    setRetentionEnabled(r.policy.enabled);
    setExpiringCount(r.preview.expiringCount);
    setQuarantined(
      await api<Array<{ id: string; content: string; purgeAfter: string }>>(
        "/api/memories/retention/quarantine",
      ),
    );
  }, [retentionDays]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    refreshRetention().catch(() => undefined);
  }, [refreshRetention]);
  const saveRetention = async (enabled: boolean) => {
    if (!(await ping())) return;
    const password = window.prompt(
      "Informe sua senha para confirmar a alteração da política de retenção:",
    );
    if (!password) return;
    await api("/api/auth/reauth", { method: "POST", body: JSON.stringify({ password }) });
    if (
      enabled &&
      !window.confirm(
        `A política vai colocar ${expiringCount} memória(s) em quarentena após o prazo escolhido. A quarentena dura 30 dias; backups podem preservar cópias durante o prazo documentado de retenção.`,
      )
    )
      return;
    await api("/api/memories/retention", {
      method: "PUT",
      body: JSON.stringify({
        enabled,
        retentionDays,
        ...(enabled ? { confirm: "ATIVAR_RETENCAO" } : {}),
      }),
    });
    setRetentionEnabled(enabled);
    await refreshRetention();
  };
  const exportMemories = async () => {
    const payload = (await ping())
      ? await api<{ exportedAt: string; count: number; memories: Memory[] }>("/api/memories/export")
      : { exportedAt: new Date().toISOString(), memories: await store.list() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jarvis-memories.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const submitMemory = async (e: FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    await store.save({
      ...(editing ? { id: editing } : {}),
      content: content.trim(),
      tags,
    } as Partial<Memory>);
    setContent("");
    setTags("");
    setEditing(null);
    refresh();
  };

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("memory_title")} sub={t("memory_sub")}>
        <Input
          placeholder={t("search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-64"
        />
        <Button type="button" variant="outline" onClick={exportMemories}>
          <Download className="mr-2 h-4 w-4" />
          Exportar JSON
        </Button>
      </PageHeader>
      <form className="hud-panel mb-6 flex flex-col gap-3 p-4 md:flex-row" onSubmit={submitMemory}>
        <Input
          placeholder={t("content")}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="flex-1"
          aria-label={t("content")}
        />
        <Input
          placeholder={t("tags")}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="md:w-48"
        />
        <Button type="submit">{editing ? "Salvar correção" : t("add")}</Button>
        {editing && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setEditing(null);
              setContent("");
              setTags("");
            }}
          >
            Cancelar
          </Button>
        )}
      </form>
      <section className="hud-panel mb-6 space-y-3 p-4" aria-label="Retenção de memórias">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-display">Retenção automática de memórias</div>
            <p className="text-sm text-muted-foreground">
              Desativada por padrão. Memórias vencidas ficam recuperáveis em quarentena por 30 dias
              antes da exclusão local.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Prazo de retenção"
              className="rounded-md border border-input bg-secondary p-2 text-sm"
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value))}
            >
              {[30, 90, 180, 365].map((days) => (
                <option key={days} value={days}>
                  {days} dias
                </option>
              ))}
            </select>
            <Button
              variant={retentionEnabled ? "outline" : "default"}
              onClick={() => saveRetention(!retentionEnabled).catch((e) => window.alert(String(e)))}
            >
              {retentionEnabled ? "Desativar" : "Ativar política"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Prévia: {expiringCount} memória(s) atingem ou já passaram do prazo de {retentionDays}{" "}
          dias. O período de backup local pode manter cópias após a exclusão do banco ativo.
        </p>
        {quarantined.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <div className="hud-label">Quarentena recuperável</div>
            {quarantined.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1">
                  {m.content}
                  <span className="block text-xs text-muted-foreground">
                    Exclusão prevista: {new Date(m.purgeAfter).toLocaleString()}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await api(`/api/memories/${m.id}/restore`, { method: "POST", body: "{}" });
                    await refresh();
                    await refreshRetention();
                  }}
                >
                  Restaurar
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
      {items.length === 0 && <p className="text-sm text-muted-foreground">{t("empty")}</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((m) => (
          <div key={m.id} className="hud-panel group flex flex-col gap-2 p-4">
            <p className="text-sm whitespace-pre-wrap">{m.content}</p>
            <div className="mt-auto flex items-center justify-between">
              <span className="hud-label">
                {m.tags || "—"} · {new Date(m.created_at).toLocaleDateString()}
              </span>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setEditing(m.id);
                    setContent(m.content);
                    setTags(m.tags || "");
                  }}
                  aria-label="Corrigir memória"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={async () => {
                    await store.remove(m.id);
                    refresh();
                  }}
                  aria-label={t("delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
