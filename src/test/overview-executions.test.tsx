import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { listApprovals, listExecutions } from "@/lib/bridge";

// P0.1 — as novas áreas administrativas precisam existir como rotas e as listagens
// precisam ser REAIS: quando o backend está indisponível retornam `null` (indisponível),
// nunca dados de demonstração apresentados como reais.
describe("Painel P0.1 — rotas", () => {
  it("registra a Visão geral em /visao-geral", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    expect(router.matchRoutes("/visao-geral").at(-1)?.routeId).toBe("/visao-geral");
  });

  it("registra Execuções em /execucoes", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    expect(router.matchRoutes("/execucoes").at(-1)?.routeId).toBe("/execucoes");
  });
});

describe("Painel P0.1 — listagens sem backend", () => {
  afterEach(() => vi.restoreAllMocks());

  it("listApprovals/listExecutions retornam null (indisponível), nunca demo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await listApprovals()).toBeNull();
    expect(await listExecutions()).toBeNull();
  });
});
