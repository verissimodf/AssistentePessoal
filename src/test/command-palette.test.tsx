import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CommandPalette } from "@/components/CommandPalette";

const mockReindexAllPendingDocuments = vi.fn();
const mockListSkills = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...original,
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@/lib/bridge", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/bridge")>();
  return {
    ...original,
    reindexAllPendingDocuments: (...args: unknown[]) => mockReindexAllPendingDocuments(...args),
    listSkills: (...args: unknown[]) => mockListSkills(...args),
    ping: () => Promise.resolve(true),
  };
});

describe("CommandPalette Component (Ctrl+K / Cmd+K)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSkills.mockResolvedValue({ skills: [] });
    mockReindexAllPendingDocuments.mockResolvedValue({ ok: true, processed: 1, upgraded: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("não renderiza por padrão e abre ao pressionar Ctrl+K", async () => {
    render(<CommandPalette />);

    // Inicialmente fechado
    expect(screen.queryByTestId("command-palette-dialog")).not.toBeInTheDocument();

    // Dispara atalho global Ctrl+K
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByTestId("command-palette-dialog")).toBeInTheDocument();
      expect(screen.getByTestId("input-command-palette")).toBeInTheDocument();
    });

    expect(
      screen.getByPlaceholderText("Digite um comando, página ou skill..."),
    ).toBeInTheDocument();
  });

  it("abre ao disparar o evento customizado open-command-palette", async () => {
    render(<CommandPalette />);

    expect(screen.queryByTestId("command-palette-dialog")).not.toBeInTheDocument();

    window.dispatchEvent(new CustomEvent("open-command-palette"));

    await waitFor(() => {
      expect(screen.getByTestId("command-palette-dialog")).toBeInTheDocument();
    });
  });

  it("fecha ao pressionar a tecla Escape", async () => {
    render(<CommandPalette />);

    // Abre
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByTestId("command-palette-dialog")).toBeInTheDocument();
    });

    // Pressiona Escape no input
    const input = screen.getByTestId("input-command-palette");
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("command-palette-dialog")).not.toBeInTheDocument();
    });
  });

  it("filtra comandos de navegação e ações rápidas dinamicamente", async () => {
    render(<CommandPalette />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByTestId("command-palette-dialog")).toBeInTheDocument();
    });

    // Verifica que itens iniciais aparecem
    expect(screen.getByText("Conversa & Chat")).toBeInTheDocument();
    expect(screen.getByText("Documentos RAG")).toBeInTheDocument();
    expect(screen.getByText("Sincronizar Vetores RAG Pendentes")).toBeInTheDocument();

    // Digita filtro para ação de sincronização RAG
    const input = screen.getByTestId("input-command-palette");
    fireEvent.change(input, { target: { value: "Sincronizar" } });

    await waitFor(() => {
      expect(screen.getByText("Sincronizar Vetores RAG Pendentes")).toBeInTheDocument();
      expect(screen.queryByText("Conversa & Chat")).not.toBeInTheDocument();
      expect(screen.queryByText("Configurações")).not.toBeInTheDocument();
    });
  });

  it("busca e exibe skills dinâmicas ao digitar mais de 2 caracteres", async () => {
    mockListSkills.mockResolvedValueOnce({
      skills: [
        {
          id: "threejs-expert",
          name: "Three.js 3D Expert",
          description: "Criação de cenas WebGL 3D",
          category: "threejs-skills",
        },
      ],
    });

    render(<CommandPalette />);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByTestId("command-palette-dialog")).toBeInTheDocument();
    });

    const input = screen.getByTestId("input-command-palette");
    fireEvent.change(input, { target: { value: "threejs" } });

    await waitFor(() => {
      expect(mockListSkills).toHaveBeenCalledWith({ q: "threejs" });
      expect(screen.getByText("Three.js 3D Expert")).toBeInTheDocument();
    });
  });
});
