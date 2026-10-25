// P0.2 — Metadados de build reais na Visão geral.
//
// Regras sob teste:
//   - o commit exibido vem do `/api/health` (injetado no build) e nunca é adivinhado;
//   - commit "unknown"/ausente → "Não registrado", não um valor presumido do branch;
//   - um commit real aparece tal e qual o build injetou, e o buildTime só aparece se conhecido.
// O painel é renderizado como filho do provider de i18n (que no arquivo real fica no root).
import { render, screen, waitFor, cleanup } from "@testing-library/react";
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

const SHA = "abc1234def567890abcdef1234567890abcdef12";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

// Identidade de build do `/api/health`; as listagens (aprovações/execuções/auditoria) ficam
// indisponíveis — fora do escopo deste teste.
function stubHealth(health: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.includes("/api/health")) return jsonResponse(health);
      // Listagens do administrador: forma real do contrato (`{ approvals/executions }`).
      // `api()` lança em erro HTTP, então devolvemos 200 vazio em vez de simular offline.
      if (url.includes("/api/approvals")) return jsonResponse({ approvals: [] });
      if (url.includes("/api/executions")) return jsonResponse({ executions: [] });
      // Auditoria: a ponte espera um array direto (`api<AuditRow[]>("/api/audit")`).
      if (url.includes("/api/audit")) return jsonResponse([]);
      return jsonResponse({});
    }),
  );
}

async function renderOverview() {
  render(
    <I18nProvider>
      <OverviewRoute.options.component />
    </I18nProvider>,
  );
  // Os dados chegam via `load()` (Promise.all); espera a seção de identidade de build existir.
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
    versao: { app: "1.3.0", commit: null, banco: 10, node: "v22.22.2", uptimeSegundos: 120 },
  });
});

describe("Visão geral — metadados de build", () => {
  it("mostra o commit real injetado pelo build", async () => {
    stubHealth({
      ok: true,
      version: "1.3.0",
      commit: SHA,
      buildTime: "2026-10-18T05:33:13Z",
      setupRequired: false,
    });
    await renderOverview();
    await waitFor(() => expect(screen.getByText(SHA)).toBeTruthy());
    expect(screen.queryByText("Não registrado")).toBeNull();
    expect(screen.getByText("2026-10-18T05:33:13Z")).toBeTruthy();
  });

  it("mostra o esquema efetivo e o status do commit injetados pelo build", async () => {
    stubHealth({
      ok: true,
      version: "1.7.8",
      commit: SHA,
      commitStatus: "Registrado",
      schemaVersion: 12,
      buildTime: "2026-10-25T23:00:00Z",
      setupRequired: false,
    });
    await renderOverview();
    await waitFor(() => expect(screen.getByText(SHA)).toBeTruthy());
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText(/\(Registrado\)/)).toBeTruthy();
  });

  it("commit 'unknown' do build vira 'Não registrado', nunca um SHA adivinhado", async () => {
    stubHealth({
      ok: true,
      version: "1.3.0",
      commit: "unknown",
      buildTime: "unknown",
      setupRequired: false,
    });
    await renderOverview();
    await waitFor(() => expect(screen.getAllByText("Não registrado").length).toBeGreaterThan(0));
    // Nenhum valor com forma de SHA aparece na identidade de build.
    expect(document.body.textContent ?? "").not.toMatch(/\b[0-9a-f]{40}\b/i);
    // Sem buildTime conhecido, a linha de build não é renderizada.
    expect(screen.queryByText(/Build/i)).toBeNull();
  });

  it("sem campos de build no health (backend antigo) também mostra 'Não registrado'", async () => {
    stubHealth({ ok: true, version: "1.2.0", setupRequired: false });
    await renderOverview();
    await waitFor(() => expect(screen.getAllByText("Não registrado").length).toBeGreaterThan(0));
    expect(document.body.textContent ?? "").not.toMatch(/\b[0-9a-f]{40}\b/i);
  });

  it("sem manifest de build o release também vira 'Não registrado' (não uma versão presumida)", async () => {
    loadDiagnostics.mockResolvedValue({
      versao: { app: null, commit: null, banco: 10, node: "v22.22.2", uptimeSegundos: 120 },
    });
    stubHealth({ ok: true, commit: "unknown", setupRequired: false });
    await renderOverview();
    await waitFor(() => expect(screen.getAllByText("Não registrado").length).toBeGreaterThan(0));
    expect(document.body.textContent ?? "").not.toContain("1.2.0");
  });
});
