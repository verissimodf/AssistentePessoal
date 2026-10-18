// P0.2 — Foco da sessão na Visão geral: objetivo/resumo/decisões EXPLÍCITOS (persistidos no
// backend, por dono) e pendências DERIVADAS de dados reais.
//
// Regras sob teste:
//   - o que vem de `/api/session-focus` é exibido como estado guardado (sem dados de demonstração);
//   - editar e salvar envia o rascunho por PUT e reflete a resposta do servidor;
//   - sem backend (401) a área mostra "Indisponível (offline)" — nunca um objetivo inventado;
//   - o "próximo passa" é rotulado como derivado de aprovações/execuções reais.
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadDiagnostics = vi.fn();
vi.mock("@/lib/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bridge")>()),
  loadDiagnostics: (...a: unknown[]) => loadDiagnostics(...a),
  useAuthState: () => "ok",
  useBridgeStatus: () => true,
}));

import { Route as OverviewRoute } from "@/routes/visao-geral";
import { I18nProvider } from "@/lib/i18n";

const FOCUS = {
  objective: "Publicar o relatório P0.2",
  summary: "Verificadores e metadados de build entregues.",
  decisions: ["Commit só via --build-arg GIT_SHA"],
  updatedAt: "2026-10-18T14:00:00.000Z",
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

let putBodies: Record<string, unknown>[] = [];

function stubFetch(opts: { focusStatus?: number } = {}) {
  putBodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      const method = (init?.method || "GET").toUpperCase();
      if (url.includes("/api/health"))
        return json({ ok: true, version: "1.3.0", commit: "unknown" });
      if (url.includes("/api/session-focus")) {
        if (opts.focusStatus && opts.focusStatus !== 200) {
          return new Response("{}", {
            status: opts.focusStatus,
            headers: { "content-type": "application/json" },
          });
        }
        if (method === "PUT") {
          const body = JSON.parse(String(init?.body || "{}"));
          putBodies.push(body);
          return json({ ...FOCUS, ...body, updatedAt: new Date().toISOString() });
        }
        return json(FOCUS);
      }
      if (url.includes("/api/approvals")) return json({ approvals: [] });
      if (url.includes("/api/executions")) return json({ executions: [] });
      if (url.includes("/api/audit")) return json([]);
      return json({});
    }),
  );
}

async function renderOverview() {
  render(
    <I18nProvider>
      <OverviewRoute.options.component />
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.queryByText(/Release/i)).toBeTruthy());
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  loadDiagnostics.mockResolvedValue({
    versao: { app: "1.3.0", commit: null, banco: 11, node: "v22.22.2", uptimeSegundos: 120 },
  });
  window.history.pushState({}, "", "/visao-geral");
});

describe("Visão geral — foco da sessão", () => {
  it("mostra o foco guardado no backend (objetivo, resumo e decisões)", async () => {
    stubFetch();
    await renderOverview();
    await waitFor(() => expect(screen.getByLabelText("Objetivo")).toBeTruthy());
    expect((screen.getByLabelText("Objetivo") as HTMLTextAreaElement).value).toBe(FOCUS.objective);
    expect((screen.getByLabelText("Resumo") as HTMLTextAreaElement).value).toBe(FOCUS.summary);
    expect(screen.getByText(FOCUS.decisions[0]!)).toBeTruthy();
    // Pendências continuam DERIVADAS e rotuladas como tal.
    expect(screen.getByText(/derivado de aprovações\/execuções reais/)).toBeTruthy();
  });

  it("salvar envia o rascunho por PUT e reflete a resposta do servidor", async () => {
    stubFetch();
    await renderOverview();
    await waitFor(() => expect(screen.getByLabelText("Objetivo")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Objetivo"), {
      target: { value: "Novo objetivo editado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => expect(putBodies.length).toBe(1));
    expect(putBodies[0]!.objective).toBe("Novo objetivo editado");
    expect(Array.isArray(putBodies[0]!.decisions)).toBe(true);
    await waitFor(() => expect(screen.getByText(/Guardado/)).toBeTruthy());
    expect((screen.getByLabelText("Objetivo") as HTMLTextAreaElement).value).toBe(
      "Novo objetivo editado",
      "a resposta do servidor volta a alimentar o rascunho",
    );
  });

  it("sem acesso ao endpoint o foco é 'Indisponível (offline)', nunca um objetivo de demonstração", async () => {
    stubFetch({ focusStatus: 401 });
    await renderOverview();
    await waitFor(() => expect(screen.queryByText(/Release/i)).toBeTruthy());
    // A área do foco (segundo cartão de conteúdo) está indisponível e sem campos editáveis.
    await waitFor(() => expect(screen.queryByLabelText("Objetivo")).toBeNull());
    expect(screen.getAllByText("Indisponível (offline)").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(FOCUS.objective);
  });
});
