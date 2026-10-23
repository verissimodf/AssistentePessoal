import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bridge")>()),
  api: (...args: unknown[]) => api(...args),
}));

import { DraftsPage } from "@/routes/rascunhos";

const drafts = [
  {
    id: "d1",
    account: "gmail",
    to: "a@x.test",
    subject: "Um",
    state: "pending",
    createdAt: "2026-10-15T10:00:00Z",
    expiresAt: "2026-10-15T10:10:00Z",
  },
  {
    id: "d2",
    account: "gmail",
    to: "b@x.test",
    subject: "Dois",
    state: "sent",
    createdAt: "2026-10-15T09:00:00Z",
    expiresAt: "2026-10-15T09:05:00Z",
  },
];

const methodOf = (call: unknown[]) => (call[1] as RequestInit | undefined)?.method;
const callFor = (path: string, method?: string) =>
  api.mock.calls.find((c) => c[0] === path && methodOf(c) === method);
const itemAt = (i: number) => {
  const el = screen.getAllByTestId("draft-item")[i];
  if (!el) throw new Error(`draft item ${i} not found`);
  return el;
};
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/mail/accounts")
      return [{ type: "gmail", user: "a***@x.test", enabled: true, hasPassword: true }];
    if (path === "/api/mail/drafts" && init?.method === "POST")
      return { id: "novo-1", state: "pending", expiresAt: Date.now() + 600_000 };
    if (path === "/api/mail/drafts") return drafts;
    const m = /^\/api\/mail\/drafts\/([^/]+)(\/send)?$/.exec(path);
    if (m && m[2] === "/send") return { ok: true, state: "sent" };
    if (m && init?.method === "PUT") return { ...drafts[0], ...bodyOf([path, init]) };
    if (m && init?.method === "DELETE") return { ok: true };
    if (m) return { ...drafts.find((d) => d.id === m[1]), body: m[1] === "d1" ? "corpo" : null };
    return {};
  });
});

describe("E-mail drafts — composição e edição", () => {
  it("oferece caixa de composição com conta, destinatário, assunto e corpo", async () => {
    render(<DraftsPage />);
    await waitFor(() => expect(screen.getByTestId("draft-compose")).toBeInTheDocument());
    expect(screen.getByTestId("compose-to")).toBeInTheDocument();
    expect(screen.getByTestId("compose-subject")).toBeInTheDocument();
    expect(screen.getByTestId("compose-body")).toBeInTheDocument();
    // A conta vem da lista de contas do admin.
    await waitFor(() => expect(screen.getByTestId("compose-account")).toBeInTheDocument());
  });

  it("criar rascunho faz POST e NUNCA envia", async () => {
    render(<DraftsPage />);
    await waitFor(() => expect(screen.getByTestId("compose-to")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("compose-to"), { target: { value: "dest@x.test" } });
    fireEvent.change(screen.getByTestId("compose-subject"), { target: { value: "Assunto novo" } });
    fireEvent.change(screen.getByTestId("compose-body"), { target: { value: "Corpo novo" } });
    fireEvent.click(screen.getByTestId("compose-submit"));
    await waitFor(() => expect(callFor("/api/mail/drafts", "POST")).toBeDefined());
    expect(bodyOf(callFor("/api/mail/drafts", "POST")!)).toEqual({
      account: "gmail",
      to: "dest@x.test",
      subject: "Assunto novo",
      body: "Corpo novo",
    });
    expect(
      api.mock.calls.some((c) => String(c[0]).includes("/send")),
      "compor nunca envia",
    ).toBe(false);
  });

  it("não submete composição incompleta (sem destinatário ou sem corpo)", async () => {
    render(<DraftsPage />);
    await waitFor(() => expect(screen.getByTestId("compose-to")).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("compose-body"), { target: { value: "só corpo" } });
    fireEvent.click(screen.getByTestId("compose-submit"));
    await new Promise((r) => setTimeout(r, 10));
    expect(callFor("/api/mail/drafts", "POST")).toBeUndefined();
  });

  it("edita um rascunho pendente e faz PUT com os novos valores", async () => {
    render(<DraftsPage />);
    await waitFor(() => expect(screen.getAllByTestId("draft-item")).toHaveLength(2));
    fireEvent.click(itemAt(0)); // d1 = pending
    await waitFor(() => expect(screen.getByTestId("draft-edit")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("draft-edit"));
    const to = await screen.findByTestId("edit-to");
    fireEvent.change(to, { target: { value: "editado@x.test" } });
    fireEvent.change(screen.getByTestId("edit-subject"), { target: { value: "Revisado" } });
    fireEvent.change(screen.getByTestId("edit-body"), { target: { value: "Corpo revisado" } });
    fireEvent.click(screen.getByTestId("edit-save"));
    await waitFor(() => expect(callFor("/api/mail/drafts/d1", "PUT")).toBeDefined());
    expect(bodyOf(callFor("/api/mail/drafts/d1", "PUT")!)).toEqual({
      to: "editado@x.test",
      subject: "Revisado",
      body: "Corpo revisado",
    });
  });

  it("não oferece edição para rascunho não pendente", async () => {
    render(<DraftsPage />);
    await waitFor(() => expect(screen.getAllByTestId("draft-item")).toHaveLength(2));
    fireEvent.click(itemAt(1)); // d2 = sent
    await waitFor(() => expect(screen.getByTestId("draft-body")).toBeInTheDocument());
    expect(screen.queryByTestId("draft-edit")).toBeNull();
  });
});
