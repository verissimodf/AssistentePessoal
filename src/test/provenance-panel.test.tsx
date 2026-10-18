// P0.2 — Proveniência das configurações no painel: mostrar DE ONDE vem cada valor efetivo.
//
// Regras sob teste:
//   - o inventário vindo do backend é exibido como origens (padrão/pessoal/global);
//   - segredos aparecem apenas como marca `secret` (nenhum valor de configuração no DOM);
//   - variáveis sensíveis aparecem só como presença, com "valor não exibido";
//   - sem backend (401) → "Indisponível (offline)" e nenhum dado de demonstração.
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProvenancePanel } from "@/components/ProvenancePanel";
import { I18nProvider } from "@/lib/i18n";

const PROV = {
  keys: [
    { path: "general.agentName", origin: "personal", class: "general", secret: false },
    { path: "host.enabled", origin: "global", class: "global", secret: false },
    { path: "voice.tts", origin: "default", class: "personal", secret: false },
    { path: "providers.ollama.apiKey", origin: "personal", class: "personal", secret: true },
  ],
  env: {
    reported: [
      { name: "NODE_ENV", set: true, value: "production" },
      { name: "JARVIS_MAIL_TRANSPORT", set: false, value: null },
    ],
    presenceOnly: [
      { name: "JARVIS_MASTER_KEY", set: true },
      { name: "JARVIS_SERVICE_TOKEN", set: false },
    ],
  },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function stubFetch(opts: { status?: number; body?: unknown } = {}) {
  const status = opts.status ?? 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.includes("/api/health")) return json({ ok: true, setupRequired: false });
      if (url.includes("/api/settings/provenance")) {
        if (status !== 200)
          return new Response("{}", { status, headers: { "content-type": "application/json" } });
        return json(opts.body ?? PROV);
      }
      return json({});
    }),
  );
}

const renderPanel = async () => {
  render(
    <I18nProvider>
      <ProvenancePanel />
    </I18nProvider>,
  );
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("ProvenancePanel", () => {
  it("mostra as origens efetivas (padrão, pessoal e global)", async () => {
    stubFetch();
    await renderPanel();
    await waitFor(() => expect(screen.getByText("general.agentName")).toBeTruthy());

    // Origens: "pessoal" aparece na coluna Origem (x2) e "global" também na coluna Classe.
    expect(screen.getAllByText("pessoal").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("global").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("padrão").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("voice.tts")).toBeTruthy();
  });

  it("marca segredo sem expor valor e mostra variáveis sensíveis só como presença", async () => {
    stubFetch();
    await renderPanel();
    await waitFor(() => expect(screen.getByText("providers.ollama.apiKey")).toBeTruthy());

    expect(screen.getByText("segredo").textContent).toBe("segredo");
    // Nenhum valor de configuração aparece no DOM (o payload nem os traz; o painel não inventa).
    expect(document.body.textContent).not.toContain("enc:");
    // Variáveis reportáveis aparecem com valor/descrição de estado; as de presença só não.
    expect(document.body.textContent).toContain("NODE_ENV = production");
    expect(document.body.textContent).toContain("JARVIS_MAIL_TRANSPORT = não definida");
    const master = screen.getByText(/JARVIS_MASTER_KEY/);
    expect(master.textContent).toContain("definida");
    expect(master.textContent).toContain("valor não exibido");
    expect(master.textContent).not.toContain("production");
  });

  it("sem acesso ao endpoint mostra indisponibilidade, nunca um inventário de demonstração", async () => {
    stubFetch({ status: 401 });
    await renderPanel();
    await waitFor(() => expect(screen.getByText("Indisponível (offline)")).toBeTruthy());
    expect(document.body.textContent).not.toContain("general.agentName");
    expect(document.body.textContent).not.toContain("JARVIS_MASTER_KEY");
  });
});
