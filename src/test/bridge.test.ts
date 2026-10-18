import { beforeEach, describe, expect, it } from "vitest";

import { bridgeUrl, resolveBridge } from "@/lib/bridge";

// resolveBridge decides which base URL the panel uses to reach the local service.
// It must keep the explicit :7777 port on loopback (dev) and on non-HTTPS remote
// hosts (Tailscale relay), and switch to the page's own origin on HTTPS, where a
// reverse proxy serves panel + API under a single hostname.
describe("resolveBridge", () => {
  it("keeps :7777 on localhost (local development)", () => {
    expect(
      resolveBridge({ protocol: "http:", hostname: "localhost", origin: "http://localhost:3000" }),
    ).toBe("http://localhost:7777");
  });

  it("keeps :7777 on 127.0.0.1", () => {
    expect(
      resolveBridge({ protocol: "http:", hostname: "127.0.0.1", origin: "http://127.0.0.1:8090" }),
    ).toBe("http://127.0.0.1:7777");
  });

  it("uses the page origin on a remote HTTPS hostname, without a fixed port", () => {
    const url = resolveBridge({
      protocol: "https:",
      hostname: "jarvis.laytech.com.br",
      origin: "https://jarvis.laytech.com.br",
    });
    expect(url).toBe("https://jarvis.laytech.com.br");
    expect(url).not.toContain(":7777");
  });

  it("keeps :7777 on a non-HTTPS remote host (Tailscale relay)", () => {
    expect(
      resolveBridge({
        protocol: "http:",
        hostname: "100.87.104.126",
        origin: "http://100.87.104.126:8090",
      }),
    ).toBe("http://100.87.104.126:7777");
  });

  it("falls back to localhost when there is no hostname (SSR / file://)", () => {
    expect(resolveBridge({ protocol: "http:", hostname: "" })).toBe("http://localhost:7777");
  });
});

describe("bridgeUrl override", () => {
  beforeEach(() => localStorage.clear());

  it("honours the explicit localStorage override", () => {
    localStorage.setItem("jarvis.bridge", "https://bridge.example.test");
    expect(bridgeUrl()).toBe("https://bridge.example.test");
  });

  it("uses DEFAULT_BRIDGE when no override is set", () => {
    expect(bridgeUrl()).toBe(resolveBridge(window.location));
  });
});
