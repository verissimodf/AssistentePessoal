import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Search,
  MessageSquare,
  LayoutDashboard,
  FileText,
  Users,
  Bot,
  Brain,
  Activity,
  Settings,
  Sparkles,
  ShieldCheck,
  CornerDownLeft,
  Command,
  X,
  Code2,
} from "lucide-react";
import { reindexAllPendingDocuments, listSkills, type SkillSummary } from "@/lib/bridge";
import { toast } from "sonner";

export interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  category: "Navegação Rápida" | "Ações Rápidas" | "Skills Especializadas (Hub Global)";
  icon: React.ElementType;
  action: () => void | Promise<void>;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();

  // Atalho global Ctrl+K / Cmd+K e listener de evento customizado
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };

    const handleCustomOpen = () => setOpen(true);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("open-command-palette", handleCustomOpen);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("open-command-palette", handleCustomOpen);
    };
  }, []);

  // Foco no input ao abrir
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
    } else {
      setSearch("");
      setSkills([]);
    }
  }, [open]);

  // Busca assíncrona de skills quando busca > 2 caracteres
  useEffect(() => {
    if (search.trim().length >= 2) {
      let isCurrent = true;
      (async () => {
        try {
          const res = await listSkills({ q: search.trim() });
          if (isCurrent && res?.skills) {
            setSkills(res.skills.slice(0, 5));
          }
        } catch {
          if (isCurrent) setSkills([]);
        }
      })();
      return () => {
        isCurrent = false;
      };
    } else {
      setSkills([]);
      return undefined;
    }
  }, [search]);

  // Itens estáticos de navegação e ações
  const baseItems: CommandItem[] = useMemo(
    () => [
      // Navegação Rápida
      {
        id: "nav-chat",
        label: "Conversa & Chat",
        sublabel: "Interface conversacional principal",
        category: "Navegação Rápida",
        icon: MessageSquare,
        action: () => {
          navigate({ to: "/" });
          setOpen(false);
        },
      },
      {
        id: "nav-overview",
        label: "Visão Geral",
        sublabel: "HUD operacional e foco da sessão",
        category: "Navegação Rápida",
        icon: LayoutDashboard,
        action: () => {
          navigate({ to: "/visao-geral" });
          setOpen(false);
        },
      },
      {
        id: "nav-docs",
        label: "Documentos RAG",
        sublabel: "Gestão documental privada com RAG Híbrido",
        category: "Navegação Rápida",
        icon: FileText,
        action: () => {
          navigate({ to: "/documentos" });
          setOpen(false);
        },
      },
      {
        id: "nav-agents",
        label: "Agentes & Skills",
        sublabel: "Catálogo de 258 skills e agentes",
        category: "Navegação Rápida",
        icon: Users,
        action: () => {
          navigate({ to: "/agentes" });
          setOpen(false);
        },
      },
      {
        id: "nav-bots",
        label: "Bots Autônomos",
        sublabel: "Agendador e automações locais",
        category: "Navegação Rápida",
        icon: Bot,
        action: () => {
          navigate({ to: "/bots" });
          setOpen(false);
        },
      },
      {
        id: "nav-memory",
        label: "Memória Longo Prazo",
        sublabel: "Fatos e preferências persistentes",
        category: "Navegação Rápida",
        icon: Brain,
        action: () => {
          navigate({ to: "/memoria" });
          setOpen(false);
        },
      },
      {
        id: "nav-executions",
        label: "Execuções & Auditoria",
        sublabel: "Histórico e evidências de execução",
        category: "Navegação Rápida",
        icon: Activity,
        action: () => {
          navigate({ to: "/execucoes" });
          setOpen(false);
        },
      },
      {
        id: "nav-settings",
        label: "Configurações",
        sublabel: "Segurança, provedores de IA e sistema",
        category: "Navegação Rápida",
        icon: Settings,
        action: () => {
          navigate({ to: "/configuracoes" });
          setOpen(false);
        },
      },

      // Ações Rápidas
      {
        id: "action-rag-sync",
        label: "Sincronizar Vetores RAG Pendentes",
        sublabel: "Executa reindexação vetorial de documentos offline",
        category: "Ações Rápidas",
        icon: Sparkles,
        action: async () => {
          setOpen(false);
          toast.loading("Sincronizando vetores RAG pendentes...");
          try {
            const res = await reindexAllPendingDocuments();
            if (res && res.ok) {
              toast.success(
                `Sincronização concluída: ${res.upgraded || 0} documento(s) promovido(s) para RAG Semântico.`,
              );
            } else {
              toast.error(
                res?.reason === "embedding_provider_unavailable"
                  ? "Provedor de embeddings indisponível no momento."
                  : "Falha ao sincronizar vetores pendentes.",
              );
            }
          } catch {
            toast.error("Erro na comunicação com o servidor.");
          }
        },
      },
      {
        id: "action-router-status",
        label: "Inspecionar Status do Router Multi-Provider",
        sublabel: "Visualiza provedores primário e fallbacks ativos",
        category: "Ações Rápidas",
        icon: ShieldCheck,
        action: () => {
          navigate({ to: "/agentes" });
          setOpen(false);
        },
      },
    ],
    [navigate],
  );

  // Combina e filtra itens com base na busca
  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();

    let items = baseItems;
    if (q) {
      items = baseItems.filter(
        (i) =>
          i.label.toLowerCase().includes(q) ||
          (i.sublabel && i.sublabel.toLowerCase().includes(q)) ||
          i.category.toLowerCase().includes(q),
      );
    }

    if (skills.length > 0) {
      const skillItems: CommandItem[] = skills.map((s) => ({
        id: `skill-${s.id}`,
        label: s.name,
        sublabel: `Skill: ${s.description || s.id} [${s.category || "geral"}]`,
        category: "Skills Especializadas (Hub Global)",
        icon: Code2,
        action: () => {
          navigate({ to: "/agentes" });
          setOpen(false);
        },
      }));
      return [...items, ...skillItems];
    }

    return items;
  }, [baseItems, search, skills, navigate]);

  // Navegação por teclado no menu
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (filteredItems.length ? (prev + 1) % filteredItems.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredItems.length ? (prev - 1 + filteredItems.length) % filteredItems.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = filteredItems[selectedIndex];
      if (current) current.action();
    }
  };

  if (!open) return null;

  // Agrupa itens por categoria preservando a ordem
  const categories = Array.from(new Set(filteredItems.map((i) => i.category)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[15vh] backdrop-blur-sm animate-in fade-in-0 duration-150"
      onClick={() => setOpen(false)}
      data-testid="command-palette-dialog"
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-primary/30 bg-background/95 shadow-2xl shadow-primary/10 hud-panel flex flex-col max-h-[70vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Barra de Busca */}
        <div className="flex items-center gap-3 border-b border-border/80 px-4 py-3 bg-secondary/30">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Digite um comando, página ou skill..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            data-testid="input-command-palette"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Fechar (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Lista de Resultados */}
        <div className="flex-1 overflow-y-auto p-2 space-y-4">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Nenhum comando ou skill encontrado para &ldquo;{search}&rdquo;.
            </div>
          ) : (
            categories.map((cat) => {
              const itemsInCat = filteredItems.filter((i) => i.category === cat);
              return (
                <div key={cat} className="space-y-1">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 font-mono">
                    {cat}
                  </div>
                  {itemsInCat.map((item) => {
                    const globalIdx = filteredItems.findIndex((x) => x.id === item.id);
                    const isSelected = globalIdx === selectedIndex;
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.id}
                        data-testid={`command-item-${item.id}`}
                        onClick={() => item.action()}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                        className={`flex items-center justify-between rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-primary/20 text-primary border border-primary/40"
                            : "text-foreground hover:bg-secondary/60"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Icon
                            className={`h-4 w-4 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                          />
                          <div className="truncate">
                            <div className="text-xs font-medium truncate">{item.label}</div>
                            {item.sublabel && (
                              <div className="text-[11px] text-muted-foreground truncate">
                                {item.sublabel}
                              </div>
                            )}
                          </div>
                        </div>

                        {isSelected && (
                          <div className="flex items-center gap-1 text-[10px] text-primary/80 shrink-0 pl-2">
                            <span>Executar</span>
                            <CornerDownLeft className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Rodapé Informativo */}
        <div className="flex items-center justify-between border-t border-border/80 px-4 py-2 bg-secondary/20 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-background px-1 py-0.5 text-[9px] font-mono">
                ↑↓
              </kbd>
              <span>Navegar</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-background px-1 py-0.5 text-[9px] font-mono">
                Enter
              </kbd>
              <span>Selecionar</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border bg-background px-1 py-0.5 text-[9px] font-mono">
                Esc
              </kbd>
              <span>Fechar</span>
            </span>
          </div>
          <div className="flex items-center gap-1 font-mono text-[10px] text-primary/70">
            <Command className="h-3 w-3" />
            <span>J.A.R.V.I.S. Command</span>
          </div>
        </div>
      </div>
    </div>
  );
}
