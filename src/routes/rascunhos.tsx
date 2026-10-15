import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Mail, RefreshCw, Send, XCircle } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/bridge";

export const Route = createFileRoute("/rascunhos")({
  head: () => ({
    meta: [
      { title: "E-mail — rascunhos — Jarvis" },
      {
        name: "description",
        content:
          "Rascunhos de e-mail criados por agentes e bots, aguardando revisão e confirmação humana antes do envio.",
      },
      { property: "og:title", content: "E-mail — rascunhos — Jarvis" },
      {
        property: "og:description",
        content: "Aprovação humana obrigatória antes de enviar e-mails.",
      },
    ],
  }),
  component: DraftsPage,
});

type DraftMeta = {
  id: string;
  account: string;
  to: string;
  subject: string;
  state: string;
  createdAt: string;
  expiresAt: string;
};
type DraftFull = DraftMeta & { body: string | null };

// Labels/colours per state. `expired` and `cancelled` are terminal; the body is already discarded.
const STATE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pendente", cls: "bg-secondary text-foreground" },
  sending: { label: "Enviando…", cls: "bg-secondary text-muted-foreground" },
  sent: { label: "Enviado", cls: "bg-primary/20 text-primary" },
  failed: { label: "Falha", cls: "bg-destructive/20 text-destructive" },
  cancelled: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
  expired: { label: "Expirado", cls: "bg-muted text-muted-foreground" },
};
const stateLabel = (s: string) => STATE[s]?.label ?? s;
const stateCls = (s: string) => STATE[s]?.cls ?? "bg-secondary text-foreground";
const shortTime = (iso: string) => (iso ? new Date(iso).toLocaleString() : "—");

export function DraftsPage() {
  const [drafts, setDrafts] = useState<DraftMeta[]>([]);
  const [selected, setSelected] = useState<DraftFull | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const fail = (e: unknown) => setMsg(`Falha: ${String((e as Error).message || e)}`);
  const refresh = useCallback(async () => {
    try {
      setDrafts(await api<DraftMeta[]>("/api/mail/drafts"));
    } catch (e) {
      fail(e);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Opening a draft only READS it — it is never an approval.
  const open = async (id: string) => {
    setMsg("");
    setConfirming(false);
    try {
      setSelected(await api<DraftFull>(`/api/mail/drafts/${id}`));
    } catch {
      setSelected(null);
      setMsg("Rascunho indisponível (expirado, cancelado ou já consumido).");
      refresh();
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await api(`/api/mail/drafts/${id}`, { method: "DELETE" });
      setMsg("Rascunho cancelado.");
      setSelected(null);
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      // Explicit confirmation is sent as the server contract requires.
      await api(`/api/mail/drafts/${selected.id}/send`, {
        method: "POST",
        body: JSON.stringify({ confirm: "ENVIAR" }),
      });
      setMsg("E-mail enviado.");
      setConfirming(false);
      await refresh();
      await open(selected.id);
    } catch (e) {
      fail(e);
      setConfirming(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const canAct = selected?.state === "pending";

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader
        title="E-mail — rascunhos"
        sub="Criados por agentes e bots. Nada é enviado sem a sua confirmação explícita."
      >
        <Button variant="outline" onClick={refresh} disabled={busy}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Atualizar
        </Button>
      </PageHeader>

      {msg && (
        <pre
          data-testid="drafts-msg"
          className="mb-4 whitespace-pre-wrap rounded bg-muted p-2 text-xs"
        >
          {msg}
        </pre>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          {drafts.map((d) => (
            <button
              key={d.id}
              data-testid="draft-item"
              onClick={() => open(d.id)}
              className="hud-panel flex w-full flex-col gap-1 p-3 text-left"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <Mail className="h-4 w-4" />
                  {d.subject || "(sem assunto)"}
                </span>
                <span
                  data-testid="draft-state"
                  className={`rounded px-2 py-0.5 text-xs ${stateCls(d.state)}`}
                >
                  {stateLabel(d.state)}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {d.account} → {d.to} · {shortTime(d.createdAt)}
              </span>
            </button>
          ))}
          {drafts.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum rascunho aguardando revisão.</p>
          )}
        </div>

        <div className="hud-panel space-y-3 p-4">
          {!selected && (
            <p className="text-sm text-muted-foreground">Selecione um rascunho para revisar.</p>
          )}
          {selected && (
            <>
              <div className="flex items-center justify-between">
                <span className="hud-label">Revisão</span>
                <span className={`rounded px-2 py-0.5 text-xs ${stateCls(selected.state)}`}>
                  {stateLabel(selected.state)}
                </span>
              </div>
              <div className="space-y-1 text-sm">
                <div>
                  <span className="hud-label">Conta</span> {selected.account}
                </div>
                <div>
                  <span className="hud-label">Para</span> {selected.to}
                </div>
                <div>
                  <span className="hud-label">Assunto</span> {selected.subject || "(sem assunto)"}
                </div>
                <div>
                  <span className="hud-label">Expira</span> {shortTime(selected.expiresAt)}
                </div>
              </div>
              <pre
                data-testid="draft-body"
                className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-sm"
              >
                {selected.body ?? "(corpo indisponível — já consumido, cancelado ou expirado)"}
              </pre>

              {canAct && !confirming && (
                <div className="flex gap-2">
                  <Button
                    data-testid="draft-send"
                    onClick={() => setConfirming(true)}
                    disabled={busy}
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Enviar…
                  </Button>
                  <Button
                    data-testid="draft-cancel"
                    variant="outline"
                    onClick={() => cancel(selected.id)}
                    disabled={busy}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancelar
                  </Button>
                </div>
              )}

              {canAct && confirming && (
                <div className="space-y-2 rounded border border-border p-3">
                  <p className="text-sm">
                    Confirmar o envio para <strong>{selected.to}</strong>? O envio é definitivo.
                  </p>
                  <div className="flex gap-2">
                    <Button data-testid="draft-confirm" onClick={send} disabled={busy}>
                      Confirmar envio (ENVIAR)
                    </Button>
                    <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
                      Voltar
                    </Button>
                  </div>
                </div>
              )}

              {!canAct && (
                <p className="text-xs text-muted-foreground">
                  Este rascunho não está pendente: não pode ser enviado nem cancelado.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
