import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { describeNode, wfEffectBadge, wfRunStatusBadge } from "@/lib/workflow-ui";
import { WorkflowsPage } from "@/routes/workflows";
import type { WfDefinition, WfRun, WfRunSummary } from "@/lib/bridge";

const definition: WfDefinition = {
  id: "wf-def-1",
  name: "Diário de pesquisa",
  description: "Pesquisa o acervo e resume.",
  status: "published",
  current_version: 2,
  allowed_tools: ["document_search"],
  created_at: "2026-10-30T10:00:00Z",
  updated_at: "2026-10-30T10:05:00Z",
};

const runSummary: WfRunSummary = {
  id: "wf-run-1",
  definition_id: "wf-def-1",
  definition_version: 2,
  status: "running",
  objective: "Resumir as notas da semana",
  error_code: null,
  budget: { max_nodes: 50 },
  usage: { tool_calls: 2, model_calls: 1, estimated_tokens: 300 },
  created_at: "2026-10-30T11:00:00Z",
  started_at: "2026-10-30T11:00:01Z",
  finished_at: null,
};

const runDetail: WfRun = {
  ...runSummary,
  nodes: [
    {
      id: "ne-1",
      node_id: "start",
      node_type: "start",
      status: "completed",
      attempt: 1,
      output: { started: true },
      error_code: null,
      approval_id: null,
      agent_run_id: null,
      wake_at: null,
    },
    {
      id: "ne-2",
      node_id: "ask",
      node_type: "tool",
      status: "running",
      attempt: 1,
      output: null,
      error_code: null,
      approval_id: "ap-9",
      agent_run_id: null,
      wake_at: null,
    },
  ],
  events: [
    { id: 1, at: "2026-10-30T11:00:01Z", kind: "created", node_id: null, detail: {} },
    { id: 2, at: "2026-10-30T11:00:02Z", kind: "node_started", node_id: "ask", detail: {} },
  ],
};

vi.mock("@/lib/bridge", () => ({
  listWorkflows: vi.fn(async () => [definition]),
  listWorkflowRuns: vi.fn(async () => ({ items: [runSummary], has_more: false })),
  getWorkflowRun: vi.fn(async () => runDetail),
  listWorkflowVersions: vi.fn(async () => [
    {
      version: 2,
      created_at: "2026-10-30T10:05:00Z",
      graph: {
        nodes: [
          { id: "start", type: "start", config: {} },
          { id: "end", type: "end", config: {} },
        ],
        edges: [{ from: "start", to: "end" }],
      },
    },
  ]),
  createWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  deleteWorkflow: vi.fn(),
  publishWorkflow: vi.fn(),
  runWorkflow: vi.fn(),
  cancelWorkflowRun: vi.fn(),
  reconcileWorkflowRun: vi.fn(),
  ping: vi.fn(async () => true),
}));

describe("wfRunStatusBadge", () => {
  it("mapeia cada status do run para variante e rótulo distintos", () => {
    expect(wfRunStatusBadge("queued")).toMatchObject({ variant: "outline", label: "Na fila" });
    expect(wfRunStatusBadge("running")).toMatchObject({
      variant: "secondary",
      label: "Em execução",
      className: expect.stringContaining("blue"),
    });
    expect(wfRunStatusBadge("waiting_approval")).toMatchObject({
      variant: "secondary",
      label: "Aguardando aprovação",
      className: expect.stringContaining("yellow"),
    });
    expect(wfRunStatusBadge("waiting_dependency")).toMatchObject({
      variant: "secondary",
      label: "Aguardando dependência",
    });
    expect(wfRunStatusBadge("completed")).toMatchObject({
      variant: "secondary",
      label: "Concluído",
      className: expect.stringContaining("emerald"),
    });
    expect(wfRunStatusBadge("failed")).toMatchObject({ variant: "destructive", label: "Falhou" });
    expect(wfRunStatusBadge("cancelled")).toMatchObject({
      variant: "outline",
      label: "Cancelado",
      className: expect.stringContaining("muted"),
    });
    expect(wfRunStatusBadge("unknown")).toMatchObject({
      variant: "destructive",
      label: "Desconhecido",
      className: expect.stringContaining("ring-2"),
    });
    // status fora do conjunto fechado cai no caso unknown
    expect(wfRunStatusBadge("xyz")).toMatchObject({
      variant: "destructive",
      label: "Desconhecido",
    });
  });

  it("aceita rótulos de outra língua via parâmetro", () => {
    expect(wfRunStatusBadge("running", { running: "Running" }).label).toBe("Running");
    expect(wfRunStatusBadge("running", {}).label).toBe("Desconhecido");
  });
});

describe("wfEffectBadge", () => {
  it("mapeia efeitos de política: deny vermelho, require_approval amarelo, allow verde", () => {
    expect(wfEffectBadge("deny")).toMatchObject({
      variant: "destructive",
      label: "Negar",
    });
    expect(wfEffectBadge("require_approval")).toMatchObject({
      variant: "secondary",
      label: "Exigir aprovação",
      className: expect.stringContaining("yellow"),
    });
    expect(wfEffectBadge("allow")).toMatchObject({
      variant: "secondary",
      label: "Permitir",
      className: expect.stringContaining("emerald"),
    });
    // efeito desconhecido cai no caso neutro com o valor bruto
    expect(wfEffectBadge("zap")).toMatchObject({ variant: "outline", label: "zap" });
  });
});

describe("describeNode", () => {
  it("descreve cada tipo de nó de forma curta em português", () => {
    expect(describeNode("start", {})).toContain("Início");
    expect(describeNode("end", {})).toContain("Fim");
    expect(describeNode("agent", { definition_id: "a1", objective: "resumir" })).toContain("a1");
    expect(describeNode("agent", { definition_id: "a1", objective: "resumir" })).toContain(
      "resumir",
    );
    expect(describeNode("tool", { tool: "web_search" })).toContain("web_search");
    expect(describeNode("condition", { left: "x", op: "eq", right: "y" })).toContain("eq");
    expect(describeNode("transform", { op: "summary" })).toContain("summary");
    expect(describeNode("knowledge_search", { query: "tese" })).toContain("tese");
    expect(describeNode("approval", { description: "gastar" })).toContain("gastar");
    expect(describeNode("wait", { duration_ms: 5000 })).toContain("5000");
    expect(describeNode("wait", { until: "2026-11-01" })).toContain("2026-11-01");
    expect(describeNode("subworkflow", { definition_id: "sw" })).toContain("sw");
    expect(describeNode("alien", {})).toContain("desconhecido");
  });
});

describe("WorkflowsPage — definições e execuções", () => {
  it("renderiza workflows com status/versão e execuções com badge de status", async () => {
    render(<WorkflowsPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId("wf3-def-card").length).toBe(1);
    });
    const card = screen.getByTestId("wf3-def-card");
    expect(card).toHaveTextContent("Diário de pesquisa");
    expect(card).toHaveTextContent("Publicado");
    expect(card).toHaveTextContent("document_search");

    await waitFor(() => {
      expect(screen.getAllByTestId("wf3-run-row").length).toBe(1);
    });
    expect(screen.getByText(/Resumir as notas da semana/)).toBeInTheDocument();
    expect(screen.getByText("Em execução")).toBeInTheDocument();
    // Versão aparece no card da definição e na linha do run
    expect(screen.getAllByText(/Versão/).length).toBeGreaterThan(0);
  });
});
