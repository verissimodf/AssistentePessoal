import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DocumentsPage, parseDocError, RagBadge } from "@/routes/documentos";

const mockApi = vi.fn();
const mockReindexDocument = vi.fn();
const mockReindexAllPendingDocuments = vi.fn();
vi.mock("@/lib/bridge", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/bridge")>();
  return {
    ...original,
    api: (...args: unknown[]) => mockApi(...args),
    reindexDocument: (...args: unknown[]) => mockReindexDocument(...args),
    reindexAllPendingDocuments: (...args: unknown[]) => mockReindexAllPendingDocuments(...args),
    ping: () => Promise.resolve(true),
    useAuthState: () => "ok",
    useBridgeStatus: () => true,
  };
});

describe("DocumentsPage — RAG Semântico Híbrido & Ingestão Multiformato", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("parseDocError", () => {
    it("converte erro pdf_no_text_layer para mensagem amigável de PDF escaneado", () => {
      const err = new Error('422: {"error":"pdf_no_text_layer"}');
      expect(parseDocError(err)).toBe(
        "O arquivo PDF é escaneado ou uma imagem sem camada de texto pesquisável.",
      );
    });

    it("converte erro docx_no_text_content para mensagem amigável de DOCX sem texto", () => {
      const err = new Error('422: {"error":"docx_no_text_content"}');
      expect(parseDocError(err)).toBe("O arquivo DOCX não contém texto pesquisável legível.");
    });

    it("converte erro document_too_large para mensagem amigável de limite de tamanho", () => {
      const err = new Error('413: {"error":"document_too_large"}');
      expect(parseDocError(err)).toBe(
        "O arquivo excede o limite permitido (máximo 10 MB para PDF/DOCX ou 2 MB para texto).",
      );
    });

    it("converte erro unsupported_type para mensagem de formatos aceitos", () => {
      const err = new Error('415: {"error":"unsupported_type"}');
      expect(parseDocError(err)).toBe(
        "Formato de arquivo não suportado. Aceitos: .txt, .md, .csv, .json, .pdf e .docx.",
      );
    });
  });

  describe("RagBadge Component", () => {
    it("renderiza badge RAG Semântico Ativo para status hybrid", () => {
      render(<RagBadge status="hybrid" />);
      expect(screen.getByText("RAG Semântico Ativo")).toBeInTheDocument();
      expect(screen.getByTestId("badge-rag-hybrid")).toBeInTheDocument();
    });

    it("renderiza badge Busca Lexical / Offline para status lexical_only ou indefinido", () => {
      render(<RagBadge status="lexical_only" />);
      expect(screen.getByText("Busca Lexical / Offline")).toBeInTheDocument();
      expect(screen.getByTestId("badge-rag-lexical")).toBeInTheDocument();
    });
  });

  describe("Listagem de Documentos e Metadados RAG", () => {
    it("exibe lista de documentos com contagem de chunks e status RAG", async () => {
      mockApi.mockImplementation(async (path: string) => {
        if (path === "/api/documents") {
          return [
            {
              id: "doc-1",
              name: "relatorio_ia.pdf",
              mime: "application/pdf",
              size: 15420,
              created_at: "2026-10-21T18:00:00Z",
              chunk_count: 8,
              rag_status: "hybrid",
            },
            {
              id: "doc-2",
              name: "notas_offline.txt",
              mime: "text/plain",
              size: 2048,
              created_at: "2026-10-21T18:05:00Z",
              chunk_count: 2,
              rag_status: "lexical_only",
            },
          ];
        }
        return [];
      });

      render(<DocumentsPage />);

      await waitFor(() => {
        expect(screen.getByText("relatorio_ia.pdf")).toBeInTheDocument();
        expect(screen.getByText("notas_offline.txt")).toBeInTheDocument();
      });

      // Indicadores RAG e Chunk Count
      expect(screen.getByText("8 blocos")).toBeInTheDocument();
      expect(screen.getByText("RAG Semântico Ativo")).toBeInTheDocument();

      expect(screen.getByText("2 blocos")).toBeInTheDocument();
      expect(screen.getByText("Busca Lexical / Offline")).toBeInTheDocument();
    });
  });

  describe("Inspetor de Chunks (Modal)", () => {
    it("abre o modal de chunks e exibe a lista ao clicar em Chunks", async () => {
      mockApi.mockImplementation(async (path: string) => {
        if (path === "/api/documents") {
          return [
            {
              id: "doc-abc",
              name: "especificacao.docx",
              mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              size: 4096,
              created_at: "2026-10-21T18:00:00Z",
              chunk_count: 2,
              rag_status: "hybrid",
            },
          ];
        }
        if (path === "/api/documents/doc-abc/chunks") {
          return [
            {
              id: "chunk-1",
              document_id: "doc-abc",
              chunk_index: 0,
              content: "Primeiro parágrafo da especificação técnica.",
              token_estimate: 12,
              has_embedding: 1,
              embedding_model: "embeddings",
            },
            {
              id: "chunk-2",
              document_id: "doc-abc",
              chunk_index: 1,
              content: "Segundo parágrafo detalhando arquitetura RAG.",
              token_estimate: 14,
              has_embedding: 1,
              embedding_model: "embeddings",
            },
          ];
        }
        return [];
      });

      render(<DocumentsPage />);

      await waitFor(() => {
        expect(screen.getByText("especificacao.docx")).toBeInTheDocument();
      });

      const chunksBtn = screen.getByTestId("btn-chunks-doc-abc");
      fireEvent.click(chunksBtn);

      await waitFor(() => {
        expect(screen.getByTestId("dialog-chunks")).toBeInTheDocument();
        expect(screen.getByText("Chunks — especificacao.docx")).toBeInTheDocument();
        expect(screen.getByText("Bloco #1")).toBeInTheDocument();
        expect(
          screen.getByText("Primeiro parágrafo da especificação técnica."),
        ).toBeInTheDocument();
        expect(screen.getByText("Bloco #2")).toBeInTheDocument();
        expect(
          screen.getByText("Segundo parágrafo detalhando arquitetura RAG."),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Tratamento de Erros e Mensagens Amigáveis", () => {
    it("exibe alerta amigável quando API retorna 422 pdf_no_text_layer no upload manual", async () => {
      mockApi.mockImplementation(async (path: string, options?: any) => {
        if (path === "/api/documents" && options?.method === "POST") {
          throw new Error('422: {"error":"pdf_no_text_layer"}');
        }
        if (path === "/api/documents") return [];
        return [];
      });

      render(<DocumentsPage />);

      const nameInput = screen.getByTestId("input-doc-name");
      const contentTextarea = screen.getByTestId("textarea-content");
      const saveBtn = screen.getByTestId("btn-save-manual");

      fireEvent.change(nameInput, { target: { value: "scan.pdf" } });
      fireEvent.change(contentTextarea, { target: { value: "conteúdo" } });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByTestId("msg-error")).toBeInTheDocument();
        expect(
          screen.getByText(
            "O arquivo PDF é escaneado ou uma imagem sem camada de texto pesquisável.",
          ),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Reindexação Vetorial Sob Demanda (Vetorizar RAG)", () => {
    it("exibe botão Vetorizar RAG em documentos lexical_only e promove para hybrid ao clicar", async () => {
      let isHybrid = false;
      mockApi.mockImplementation(async (path: string) => {
        if (path === "/api/documents") {
          return [
            {
              id: "doc-offline",
              name: "guia_servidores.txt",
              mime: "text/plain",
              size: 1024,
              created_at: "2026-10-22T04:00:00Z",
              chunk_count: 3,
              rag_status: isHybrid ? "hybrid" : "lexical_only",
            },
          ];
        }
        return [];
      });

      mockReindexDocument.mockImplementation(async (id: string) => {
        isHybrid = true;
        return { ok: true, id, rag_status: "hybrid", vectorizedChunks: 3 };
      });

      render(<DocumentsPage />);

      await waitFor(() => {
        expect(screen.getByText("guia_servidores.txt")).toBeInTheDocument();
      });

      const reindexBtn = screen.getByTestId("btn-reindex-doc-offline");
      expect(reindexBtn).toBeInTheDocument();
      expect(screen.getByText("Vetorizar RAG")).toBeInTheDocument();

      fireEvent.click(reindexBtn);

      await waitFor(() => {
        expect(screen.getByText("RAG Semântico Ativo")).toBeInTheDocument();
      });
    });

    it("exibe banner e botão para sincronizar todos os vetores pendentes em lote", async () => {
      let allUpgraded = false;
      mockApi.mockImplementation(async (path: string) => {
        if (path === "/api/documents") {
          return [
            {
              id: "doc-pending-1",
              name: "manual_infra.pdf",
              mime: "application/pdf",
              size: 2048,
              created_at: "2026-10-22T04:10:00Z",
              chunk_count: 5,
              rag_status: allUpgraded ? "hybrid" : "lexical_only",
            },
            {
              id: "doc-pending-2",
              name: "regras_negocio.docx",
              mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              size: 4096,
              created_at: "2026-10-22T04:15:00Z",
              chunk_count: 8,
              rag_status: allUpgraded ? "hybrid" : "lexical_only",
            },
          ];
        }
        return [];
      });

      mockReindexAllPendingDocuments.mockImplementation(async () => {
        allUpgraded = true;
        return { ok: true, processed: 2, upgraded: 2, ids: ["doc-pending-1", "doc-pending-2"] };
      });

      render(<DocumentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId("banner-reindex-pending")).toBeInTheDocument();
        expect(screen.getByTestId("btn-reindex-all")).toBeInTheDocument();
      });

      expect(screen.getByText("Sincronizar Todos os Vetores Pendentes (2)")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("btn-reindex-all"));

      await waitFor(() => {
        expect(mockReindexAllPendingDocuments).toHaveBeenCalledTimes(1);
      });
    });
  });
});
