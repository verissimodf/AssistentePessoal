import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toast.success(...a),
    error: (...a: unknown[]) => toast.error(...a),
  },
}));
vi.mock("@/lib/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bridge")>()),
  api: (...args: unknown[]) => api(...args),
  useAuthState: () => "ok",
  currentAdmin: () => ({ id: "a1", username: "ana" }),
}));

import { SecurityPanel } from "@/components/SecurityPanel";

const defaults = (path: string) => {
  if (path === "/api/auth/admins")
    return [{ id: "a1", username: "ana", active: 1, created_at: "2026-01-01" }];
  if (path === "/api/auth/sessions") return [];
  if (path === "/api/auth/tokens") return [];
  if (path === "/api/legacy") return { resources: {}, settings: { present: false } };
  return {};
};
const callFor = (path: string, method?: string) =>
  api.mock.calls.find(
    (c) =>
      c[0] === path && ((c[1] as RequestInit | undefined)?.method ?? "GET") === (method ?? "GET"),
  );
const fill = () => {
  fireEvent.change(screen.getByPlaceholderText("Senha atual"), {
    target: { value: "senha-atual-123" },
  });
  fireEvent.change(screen.getByPlaceholderText("Nova senha (mín. 12)"), {
    target: { value: "senha-nova-123456" },
  });
  fireEvent.change(screen.getByPlaceholderText("Confirmar nova senha"), {
    target: { value: "senha-nova-123456" },
  });
};

beforeEach(() => {
  api.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  api.mockImplementation(async (path: string) => defaults(path));
});

describe("Trocar senha (Segurança)", () => {
  it("envia as três senhas em POST e limpa os campos no sucesso", async () => {
    api.mockImplementation(async (path: string) =>
      path === "/api/auth/password" ? { ok: true, sessionsRevoked: 1 } : defaults(path),
    );
    render(<SecurityPanel />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Trocar senha" })).toBeInTheDocument(),
    );
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Trocar senha" }));
    await waitFor(() => expect(callFor("/api/auth/password", "POST")).toBeDefined());
    const body = JSON.parse(
      String((callFor("/api/auth/password", "POST")?.[1] as RequestInit).body),
    );
    expect(body).toEqual({
      currentPassword: "senha-atual-123",
      newPassword: "senha-nova-123456",
      confirmPassword: "senha-nova-123456",
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect((screen.getByPlaceholderText("Senha atual") as HTMLInputElement).value).toBe("");
    expect((screen.getByPlaceholderText("Nova senha (mín. 12)") as HTMLInputElement).value).toBe(
      "",
    );
    expect((screen.getByPlaceholderText("Confirmar nova senha") as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("mostra mensagem clara de senha atual incorreta e não expõe o corpo cru do erro", async () => {
    api.mockImplementation(async (path: string) => {
      if (path === "/api/auth/password") throw new Error('403: {"error":"reauth_failed"}');
      return defaults(path);
    });
    render(<SecurityPanel />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Trocar senha" })).toBeInTheDocument(),
    );
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Trocar senha" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Senha atual incorreta."));
  });

  it("confirmação divergente tem mensagem própria de política/erro", async () => {
    api.mockImplementation(async (path: string) => {
      if (path === "/api/auth/password") throw new Error('400: {"error":"password_mismatch"}');
      return defaults(path);
    });
    render(<SecurityPanel />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Trocar senha" })).toBeInTheDocument(),
    );
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Trocar senha" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("A confirmação não confere com a nova senha."),
    );
  });
});
