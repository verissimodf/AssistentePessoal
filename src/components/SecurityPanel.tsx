import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, currentAdmin, useAuthState } from "@/lib/bridge";
import { useI18n, type Lang } from "@/lib/i18n";
import { LegacyPanel } from "./LegacyPanel";

type Admin = { id: string; username: string; active: number; created_at: string };
type Sess = { id: string; last_seen: number; user_agent: string };
type Tok = { id: string; name: string; scopes: string; last_used: number | null };

const SCOPES = ["chat", "memories:read", "memories:write", "agents:read", "bots:read", "bots:run", "web", "host:run", "comms:read", "comms:send"];
const TX: Record<Lang, Record<string, string>> = {
  pt: { admins: "Administradores (máx. 2)", add_admin: "Adicionar 2º administrador", your_pw: "Sua senha atual", disable: "Desativar", sessions: "Suas sessões ativas", revoke: "Encerrar", tokens: "Tokens de serviço (MCP / scripts)", token_hint: "Dê só os escopos necessários. O token aparece uma única vez.", create: "Criar token", copy_now: "Copie agora, ele não será mostrado de novo:", demo: "Disponível apenas com o Jarvis local conectado e autenticado.", cur_pw: "Senha atual", change_pw: "Trocar senha", new_pw: "Nova senha (mín. 12)", confirm_pw: "Confirmar nova senha", change_pw_btn: "Trocar senha", pw_changed: "Senha alterada. As outras sessões foram encerradas.", pw_current_wrong: "Senha atual incorreta.", pw_mismatch: "A confirmação não confere com a nova senha.", pw_weak: "A nova senha precisa de pelo menos 12 caracteres." },
  en: { admins: "Administrators (max 2)", add_admin: "Add 2nd administrator", your_pw: "Your current password", disable: "Disable", sessions: "Your active sessions", revoke: "End", tokens: "Service tokens (MCP / scripts)", token_hint: "Grant only the scopes needed. The token is shown once.", create: "Create token", copy_now: "Copy it now, it won't be shown again:", demo: "Available only with local Jarvis connected and signed in.", cur_pw: "Current password", change_pw: "Change password", new_pw: "New password (min. 12)", confirm_pw: "Confirm new password", change_pw_btn: "Change password", pw_changed: "Password changed. Other sessions were ended.", pw_current_wrong: "Current password is incorrect.", pw_mismatch: "The confirmation does not match the new password.", pw_weak: "The new password needs at least 12 characters." },
  es: { admins: "Administradores (máx. 2)", add_admin: "Agregar 2.º administrador", your_pw: "Tu contraseña actual", disable: "Desactivar", sessions: "Tus sesiones activas", revoke: "Cerrar", tokens: "Tokens de servicio (MCP / scripts)", token_hint: "Concede solo los alcances necesarios. El token se muestra una vez.", create: "Crear token", copy_now: "Cópialo ahora, no se mostrará de nuevo:", demo: "Disponible solo con Jarvis local conectado y autenticado.", cur_pw: "Contraseña actual", change_pw: "Cambiar contraseña", new_pw: "Nueva contraseña (mín. 12)", confirm_pw: "Confirmar nueva contraseña", change_pw_btn: "Cambiar contraseña", pw_changed: "Contraseña cambiada. Las demás sesiones se cerraron.", pw_current_wrong: "La contraseña actual es incorrecta.", pw_mismatch: "La confirmación no coincide con la nueva contraseña.", pw_weak: "La nueva contraseña necesita al menos 12 caracteres." },
};

export function SecurityPanel() {
  const { lang } = useI18n();
  const x = (k: string) => TX[lang][k];
  const state = useAuthState();
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [tokens, setTokens] = useState<Tok[]>([]);
  const [na, setNa] = useState({ username: "", password: "", currentPassword: "" });
  const [nt, setNt] = useState<{ name: string; scopes: string[] }>({ name: "mcp", scopes: ["chat", "memories:read"] });
  const [shown, setShown] = useState("");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwBusy, setPwBusy] = useState(false);

  // Troca de senha (Fase G): nada vai para URL, armazenamento local ou log; erros do servidor
  // viram mensagens claras sem revelar mais do que o necessário para o fluxo.
  const pwErrorText = (msg: string) => {
    if (msg.includes("weak_password")) return x("pw_weak");
    if (msg.includes("password_mismatch")) return x("pw_mismatch");
    if (msg.includes("reauth_failed")) return x("pw_current_wrong");
    return msg;
  };
  const submitPw = async (e: FormEvent) => {
    e.preventDefault();
    if (pwBusy) return;
    setPwBusy(true);
    try {
      await api("/api/auth/password", { method: "POST", body: JSON.stringify(pw) });
      setPw({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast.success(x("pw_changed"));
    } catch (err) {
      toast.error(pwErrorText(err instanceof Error ? err.message : String(err)));
    } finally { setPwBusy(false); }
  };

  const load = async () => {
    setAdmins(await api<Admin[]>("/api/auth/admins"));
    setSessions(await api<Sess[]>("/api/auth/sessions"));
    setTokens(await api<Tok[]>("/api/auth/tokens"));
  };
  useEffect(() => { if (state === "ok") load().catch(() => undefined); }, [state]);
  if (state !== "ok") return <p className="text-sm text-muted-foreground">{x("demo")}</p>;

  const run = async (f: () => Promise<unknown>) => { try { await f(); await load(); } catch (e) { toast.error((e as Error).message); } };
  const me = currentAdmin();
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="hud-label">{x("admins")}</h3>
        {admins.map((a) => (
          <div key={a.id} className="flex items-center justify-between text-sm">
            <span className={a.active ? "" : "text-muted-foreground line-through"}>{a.username}{a.id === me?.id ? " ★" : ""}</span>
            {!!a.active && a.id !== me?.id && <Button size="sm" variant="outline" onClick={() => run(() => api(`/api/auth/admins/${a.id}`, { method: "DELETE" }))}>{x("disable")}</Button>}
          </div>
        ))}
        {admins.length < 2 && (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/api/auth/admins", { method: "POST", body: JSON.stringify(na) }); setNa({ username: "", password: "", currentPassword: "" }); }); }}>
            <Input placeholder="usuário" value={na.username} onChange={(e) => setNa({ ...na, username: e.target.value })} />
            <Input type="password" placeholder="senha (12+)" value={na.password} onChange={(e) => setNa({ ...na, password: e.target.value })} />
            <Input type="password" placeholder={x("your_pw")} value={na.currentPassword} onChange={(e) => setNa({ ...na, currentPassword: e.target.value })} />
            <Button type="submit" size="sm">{x("add_admin")}</Button>
          </form>
        )}
      </section>
      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h3 className="hud-label">{x("sessions")}</h3>
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-muted-foreground">{new Date(s.last_seen).toLocaleString()} · {s.user_agent.slice(0, 40)}</span>
            <Button size="sm" variant="outline" onClick={() => run(() => api(`/api/auth/sessions/${s.id}`, { method: "DELETE" }))}>{x("revoke")}</Button>
          </div>
        ))}
      </section>
      <section className="space-y-3 rounded-lg border border-border bg-card p-4 md:col-span-2">
        <h3 className="hud-label">{x("tokens")}</h3>
        <p className="text-xs text-muted-foreground">{x("token_hint")}</p>
        {tokens.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
            <span>{t.name} <span className="font-mono text-xs text-muted-foreground">{t.scopes}</span></span>
            <Button size="sm" variant="outline" onClick={() => run(() => api(`/api/auth/tokens/${t.id}`, { method: "DELETE" }))}>{x("revoke")}</Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((sc) => (
            <label key={sc} className="flex items-center gap-1 font-mono text-xs">
              <input type="checkbox" checked={nt.scopes.includes(sc)} onChange={(e) => setNt({ ...nt, scopes: e.target.checked ? [...nt.scopes, sc] : nt.scopes.filter((y) => y !== sc) })} />{sc}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} className="max-w-xs" />
          <Button size="sm" onClick={() => run(async () => { const r = await api<{ token: string }>("/api/auth/tokens", { method: "POST", body: JSON.stringify(nt) }); setShown(r.token); })}>{x("create")}</Button>
        </div>
        {shown && <p className="break-all rounded bg-secondary p-2 font-mono text-xs">{x("copy_now")} {shown}</p>}
      </section>
      <section className="space-y-3 rounded-lg border border-border bg-card p-4 md:col-span-2">
        <h3 className="hud-label">{x("change_pw")}</h3>
        <form className="flex max-w-sm flex-col gap-2" onSubmit={submitPw}>
          <Input type="password" required autoComplete="current-password" placeholder={x("cur_pw")} value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
          <Input type="password" required autoComplete="new-password" placeholder={x("new_pw")} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          <Input type="password" required autoComplete="new-password" placeholder={x("confirm_pw")} value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} />
          <Button type="submit" size="sm" disabled={pwBusy} className="self-start">{x("change_pw_btn")}</Button>
        </form>
      </section>
      <LegacyPanel />
    </div>
  );
}
