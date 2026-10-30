import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText, Globe, Plus, Trash2, Type } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createKhLibrary,
  createKhNotebook,
  createKhSourceFile,
  createKhSourceText,
  createKhSourceUrl,
  deleteKhLibrary,
  deleteKhNotebook,
  deleteKhSource,
  khAsk,
  khSearch,
  khTransform,
  listKhLibraries,
  listKhNotebooks,
  listKhSources,
  ping,
  type KhAskResponse,
  type KhLibrary,
  type KhLibraryKind,
  type KhNotebook,
  type KhSearchItem,
  type KhSource,
  type KhTransformOp,
  type KhTransformResult,
} from "@/lib/bridge";
import { khStatusBadge } from "@/lib/knowledge-ui";
import { useI18n, type TKey } from "@/lib/i18n";

export const Route = createFileRoute("/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Hub — Jarvis" },
      {
        name: "description",
        content: "Bibliotecas, notebooks e fontes com pesquisa, perguntas e transformações.",
      },
      { property: "og:title", content: "Knowledge Hub — Jarvis" },
      { property: "og:description", content: "Acervo pessoal de conhecimento local do Jarvis." },
    ],
  }),
  component: KnowledgePage,
});

const KH_OPS: KhTransformOp[] = ["summary", "topics", "concepts", "compare", "synthesize"];

// O servidor responde 409 {error:"kh_duplicate"} para conteúdo já ingerido; api() embute
// o corpo na mensagem do Error, então detectamos pela presença do código.
const isDuplicate = (e: unknown): boolean =>
  String((e as Error)?.message ?? "").includes("kh_duplicate");

const KH_OP_LABEL_KEY: Record<KhTransformOp, TKey> = {
  summary: "kh_op_summary",
  topics: "kh_op_topics",
  concepts: "kh_op_concepts",
  compare: "kh_op_compare",
  synthesize: "kh_op_synthesize",
};

export function KnowledgePage() {
  const { t } = useI18n();
  const [libs, setLibs] = useState<KhLibrary[] | null>(null);
  const [libId, setLibId] = useState<string>("");
  const [libName, setLibName] = useState("");
  const [libDesc, setLibDesc] = useState("");
  const [libKind, setLibKind] = useState<KhLibraryKind>("personal");
  const [notebooks, setNotebooks] = useState<KhNotebook[] | null>(null);
  const [nbId, setNbId] = useState<string>("");
  const [nbName, setNbName] = useState("");
  const [nbDesc, setNbDesc] = useState("");
  const [nbTags, setNbTags] = useState("");
  const [sources, setSources] = useState<KhSource[] | null>(null);
  const [srcTab, setSrcTab] = useState<"text" | "url" | "file">("text");
  const [srcTitle, setSrcTitle] = useState("");
  const [srcText, setSrcText] = useState("");
  const [srcUrl, setSrcUrl] = useState("");
  const [srcFile, setSrcFile] = useState<File | null>(null);
  const [scope, setScope] = useState<"notebook" | "library">("notebook");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KhSearchItem[] | null>(null);
  const [openResult, setOpenResult] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [ask, setAsk] = useState<KhAskResponse | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [op, setOp] = useState<KhTransformOp>("summary");
  const [prompt, setPrompt] = useState("");
  const [transform, setTransform] = useState<KhTransformResult | null>(null);

  const ingestLabels: Record<string, string> = {
    pending: t("kh_status_pending"),
    processing: t("kh_status_processing"),
    indexed: t("kh_status_indexed"),
    partial: t("kh_status_partial"),
    failed: t("kh_status_failed"),
    deleted: t("kh_status_deleted"),
  };

  const refreshLibs = () => listKhLibraries().then((d) => setLibs(d ?? []));
  const refreshNotebooks = (id: string) =>
    (id ? listKhNotebooks(id) : Promise.resolve([])).then((d) => setNotebooks(d ?? []));
  const refreshSources = (id: string) =>
    (id ? listKhSources(id) : Promise.resolve(null)).then((d) => setSources(d?.items ?? []));

  useEffect(() => {
    refreshLibs().catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshNotebooks(libId).catch(() => undefined);
    setNbId("");
  }, [libId]);

  useEffect(() => {
    refreshSources(nbId).catch(() => undefined);
    setPicked([]);
  }, [nbId]);

  const gated = async () => {
    if (await ping()) return true;
    toast.info(t("demo_hint"));
    return false;
  };

  const kindLabel = (kind: string): string =>
    kind === "project" ? t("kh_kind_project") : t("kh_kind_personal");

  const createLib = async () => {
    if (!libName.trim()) return;
    if (!(await gated())) return;
    try {
      const lib = await createKhLibrary({
        name: libName.trim(),
        kind: libKind,
        description: libDesc,
      });
      toast.success(t("kh_lib_created"));
      setLibName("");
      setLibDesc("");
      if (lib) setLibId(lib.id);
      refreshLibs();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const removeLib = async (lib: KhLibrary) => {
    if (!(await gated())) return;
    try {
      await deleteKhLibrary(lib.id);
      toast.success(t("kh_lib_deleted"));
      if (libId === lib.id) setLibId("");
      refreshLibs();
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const createNb = async () => {
    if (!nbId && !libId) return;
    if (!nbName.trim()) return;
    if (!(await gated())) return;
    try {
      const nb = await createKhNotebook({
        library_id: libId,
        name: nbName.trim(),
        description: nbDesc,
        tags: nbTags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      toast.success(t("kh_notebook_created"));
      setNbName("");
      setNbDesc("");
      setNbTags("");
      if (nb) setNbId(nb.id);
      refreshNotebooks(libId);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const removeNb = async (id: string) => {
    if (!(await gated())) return;
    try {
      await deleteKhNotebook(id);
      toast.success(t("kh_notebook_deleted"));
      if (nbId === id) setNbId("");
      refreshNotebooks(libId);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const addSource = async () => {
    if (!nbId) return;
    if (srcTab === "text" && (!srcTitle.trim() || !srcText.trim())) return;
    if (srcTab === "url" && (!srcTitle.trim() || !srcUrl.trim())) return;
    if (srcTab === "file" && (!srcTitle.trim() || !srcFile)) return;
    if (!(await gated())) return;
    try {
      if (srcTab === "text") await createKhSourceText(nbId, srcTitle.trim(), srcText);
      else if (srcTab === "url") await createKhSourceUrl(nbId, srcTitle.trim(), srcUrl.trim());
      else if (srcFile) await createKhSourceFile(nbId, srcTitle.trim(), srcFile);
      toast.success(t("kh_source_added"));
      setSrcTitle("");
      setSrcText("");
      setSrcUrl("");
      setSrcFile(null);
      refreshSources(nbId);
      refreshNotebooks(libId);
    } catch (e) {
      if (isDuplicate(e)) toast.error(t("kh_duplicate"));
      else toast.error(String((e as Error).message));
    }
  };

  const removeSource = async (s: KhSource) => {
    if (!window.confirm(t("kh_confirm_delete_source"))) return;
    if (!(await gated())) return;
    try {
      await deleteKhSource(s.id);
      toast.success(t("kh_source_deleted"));
      refreshSources(nbId);
      refreshNotebooks(libId);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    if (!(await gated())) return;
    try {
      const body: { query: string; notebook_id?: string; library_id?: string } = {
        query: query.trim(),
      };
      if (scope === "notebook" && nbId) body.notebook_id = nbId;
      else if (libId) body.library_id = libId;
      const r = await khSearch(body);
      setResults(r?.items ?? []);
      setOpenResult(null);
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const runAsk = async () => {
    if (!question.trim()) return;
    if (!(await gated())) return;
    try {
      const body: { question: string; notebook_id?: string; library_id?: string } = {
        question: question.trim(),
      };
      if (scope === "notebook" && nbId) body.notebook_id = nbId;
      else if (libId) body.library_id = libId;
      setAsk(await khAsk(body));
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const runTransform = async () => {
    if (picked.length === 0) return;
    if (!(await gated())) return;
    try {
      setTransform(
        await khTransform({
          op,
          source_ids: picked,
          ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        }),
      );
    } catch (e) {
      toast.error(String((e as Error).message));
    }
  };

  const togglePick = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const nb = (notebooks ?? []).find((n) => n.id === nbId) ?? null;

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader title={t("kh_title")} sub={t("kh_sub")} />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Coluna esquerda: bibliotecas e notebooks */}
        <aside className="space-y-6" data-testid="kh-sidebar">
          <section>
            <div className="hud-label mb-2">{t("kh_libraries")}</div>
            {libs !== null && libs.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("kh_empty_libraries")}</p>
            )}
            <div className="space-y-2">
              {(libs ?? []).map((l) => (
                <div key={l.id} className="hud-panel p-3" data-testid="kh-lib-card">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex-1 text-left text-sm hover:text-primary"
                      onClick={() => setLibId(l.id)}
                      aria-pressed={libId === l.id}
                    >
                      {l.name}
                    </button>
                    <Badge variant={l.kind === "project" ? "default" : "outline"}>
                      {kindLabel(l.kind)}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("delete")}
                      onClick={() => removeLib(l)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {l.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{l.description}</p>
                  )}
                </div>
              ))}
            </div>
            <div className="hud-panel mt-3 space-y-2 p-3" data-testid="kh-lib-form">
              <div className="hud-label">{t("kh_new_library")}</div>
              <Input
                placeholder={t("name")}
                value={libName}
                onChange={(e) => setLibName(e.target.value)}
              />
              <Input
                placeholder={t("kh_description")}
                value={libDesc}
                onChange={(e) => setLibDesc(e.target.value)}
              />
              <select
                className="w-full rounded-md border border-input bg-secondary p-2 text-sm"
                value={libKind}
                onChange={(e) => setLibKind(e.target.value as KhLibraryKind)}
                aria-label={t("kh_kind")}
              >
                <option value="personal">{t("kh_kind_personal")}</option>
                <option value="project">{t("kh_kind_project")}</option>
              </select>
              <Button size="sm" className="w-full" onClick={createLib} disabled={!libName.trim()}>
                <Plus className="h-3 w-3" />
                {t("kh_create")}
              </Button>
            </div>
          </section>

          <section>
            <div className="hud-label mb-2">{t("kh_notebooks")}</div>
            {!libId && <p className="text-sm text-muted-foreground">{t("kh_select_library")}</p>}
            {libId && notebooks !== null && notebooks.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("kh_empty_notebooks")}</p>
            )}
            <div className="space-y-2">
              {(notebooks ?? []).map((n) => (
                <div key={n.id} className="hud-panel p-3" data-testid="kh-notebook-row">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="flex-1 text-left text-sm hover:text-primary"
                      onClick={() => setNbId(n.id)}
                      aria-pressed={nbId === n.id}
                    >
                      {n.name}
                    </button>
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {n.source_count}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("delete")}
                      onClick={() => removeNb(n.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {n.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{n.description}</p>
                  )}
                </div>
              ))}
            </div>
            {libId && (
              <div className="hud-panel mt-3 space-y-2 p-3" data-testid="kh-nb-form">
                <div className="hud-label">{t("kh_new_notebook")}</div>
                <Input
                  placeholder={t("name")}
                  value={nbName}
                  onChange={(e) => setNbName(e.target.value)}
                />
                <Input
                  placeholder={t("kh_description")}
                  value={nbDesc}
                  onChange={(e) => setNbDesc(e.target.value)}
                />
                <Input
                  placeholder={t("kh_tags")}
                  value={nbTags}
                  onChange={(e) => setNbTags(e.target.value)}
                />
                <Button size="sm" className="w-full" onClick={createNb} disabled={!nbName.trim()}>
                  <Plus className="h-3 w-3" />
                  {t("kh_create")}
                </Button>
              </div>
            )}
          </section>
        </aside>

        {/* Coluna direita: fontes, pesquisa, perguntas, transformações */}
        <div className="space-y-6">
          {/* Fontes */}
          <section>
            <div className="hud-label mb-2">
              {t("kh_sources")}
              {nb ? ` — ${nb.name}` : ""}
            </div>
            {!nbId && <p className="text-sm text-muted-foreground">{t("kh_select_library")}</p>}
            {nbId && sources !== null && sources.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("kh_empty_sources")}</p>
            )}
            <div className="space-y-2">
              {(sources ?? []).map((s) => {
                const badge = khStatusBadge(s.ingest_status, ingestLabels);
                return (
                  <div key={s.id} className="hud-panel p-3" data-testid="kh-source-row">
                    <div className="flex flex-wrap items-center gap-2">
                      {s.type === "url" ? (
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      ) : s.type === "file" ? (
                        <FileText className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Type className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="flex-1 text-sm">{s.title}</span>
                      <Badge variant={badge.variant} className={badge.className}>
                        {badge.label}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {t("kh_index_status")}: {s.index_status}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={t("delete")}
                        onClick={() => removeSource(s)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Adicionar fonte */}
            {nbId && (
              <div className="hud-panel mt-3 space-y-2 p-4" data-testid="kh-add-source">
                <div className="flex flex-wrap gap-2">
                  {(["text", "url", "file"] as const).map((tab) => (
                    <Button
                      key={tab}
                      size="sm"
                      variant={srcTab === tab ? "default" : "outline"}
                      onClick={() => setSrcTab(tab)}
                    >
                      {tab === "text"
                        ? t("kh_source_text")
                        : tab === "url"
                          ? t("kh_source_url")
                          : t("kh_source_file")}
                    </Button>
                  ))}
                </div>
                <Input
                  placeholder={t("kh_title")}
                  value={srcTitle}
                  onChange={(e) => setSrcTitle(e.target.value)}
                />
                {srcTab === "text" && (
                  <Textarea
                    rows={4}
                    placeholder={t("kh_content")}
                    value={srcText}
                    onChange={(e) => setSrcText(e.target.value)}
                  />
                )}
                {srcTab === "url" && (
                  <Input
                    type="url"
                    placeholder="https://..."
                    value={srcUrl}
                    onChange={(e) => setSrcUrl(e.target.value)}
                  />
                )}
                {srcTab === "file" && (
                  <input
                    type="file"
                    className="block w-full text-sm"
                    aria-label={t("kh_upload")}
                    onChange={(e) => setSrcFile(e.target.files?.[0] ?? null)}
                  />
                )}
                <Button
                  size="sm"
                  onClick={addSource}
                  disabled={
                    !srcTitle.trim() ||
                    (srcTab === "text" && !srcText.trim()) ||
                    (srcTab === "url" && !srcUrl.trim()) ||
                    (srcTab === "file" && !srcFile)
                  }
                >
                  <Plus className="h-3 w-3" />
                  {t("kh_add_source")}
                </Button>
              </div>
            )}
          </section>

          {/* Pesquisa */}
          <section className="hud-panel space-y-2 p-4" data-testid="kh-search-panel">
            <div className="hud-label">{t("kh_search_title")}</div>
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-md border border-input bg-secondary p-2 text-sm"
                value={scope}
                onChange={(e) => setScope(e.target.value as typeof scope)}
                aria-label={t("kh_scope")}
              >
                <option value="notebook">{t("kh_scope_notebook")}</option>
                <option value="library">{t("kh_scope_library")}</option>
              </select>
              <Input
                className="min-w-[200px] flex-1"
                placeholder={t("kh_search_placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button size="sm" onClick={runSearch} disabled={!query.trim()}>
                {t("kh_search")}
              </Button>
            </div>
            {results !== null && results.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("kh_no_results")}</p>
            )}
            <div className="space-y-2">
              {(results ?? []).map((r) => {
                const open = openResult === r.chunk_id;
                return (
                  <div
                    key={r.chunk_id}
                    className="rounded-md border border-border p-3"
                    data-testid="kh-search-result"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex-1 text-sm font-medium">{r.source_title}</span>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {t("kh_score")}: {r.score.toFixed(3)}
                      </Badge>
                      {r.citation && (
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {t("kh_citation")}: doc {r.citation.document_id.slice(0, 8)} ·{" "}
                          {t("kh_chunk")} {r.citation.chunk_index}
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOpenResult(open ? null : r.chunk_id)}
                        aria-expanded={open}
                      >
                        {open ? "−" : "+"}
                      </Button>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{r.snippet}</p>
                    {open && (
                      <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-secondary/50 p-2 text-xs">
                        {r.content}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Perguntar ao acervo */}
          <section className="hud-panel space-y-2 p-4" data-testid="kh-ask-panel">
            <div className="hud-label">{t("kh_ask_title")}</div>
            <div className="flex flex-wrap gap-2">
              <Input
                className="min-w-[200px] flex-1"
                placeholder={t("kh_ask_placeholder")}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <Button size="sm" onClick={runAsk} disabled={!question.trim()}>
                {t("kh_ask")}
              </Button>
            </div>
            {ask && (
              <div
                className="space-y-2 rounded-md border border-border p-3"
                data-testid="kh-answer-block"
              >
                {ask.sufficient === false && (
                  <p className="text-sm text-yellow-600">{t("kh_insufficient")}</p>
                )}
                <div className="hud-label">{t("kh_answer")}</div>
                <pre className="whitespace-pre-wrap text-sm">{ask.answer}</pre>
                {ask.citations.length > 0 && (
                  <div>
                    <div className="hud-label">{t("kh_citation")}</div>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {ask.citations.map((c, i) => (
                        <li key={`${c.chunk_id}-${i}`}>
                          {c.source_title} · {t("kh_chunk")} {c.chunk_index} · {t("kh_score")}{" "}
                          {c.score.toFixed(3)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Transformações */}
          <section className="hud-panel space-y-2 p-4" data-testid="kh-transform-panel">
            <div className="hud-label">{t("kh_transform_title")}</div>
            {(sources ?? []).length > 0 && (
              <div className="grid gap-1 text-xs sm:grid-cols-2">
                {(sources ?? []).map((s) => (
                  <label key={s.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={picked.includes(s.id)}
                      onChange={() => togglePick(s.id)}
                    />
                    {s.title}
                  </label>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <select
                className="rounded-md border border-input bg-secondary p-2 text-sm"
                value={op}
                onChange={(e) => setOp(e.target.value as KhTransformOp)}
                aria-label={t("kh_transform_title")}
              >
                {KH_OPS.map((o) => (
                  <option key={o} value={o}>
                    {t(KH_OP_LABEL_KEY[o])}
                  </option>
                ))}
              </select>
              <Input
                className="min-w-[160px] flex-1"
                placeholder={t("kh_prompt_optional")}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <Button size="sm" onClick={runTransform} disabled={picked.length === 0}>
                {t("kh_run")}
              </Button>
            </div>
            {transform && (
              <div
                className="space-y-2 rounded-md border border-border p-3"
                data-testid="kh-transform-result"
              >
                <div className="hud-label">
                  {t("kh_result")} · {t(KH_OP_LABEL_KEY[transform.op])}
                </div>
                <pre className="whitespace-pre-wrap text-sm">{transform.result}</pre>
                {transform.citations.length > 0 && (
                  <div>
                    <div className="hud-label">{t("kh_citation")}</div>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {transform.citations.map((c, i) => (
                        <li key={`${c.chunk_id}-${i}`}>
                          {c.source_title} · {t("kh_chunk")} {c.chunk_index}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
