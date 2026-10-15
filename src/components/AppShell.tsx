import { Link, Outlet } from "@tanstack/react-router";
import { Bot, Brain, FileText, LogOut, Mail, MessageSquare, Settings, Users } from "lucide-react";
import { logout, useAuthState, useBridgeStatus } from "@/lib/bridge";
import { AuthGate, useAuthText } from "@/components/AuthGate";
import { LANGS, useI18n, type Lang } from "@/lib/i18n";

export function AppShell() {
  const { t, lang, setLang } = useI18n();
  const online = useBridgeStatus();
  const auth = useAuthState();
  const a = useAuthText();
  const nav = [
    { to: "/", label: t("nav_chat"), icon: MessageSquare },
    { to: "/memoria", label: t("nav_memory"), icon: Brain },
    { to: "/documentos", label: "Documentos", icon: FileText },
    { to: "/rascunhos", label: "E-mail", icon: Mail },
    { to: "/agentes", label: t("nav_agents"), icon: Users },
    { to: "/bots", label: t("nav_bots"), icon: Bot },
    { to: "/configuracoes", label: t("nav_settings"), icon: Settings },
  ] as const;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-row items-center gap-1 border-b border-border bg-sidebar/80 p-2 md:w-56 md:flex-col md:items-stretch md:border-b-0 md:border-r md:p-4">
        <div className="mb-0 mr-2 md:mb-6 md:mr-0">
          <div className="font-display text-xl font-bold text-primary text-glow">J.A.R.V.I.S.</div>
          <div className="hud-label hidden md:block">local assistant</div>
        </div>
        <nav className="flex flex-1 flex-row gap-1 overflow-x-auto md:flex-col">
          {nav.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-primary"
            >
              <Icon className="h-4 w-4" />
              <span className="hidden md:inline">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 md:flex-col md:items-stretch">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="rounded-md border border-input bg-secondary px-2 py-1 text-xs"
            aria-label="Language"
          >
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <div className="flex items-center gap-2 text-xs" title={online ? "" : t("demo_hint")}>
            <span className={`h-2 w-2 rounded-full ${online ? "bg-chart-3" : "bg-accent"} animate-pulse`} />
            <span className="hidden text-muted-foreground md:inline">{online ? t("connected") : t("demo")}</span>
          </div>
          {auth === "ok" && (
            <button onClick={() => logout()} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground" aria-label={a("logout")}>
              <LogOut className="h-3 w-3" /><span className="hidden md:inline">{a("logout")}</span>
            </button>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-hidden">
        <AuthGate><Outlet /></AuthGate>
      </main>
    </div>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
