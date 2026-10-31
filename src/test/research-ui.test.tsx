import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { evidenceTypeBadge, learnAttemptBadge, researchStatusBadge } from "@/lib/research-ui";
import { ResearchPage } from "@/routes/research";
import type { ResearchProject } from "@/lib/bridge";

const project: ResearchProject = {
  id: "rs-1",
  question: "Quais as limitações do RAG híbrido?",
  scope_text: "Só fontes do Hub local",
  status: "running",
  plan: null,
  sources: [
    {
      id: "src-1",
      origin: "web",
      title: "Hybrid RAG survey",
      url: "https://exemplo.org/rag",
      domain: "exemplo.org",
      quality: "full",
      fetched_at: null,
    },
    {
      id: "src-2",
      origin: "hub",
      title: "Notas internas de busca",
      url: null,
      domain: null,
      quality: "snippet_only",
      fetched_at: null,
    },
  ],
  evidence: [
    {
      id: "ev-1",
      source_id: "src-1",
      quote: "O reranking reduziu o erro em 12%.",
      location: "p. 4",
      type: "direct",
    },
  ],
  claims: [
    {
      id: "cl-1",
      statement: "Reranking ajuda em consultas híbridas.",
      evidence_ids: ["ev-1"],
      status: "supported",
    },
  ],
  conflicts: [],
  reports: [{ id: "rep-1", version: 1, title: "Relatório", created_at: "2026-10-30T10:00:00Z" }],
  created_at: "2026-10-30T09:00:00Z",
  updated_at: "2026-10-30T10:00:00Z",
};

vi.mock("@/lib/bridge", () => ({
  listResearch: vi.fn(async () => ({ items: [project], has_more: false })),
  createResearch: vi.fn(async () => project),
  getResearch: vi.fn(async () => project),
  planResearch: vi.fn(async () => project),
  executeResearch: vi.fn(async () => project),
  deepenResearch: vi.fn(async () => project),
  getResearchReport: vi.fn(async () => ({
    version: 1,
    title: "Relatório",
    content: "# Resumo\nEvidências apoiam a tese [1].",
    citations: [
      {
        n: 1,
        source_id: "src-1",
        origin: "web",
        title: "Hybrid RAG survey",
        url: "https://exemplo.org/rag",
        domain: "exemplo.org",
      },
    ],
  })),
  ping: vi.fn(async () => true),
}));

describe("researchStatusBadge", () => {
  it("mapeia cada status para variante, cor e rótulo distintos", () => {
    // azul: running / planning
    for (const s of ["running", "planning"]) {
      const b = researchStatusBadge(s);
      expect(b.variant).toBe("secondary");
      expect(b.className).toContain("blue");
    }
    // verde: completed
    expect(researchStatusBadge("completed")).toMatchObject({
      variant: "secondary",
      label: "Concluído",
      className: expect.stringContaining("emerald"),
    });
    // amarelo: partial / inconclusive / waiting
    for (const s of ["partial", "inconclusive", "waiting"]) {
      const b = researchStatusBadge(s);
      expect(b.variant).toBe("secondary");
      expect(b.className).toContain("yellow");
    }
    // vermelho: failed / cancelled
    for (const s of ["failed", "cancelled"]) {
      expect(researchStatusBadge(s)).toMatchObject({ variant: "destructive" });
    }
    // unknown = destructive com anel
    expect(researchStatusBadge("unknown")).toMatchObject({
      variant: "destructive",
      label: "Desconhecido",
      className: expect.stringContaining("ring-2"),
    });
    // draft = cinza
    expect(researchStatusBadge("draft")).toMatchObject({ variant: "outline", label: "Rascunho" });
    // fora do conjunto cai no caso unknown
    expect(researchStatusBadge("xyz")).toMatchObject({
      variant: "destructive",
      label: "Desconhecido",
    });
  });

  it("aceita rótulos de outra língua via parâmetro", () => {
    expect(researchStatusBadge("running", { running: "Running" }).label).toBe("Running");
    expect(researchStatusBadge("running", {}).label).toBe("Desconhecido");
  });
});

describe("evidenceTypeBadge", () => {
  it("mapeia todos os tipos de evidência: direct verde, indirect azul, inference amarela, hypothesis cinza, gap vermelho", () => {
    expect(evidenceTypeBadge("direct")).toMatchObject({
      variant: "secondary",
      label: "Direta",
      className: expect.stringContaining("emerald"),
    });
    expect(evidenceTypeBadge("indirect")).toMatchObject({
      variant: "secondary",
      label: "Indireta",
      className: expect.stringContaining("blue"),
    });
    expect(evidenceTypeBadge("inference")).toMatchObject({
      variant: "secondary",
      label: "Inferência",
      className: expect.stringContaining("yellow"),
    });
    expect(evidenceTypeBadge("hypothesis")).toMatchObject({
      variant: "outline",
      label: "Hipótese",
      className: expect.stringContaining("muted"),
    });
    expect(evidenceTypeBadge("gap")).toMatchObject({ variant: "destructive", label: "Lacuna" });
    // tipo fora do conjunto volta com o valor bruto
    expect(evidenceTypeBadge("zap")).toMatchObject({ variant: "outline", label: "zap" });
  });

  it("aceita rótulos de outra língua via parâmetro", () => {
    expect(evidenceTypeBadge("direct", { direct: "Direct" }).label).toBe("Direct");
  });
});

describe("learnAttemptBadge", () => {
  it("mapeia o veredito tri-state: true verde, false vermelho, null amarelo (indeterminado)", () => {
    expect(learnAttemptBadge(true)).toMatchObject({
      variant: "secondary",
      label: "Correto",
      className: expect.stringContaining("emerald"),
    });
    expect(learnAttemptBadge(false)).toMatchObject({
      variant: "destructive",
      label: "Incorreto",
    });
    expect(learnAttemptBadge(null)).toMatchObject({
      variant: "secondary",
      label: "Indeterminado",
      className: expect.stringContaining("yellow"),
    });
    expect(learnAttemptBadge(true, { true: "Correct" }).label).toBe("Correct");
  });
});

describe("ResearchPage — lista, detalhe e relatório", () => {
  it("renderiza investigações com badge de status e, ao abrir, fontes/evidências/claims", async () => {
    render(<ResearchPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId("rs-row").length).toBe(1);
    });
    expect(screen.getByText(/limitações do RAG híbrido/)).toBeInTheDocument();
    expect(screen.getByText("Em execução")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Abrir"));
    await waitFor(() => {
      expect(screen.getByTestId("rs-detail")).toBeInTheDocument();
    });
    expect(screen.getByText(/Só fontes do Hub local/)).toBeInTheDocument();

    // fontes com origem web/hub e qualidade
    expect(screen.getAllByTestId("rs-source-row").length).toBe(2);
    expect(screen.getByText("Hybrid RAG survey")).toBeInTheDocument();
    expect(screen.getByText("Notas internas de busca")).toBeInTheDocument();

    // evidência verbatim com tipo
    expect(screen.getAllByTestId("rs-evidence-row").length).toBe(1);
    expect(screen.getByText(/reranking reduziu o erro em 12%/)).toBeInTheDocument();
    expect(screen.getByText("Direta")).toBeInTheDocument();

    // claim com status traduzido
    expect(screen.getAllByTestId("rs-claim-row").length).toBe(1);
    expect(screen.getByText("Sustentada")).toBeInTheDocument();

    // carrega o relatório: conteúdo + citação [n] com título/url/domínio
    fireEvent.click(screen.getByText("Carregar relatório"));
    await waitFor(() => {
      expect(screen.getByTestId("rs-report")).toBeInTheDocument();
    });
    expect(screen.getByText(/Evidências apoiam a tese/)).toBeInTheDocument();
    expect(screen.getByText(/^\[1\]/)).toBeInTheDocument();
    expect(screen.getAllByText(/Hybrid RAG survey/).length).toBeGreaterThan(0);
  });
});
