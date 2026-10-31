import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { khStatusBadge } from "@/lib/knowledge-ui";
import { KnowledgePage } from "@/routes/knowledge";
import type { KhLibrary, KhNotebook, KhSource } from "@/lib/bridge";

const library: KhLibrary = {
  id: "kh-lib-1",
  name: "Tese de doutorado",
  kind: "project",
  description: "Material de referência do projeto.",
};

const notebook: KhNotebook = {
  id: "kh-nb-1",
  library_id: "kh-lib-1",
  name: "Capítulos",
  description: "Rascunhos dos capítulos.",
  tags: ["tese"],
  source_count: 1,
};

const source: KhSource = {
  id: "kh-src-1",
  notebook_id: "kh-nb-1",
  type: "text",
  title: "Introdução",
  description: null,
  origin: "ui",
  content_hash: "abc123",
  size: 120,
  mime: null,
  version: 1,
  ingest_status: "indexed",
  index_status: "indexed",
  error_code: null,
  provenance: null,
  has_document: true,
  versions: [],
  created_at: "2026-10-30T10:00:00Z",
  updated_at: "2026-10-30T10:00:00Z",
};

vi.mock("@/lib/bridge", () => ({
  listKhLibraries: vi.fn(async () => [library]),
  createKhLibrary: vi.fn(async () => library),
  updateKhLibrary: vi.fn(async () => library),
  deleteKhLibrary: vi.fn(async () => ({ ok: true })),
  listKhNotebooks: vi.fn(async () => [notebook]),
  createKhNotebook: vi.fn(async () => notebook),
  deleteKhNotebook: vi.fn(async () => ({ ok: true })),
  listKhSources: vi.fn(async () => ({ items: [source], has_more: false })),
  createKhSourceText: vi.fn(async () => source),
  createKhSourceUrl: vi.fn(async () => source),
  createKhSourceFile: vi.fn(async () => source),
  deleteKhSource: vi.fn(async () => ({ ok: true })),
  khSearch: vi.fn(async () => ({ items: [], modes: { fts: true, rag: false } })),
  khAsk: vi.fn(async () => ({ answer: "", citations: [], sufficient: true })),
  khTransform: vi.fn(async () => ({
    id: "kh-tr-1",
    op: "summary",
    result: "",
    citations: [],
    sources: [],
    created_at: "2026-10-30T10:00:00Z",
  })),
  ping: vi.fn(async () => true),
}));

describe("khStatusBadge", () => {
  it("mapeia os 6 estados de ingest_status para variante, cor e rótulo", () => {
    // amarelo: pending / processing / partial
    for (const s of ["pending", "processing", "partial"]) {
      const b = khStatusBadge(s);
      expect(b.variant).toBe("secondary");
      expect(b.className).toContain("yellow");
    }
    // verde: indexed
    expect(khStatusBadge("indexed")).toMatchObject({
      variant: "secondary",
      className: expect.stringContaining("emerald"),
      label: "Indexado",
    });
    // vermelho: failed
    expect(khStatusBadge("failed")).toMatchObject({ variant: "destructive", label: "Falhou" });
    // cinza: deleted
    expect(khStatusBadge("deleted")).toMatchObject({
      variant: "outline",
      className: expect.stringContaining("muted"),
      label: "Excluída",
    });
    expect(khStatusBadge("pending").label).toBe("Pendente");
    expect(khStatusBadge("processing").label).toBe("Processando");
  });

  it("aceita rótulos externos (i18n) e cai no status desconhecido sem falhar", () => {
    const b = khStatusBadge("indexed", { indexed: "Indexed" });
    expect(b.label).toBe("Indexed");
    const fallback = khStatusBadge("xyz");
    expect(fallback.variant).toBe("outline");
    expect(fallback.label).toBe("xyz");
  });
});

describe("KnowledgePage — bibliotecas, notebooks e fontes", () => {
  it("renderiza biblioteca, notebook e fontes com dados do bridge", async () => {
    render(<KnowledgePage />);

    await waitFor(() => {
      expect(screen.getAllByTestId("kh-lib-card").length).toBe(1);
    });
    expect(screen.getByText("Tese de doutorado")).toBeInTheDocument();
    // badge do cartão + option do select compartilham o rótulo
    expect(screen.getAllByText("Projeto").length).toBeGreaterThan(0);

    // selecionar a biblioteca carrega os notebooks dela
    fireEvent.click(screen.getByText("Tese de doutorado"));
    await waitFor(() => {
      expect(screen.getAllByTestId("kh-notebook-row").length).toBe(1);
    });
    expect(screen.getByText("Capítulos")).toBeInTheDocument();

    // selecionar o notebook carrega as fontes dele
    fireEvent.click(screen.getByText("Capítulos"));
    await waitFor(() => {
      expect(screen.getAllByTestId("kh-source-row").length).toBe(1);
    });
    // título da fonte aparece na lista e no checkbox de transformações
    expect(screen.getAllByText("Introdução").length).toBeGreaterThan(0);
    expect(screen.getByText("Indexado")).toBeInTheDocument();
    expect(screen.getByText(/Índice: indexed/)).toBeInTheDocument();
  });
});
