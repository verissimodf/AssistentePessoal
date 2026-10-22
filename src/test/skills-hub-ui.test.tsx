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
    const copiedText = mockWriteText.mock.calls[0][0];
    expect(copiedText).toContain("mcpServers");
    expect(copiedText).toContain("jarvis");
    expect(copiedText).toContain("JARVIS_SERVICE_TOKEN");
  });
});
