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
/** Indexed access with the strict `noUncheckedIndexedAccess` contract made explicit. */
const itemAt = (i: number) => {
  const el = screen.getAllByTestId("draft-item")[i];
  if (!el) throw new Error(`draft item ${i} not found`);
  return el;
};

beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "/api/mail/drafts") return drafts;
    const m = /^\/api\/mail\/drafts\/([^/]+)(\/send)?$/.exec(path);
    if (m && m[2] === "/send") return { ok: true, state: "sent" };
    if (m && init?.method === "DELETE") return { ok: true };
    if (m)
      return {
        ...drafts.find((d) => d.id === m[1]),
        body: m[1] === "d1" ? "corpo do rascunho" : null,
      };
    return {};
  });
});

describe("E-mail drafts page", () => {
  it("lists the drafts with their real states", async () => {
    render(<DraftsPage />);
    await waitFor(() => expect(screen.getAllByTestId("draft-item")).toHaveLength(2));
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText("Enviado")).toBeInTheDocument();
  });

  it("opening a draft only reads it — never an approval", async () => {
    render(<DraftsPage />);
    await waitFor(() => expect(screen.getAllByTestId("draft-item")).toHaveLength(2));
    fireEvent.click(itemAt(0));
    await waitFor(() =>
      expect(screen.getByTestId("draft-body")).toHaveTextContent("corpo do rascunho"),
    );
    expect(callFor("/api/mail/drafts/d1/send", "POST")).toBeUndefined();
  });

  it("requires an explicit confirmation before sending, using confirm: ENVIAR", async () => {
    render(<DraftsPage />);
    await waitFor(() => expect(screen.getAllByTestId("draft-item")).toHaveLength(2));
    fireEvent.click(itemAt(0));
    await waitFor(() => expect(screen.getByTestId("draft-send")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("draft-send"));
    expect(screen.getByTestId("draft-confirm")).toBeInTheDocument();
    expect(callFor("/api/mail/drafts/d1/send", "POST")).toBeUndefined(); // revealing the confirmation does not send

    fireEvent.click(screen.getByTestId("draft-confirm"));
    await waitFor(() => expect(callFor("/api/mail/drafts/d1/send", "POST")).toBeDefined());
    const call = callFor("/api/mail/drafts/d1/send", "POST")!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ confirm: "ENVIAR" });
  });

  it("a non-pending draft cannot be sent or cancelled", async () => {
    render(<DraftsPage />);
    await waitFor(() => expect(screen.getAllByTestId("draft-item")).toHaveLength(2));
    fireEvent.click(itemAt(1)); // d2 = sent
    await waitFor(() => expect(screen.getByTestId("draft-body")).toBeInTheDocument());
    expect(screen.queryByTestId("draft-send")).toBeNull();
    expect(screen.queryByTestId("draft-cancel")).toBeNull();
  });

  it("cancelling discards the draft", async () => {
    render(<DraftsPage />);
    await waitFor(() => expect(screen.getAllByTestId("draft-item")).toHaveLength(2));
    fireEvent.click(itemAt(0));
    await waitFor(() => expect(screen.getByTestId("draft-cancel")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("draft-cancel"));
    await waitFor(() => expect(callFor("/api/mail/drafts/d1", "DELETE")).toBeDefined());
  });
});
