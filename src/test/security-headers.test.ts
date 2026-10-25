import { describe, it, expect } from "vitest";
import { withSecurityHeaders, PANEL_SECURITY_HEADERS } from "../lib/security-headers";

describe("cabeçalhos de segurança do painel", () => {
  it("adiciona nosniff, referrer-policy e proteção contra enquadramento", () => {
    const out = withSecurityHeaders(
      new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    expect(out.headers.get("x-content-type-options")).toBe("nosniff");
    expect(out.headers.get("referrer-policy")).toBe("no-referrer");
    expect(out.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(out.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
  });

  it("preserva status, corpo e content-type", async () => {
    const out = withSecurityHeaders(
      new Response("<html>painel</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    expect(out.status).toBe(200);
    expect(out.headers.get("content-type")).toBe("text/html");
    expect(await out.text()).toBe("<html>painel</html>");
  });

  it("não sobrescreve um cabeçalho já definido pela aplicação", () => {
    const out = withSecurityHeaders(
      new Response("ok", {
        status: 200,
        headers: { "content-security-policy": "default-src 'self'" },
      }),
    );
    expect(out.headers.get("content-security-policy")).toBe("default-src 'self'");
    expect(out.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("lida com respostas sem corpo (204/304) sem lançar", () => {
    for (const status of [204, 304]) {
      const out = withSecurityHeaders(new Response(null, { status }));
      expect(out.status).toBe(status);
      expect(out.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("o conjunto declarado é exatamente o aplicado", () => {
    const out = withSecurityHeaders(new Response("x"));
    for (const [k, v] of Object.entries(PANEL_SECURITY_HEADERS)) expect(out.headers.get(k)).toBe(v);
  });
});
