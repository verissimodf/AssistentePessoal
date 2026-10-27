import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bridge")>()),
  api: (...args: unknown[]) => api(...args),
}));

import { ConnectionTest, connectionErrorText, connectionText } from "@/components/ConnectionTest";

beforeEach(() => api.mockReset());

const click = (account = "gmail") => {
  render(<ConnectionTest account={account} />);
  fireEvent.click(screen.getByTestId(`conn-test-${account}`));
};

describe("Teste de conexão IMAP/SMTP (aba Comunicação)", () => {
  it("mostra 'conexão validada' quando IMAP e SMTP respondem", async () => {
    api.mockResolvedValue({
      mode: "imap",
      imap: { ok: true, state: "connected", reason: null },
      smtp: { ok: true, state: "connected", reason: null },
    });
    click();
    await waitFor(() =>
      expect(screen.getByTestId("conn-result-gmail")).toHaveTextContent(/conexão validada/i),
    );
    expect(api.mock.calls[0]?.[0]).toBe("/api/mail/gmail/test-connection");
    expect((api.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe("POST");
  });

  it("mostra 'mock' e deixa claro que não é prova de conexão real", async () => {
    api.mockResolvedValue({
      mode: "mock",
      imap: { ok: false, state: "unsupported", reason: null },
      smtp: { ok: false, state: "unsupported", reason: null },
    });
    click();
    await waitFor(() =>
      expect(screen.getByTestId("conn-result-gmail")).toHaveTextContent(/simulado/i),
    );
    expect(screen.getByTestId("conn-result-gmail")).toHaveTextContent(/não verificad/i);
  });

  it("distingue falha de autenticação de falha de rede", async () => {
    api.mockResolvedValue({
      mode: "imap",
      imap: { ok: false, state: "reconnect", reason: "auth" },
      smtp: { ok: false, state: "reconnect", reason: "auth" },
    });
    click();
    await waitFor(() =>
      expect(screen.getByTestId("conn-result-gmail")).toHaveTextContent(/autentica/i),
    );
    api.mockResolvedValue({
      mode: "imap",
      imap: { ok: false, state: "error", reason: "dns" },
      smtp: { ok: false, state: "error", reason: "timeout" },
    });
    fireEvent.click(screen.getByTestId("conn-test-gmail"));
    await waitFor(() =>
      expect(screen.getByTestId("conn-result-gmail")).toHaveTextContent(/DNS|rede/i),
    );
  });

  it("traduz o resultado em texto distinguindo os quatro estados (função pura)", () => {
    const ch = (ok: boolean, state: string, reason: string | null) => ({ ok, state, reason });
    // conexão validada
    expect(
      connectionText({
        mode: "imap",
        imap: ch(true, "connected", null),
        smtp: ch(true, "connected", null),
      }),
    ).toMatch(/validada/i);
    // mock / não verificado — nunca afirma conexão real
    const mock = connectionText({
      mode: "mock",
      imap: ch(false, "unsupported", null),
      smtp: ch(false, "unsupported", null),
    });
    expect(mock).toMatch(/simulado/i);
    expect(mock).toMatch(/não verificad/i);
    // falha de autenticação (não confundir com rede)
    expect(
      connectionText({
        mode: "imap",
        imap: ch(false, "reconnect", "auth"),
        smtp: ch(false, "reconnect", "auth"),
      }),
    ).toMatch(/autentica/i);
    // falha de rede/timeout
    const net = connectionText({
      mode: "imap",
      imap: ch(false, "error", "dns"),
      smtp: ch(false, "error", "timeout"),
    });
    expect(net).toMatch(/DNS/i);
    expect(net).toMatch(/tempo esgotado/i);
  });

  it("trata configuração incompleta como aviso, não como falha fatal (função pura)", () => {
    expect(connectionErrorText('400: {"error":"incomplete_config"}')).toMatch(/incompleta/i);
    expect(connectionErrorText("403: forbidden")).toMatch(/^Falha:/);
  });

  it("mostra o rótulo de mock na tela quando o transporte é simulado", async () => {
    api.mockResolvedValue({
      mode: "mock",
      imap: { ok: false, state: "unsupported", reason: null },
      smtp: { ok: false, state: "unsupported", reason: null },
    });
    render(<ConnectionTest account="gmail" />);
    fireEvent.click(screen.getByTestId("conn-test-gmail"));
    await waitFor(() =>
      expect(screen.getByTestId("conn-result-gmail")).toHaveTextContent(/simulado/i),
    );
  });
});
