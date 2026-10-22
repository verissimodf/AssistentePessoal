import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import {
  FileText,
  Trash2,
  Upload,
  Layers,
  Search,
  AlertCircle,
  CheckCircle2,
  FileCode,
  Loader2,
  Eye,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { api, type Doc, type DocChunk, reindexDocument } from "@/lib/bridge";

export const Route = createFileRoute("/documentos")({
  head: () => ({
    meta: [
      { title: "Documentos — Jarvis" },
      {
        name: "description",
        content:
          "Documentos multiformato privados (TXT, MD, CSV, PDF, DOCX) com RAG Semântico Híbrido.",
      },
      { property: "og:title", content: "Documentos — Jarvis" },
      {
        property: "og:description",
        content: "Gestão documental privada com RAG semântico híbrido e chunks em memória.",
      },
    ],
  }),
  component: DocumentsPage,
});

const EXT_TO_MIME: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function parseDocError(err: unknown): string {
  const raw = String((err as any)?.message || err || "");
  if (raw.includes("pdf_no_text_layer")) {
    return "O arquivo PDF é escaneado ou uma imagem sem camada de texto pesquisável.";
  }
  if (raw.includes("docx_no_text_content")) {
    return "O arquivo DOCX não contém texto pesquisável legível.";
  }
  if (raw.includes("document_too_large")) {
    return "O arquivo excede o limite permitido (máximo 10 MB para PDF/DOCX ou 2 MB para texto).";
  }
  if (raw.includes("unsupported_type")) {
    return "Formato de arquivo não suportado. Aceitos: .txt, .md, .csv, .json, .pdf e .docx.";
  }
  if (raw.includes("empty_document")) {
    return "O documento está vazio.";
  }
  if (raw.includes("binary_not_allowed")) {
    return "Arquivo de texto contém bytes binários não permitidos.";
  }
  return raw;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const b64 = res.includes(",") ? res.split(",")[1] : res;
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function RagBadge({ status }: { status?: string }) {
  if (status === "hybrid") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/40 bg-emerald-500/15 text-emerald-400 font-normal text-xs"
        data-testid="badge-rag-hybrid"
      >
        RAG Semântico Ativo
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-500/40 bg-amber-500/15 text-amber-400 font-normal text-xs"
      data-testid="badge-rag-lexical"
    >
      Busca Lexical / Offline
    </Badge>
  );
}

export function DocumentsPage() {
  const [items, setItems] = useState<Doc[]>([]);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [selectedDoc, setSelectedDoc] = useState<Doc | null>(null);
  const [chunks, setChunks] = useState<DocChunk[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);

  const [viewingDoc, setViewingDoc] = useState<{ name: string; content: string } | null>(null);
  const [loadingView, setLoadingView] = useState(false);
  const [reindexingId, setReindexingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => {
    api<Doc[]>("/api/documents")
      .then((docs) => setItems(docs || []))
      .catch((e) => setError(parseDocError(e)));
  };

  const handleReindex = async (docId: string) => {
    setReindexingId(docId);
    setError("");
    setMsg("");
    try {
      const res = await reindexDocument(docId);
      if (res && res.ok) {
        setMsg(
          `Documento reindexado com sucesso para RAG Semântico (${res.vectorizedChunks || 0} blocos vetorizados).`
        );
        refresh();
      } else {
        setError(
          res?.reason === "embedding_provider_unavailable"
            ? "Provedor de embeddings indisponível no momento. Verifique as configurações de IA."
            : "Falha ao gerar embeddings para o documento."
        );
      }
    } catch (e) {
      setError(parseDocError(e));
    } finally {
      setReindexingId(null);
    }
  };


  useEffect(() => {
    refresh();
  }, []);

  const handleFileUpload = async (file?: File) => {
    if (!file) return;
    setMsg("");
    setError("");
    setLoading(true);

    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const mime = EXT_TO_MIME[ext] || file.type || "text/plain";
      const isBinary = ext === "pdf" || ext === "docx";

      if (isBinary) {
        const base64Content = await toBase64(file);
        await api("/api/documents", {
          method: "POST",
          body: JSON.stringify({
            name: file.name,
            mime,
            content: base64Content,
            encoding: "base64",
          }),
        });
      } else {
        const textContent = await file.text();
        await api("/api/documents", {
          method: "POST",
          body: JSON.stringify({
            name: file.name,
            mime,
            content: textContent,
            encoding: "utf8",
          }),
        });
      }

      setMsg(`Documento carregado e indexado: ${file.name}`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      refresh();
    } catch (e) {
      setError(parseDocError(e));
    } finally {
      setLoading(false);
    }
  };

  const handleManualSave = async () => {
    if (!name.trim() || !content.trim()) return;
    setMsg("");
    setError("");
    setLoading(true);

    try {
      const ext = name.split(".").pop()?.toLowerCase() || "txt";
      const mime = EXT_TO_MIME[ext] || "text/plain";
      await api("/api/documents", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          mime,
          content,
          encoding: "utf8",
        }),
      });
      setMsg(`Salvo e indexado: ${name.trim()}`);
      setName("");
      setContent("");
      refresh();
    } catch (e) {
      setError(parseDocError(e));
    } finally {
      setLoading(false);
    }
  };

  const search = async () => {
    if (!q.trim()) return refresh();
    try {
      const r = await api<
        { id: string; name: string; snippet: string; chunk_count?: number; rag_status?: string }[]
      >(`/api/documents/search?q=${encodeURIComponent(q)}`);
      setItems(
        r.map((x) => ({
          id: x.id,
          name: x.name,
          mime: "text/plain",
          size: 0,
          created_at: "",
          chunk_count: x.chunk_count,
          rag_status: x.rag_status,
        })),
      );
    } catch (e) {
      setError(parseDocError(e));
    }
  };

  const inspectChunks = async (doc: Doc) => {
    setSelectedDoc(doc);
    setLoadingChunks(true);
    setChunks([]);
    try {
      const data = await api<DocChunk[]>(`/api/documents/${doc.id}/chunks`);
      setChunks(data || []);
    } catch (e) {
      setError(parseDocError(e));
    } finally {
      setLoadingChunks(false);
    }
  };

  const viewDocumentContent = async (id: string) => {
    setLoadingView(true);
    try {
      const d = await api<{ name: string; content: string }>(`/api/documents/${id}`);
      setViewingDoc({ name: d.name, content: d.content || "" });
    } catch (e) {
      setError(parseDocError(e));
    } finally {
      setLoadingView(false);
    }
  };

  const del = async (id: string) => {
    try {
      await api(`/api/documents/${id}`, { method: "DELETE" });
      setMsg("Documento excluído.");
      refresh();
    } catch (e) {
      setError(parseDocError(e));
    }
  };

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader
        title="Documentos"
        sub="Base de conhecimento privada e local. Suporte a PDF, DOCX, TXT, MD, CSV e JSON com RAG Semântico Híbrido."
      >
        <div className="flex items-center gap-2">
          <Input
            placeholder="Buscar por termo ou conceito..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            className="w-64"
            data-testid="input-search"
          />
          <Button variant="secondary" size="icon" onClick={() => search()} title="Buscar">
            <Search className="h-4 w-4" />
          </Button>
        </div>
      </PageHeader>

      {/* Painel de Upload e Criação */}
      <div className="hud-panel mb-6 flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex-1">
            <Input
              placeholder="Nome do arquivo (ex.: manual.txt, contrato.pdf)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-doc-name"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              id="file-upload"
              data-testid="file-upload-input"
              accept=".txt,.md,.csv,.json,.pdf,.docx,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="text-xs file:mr-2 file:rounded-md file:border-0 file:bg-primary/20 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-primary/30"
              onChange={(e) => handleFileUpload(e.target.files?.[0])}
              disabled={loading}
            />
            <Button
              onClick={handleManualSave}
              disabled={loading || !name.trim() || !content.trim()}
              data-testid="btn-save-manual"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Salvar Manual
            </Button>
          </div>
        </div>

        <textarea
          className="min-h-20 rounded-md border bg-background/50 p-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Ou digite/cole o conteúdo em texto plano aqui..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          data-testid="textarea-content"
        />

        {msg && (
          <div
            className="flex items-center gap-2 rounded bg-emerald-500/10 p-2.5 text-xs text-emerald-400 border border-emerald-500/20"
            data-testid="msg-success"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{msg}</span>
          </div>
        )}

        {error && (
          <div
            className="flex items-center gap-2 rounded bg-destructive/10 p-2.5 text-xs text-destructive border border-destructive/20"
            data-testid="msg-error"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Listagem de Documentos */}
      <div className="space-y-2.5">
        {items.map((d) => (
          <div
            key={d.id}
            data-testid={`doc-row-${d.id}`}
            className="hud-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-3">
              <button
                className="mt-0.5 rounded p-1 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => viewDocumentContent(d.id)}
                title="Visualizar texto extraído"
                data-testid={`btn-view-${d.id}`}
              >
                <FileText className="h-5 w-5 text-primary" />
              </button>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground text-sm">{d.name}</span>
                  <RagBadge status={d.rag_status} />
                  <span
                    className="text-xs text-muted-foreground"
                    data-testid={`chunk-count-${d.id}`}
                  >
                    {d.chunk_count !== undefined ? `${d.chunk_count} blocos` : "1 bloco"}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatBytes(d.size)}</span>
                  {d.created_at && (
                    <span>• {new Date(d.created_at).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              {(d.rag_status === "lexical_only" || d.rag_status === "lexical") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-amber-400 border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-300"
                  onClick={() => handleReindex(d.id)}
                  disabled={reindexingId === d.id}
                  data-testid={`btn-reindex-${d.id}`}
                  title="Gerar embeddings vetoriais para este documento"
                >
                  {reindexingId === d.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  <span>Vetorizar RAG</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => inspectChunks(d)}
                data-testid={`btn-chunks-${d.id}`}
                title="Inspecionar blocos de RAG"
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Chunks</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={() => del(d.id)}
                data-testid={`btn-del-${d.id}`}
                title="Excluir documento"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}

        {items.length === 0 && (
          <div className="hud-panel p-8 text-center text-sm text-muted-foreground">
            <FileCode className="mx-auto mb-2 h-8 w-8 opacity-40" />
            <p>Nenhum documento cadastrado.</p>
            <p className="mt-1 text-xs">
              Envie arquivos PDF, DOCX, TXT, MD, CSV ou cole textos manuais para habilitar a busca RAG híbrida.
            </p>
          </div>
        )}
      </div>

      {/* Modal / Dialog de Inspeção de Chunks */}
      <Dialog open={!!selectedDoc} onOpenChange={(open) => !open && setSelectedDoc(null)}>
        <DialogContent
          className="max-w-2xl max-h-[85vh] flex flex-col"
          data-testid="dialog-chunks"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Layers className="h-5 w-5 text-primary" />
              <span>Chunks — {selectedDoc?.name}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {selectedDoc?.chunk_count ?? chunks.length} blocos indexados •{" "}
              {selectedDoc?.rag_status === "hybrid"
                ? "RAG Semântico Híbrido (Embeddings + Lexical)"
                : "Busca Lexical / Offline (sem embeddings)"}
            </DialogDescription>
          </DialogHeader>

          {loadingChunks ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-xs text-muted-foreground">Carregando chunks...</span>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[55vh]">
              {chunks.map((c) => (
                <div
                  key={c.id || c.chunk_index}
                  data-testid={`chunk-item-${c.chunk_index}`}
                  className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs"
                >
                  <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground border-b border-border/40 pb-1.5">
                    <span className="font-medium text-foreground">
                      Bloco #{c.chunk_index + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <span>~{c.token_estimate} tokens</span>
                      <span className="text-border">•</span>
                      <span
                        className={
                          c.has_embedding ? "text-emerald-400" : "text-amber-400"
                        }
                      >
                        {c.has_embedding ? "Vetor Ativo" : "Sem Vetor"}
                      </span>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground/90">
                    {c.content}
                  </p>
                </div>
              ))}
              {chunks.length === 0 && (
                <p className="text-center py-6 text-xs text-muted-foreground">
                  Nenhum chunk gerado para este documento.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal / Dialog de Visualização de Conteúdo */}
      <Dialog open={!!viewingDoc} onOpenChange={(open) => !open && setViewingDoc(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5 text-primary" />
              <span>{viewingDoc?.name}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Conteúdo extraído em memória e salvo localmente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto p-2 max-h-[55vh]">
            <pre className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
              {viewingDoc?.content}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
