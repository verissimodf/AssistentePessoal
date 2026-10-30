// Fase H (incidente PONG) — envio de mensagem pela interface.
// Reproduz o incidente: no painel real (HTTP na tailnet = contexto NÃO seguro),
// `crypto.randomUUID` não existe e o envio morria em silêncio, por clique E por Enter.
// Estes testes cobrem: botão, Enter, Shift+Enter, mensagem vazia, anti-duplicação,
// falha visível com retry idempotente (mesmo clientMsgId) e o contexto inseguro.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toast.success(...a),
    error: (...a: unknown[]) => toast.error(...a),
  },
}));

const apiMock = vi.fn();
const settingsMock = vi.fn();
const listMock = vi.fn();
const openMock = vi.fn();
const delMock = vi.fn();
const chat = vi.fn();
// O painel chama o stream primeiro e usa chatConversation só como fallback (`||`);
// alias no mesmo mock cobre o caminho real em ambos os cenários.
vi.mock("@/lib/bridge", () => ({
  api: (...a: unknown[]) => apiMock(...a),
  loadSettings: (...a: unknown[]) => settingsMock(...a),
  listConversations: (...a: unknown[]) => listMock(...a),
  openConversation: (...a: unknown[]) => openMock(...a),
  deleteConversation: (...a: unknown[]) => delMock(...a),
  chatConversation: (...a: unknown[]) => chat(...a),
  chatConversationStream: (...a: unknown[]) => chat(...a),
}));

vi.mock("@/components/Avatar3D", () => ({ Avatar3D: () => null }));
vi.mock("@/lib/voice", () => ({
  listenOnce: vi.fn(async () => ""),
  speak: vi.fn(async () => {}),
  stopSpeaking: vi.fn(),
  useWake: () => 0,
}));

import { ChatPage } from "@/routes/index";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLACEHOLDER = "Fale ou digite um comando…";
const SEND = "Enviar";
const RETRY = "Tentar novamente";
const FAIL_MSG = "Falha ao enviar — sua mensagem foi preservada. Tente novamente.";

const exchange = (reply = "PONG recebido") => ({
  reply,
  conversation: {
    id: "c1",
    title: "PONG",
    created_at: "2026-10-17T10:00:00.000Z",
    updated_at: "2026-10-17T10:00:00.000Z",
    agent_id: null,
  },
  reasoning: null,
  tools: [],
  pending: [],
});

const type = (text: string) => {
  const ta = screen.getByPlaceholderText(PLACEHOLDER);
  fireEvent.change(ta, { target: { value: text } });
  return ta;
};
const clickSend = () => fireEvent.click(screen.getByRole("button", { name: SEND }));

beforeAll(() => {
  // jsdom não implementa scrollIntoView; o efeito de scroll da conversa o chama.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  for (const m of [
    apiMock,
    settingsMock,
    listMock,
    openMock,
    delMock,
    chat,
    toast.success,
    toast.error,
  ])
    m.mockReset();
  localStorage.clear();
  apiMock.mockImplementation(async (path: string) => (path === "/api/agents" ? [] : {}));
  settingsMock.mockImplementation(async () => ({ general: { agentName: "Jarvis" } }));
  listMock.mockImplementation(async () => []);
  chat.mockImplementation(async () => exchange());
  vi.unstubAllGlobals();
});

describe("envio de mensagem no painel (incidente PONG)", () => {
  it("clique no botão envia: PONG vai ao servidor e a resposta aparece", async () => {
    render(<ChatPage />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    type("PONG");
    clickSend();
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    const [convId, content, id, pin] = chat.mock.calls[0] as [
      string | null,
      string,
      string,
      string | undefined,
    ];
    expect(convId).toBeNull(); // sem conversa selecionada → o servidor cria uma
    expect(content).toBe("PONG");
    expect(V4.test(id)).toBe(true); // clientMsgId válido (idempotência do servidor)
    expect(pin).toBeUndefined();
    expect(screen.getByText("PONG")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("PONG recebido")).toBeInTheDocument());
  });

  it("Enter envia; Shift+Enter preserva a quebra de linha e NÃO envia", async () => {
    render(<ChatPage />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    const ta = type("via enter");
    fireEvent.keyDown(ta, { key: "Enter" });
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    expect(chat.mock.calls[0]![1]).toBe("via enter");

    const ta2 = type("linha 1");
    fireEvent.keyDown(ta2, { key: "Enter", shiftKey: true });
    expect(chat).toHaveBeenCalledTimes(1); // não envia
    expect((ta2 as HTMLTextAreaElement).value).toBe("linha 1"); // texto preservado para continuar digitando
  });

  it("mensagem vazia ou só espaços não gera requisição", async () => {
    render(<ChatPage />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    clickSend();
    type("   ");
    clickSend();
    expect(chat).not.toHaveBeenCalled();
  });

  it("não duplica: novo envio é bloqueado enquanto o anterior está em andamento", async () => {
    let resolveIt: (v: unknown) => void = () => {};
    chat.mockImplementation(
      () =>
        new Promise((res) => {
          resolveIt = res;
        }),
    );
    render(<ChatPage />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    type("PONG");
    clickSend();
    // Durante o envio os botões se trocam: "Enviar" some (nada a reenviar de propósito —
    // sem clique e sem enter) e "Cancelar resposta" toma o lugar no formulário.
    expect(screen.queryByRole("button", { name: SEND })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar resposta" })).toBeInTheDocument();
    expect(chat).toHaveBeenCalledTimes(1);
    resolveIt(exchange());
    await waitFor(() => expect(screen.getByText("PONG recebido")).toBeInTheDocument());
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("falha de API fica visível e o retry reusa o MESMO clientMsgId (sem duplicar no servidor)", async () => {
    chat.mockRejectedValueOnce(new Error("502"));
    render(<ChatPage />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    type("PONG");
    clickSend();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(FAIL_MSG));
    const firstId = chat.mock.calls[0]![2] as string;
    expect(screen.getByText("PONG")).toBeInTheDocument(); // a mensagem não some da interface

    chat.mockImplementationOnce(async () => exchange());
    fireEvent.click(screen.getByRole("button", { name: RETRY }));
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(2));
    expect(chat.mock.calls[1]![2]).toBe(firstId); // idempotência preservada
    await waitFor(() => expect(screen.getByText("PONG recebido")).toBeInTheDocument());
  });

  it("REGRESSÃO: contexto não seguro (HTTP na tailnet, sem crypto.randomUUID) ainda envia", async () => {
    // É exatamente o ambiente real do painel: isSecureContext=false e randomUUID indisponível.
    const { webcrypto } = await import("node:crypto");
    vi.stubGlobal("crypto", { getRandomValues: (b: Uint8Array) => webcrypto.getRandomValues(b) });
    render(<ChatPage />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    type("PONG");
    clickSend();
    await waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    const id = chat.mock.calls[0]![2] as string;
    expect(V4.test(id)).toBe(true); // gerado sem randomUUID, no formato v4 que o servidor aceita
    await waitFor(() => expect(screen.getByText("PONG recebido")).toBeInTheDocument());
  });
});
