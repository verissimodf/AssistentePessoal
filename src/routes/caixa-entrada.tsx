import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Inbox, Mail, RefreshCw, Search, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/bridge";

export const Route = createFileRoute("/caixa-entrada")({
  head: () => ({
    meta: [
      { title: "Caixa de entrada — Jarvis" },
      { name: "description", content: "Consulte mensagens de e-mail por IMAP, sem enviar nem alterar mensagens." },
    ],
  }),
  component: InboxPage,
});

type MailAccount = {
  type: "gmail" | "outlook";
  enabled: boolean;
  user: string;
  hasPassword: boolean;
  state: string;
};
type MessageMeta = {
  id: string;
  date: string | null;
  from: string;
  subject: string;
  unseen: boolean;
};
type MailMessage = MessageMeta & { body: string; untrusted: true };
type MessagePage = { messages: MessageMeta[]; total: number; limit: number; offset: number };

const PAGE_SIZE = 20;
const formatDate = (value: string | null) => {
  if (!value) return "Data desconhecida";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data desconhecida" : date.toLocaleString();
};

function InboxPage() {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [account, setAccount] = useState<"gmail" | "outlook">("gmail");
  const [messages, setMessages] = useState<MessageMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<MailMessage | null>(null);
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [since, setSince] = useState("");
  const [before, setBefore] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const available = useMemo(() => accounts.filter((item) => item.enabled && item.hasPassword), [accounts]);
  const hasSearch = !!(from.trim() || subject.trim() || since || before);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const result = await api<MailAccount[]>("/api/mail/accounts");
      setAccounts(result);
      if (!result.some((item) => item.type === account && item.enabled && item.hasPassword)) {
        const first = result.find((item) => item.enabled && item.hasPassword);
        if (first) setAccount(first.type);
      }
      setError("");
    } catch {
      setError("Não foi possível consultar as contas. Verifique a sessão e as permissões.");
    } finally {
      setLoadingAccounts(false);
    }
  }, [account]);

  const loadMessages = useCallback(async (nextOffset = 0, filters?: { from: string; subject: string; since: string; before: string }) => {
    const activeFrom = filters?.from ?? from;
    const activeSubject = filters?.subject ?? subject;
    const activeSince = filters?.since ?? since;
    const activeBefore = filters?.before ?? before;
    const searchActive = !!(activeFrom.trim() || activeSubject.trim() || activeSince || activeBefore);
    setLoadingMessages(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(nextOffset) });
      let path = `/api/mail/${account}/messages?${params.toString()}`;
      if (searchActive) {
        const criteria = new URLSearchParams(params);
        if (activeFrom.trim()) criteria.set("from", activeFrom.trim());
        if (activeSubject.trim()) criteria.set("subject", activeSubject.trim());
        if (activeSince) criteria.set("since", activeSince);
        if (activeBefore) criteria.set("before", activeBefore);
        path = `/api/mail/${account}/search?${criteria.toString()}`;
      }
      const result = await api<MessagePage>(path);
      setMessages(result.messages || []);
      setTotal(result.total || 0);
      setOffset(result.offset ?? nextOffset);
      setSelected(null);
    } catch (e) {
      const message = String((e as Error).message || "");
      if (message.includes("404")) setError("Esta conta não está disponível ou não está habilitada para este administrador.");
      else if (message.includes("provider_error")) setError("Falha ao consultar o provedor de e-mail. Verifique a conexão IMAP.");
      else if (message.includes("429")) setError("Limite de consultas atingido. Aguarde antes de atualizar novamente.");
      else setError("Não foi possível carregar as mensagens. Confirme a conexão IMAP e tente novamente.");
      setMessages([]);
      setTotal(0);
    } finally {
      setLoadingMessages(false);
    }
  }, [account, before, from, hasSearch, since, subject]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => {
    if (available.some((item) => item.type === account)) loadMessages(0);
    else { setMessages([]); setTotal(0); }
    // Filters are submitted explicitly; changing each field must not trigger a request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, available.length]);

  const openMessage = async (item: MessageMeta) => {
    setLoadingMessages(true);
    setError("");
    try {
      const result = await api<MailMessage>(`/api/mail/${account}/messages/${encodeURIComponent(item.id)}`);
      setSelected(result);
    } catch {
      setError("Não foi possível abrir esta mensagem. Ela pode ter sido removida ou a conexão pode ter falhado.");
    } finally {
      setLoadingMessages(false);
    }
  };

  const resetSearch = async () => {
    setFrom("");
    setSubject("");
    setSince("");
    setBefore("");
    setOffset(0);
    setNotice("");
    await loadMessages(0, { from: "", subject: "", since: "", before: "" });
  };

  const runSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await loadMessages(0);
  };

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader
        title="Caixa de entrada"
        sub="Mensagens reais via IMAP. Esta tela não envia, exclui nem marca mensagens como lidas."
      >
        <Button variant="outline" onClick={() => selected ? openMessage(selected) : loadMessages(offset)} disabled={loadingMessages || available.length === 0}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loadingMessages ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </PageHeader>

      {error && <div role="alert" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-md border border-border bg-muted p-3 text-sm">{notice}</div>}

      {selected ? (
        <section className="hud-panel space-y-4 p-4" aria-label="Mensagem selecionada">
          <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar à lista
          </Button>
          <div className="border-b border-border pb-3">
            <h2 className="text-xl font-semibold">{selected.subject || "(sem assunto)"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">De: {selected.from || "Remetente desconhecido"}</p>
            <p className="text-sm text-muted-foreground">{formatDate(selected.date)}</p>
          </div>
          <p className="text-xs text-muted-foreground">O corpo abaixo é conteúdo externo não confiável, exibido como texto simples.</p>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 text-sm">{selected.body || "(mensagem sem corpo de texto disponível)"}</pre>
        </section>
      ) : (
        <>
          <section className="hud-panel mb-4 space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-w-52 flex-col gap-1 text-sm">
                <span className="hud-label">Conta</span>
                <select
                  className="rounded-md border border-input bg-secondary px-3 py-2"
                  value={account}
                  onChange={(event) => { setAccount(event.target.value as "gmail" | "outlook"); setOffset(0); }}
                  disabled={loadingAccounts || available.length === 0}
                >
                  {available.map((item) => <option key={item.type} value={item.type}>{item.type === "gmail" ? "Gmail" : "Outlook"} · {item.user}</option>)}
                </select>
              </label>
              <div className="flex items-center gap-2 pt-5 text-sm text-muted-foreground">
                <Inbox className="h-4 w-4" />
                {loadingAccounts ? "Consultando contas…" : `${total} mensagem(ns)`}
              </div>
            </div>

            <form onSubmit={runSearch} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="hud-label">Remetente contém</span>
                <Input value={from} onChange={(event) => setFrom(event.target.value)} maxLength={200} placeholder="nome ou endereço" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="hud-label">Assunto contém</span>
                <Input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={200} placeholder="palavras do assunto" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="hud-label">A partir de</span>
                <Input type="date" value={since} onChange={(event) => setSince(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="hud-label">Antes de</span>
                <Input type="date" value={before} onChange={(event) => setBefore(event.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-4">
                <Button type="submit" disabled={loadingMessages || available.length === 0}>
                  <Search className="mr-2 h-4 w-4" /> Pesquisar
                </Button>
                <Button type="button" variant="outline" onClick={resetSearch} disabled={loadingMessages || !hasSearch}>Limpar filtros</Button>
              </div>
            </form>
          </section>

          {available.length === 0 && !loadingAccounts ? (
            <div className="hud-panel p-6 text-sm text-muted-foreground">
              <Mail className="mb-2 h-5 w-5" />
              Nenhuma conta de e-mail habilitada e configurada foi encontrada. Abra Configurações → Comunicação, habilite Gmail e salve as credenciais; depois teste a conexão IMAP.
            </div>
          ) : loadingMessages ? (
            <div role="status" className="hud-panel p-6 text-sm text-muted-foreground">Carregando mensagens…</div>
          ) : messages.length === 0 ? (
            <div className="hud-panel p-6 text-sm text-muted-foreground">Nenhuma mensagem encontrada para esta conta e estes filtros.</div>
          ) : (
            <section className="hud-panel overflow-hidden" aria-label="Lista de mensagens">
              <div className="divide-y divide-border">
                {messages.map((item) => (
                  <button key={item.id} onClick={() => openMessage(item)} className="flex w-full flex-col gap-1 p-4 text-left transition-colors hover:bg-accent/40 md:flex-row md:items-center md:gap-4">
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span aria-label={item.unseen ? "Não lida" : "Lida"} className={`h-2 w-2 shrink-0 rounded-full ${item.unseen ? "bg-primary" : "bg-muted-foreground/30"}`} />
                      <span className={`truncate text-sm ${item.unseen ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{item.from || "Remetente desconhecido"}</span>
                    </span>
                    <span className={`min-w-0 flex-[2] truncate text-sm ${item.unseen ? "font-semibold" : ""}`}>{item.subject || "(sem assunto)"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDate(item.date)}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border p-3">
                <span className="text-xs text-muted-foreground">Exibindo {offset + 1}–{Math.min(offset + messages.length, total)} de {total}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={loadingMessages || offset <= 0} onClick={() => loadMessages(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft className="mr-1 h-4 w-4" /> Anterior</Button>
                  <Button size="sm" variant="outline" disabled={loadingMessages || offset + messages.length >= total} onClick={() => loadMessages(offset + PAGE_SIZE)}>Próxima <ChevronRight className="ml-1 h-4 w-4" /></Button>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
