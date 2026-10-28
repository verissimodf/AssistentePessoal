import { useEffect, useState } from "react";
import { api, type BrowserApprovalReview } from "@/lib/bridge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type Decision = { output: string; status?: string };

export function BrowserApprovalReview({
  id,
  onDone,
}: {
  id: string;
  onDone: (result: Decision) => void;
}) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<BrowserApprovalReview | null>(null);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isWrite = review && ["click", "fill"].includes(review.operation);

  useEffect(() => {
    if (!open) {
      setReview(null);
      setPassword("");
      setConfirmed(false);
      setRevealed(false);
      setError("");
      return;
    }
    let active = true;
    api<{ review: BrowserApprovalReview }>(`/api/approvals/${id}/review`)
      .then(({ review: data }) => {
        if (active) setReview(data);
      })
      .catch(() => {
        if (active) setError("Não foi possível carregar a revisão desta ação.");
      });
    return () => {
      active = false;
      setReview(null);
      setConfirmed(false);
      setRevealed(false);
      setPassword("");
    };
  }, [open, id]);

  const reveal = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/reauth", { method: "POST", body: JSON.stringify({ password }) });
      const { review: data } = await api<{ review: BrowserApprovalReview }>(
        `/api/approvals/${id}/reveal`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setReview(data);
      setRevealed(true);
      setPassword("");
    } catch {
      setError("Não foi possível revalidar a sessão ou revelar o valor.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (approve: boolean) => {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Decision>(`/api/approvals/${id}`, {
        method: "POST",
        body: JSON.stringify({
          approve,
          ...(approve && isWrite ? { confirmWrite: true, fingerprint: review.fingerprint } : {}),
        }),
      });
      setOpen(false);
      onDone(result);
    } catch {
      setError("A aprovação não foi concluída. Reabra a revisão para validar o estado atual.");
    } finally {
      setBusy(false);
    }
  };

  const canApprove = !!review && (!isWrite || (confirmed && (!review.hasText || revealed)));

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Revisar ação
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revisar ação do navegador</DialogTitle>
            <DialogDescription>Confira o destino e os dados antes de autorizar.</DialogDescription>
          </DialogHeader>
          {review ? (
            <div className="space-y-3 text-sm">
              <p>
                <span className="hud-label">Operação:</span> {review.operation}
              </p>
              <p>
                <span className="hud-label">Destino:</span> {review.host || "não informado"}
              </p>
              {review.selector && (
                <p>
                  <span className="hud-label">Seletor:</span> <code>{review.selector}</code>
                </p>
              )}
              {review.hasText && (
                <div className="space-y-2">
                  <p>
                    <span className="hud-label">Valor:</span>{" "}
                    <code className="break-all">{review.preview}</code>
                  </p>
                  {review.preview === "••••••••" && (
                    <div className="flex gap-2">
                      <Input
                        aria-label="Senha para revelar o valor"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Senha atual"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!password || busy}
                        onClick={reveal}
                      >
                        Revelar valor
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {isWrite && (
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={confirmed}
                    onCheckedChange={(value) => setConfirmed(value === true)}
                  />
                  Confirmo a escrita no destino indicado.
                </label>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Carregando revisão...</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => decide(false)}>
              Negar
            </Button>
            <Button disabled={busy || !canApprove} onClick={() => decide(true)}>
              {isWrite ? "Confirmar e executar" : "Aprovar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
