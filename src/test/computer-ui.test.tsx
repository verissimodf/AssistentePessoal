import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ciStatusBadge, DEFAULT_CI_LABELS } from "@/lib/computer-ui";
import { ComputerPage } from "@/routes/computer";
import type { CiProcedure, CiSession, CiSessionSummary } from "@/lib/bridge";

// ---------- helpers puras (3 grupos de status) ----------

describe("ciStatusBadge — sessões", () => {
  it("mapeia active=verde, closed=cinza, failed=vermelho", () => {
    expect(ciStatusBadge("active")).toMatchObject({
      variant: "secondary",
      label: "Ativa",
      className: expect.stringContaining("emerald"),
    });
    expect(ciStatusBadge("closed")).toMatchObject({
      variant: "outline",
      label: "Encerrada",
      className: expect.stringContaining("muted"),
    });
    expect(ciStatusBadge("failed")).toMatchObject({ variant: "destructive", label: "Falhou" });
  });
});

describe("ciStatusBadge — ações de plano", () => {
  it("cobre os 9 status com cores distintas", () => {
    expect(ciStatusBadge("planned")).toMatchObject({ variant: "outline", label: "Planejada" });
    expect(ciStatusBadge("running")).toMatchObject({
      variant: "secondary",
      label: "Em execução",
      className: expect.stringContaining("blue"),
    });
    expect(ciStatusBadge("succeeded")).toMatchObject({
      variant: "secondary",
      label: "Bem-sucedida",
      className: expect.stringContaining("emerald"),
    });
    expect(ciStatusBadge("failed")).toMatchObject({ variant: "destructive", label: "Falhou" });
    expect(ciStatusBadge("verification_pending")).toMatchObject({
      variant: "secondary",
      label: "Aguardando aprovação",
      className: expect.stringContaining("yellow"),
    });
    expect(ciStatusBadge("unknown")).toMatchObject({
      variant: "destructive",
      label: "Desconhecida",
      className: expect.stringContaining("ring-2"),
    });
    expect(ciStatusBadge("reconciling")).toMatchObject({
      variant: "secondary",
      label: "Reconciliando",
      className: expect.stringContaining("yellow"),
    });
    expect(ciStatusBadge("cancelled")).toMatchObject({
      variant: "outline",
      label: "Cancelada",
      className: expect.stringContaining("muted"),
    });
    expect(ciStatusBadge("blocked")).toMatchObject({ variant: "destructive", label: "Bloqueada" });
  });
});

describe("ciStatusBadge — procedimentos", () => {
  it("mapeia observed=cinza, inferred=amarelo, tested=azul, validated=verde, deprecated=vermelho", () => {
    expect(ciStatusBadge("observed")).toMatchObject({
      variant: "outline",
      label: "Observado",
      className: expect.stringContaining("muted"),
    });
    expect(ciStatusBadge("inferred")).toMatchObject({
      variant: "secondary",
      label: "Inferido",
      className: expect.stringContaining("yellow"),
    });
    expect(ciStatusBadge("tested")).toMatchObject({
      variant: "secondary",
      label: "Testado",
      className: expect.stringContaining("blue"),
    });
    expect(ciStatusBadge("validated")).toMatchObject({
      variant: "secondary",
      label: "Validado",
      className: expect.stringContaining("emerald"),
    });
    expect(ciStatusBadge("deprecated")).toMatchObject({
      variant: "destructive",
      label: "Descontinuado",
    });
  });

  it("status fora do conjunto cai no caso neutro com o valor bruto; rótulos podem ser trocados", () => {
    expect(ciStatusBadge("zap")).toMatchObject({ variant: "outline", label: "zap" });
    expect(ciStatusBadge("active", { active: "Active" }).label).toBe("Active");
    expect(ciStatusBadge("active", {}).label).toBe("active");
    expect(Object.keys(DEFAULT_CI_LABELS).length).toBe(16); // 3 sessões + 8 ações + 5 procedimentos ("failed" é compartilhado)
  });
});

// ---------- render da página (bridge mockado) ----------

const session: CiSessionSummary = {
  id: "ci-1",
  environment: "browser",
  objective: "Abrir o painel de status",
  status: "active",
  created_at: "2026-10-30T10:00:00Z",
  closed_at: null,
};

const sessionDetail: CiSession = {
  ...session,
  config: { allowedHosts: [] },
  usage: { tool_calls: 3 },
  plans: [
    {
      id: "plan-1",
      objective: "Abrir o painel de status",
      status: "planned",
      observation_id: "obs-1",
      created_at: "2026-10-30T10:01:00Z",
      steps: [],
    },
  ],
  observations: [
    {
      id: "obs-1",
      kind: "screenshot+extract",
      observation_hash: "abcd1234abcd1234abcd1234abcd1234",
      dims: { width: 1280, height: 720 },
      artifact_path: null,
      created_at: "2026-10-30T10:00:30Z",
    },
  ],
};

const procedure: CiProcedure = {
  id: "proc-1",
  name: "Abrir painel de status",
  goal: "Chegar à página de status",
  status: "tested",
  version: 2,
  success_count: 3,
  fail_count: 0,
  steps: [
    {
      action: "navigate",
      target: { url: "https://exemplo.dev" },
      expected: {},
      why: "ponto de partida",
    },
  ],
  last_used_at: "2026-10-30T09:00:00Z",
};

vi.mock("@/lib/bridge", () => ({
  listCiSessions: vi.fn(async () => [session]),
  listCiProcedures: vi.fn(async () => [procedure]),
  openCiSession: vi.fn(),
  getCiSession: vi.fn(async () => sessionDetail),
  closeCiSession: vi.fn(),
  observeCiSession: vi.fn(),
  planCiSession: vi.fn(),
  executeCiPlan: vi.fn(),
  createCiProcedure: vi.fn(),
  reuseCiProcedure: vi.fn(),
  ping: vi.fn(async () => true),
}));

describe("ComputerPage — sessões e procedimentos", () => {
  it("renderiza sessões com badge de status e procedimentos com contadores", async () => {
    render(<ComputerPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId("ci-session-row").length).toBe(1);
    });
    expect(screen.getByText(/Abrir o painel de status/)).toBeInTheDocument();
    expect(screen.getByText("Ativa")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByTestId("ci-procedure-row").length).toBe(1);
    });
    const card = screen.getByTestId("ci-procedure-row");
    expect(card).toHaveTextContent("Abrir painel de status");
    expect(card).toHaveTextContent("Testado");
    expect(card).toHaveTextContent("3 sucessos");
    expect(card).toHaveTextContent("0 falhas");

    // Expande o detalhe da sessão (carrega observações/planos do servidor mockado)
    fireEvent.click(screen.getByRole("button", { name: "+" }));
    await waitFor(() => {
      expect(screen.getByText(/abcd1234/)).toBeInTheDocument(); // hash da observação persistida
    });

    // Nota D9 e botões da sessão presentes
    expect(screen.getByText(/aprovação humana D9/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Aprovações/ })).toHaveAttribute("href", "/approvals");
    expect(screen.getByRole("button", { name: /Observar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Planejar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Encerrar sessão/ })).toBeInTheDocument();
  });
});
