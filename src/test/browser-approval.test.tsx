import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bridge")>()),
  api: (...args: unknown[]) => api(...args),
}));

import { BrowserApprovalReview } from "@/components/BrowserApprovalReview";

describe("revisão de aprovação Playwright", () => {
  beforeEach(() => {
    api.mockReset();
    api.mockImplementation(async (path: string) => {
      if (path.endsWith("/review"))
        return {
          review: {
            operation: "fill",
            host: "example.com",
            selector: "#email",
            hasText: true,
            preview: "••••••••",
            fingerprint: "fingerprint-locked-to-action",
          },
        };
      if (path === "/api/approvals/approval-1/reveal")
        return {
          review: {
            operation: "fill",
            host: "example.com",
            selector: "#email",
            hasText: true,
            preview: "ana@example.com",
            fingerprint: "fingerprint-locked-to-action",
          },
        };
      return { output: "Ação concluída", status: "done" };
    });
  });

  it("mantém o texto mascarado, exige reautenticação e confirmação, e envia o fingerprint revisado", async () => {
    const onDone = vi.fn();
    render(<BrowserApprovalReview id="approval-1" onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Revisar ação" }));
    await screen.findByText("••••••••");
    expect(screen.queryByText("ana@example.com")).not.toBeInTheDocument();

    const approve = screen.getByRole("button", { name: "Confirmar e executar" });
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Senha para revelar o valor"), {
      target: { value: "senha-atual-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revelar valor" }));
    await screen.findByText("ana@example.com");
    const reauthCall = api.mock.calls.find((call) => call[0] === "/api/auth/reauth");
    expect(reauthCall).toBeDefined();
    const revealCall = api.mock.calls.find(
      (call) => call[0] === "/api/approvals/approval-1/reveal",
    );
    expect(revealCall).toBeDefined();

    fireEvent.click(screen.getByRole("checkbox", { name: /confirmo a escrita/i }));
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ output: "Ação concluída", status: "done" }),
    );
    const decision = api.mock.calls.find((call) => call[0] === "/api/approvals/approval-1");
    expect(JSON.parse(String((decision?.[1] as RequestInit).body))).toEqual({
      approve: true,
      confirmWrite: true,
      fingerprint: "fingerprint-locked-to-action",
    });
  });
});
