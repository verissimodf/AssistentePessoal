import { useState } from "react";
import { PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/bridge";

/** Per-channel result returned by `POST /api/mail/:account/test-connection`. */
export type ChannelResult = { ok: boolean; state: string; reason: string | null };
export type ConnResult = { mode?: string; imap: ChannelResult; smtp: ChannelResult };

const REASON: Record<string, string> = {
  auth: "falha de autenticação",
  dns: "DNS/nome não resolvido",
  timeout: "tempo esgotado",
  tls: "certificado/TLS",
  unreachable: "host inalcançável",
  unknown: "falha não classificada",
};

const channelText = (c: ChannelResult) =>
  c.ok ? "ok" : (REASON[c.reason ?? "unknown"] ?? "falha");

/** Texto do resultado do teste de conexão (função pura: testável sem DOM nem rede). */
export function connectionText(r: ConnResult): string {
  if (r.mode === "mock" || r.imap.state === "unsupported")
    return "Simulado (mock): conexão não verificada — não é prova de conexão real.";
  if (r.imap.ok && r.smtp.ok) return "Conexão validada (IMAP e SMTP).";
  const parts: string[] = [];
  if (!r.imap.ok) parts.push(`IMAP: ${channelText(r.imap)}`);
  if (!r.smtp.ok) parts.push(`SMTP: ${channelText(r.smtp)}`);
  return `Falha de conexão — ${parts.join("; ")}.`;
}

/** Texto do erro do endpoint (função pura): configuração incompleta ≠ falha fatal. */
export function connectionErrorText(message: string): string {
  return /incomplete_config|incomplet/i.test(message)
    ? "Configuração incompleta."
    : `Falha: ${message}`;
}

/**
 * Prova conectividade e autenticação IMAP/SMTP sem enviar e-mail (P1-B). Distingue explicitamente
 * `mock` (simulado, NÃO é prova de conexão real), configuração incompleta, conexão validada e falha.
 */
export function ConnectionTest({ account }: { account: string }) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");

  const run = async () => {
    setBusy(true);
    setText("Testando…");
    try {
      const r = await api<ConnResult>(`/api/mail/${account}/test-connection`, { method: "POST" });
      setText(connectionText(r));
    } catch (e) {
      setText(connectionErrorText(String((e as Error).message || e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        data-testid={`conn-test-${account}`}
        onClick={run}
        disabled={busy}
      >
        <PlugZap className="mr-2 h-4 w-4" />
        Testar conexão
      </Button>
      {text && (
        <p data-testid={`conn-result-${account}`} className="text-xs text-muted-foreground">
          {text}
        </p>
      )}
    </div>
  );
}
