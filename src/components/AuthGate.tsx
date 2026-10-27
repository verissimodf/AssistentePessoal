import { useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login, setupFirstAdmin, useAuthState } from "@/lib/bridge";
import { useI18n, type Lang } from "@/lib/i18n";

export const AUTH_TEXT: Record<Lang, Record<string, string>> = {
  pt: {
    login_title: "Entrar no Jarvis",
    login_sub: "Acesso restrito aos administradores deste computador.",
    setup_title: "Primeiro acesso",
    setup_sub:
      "Crie o administrador principal. O código de configuração está no arquivo indicado na janela do Jarvis (data/bootstrap-token.txt). Ele vale por 15 minutos e só pode ser usado uma vez.",
    token: "Código de configuração",
    user: "Usuário",
    password: "Senha (mínimo 12 caracteres)",
    password2: "Confirmar senha",
    enter: "Entrar",
    create: "Criar administrador",
    mismatch: "As senhas não conferem.",
    invalid_credentials: "Usuário ou senha inválidos.",
    too_many_attempts: "Muitas tentativas. Aguarde {s} s.",
    invalid_bootstrap_token: "Código inválido. Reinicie o Jarvis para gerar outro.",
    bootstrap_token_expired: "Código expirado. Reinicie o Jarvis para gerar outro.",
    setup_closed: "O primeiro acesso já foi concluído.",
    weak_password: "Senha fraca: use ao menos 12 caracteres.",
    invalid_username: "Usuário: 3 a 32 letras, números, ponto, hífen ou sublinhado.",
    logout: "Sair",
    security: "Segurança",
  },
  en: {
    login_title: "Sign in to Jarvis",
    login_sub: "Restricted to this computer's administrators.",
    setup_title: "First access",
    setup_sub:
      "Create the main administrator. The setup code is in the file shown in the Jarvis window (data/bootstrap-token.txt). It is valid for 15 minutes and works once.",
    token: "Setup code",
    user: "Username",
    password: "Password (12+ characters)",
    password2: "Confirm password",
    enter: "Sign in",
    create: "Create administrator",
    mismatch: "Passwords do not match.",
    invalid_credentials: "Invalid username or password.",
    too_many_attempts: "Too many attempts. Wait {s} s.",
    invalid_bootstrap_token: "Invalid code. Restart Jarvis to get a new one.",
    bootstrap_token_expired: "Code expired. Restart Jarvis to get a new one.",
    setup_closed: "First access was already completed.",
    weak_password: "Weak password: use at least 12 characters.",
    invalid_username: "Username: 3–32 letters, digits, dot, dash or underscore.",
    logout: "Sign out",
    security: "Security",
  },
  es: {
    login_title: "Entrar en Jarvis",
    login_sub: "Acceso restringido a los administradores de este equipo.",
    setup_title: "Primer acceso",
    setup_sub:
      "Crea el administrador principal. El código de configuración está en el archivo indicado en la ventana de Jarvis (data/bootstrap-token.txt). Vale 15 minutos y se usa una sola vez.",
    token: "Código de configuración",
    user: "Usuario",
    password: "Contraseña (mínimo 12 caracteres)",
    password2: "Confirmar contraseña",
    enter: "Entrar",
    create: "Crear administrador",
    mismatch: "Las contraseñas no coinciden.",
    invalid_credentials: "Usuario o contraseña inválidos.",
    too_many_attempts: "Demasiados intentos. Espera {s} s.",
    invalid_bootstrap_token: "Código inválido. Reinicia Jarvis para obtener otro.",
    bootstrap_token_expired: "Código vencido. Reinicia Jarvis para obtener otro.",
    setup_closed: "El primer acceso ya fue completado.",
    weak_password: "Contraseña débil: usa al menos 12 caracteres.",
    invalid_username: "Usuario: 3 a 32 letras, números, punto, guion o guion bajo.",
    logout: "Salir",
    security: "Seguridad",
  },
};
export const useAuthText = () => {
  const { lang } = useI18n();
  return (k: string) => AUTH_TEXT[lang][k] ?? k;
};

/** Shows login / first-access screens when the local service requires it; demo mode passes through. */
export function AuthGate({ children }: { children: ReactNode }) {
  const state = useAuthState();
  if (state === "setup" || state === "login") return <AuthForm mode={state} />;
  return <>{children}</>;
}

function AuthForm({ mode }: { mode: "setup" | "login" }) {
  const a = useAuthText();
  const [f, setF] = useState({ token: "", user: "", pw: "", pw2: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    if (mode === "setup" && f.pw !== f.pw2) return setErr(a("mismatch"));
    setBusy(true);
    try {
      if (mode === "setup") await setupFirstAdmin(f.token, f.user, f.pw);
      else await login(f.user, f.pw);
    } catch (x) {
      const ex = x as { code?: string; retryAfter?: number };
      setErr(a(ex.code || "invalid_credentials").replace("{s}", String(ex.retryAfter ?? "")));
    } finally {
      setBusy(false);
      setF((v) => ({ ...v, pw: "", pw2: "" }));
    }
  };
  const Icon = mode === "setup" ? ShieldCheck : KeyRound;
  return (
    <div className="flex min-h-[80vh] items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="hud-panel w-full max-w-md space-y-4 rounded-lg border border-border bg-card p-6"
      >
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">
            {a(mode === "setup" ? "setup_title" : "login_title")}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {a(mode === "setup" ? "setup_sub" : "login_sub")}
        </p>
        {mode === "setup" && (
          <Input
            aria-label={a("token")}
            placeholder={a("token")}
            value={f.token}
            autoComplete="off"
            onChange={(e) => setF({ ...f, token: e.target.value })}
            required
          />
        )}
        <Input
          aria-label={a("user")}
          placeholder={a("user")}
          value={f.user}
          autoComplete="username"
          onChange={(e) => setF({ ...f, user: e.target.value })}
          required
        />
        <Input
          aria-label={a("password")}
          placeholder={a("password")}
          type="password"
          value={f.pw}
          autoComplete={mode === "setup" ? "new-password" : "current-password"}
          onChange={(e) => setF({ ...f, pw: e.target.value })}
          required
        />
        {mode === "setup" && (
          <Input
            aria-label={a("password2")}
            placeholder={a("password2")}
            type="password"
            value={f.pw2}
            autoComplete="new-password"
            onChange={(e) => setF({ ...f, pw2: e.target.value })}
            required
          />
        )}
        {err && (
          <p role="alert" className="text-sm text-destructive">
            {err}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {a(mode === "setup" ? "create" : "enter")}
        </Button>
      </form>
    </div>
  );
}
