import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOriginBadge, AgentsPage } from "@/routes/agentes";
import { listSkills, getSkillDetail, type SkillSummary } from "@/lib/bridge";

describe("Skills Hub — Origin Badges", () => {
  it("determina distintamente badges de origem para ecossistemas suportados", () => {
    const threejsSkill: SkillSummary = {
      id: "threejs-expert",
      name: "Three.js Expert",
      description: "WebGL 3D",
      tags: ["threejs"],
      category: "threejs-skills",
    };
    expect(getOriginBadge(threejsSkill).label).toBe("threejs");

    const gsapSkill: SkillSummary = {
      id: "gsap-motion",
      name: "GSAP Motion",
      description: "Timelines",
      tags: ["gsap"],
      category: "gsap-skills",
    };
    expect(getOriginBadge(gsapSkill).label).toBe("gsap");

    const designSkill: SkillSummary = {
      id: "design-dna",
      name: "Design DNA",
      description: "Tokens",
      tags: ["design-dna"],
      category: "design-dna",
    };
    expect(getOriginBadge(designSkill).label).toBe("design-dna");

    const googleSkill: SkillSummary = {
      id: "google-ads-api",
      name: "Google Ads",
      description: "Diagnostics",
      tags: ["google"],
      category: "google-skills",
    };
    expect(getOriginBadge(googleSkill).label).toBe("google");

    const emilSkill: SkillSummary = {
      id: "emil-ui-polish",
      name: "Emil Polish",
      description: "Micro-interactions",
      tags: ["emil"],
      category: "emilkowalski-skills",
    };
    expect(getOriginBadge(emilSkill).label).toBe("emilkowalski");

    const addySkill: SkillSummary = {
      id: "web-dev-performance",
      name: "Web Perf",
      description: "Performance metrics",
      tags: ["addyosmani"],
      category: "agent-skills",
    };
    expect(getOriginBadge(addySkill).label).toBe("addyosmani");

    const genericSkill: SkillSummary = {
      id: "custom-community-skill",
      name: "Community",
      description: "General",
      tags: [],
      category: "custom",
    };
    expect(getOriginBadge(genericSkill).label).toBe("custom");
  });
});

describe("Skills Hub — Client Bridge", () => {
  afterEach(() => vi.restoreAllMocks());

  it("listSkills e getSkillDetail retornam null em modo offline sem lançar erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await listSkills()).toBeNull();
    expect(await getSkillDetail("any-id")).toBeNull();
  });
});

describe("AgentsPage — MCP Connection Assistant", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renderiza o card de conexão MCP e permite copiar o snippet de configuração", async () => {
    // Mock navigator.clipboard
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(<AgentsPage defaultTab="agents" />);

    await waitFor(() => {
      expect(screen.getByTestId("card-mcp-connect")).toBeInTheDocument();
      expect(screen.getByTestId("btn-copy-mcp")).toBeInTheDocument();
    });

    expect(screen.getByText("Conectar Agentes Externos (MCP: Claude / Goose / IDE)")).toBeInTheDocument();
    expect(screen.getByText(/jarvis_service_token/i)).toBeInTheDocument();

    const copyBtn = screen.getByTestId("btn-copy-mcp");
    fireEvent.click(copyBtn);

    expect(mockWriteText).toHaveBeenCalledTimes(1);
    const copiedText = mockWriteText.mock.calls[0]?.[0] ?? "";
    expect(copiedText).toContain("mcpServers");
    expect(copiedText).toContain("jarvis");
    expect(copiedText).toContain("JARVIS_SERVICE_TOKEN");
  });
});

describe("AgentsPage — Multi-Provider Router & Telemetry (v1.6.0)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renderiza o card do router com perfis de roteamento ativos e métricas operacionais", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url.includes("/api/skills")) {
          return new Response(
            JSON.stringify({
              total: 1,
              totalCatalog: 258,
              categories: ["graphics"],
              skills: [
                {
                  id: "threejs-expert",
                  name: "Three.js 3D Expert",
                  description: "Criação de cenas 3D",
                  tags: ["threejs"],
                  category: "graphics",
                },
              ],
              routerStatus: {
                activeAgent: "Jarvis Principal",
                primary: {
                  provider: "ollama",
                  model: "llama3.1",
                  baseUrl: "http://ollama-llm:11434/v1",
                },
                fallbacks: [{ provider: "anthropic", model: "claude-3-5-sonnet" }],
                totalProviders: 2,
                resilientFallbackEnabled: true,
                profiles: ["realtime_voice", "code_engineering", "rag_knowledge", "general"],
                telemetry: {
                  providers: {
                    ollama: {
                      calls: 10,
                      successes: 9,
                      failures: 1,
                      fallbacksTriggered: 1,
                      totalLatencyMs: 1500,
                      avgLatencyMs: 150,
                      totalEstimatedTokens: 4500,
                    },
                  },
                  profiles: {
                    realtime_voice: 3,
                    code_engineering: 5,
                    rag_knowledge: 2,
                    general: 0,
                  },
                  totalCalls: 10,
                  totalFallbacks: 1,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      })
    );

    render(<AgentsPage defaultTab="skills" />);

    await waitFor(() => {
      expect(screen.getByTestId("card-router-status")).toBeInTheDocument();
      expect(screen.getByTestId("router-profiles")).toBeInTheDocument();
      expect(screen.getByTestId("router-telemetry")).toBeInTheDocument();
    });

    // Valida os badges dos perfis
    expect(screen.getByText("Voz Tempo Real")).toBeInTheDocument();
    expect(screen.getByText("Engenharia de Código")).toBeInTheDocument();
    expect(screen.getByText("RAG Documental")).toBeInTheDocument();
    expect(screen.getByText("Geral")).toBeInTheDocument();

    // Valida as métricas de telemetria
    const telemetrySection = screen.getByTestId("router-telemetry");
    expect(telemetrySection).toHaveTextContent("Chamadas:");
    expect(telemetrySection).toHaveTextContent("10");
    expect(telemetrySection).toHaveTextContent("Latência Média:");
    expect(telemetrySection).toHaveTextContent("150ms");
    expect(telemetrySection).toHaveTextContent("Fallbacks:");
    expect(telemetrySection).toHaveTextContent("1 acionado(s)");
  });
});

