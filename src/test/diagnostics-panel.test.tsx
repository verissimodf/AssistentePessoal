// Fase I — aba Diagnóstico: o painel é somente leitura e apresenta estado + evidência
// do inventário retornado pela ponte (aqui, mockada). Nenhuma ação de mutação deve existir.
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadDiagnostics = vi.fn();
vi.mock("@/lib/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bridge")>()),
  loadDiagnostics: (...a: unknown[]) => loadDiagnostics(...a),
  useAuthState: () => "ok",
}));

import { DiagnosticoPanel } from "@/components/DiagnosticoPanel";

const INVENTARIO = {
  generatedAt: "2026-10-17T05:00:00.000Z",
  versao: { app: "1.2.0", banco: 8, node: "v22.22.3", uptimeSegundos: 3600 },
  resumo: {
    saude: "atencao",
    total: 2,
    porEstado: { OPERACIONAL: 1, INDISPONÍVEL: 1 },
    pendencias: 1,
  },
  itens: [
    {
      id: "servico:api",
      categoria: "servico",
      nome: "Serviço J.A.R.V.I.S. (API)",
      estado: "OPERACIONAL",
      flags: { implementado: true, habilitado: true, testado: true },
      evidencias: [
        {
          metodo: "execucao",
          ref: "processo em execução (uptime lido do runtime)",
          data: "2026-10-17T05:00:00.000Z",
        },
      ],
      limitacoes: [],
      confianca: "alta",
    },
    {
      id: "provedor:omniroute",
      categoria: "integracao",
      nome: "OmniRoute (provedor)",
      estado: "INDISPONÍVEL",
      flags: { implementado: true, habilitado: false, testado: false },
      evidencias: [
        { metodo: "codigo", ref: "server/llm.js (DEFAULT_URLS/providerConfig)", data: null },
      ],
      limitacoes: ["Sem chave configurada — limitação conhecida mantida por decisão."],
      confianca: "media",
    },
  ],
  testes: [{ arquivo: "tests/diagnostics.test.mjs", area: "Diagnóstico" }],
  riscos: ["Risco registrado para o teste."],
  oportunidades: ["Oportunidade registrada para o teste."],
  decisoesHumanas: ["Decisão registrada para o teste."],
  notas: ["Nota registrada para o teste."],
};

beforeEach(() => loadDiagnostics.mockReset());

describe("Diagnóstico Operacional (aba somente leitura)", () => {
  it("mostra estados, fatos, evidências (com e sem data) e limitações", async () => {
    loadDiagnostics.mockResolvedValue(INVENTARIO);
    render(<DiagnosticoPanel />);
    await waitFor(() => expect(screen.getByText("OPERACIONAL")).toBeInTheDocument());
    expect(screen.getByText("INDISPONÍVEL")).toBeInTheDocument();
    expect(screen.getByText(/processo em execução/)).toBeInTheDocument();
    expect(screen.getByText(/sem data/)).toBeInTheDocument();
    expect(screen.getByText(/Sem chave configurada/)).toBeInTheDocument();
    expect(screen.getByText("Risco registrado para o teste.")).toBeInTheDocument();
    expect(screen.getByText("Decisão registrada para o teste.")).toBeInTheDocument();
  });

  it("não oferece nenhuma ação de mutação (apenas recarregar a leitura)", async () => {
    loadDiagnostics.mockResolvedValue(INVENTARIO);
    render(<DiagnosticoPanel />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Atualizar" })).toBeInTheDocument(),
    );
    const botoes = screen.getAllByRole("button").map((b) => b.textContent);
    expect(botoes).toEqual(["Atualizar"]);
  });

  it("sem serviço local mostra o aviso e não renderiza inventário", async () => {
    loadDiagnostics.mockResolvedValue(null);
    render(<DiagnosticoPanel />);
    await waitFor(() =>
      expect(
        screen.getByText(/Disponível apenas com o Jarvis local conectado/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("OPERACIONAL")).not.toBeInTheDocument();
  });
});
