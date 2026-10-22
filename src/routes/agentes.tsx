import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import {
  Star,
  Trash2,
  Search,
  Cpu,
  ShieldCheck,
  FileText,
  Copy,
  Check,
  Sparkles,
  Layers,
  ArrowRight,
} from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  collection,
  type Agent,
  listSkills,
  getSkillDetail,
  type SkillSummary,
  type SkillsResponse,
  type SkillDetail,
  type RouterStatus,
} from "@/lib/bridge";
import { CHAT_PROVIDERS, TEMPLATES, TOOLS } from "@/lib/catalog";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/agentes")({
  head: () => ({
    meta: [
      { title: "Agentes e Skills — Jarvis" },
      {
        name: "description",
        content: "Crie agentes personalizados e explore o Hub Global de Skills especializadas.",
      },
      { property: "og:title", content: "Agentes e Skills — Jarvis" },
      {
        property: "og:description",
        content: "Gerenciamento de agentes e catálogo global de 257+ skills.",
      },
    ],
  }),
  component: AgentsPage,
});

const store = collection<Agent>("agents");
const blank: Partial<Agent> = {
  name: "",
  instructions: "",
  provider: "ollama",
  model: "llama3.1",
  tools: ["remember", "recall", "web_search", "load_skill"],
};

export function getOriginBadge(skill: SkillSummary): { label: string; className: string } {
  const cat = (skill.category || "").toLowerCase();
  const id = (skill.id || "").toLowerCase();
  if (cat.includes("threejs") || id.startsWith("threejs")) {
    return { label: "threejs", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
  }
  if (cat.includes("gsap") || id.startsWith("gsap")) {
    return { label: "gsap", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
  }
  if (cat.includes("design-dna") || id.includes("design-dna")) {
    return { label: "design-dna", className: "bg-purple-500/20 text-purple-400 border-purple-500/30" };
  }
  if (
    cat.includes("google") ||
    id.startsWith("google-") ||
    id.startsWith("gke-") ||
    id.startsWith("agent-platform")
  ) {
    return { label: "google", className: "bg-amber-500/20 text-amber-400 border-amber-500/30" };
  }
  if (cat.includes("emil") || id.startsWith("emil-")) {
    return { label: "emilkowalski", className: "bg-pink-500/20 text-pink-400 border-pink-500/30" };
  }
  if (cat.includes("agent-skills") || skill.tags?.includes("addyosmani")) {
    return { label: "addyosmani", className: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" };
  }
  return { label: skill.category || "comunidade", className: "bg-muted text-muted-foreground border-border" };
}

function AgentsPage() {
  const { t } = useI18n();

  // Estados dos Agentes
  const [items, setItems] = useState<Agent[]>([]);
  const [edit, setEdit] = useState<Partial<Agent>>(blank);

  // Estados das Skills & Router
  const [activeTab, setActiveTab] = useState<string>("skills");
  const [skillsData, setSkillsData] = useState<SkillsResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null);
  const [loadingSkill, setLoadingSkill] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  const refreshAgents = () => store.list().then(setItems);

  const loadSkillsList = async (q?: string, cat?: string) => {
    setLoadingList(true);
    try {
      const res = await listSkills({
        q: q || undefined,
        category: cat && cat !== "all" ? cat : undefined,
      });
      if (res) {
        setSkillsData(res);
      }
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    refreshAgents();
    loadSkillsList();
  }, []);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    loadSkillsList(val, selectedCategory);
  };

  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    loadSkillsList(searchQuery, cat);
  };

  const inspectSkill = async (skill: SkillSummary) => {
    setLoadingSkill(true);
    setCopied(false);
    try {
      const detail = await getSkillDetail(skill.id);
      if (detail) {
        setSelectedSkill(detail);
      }
    } finally {
      setLoadingSkill(false);
    }
  };

  const handleCopy = async () => {
    if (!selectedSkill?.content) return;
    try {
      await navigator.clipboard.writeText(selectedSkill.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const saveAgent = async () => {
    if (!edit.name) return;
    await store.save(edit);
    setEdit(blank);
    refreshAgents();
  };

  const activateAgent = async (a: Agent) => {
    for (const x of items) {
      if (x.active && x.id !== a.id) await store.save({ ...x, active: false });
    }
    await store.save({ ...a, active: true });
    refreshAgents();
    loadSkillsList(searchQuery, selectedCategory);
  };

  const routerStatus: RouterStatus | undefined = skillsData?.routerStatus;
  const totalCatalog = skillsData?.totalCatalog ?? 257;

  return (
    <div className="h-screen overflow-y-auto p-6 md:p-10">
      <PageHeader
        title={t("agents_title")}
        sub="Configure personalidades e explore o Hub Global de Skills multi-agente."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4 space-y-6">
        <TabsList className="bg-secondary/60 p-1 border border-border">
          <TabsTrigger value="skills" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>Hub Global de Skills</span>
            <Badge variant="secondary" className="px-1.5 py-0 text-xs font-mono">
              {totalCatalog}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="agents" className="flex items-center gap-2">
            <Cpu className="h-4 w-4" />
            <span>Agentes Pessoais</span>
            <Badge variant="outline" className="px-1.5 py-0 text-xs font-mono">
              {items.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* ================= ABA DO HUB DE SKILLS ================= */}
        <TabsContent value="skills" className="space-y-6 focus-visible:outline-none">
          {/* Card de Status do Multi-Provider Router */}
          {routerStatus && (
            <div className="hud-panel p-5 bg-gradient-to-r from-secondary/40 via-background to-secondary/20 border border-primary/20">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-emerald-400" />
                    <span className="font-display font-semibold text-base text-foreground">
                      Multi-Provider Router
                    </span>
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs">
                      Auto-Fallback Resiliente
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Cadeia autônoma de execução que redireciona automaticamente requisições se o provedor
                    primário oscilar.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <div className="flex items-center gap-1.5 rounded-md bg-secondary/80 px-3 py-1.5 border border-border">
                    <span className="text-muted-foreground">Primário:</span>
                    <span className="font-semibold text-foreground uppercase tracking-wider text-[11px]">
                      {routerStatus.primary.provider}
                    </span>
                    <span className="font-mono text-[11px] text-primary">
                      ({routerStatus.primary.model || "padrão"})
                    </span>
                  </div>

                  {routerStatus.fallbacks.length > 0 && (
                    <div className="flex items-center gap-1.5 rounded-md bg-secondary/80 px-3 py-1.5 border border-border">
                      <span className="text-muted-foreground">Fallbacks:</span>
                      <div className="flex items-center gap-1">
                        {routerStatus.fallbacks.map((fb, idx) => (
                          <span
                            key={fb.provider + idx}
                            className="font-mono text-[10px] bg-background/80 px-1.5 py-0.5 rounded text-foreground"
                          >
                            {fb.provider}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="text-muted-foreground">
                    Agente ativo:{" "}
                    <span className="font-semibold text-foreground">{routerStatus.activeAgent}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Barra de Filtros e Busca */}
          <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por habilidade, tecnologia, comando..."
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9 bg-secondary/50"
              />
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
              <select
                className="rounded-md border border-input bg-secondary px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                value={selectedCategory}
                onChange={(e) => handleCategoryChange(e.target.value)}
              >
                <option value="all">Todas as Categorias ({skillsData?.totalCatalog ?? 257})</option>
                {skillsData?.categories?.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              <span className="text-xs text-muted-foreground whitespace-nowrap pl-2">
                Exibindo <strong>{skillsData?.skills?.length ?? 0}</strong> skills
              </span>
            </div>
          </div>

          {/* Grid de Skills */}
          {skillsData?.skills && skillsData.skills.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {skillsData.skills.map((skill) => {
                const origin = getOriginBadge(skill);
                return (
                  <div
                    key={skill.id}
                    className="hud-panel flex flex-col justify-between p-4 border border-border/80 hover:border-primary/50 transition-colors"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-display font-medium text-base text-foreground leading-snug line-clamp-1">
                          {skill.name}
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] uppercase font-mono px-1.5 py-0 tracking-wider shrink-0 border ${origin.className}`}
                        >
                          {origin.label}
                        </Badge>
                      </div>

                      <div className="font-mono text-[11px] text-muted-foreground select-all">
                        {skill.id}
                      </div>

                      <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                        {skill.description || "Nenhuma descrição fornecida."}
                      </p>

                      {skill.tags && skill.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {skill.tags.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="rounded bg-secondary/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground"
                            >
                              #{t}
                            </span>
                          ))}
                          {skill.tags.length > 3 && (
                            <span className="text-[10px] text-muted-foreground/70 self-center">
                              +{skill.tags.length - 3}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="pt-4 mt-2 border-t border-border/40 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground/70">
                        {skill.category || "geral"}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 text-xs hover:text-primary hover:bg-primary/10"
                        onClick={() => inspectSkill(skill)}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        <span>Inspecionar SKILL.md</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="hud-panel p-12 text-center space-y-2">
              <Layers className="h-8 w-8 text-muted-foreground mx-auto opacity-50" />
              <div className="text-sm font-medium text-foreground">Nenhuma skill encontrada</div>
              <p className="text-xs text-muted-foreground">
                Tente ajustar seu termo de busca ou selecione outra categoria.
              </p>
            </div>
          )}
        </TabsContent>

        {/* ================= ABA DE AGENTES PESSOAIS ================= */}
        <TabsContent value="agents" className="focus-visible:outline-none">
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-3">
              {items.map((a) => (
                <div key={a.id} className="hud-panel flex items-start gap-4 p-4">
                  <div className="flex-1 cursor-pointer" onClick={() => setEdit(a)}>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-lg">{a.name}</span>
                      {a.active && (
                        <span className="rounded bg-primary px-2 text-xs text-primary-foreground">
                          {t("active")}
                        </span>
                      )}
                    </div>
                    <div className="hud-label mt-1">
                      {a.provider} · {a.model} · {a.tools?.join(", ")}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                      {a.instructions}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => activateAgent(a)}
                    aria-label={t("set_active")}
                  >
                    <Star className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      await store.remove(a.id);
                      refreshAgents();
                    }}
                    aria-label={t("delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="hud-panel space-y-3 p-4">
              <Input
                placeholder={t("name")}
                value={edit.name || ""}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
              <div className="flex gap-2">
                <select
                  className="flex-1 rounded-md border border-input bg-secondary px-2 text-sm"
                  value={edit.provider}
                  onChange={(e) => setEdit({ ...edit, provider: e.target.value })}
                >
                  {CHAT_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <Input
                  placeholder={t("model")}
                  value={edit.model || ""}
                  onChange={(e) => setEdit({ ...edit, model: e.target.value })}
                />
              </div>
              <Textarea
                rows={7}
                placeholder={t("instructions")}
                value={edit.instructions || ""}
                onChange={(e) => setEdit({ ...edit, instructions: e.target.value })}
              />
              <div>
                <div className="hud-label mb-2">{t("templates")}</div>
                <div className="flex flex-wrap gap-1">
                  {TEMPLATES.map((tp) => (
                    <button
                      key={tp.name}
                      type="button"
                      className="rounded border border-border px-2 py-1 text-xs hover:border-primary"
                      onClick={() =>
                        setEdit({
                          ...edit,
                          instructions: [edit.instructions, tp.text].filter(Boolean).join("\n\n"),
                        })
                      }
                    >
                      + {tp.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="hud-label mb-2">{t("tools")}</div>
                <div className="flex flex-wrap gap-1">
                  {TOOLS.map((tool) => {
                    const on = edit.tools?.includes(tool);
                    return (
                      <button
                        key={tool}
                        type="button"
                        onClick={() =>
                          setEdit({
                            ...edit,
                            tools: on
                              ? edit.tools!.filter((x) => x !== tool)
                              : [...(edit.tools || []), tool],
                          })
                        }
                        className={`rounded px-2 py-1 font-mono text-xs ${
                          on
                            ? "bg-primary text-primary-foreground"
                            : "border border-border text-muted-foreground"
                        }`}
                      >
                        {tool}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={saveAgent} className="flex-1">
                  {t("save")}
                </Button>
                <Button variant="outline" onClick={() => setEdit(blank)}>
                  {t("cancel")}
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Modal Dialog de Inspeção do SKILL.md */}
      <Dialog open={!!selectedSkill} onOpenChange={(open) => !open && setSelectedSkill(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-6">
          <DialogHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <DialogTitle className="font-display text-lg">
                {selectedSkill?.name}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs font-mono text-muted-foreground flex items-center gap-2">
              <span>ID: {selectedSkill?.id}</span>
              <span>·</span>
              <span>Caminho: {selectedSkill?.path}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden my-3">
            <div className="h-[55vh] overflow-y-auto rounded-md bg-secondary/40 p-4 border border-border">
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90 selection:bg-primary selection:text-primary-foreground">
                {selectedSkill?.content}
              </pre>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex flex-wrap gap-1">
              {selectedSkill?.tags?.map((t) => (
                <span
                  key={t}
                  className="rounded bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  #{t}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="gap-1.5 text-xs"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copiar Conteúdo</span>
                  </>
                )}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => setSelectedSkill(null)}
                className="text-xs"
              >
                Fechar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
