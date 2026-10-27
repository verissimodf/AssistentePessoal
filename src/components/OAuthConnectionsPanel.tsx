import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ping } from "@/lib/bridge";
import { Button } from "@/components/ui/button";

type Connection = {
  id: string;
  provider: "google" | "microsoft";
  email: string;
  scopes: string[];
  status: string;
  updatedAt: string;
};
const PROVIDERS = [
  { id: "google", label: "Google / Gmail" },
  { id: "microsoft", label: "Microsoft / Outlook" },
] as const;

export function OAuthConnectionsPanel() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [includeSend, setIncludeSend] = useState<Record<string, boolean>>({});
  const refresh = useCallback(async () => {
    if (await ping()) setConnections(await api<Connection[]>("/api/oauth/connections"));
  }, []);
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const reauthenticate = async () => {
    const password = window.prompt("Confirme sua senha para alterar uma conexão externa:");
    if (!password) return false;
    await api("/api/auth/reauth", { method: "POST", body: JSON.stringify({ password }) });
    return true;
  };

  const connect = async (provider: string) => {
    if (!(await ping()) || !(await reauthenticate())) return;
    const result = await api<{ authorizationUrl: string }>(`/api/oauth/${provider}/start`, {
      method: "POST",
      body: JSON.stringify({ includeSend: !!includeSend[provider] }),
    });
    window.location.assign(result.authorizationUrl);
  };

  const disconnect = async (provider: string) => {
    if (!window.confirm("Desconectar esta conta e remover o refresh token local?")) return;
    if (!(await reauthenticate())) return;
    await api(`/api/oauth/${provider}/disconnect`, {
      method: "POST",
      body: JSON.stringify({ confirm: "DESCONECTAR" }),
    });
    await refresh();
    toast.success("Conta desconectada e token local removido.");
  };

  return (
    <div className="hud-panel space-y-3 p-4 md:col-span-2">
      <div>
        <div className="font-display">Contas de e-mail OAuth</div>
        <p className="text-sm text-muted-foreground">
          Tokens ficam cifrados no banco local. Leitura é autorizada ao conectar; envio requer
          consentimento separado e continua sujeito à confirmação D9.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {PROVIDERS.map(({ id, label }) => {
          const connection = connections.find((c) => c.provider === id);
          const hasSend = connection?.scopes.some(
            (s) => s === "https://www.googleapis.com/auth/gmail.send" || s === "Mail.Send",
          );
          return (
            <div key={id} className="rounded-md border border-border p-3">
              <div className="font-medium">{label}</div>
              {connection ? (
                <>
                  <p className="mt-1 text-sm">
                    {connection.email} · {connection.status}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Acesso: leitura{hasSend ? " e envio (D9)" : ""}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => disconnect(id).catch((e) => toast.error(String(e)))}
                  >
                    Desconectar
                  </Button>
                </>
              ) : (
                <>
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={!!includeSend[id]}
                      onChange={(e) => setIncludeSend({ ...includeSend, [id]: e.target.checked })}
                    />
                    Solicitar também permissão para enviar (D9 continua ativo)
                  </label>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => connect(id).catch((e) => toast.error(String(e)))}
                  >
                    Conectar conta
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
