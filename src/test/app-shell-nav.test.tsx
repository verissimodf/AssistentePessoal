// Regressão do menu: o item "Skills" deve apresentar rótulo correto nos idiomas —
// a falha original (nav_skills usada sem definição em i18n) deixava o link sem texto.
// Renderiza o router completo (AppShell real + I18nProvider real + página /skills) com a
// ponte mockada (padrão do repo) — o i18n NÃO é mockado: é exatamente o que está sob teste.
// O routeTree carrega TODAS as páginas, então o mock cobre qualquer export via Proxy.
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/bridge", () => ({
  // exports usados pelas páginas carregadas pelo routeTree (as não visíveis em /skills
  // apenas precisam existir — só SkillsPage e AppShell são renderizadas neste teste):
  api: vi.fn(),
  bridgeUrl: () => "http://127.0.0.1:7777",
  collection: () => ({ list: vi.fn(async () => []), save: vi.fn(), remove: vi.fn() }),
  currentAdmin: () => null,
  DEFAULT_BRIDGE: "",
  DEFAULT_SETTINGS: {},
  inspectSkill: vi.fn(),
  listExecutions: vi.fn(async () => []),
  loadDiagnostics: vi.fn(async () => null),
  loadProvenance: vi.fn(async () => null),
  loadSettings: vi.fn(async () => ({})),
  login: vi.fn(),
  logout: vi.fn(),
  ping: vi.fn(async () => true),
  saveSettings: vi.fn(),
  setupFirstAdmin: vi.fn(),
  useAuthState: () => "ok",
  useBridgeStatus: () => true,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, Toaster: vi.fn(() => null) }));

import { routeTree } from "@/routeTree.gen";

const makeRouter = async (initial = "/skills") => {
  const router = createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  await router.load(); // monta a rota ativa antes do render (senão o RouterProvider fica pendente)
  return router;
};

describe("Navegação do painel (item Skills)", () => {
  it("o link do menu Skills tem o rótulo definido (pt) e aponta para /skills", async () => {
    render(<RouterProvider router={await makeRouter()} />);
    const link = screen.getByRole("link", { name: "Skills" });
    expect(link).toHaveAttribute("href", "/skills");
  });

  it.each([
    ["en", "Skills"],
    ["es", "Skills"],
  ])("rótulo presente em %s também", async (lang, esperado) => {
    localStorage.setItem("jarvis.lang", lang);
    render(<RouterProvider router={await makeRouter()} />);
    await waitFor(() => expect(screen.getByRole("link", { name: esperado })).toBeInTheDocument());
  });
});
