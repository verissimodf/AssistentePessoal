// Fase H — regras da lista de conversas na interface: qual conversa fica selecionada após
// recarregar a página (regra pura, sem servidor) e formatação de datas da lista.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatConversationDate, getStoredActive, newClientMsgId, pickActiveConversation, storeActive } from "@/lib/conversations";
import type { ConversationSummary } from "@/lib/bridge";

const conv = (id: string, updated_at = "2026-01-01T10:00:00.000Z"): ConversationSummary =>
  ({ id, title: `conversa ${id}`, created_at: updated_at, updated_at });

describe("seleção da conversa após recarregar (regra adotada)", () => {
  beforeEach(() => localStorage.clear());

  it("mantém a conversa guardada localmente se ela ainda existir no servidor", () => {
    storeActive("c2");
    expect(getStoredActive()).toBe("c2");
    expect(pickActiveConversation(getStoredActive(), [conv("c1"), conv("c2")])).toBe("c2");
  });

  it("cai para a mais recente quando a guardada não existe mais (excluída em outro lugar)", () => {
    storeActive("c9");
    expect(pickActiveConversation(getStoredActive(), [conv("c1"), conv("c2")])).toBe("c1");
  });

  it("sem conversas: começa uma nova (null) — nenhuma conversa é apagada", () => {
    expect(pickActiveConversation("c9", [])).toBeNull();
    expect(pickActiveConversation(null, [])).toBeNull();
  });

  it("é idempotente: recarregar duas vezes com o mesmo estado escolhe a mesma conversa", () => {
    storeActive("c2");
    const list = [conv("c1"), conv("c2")];
    const first = pickActiveConversation(getStoredActive(), list);
    const second = pickActiveConversation(getStoredActive(), list);
    expect(first).toBe("c2");
    expect(second).toBe(first);
  });

  it("limpar a seleção remove a chave local (nova conversa)", () => {
    storeActive("c2");
    storeActive(null);
    expect(getStoredActive()).toBeNull();
    expect(pickActiveConversation(getStoredActive(), [conv("c1")])).toBe("c1");
  });
});

describe("data da lista de conversas", () => {
  it("hoje aparece como hora; datas antigas como dia/mês", () => {
    const today = new Date(Date.now() - 60_000).toISOString();
    expect(formatConversationDate(today, "pt")).toMatch(/\d{2}:\d{2}/);
    expect(formatConversationDate("2020-03-05T12:00:00.000Z", "pt")).toMatch(/05[.\s]*(de\s*)?mar/i);
  });

  it("data inválida → string vazia (nunca texto quebrado na lista)", () => {
    expect(formatConversationDate("não é data", "pt")).toBe("");
  });
});

// Incidente PONG: no painel acessado por HTTP na tailnet (contexto NÃO seguro),
// `crypto.randomUUID` não existe e o envio morria em silêncio. O clientMsgId precisa
// ser gerado mesmo sem randomUUID, no formato UUID v4 que o servidor valida.
describe("clientMsgId do envio (idempotência × contexto do painel)", () => {
  // Mesma regra do servidor (server/conversations.js): UUID v4.
  const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  afterEach(() => vi.unstubAllGlobals());

  it("contexto seguro: usa crypto.randomUUID quando disponível", () => {
    expect(V4.test(newClientMsgId())).toBe(true);
  });

  it("contexto NÃO seguro (sem randomUUID): gera v4 válido com getRandomValues", async () => {
    const { webcrypto } = await import("node:crypto");
    vi.stubGlobal("crypto", { getRandomValues: (b: Uint8Array) => webcrypto.getRandomValues(b) });
    for (let i = 0; i < 20; i++) expect(V4.test(newClientMsgId())).toBe(true);
  });

  it("último recurso (sem randomUUID e sem getRandomValues): ainda gera v4 válido", () => {
    vi.stubGlobal("crypto", {});
    for (let i = 0; i < 20; i++) expect(V4.test(newClientMsgId())).toBe(true);
  });

  it("não colide: 1000 ids distintos", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newClientMsgId()));
    expect(ids.size).toBe(1000);
  });
});
