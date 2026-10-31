import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { workforceStatusBadge } from "@/lib/workforce";
import { WorkforcePage } from "@/routes/workforce";
import type { WorkforceDefinition, WorkforceRun, WorkforceTemplate } from "@/lib/bridge";

const agent: WorkforceDefinition = {
  id: "wf-agent-1",
  name: "Agente de Pesquisa",
  role: "specialist",
  description: "Pesquisa na web e devolve relatório.",
  version: 1,
  instructions: "Pesquise com fontes.",
  model_preferences: { provider: null, model: null },
  permitted_tools: ["web_search", "fetch_url"],
  permission_scopes: ["web", "documents:read"],
  resource_budget: {
    max_depth: 3,
    max_children: 8,
    max_tree_runs: 16,
    max_tool_calls: 25,
    max_model_calls: 40,
    max_tokens: null,
    runtime_ms: 300000,
    max_retries: 1,
    max_concurrent_children: 2,
  },
  execution_limits: {},
  enabled: true,
  created_at: "2026-10-30T10:00:00Z",
  updated_at: "2026-10-30T10:00:00Z",
};

const run: WorkforceRun = {
  id: "wf-run-1",
  definition_id: "wf-agent-1",
  parent_run_id: null,
  correlation_id: "corr-1",
  objective: "Mapear o mercado de agentes locais",
  status: "running",
  depth: 0,
  usage: { tool_calls: 3, model_calls: 2, estimated_tokens: 1200 },
  result: null,
  error_code: null,
  verification: "unverified",
  definition: { name: "Agente de Pesquisa", role: "specialist" },
  children: [],
  created_at: "2026-10-30T10:05:00Z",
  finished_at: null,
};

const template: WorkforceTemplate = {
  key: "research",
  name: "Agente de Pesquisa",
  role: "specialist",
  description: "Pesquisa na web e em documentos locais.",
  permitted_tools: ["web_search"],
  permission_scopes: ["web"],
};

vi.mock("@/lib/bridge", () => ({
  listWorkforceAgents: vi.fn(async () => [agent]),
  createWorkforceAgent: vi.fn(async () => agent),
  updateWorkforceAgent: vi.fn(async () => agent),
  deleteWorkforceAgent: vi.fn(async () => ({ ok: true })),
  runWorkforceAgent: vi.fn(async () => ({ run, deduplicated: false })),
  listWorkforceRuns: vi.fn(async () => ({ items: [run], has_more: false })),
  getWorkforceRun: vi.fn(async () => run),
  cancelWorkforceRun: vi.fn(async () => run),
  reconcileWorkforceRun: vi.fn(async () => run),
  listWorkforceTemplates: vi.fn(async () => [template]),
  ping: vi.fn(async () => true),
}));

describe("workforceStatusBadge", () => {
  it("mapeia cada status para variante e rótulo distintos", () => {
    expect(workforceStatusBadge("queued")).toMatchObject({
      variant: "outline",
      label: "Na fila",
      verified: false,
    });
    expect(workforceStatusBadge("running")).toMatchObject({
      variant: "secondary",
      label: "Em execução",
    });
    expect(workforceStatusBadge("awaiting_approval")).toMatchObject({
      variant: "secondary",
      label: "Aguardando aprovação",
    });
    expect(workforceStatusBadge("completed")).toMatchObject({
      variant: "secondary",
      label: "Concluído",
    });
    expect(workforceStatusBadge("failed")).toMatchObject({
      variant: "destructive",
      label: "Falhou",
    });
    expect(workforceStatusBadge("cancelled")).toMatchObject({
      variant: "outline",
      label: "Cancelado",
    });
    expect(workforceStatusBadge("unknown")).toMatchObject({
      variant: "destructive",
      label: "Desconhecido",
    });
    // status fora do conjunto fechado cai no caso unknown
    expect(workforceStatusBadge("xyz")).toMatchObject({
      variant: "destructive",
      label: "Desconhecido",
    });
  });

  it("marca verificação verified como badge extra verde", () => {
    const verified = workforceStatusBadge("completed", "verified");
    expect(verified.verified).toBe(true);
    expect(verified.className).toContain("emerald");

    const unverified = workforceStatusBadge("completed", "unverified");
    expect(unverified.verified).toBe(false);
  });
});

describe("WorkforcePage — catálogo, execuções e modelos", () => {
  it("renderiza especialistas, execuções e templates com dados do bridge", async () => {
    render(<WorkforcePage />);

    await waitFor(() => {
      expect(screen.getAllByTestId("wf-agent-card").length).toBe(1);
    });
    expect(screen.getAllByText("Agente de Pesquisa").length).toBeGreaterThan(0);
    const card = screen.getByTestId("wf-agent-card");
    expect(card).toHaveTextContent("web_search");
    expect(card).toHaveTextContent("documents:read");
    expect(card).toHaveTextContent("Pesquisa na web e devolve relatório.");

    await waitFor(() => {
      expect(screen.getAllByTestId("wf-run-row").length).toBe(1);
    });
    expect(screen.getByText(/Mapear o mercado de agentes locais/)).toBeInTheDocument();
    expect(screen.getByText("Em execução")).toBeInTheDocument();

    const templatesSection = screen.getByTestId("wf-templates");
    expect(templatesSection).toHaveTextContent("Agente de Pesquisa");
    expect(templatesSection).toHaveTextContent("Criar a partir do modelo");
  });
});
