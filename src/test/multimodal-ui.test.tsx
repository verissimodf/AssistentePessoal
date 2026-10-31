import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "@/components/Avatar";
import {
  avatarStateFromTurn,
  describeTurnState,
  mmTurnBadgeClass,
  shouldReduceMotion,
  useAudioPlaying,
  voiceCaptureAvailable,
} from "@/lib/multimodal-ui";

// ---------- avatarStateFromTurn — mapeamento HONESTO ----------

describe("avatarStateFromTurn", () => {
  it("listening só aparece com o microfone LIGADO; sem mic → idle", () => {
    expect(avatarStateFromTurn("listening", true, "active")).toBe("listening");
    expect(avatarStateFromTurn("listening", false, "active")).toBe("idle");
  });

  it("speaking só aparece com áudio em reprodução; sem áudio → thinking", () => {
    expect(avatarStateFromTurn("speaking", true, "active", true)).toBe("speaking");
    expect(avatarStateFromTurn("speaking", true, "active", false)).toBe("thinking");
  });

  it("estados de trabalho → thinking", () => {
    for (const s of ["transcribing", "processing", "generating"]) {
      expect(avatarStateFromTurn(s, false, "active")).toBe("thinking");
    }
  });

  it("interrupted → interrupted; failed → error", () => {
    expect(avatarStateFromTurn("interrupted", true, "active")).toBe("interrupted");
    expect(avatarStateFromTurn("failed", true, "active")).toBe("error");
  });

  it("sessão fechada → unavailable, mesmo com turno em estado ativo", () => {
    for (const s of ["listening", "speaking", "processing", "idle"]) {
      expect(avatarStateFromTurn(s, true, "closed", true)).toBe("unavailable");
    }
  });

  it("idle/completed/estado desconhecido → idle", () => {
    expect(avatarStateFromTurn("idle", false, "active")).toBe("idle");
    expect(avatarStateFromTurn("completed", false, "active")).toBe("idle");
    expect(avatarStateFromTurn("zap", true, "active")).toBe("idle");
  });
});

// ---------- describeTurnState — chaves i18n estáveis ----------

describe("describeTurnState", () => {
  it("cobre todos os estados de turno com chave mm_state_*", () => {
    expect(describeTurnState("listening", true)).toBe("mm_state_listening");
    expect(describeTurnState("listening", false)).toBe("mm_state_idle"); // nunca "ouvindo" sem mic
    expect(describeTurnState("transcribing")).toBe("mm_state_transcribing");
    expect(describeTurnState("processing")).toBe("mm_state_processing");
    expect(describeTurnState("generating")).toBe("mm_state_generating");
    expect(describeTurnState("speaking")).toBe("mm_state_speaking");
    expect(describeTurnState("interrupted")).toBe("mm_state_interrupted");
    expect(describeTurnState("completed")).toBe("mm_state_completed");
    expect(describeTurnState("failed")).toBe("mm_state_failed");
    expect(describeTurnState("qualquer-coisa")).toBe("mm_state_unknown");
  });
});

describe("mmTurnBadgeClass", () => {
  it("concluído=verde, falha=destrutivo padrão, ativos=amarelo, outros=muted", () => {
    expect(mmTurnBadgeClass("completed")).toContain("emerald");
    expect(mmTurnBadgeClass("failed")).toBe("text-muted-foreground");
    for (const s of ["listening", "transcribing", "processing", "generating", "interrupted"]) {
      expect(mmTurnBadgeClass(s)).toContain("yellow");
    }
    expect(mmTurnBadgeClass("speaking")).toContain("blue");
    expect(mmTurnBadgeClass("idle")).toBe("text-muted-foreground");
  });
});

// ---------- shouldReduceMotion / voiceCaptureAvailable ----------

describe("shouldReduceMotion", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it("retorna true quando prefers-reduced-motion: reduce", () => {
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    expect(shouldReduceMotion()).toBe(true);
  });

  it("retorna false sem preferência e quando matchMedia não existe", () => {
    expect(shouldReduceMotion()).toBe(false); // setup.ts: matches: false
    const w = window as { matchMedia?: unknown };
    const saved = w.matchMedia;
    w.matchMedia = undefined;
    expect(shouldReduceMotion()).toBe(false);
    w.matchMedia = saved;
  });
});

describe("voiceCaptureAvailable", () => {
  it("em jsdom (sem mediaDevices/MediaRecorder) a captura de voz é indisponível", () => {
    expect(voiceCaptureAvailable()).toBe(false);
  });
});

// ---------- useAudioPlaying — sincronização com eventos REAIS de <audio> ----------

class FakeAudio extends EventTarget {
  paused = true;
  ended = false;
  asElement(): HTMLAudioElement {
    return this as unknown as HTMLAudioElement;
  }
}

describe("useAudioPlaying", () => {
  it("só fica true com play/playing e volta a false em pause/ended/error", () => {
    const el = new FakeAudio();
    const { result, rerender } = renderHook(
      (p: { a: FakeAudio | null }) => useAudioPlaying(p.a?.asElement() ?? null),
      { initialProps: { a: null as FakeAudio | null } },
    );
    expect(result.current).toBe(false);

    rerender({ a: el });
    expect(result.current).toBe(false);

    act(() => {
      el.paused = false;
      el.dispatchEvent(new Event("play"));
    });
    expect(result.current).toBe(true);

    act(() => {
      el.dispatchEvent(new Event("pause"));
    });
    expect(result.current).toBe(false);

    act(() => {
      el.dispatchEvent(new Event("play"));
    });
    expect(result.current).toBe(true);

    act(() => {
      el.ended = true;
      el.dispatchEvent(new Event("ended"));
    });
    expect(result.current).toBe(false);

    act(() => {
      el.dispatchEvent(new Event("error"));
    });
    expect(result.current).toBe(false);
  });

  it("ao trocar/remover o elemento, a reprodução zera", () => {
    const el = new FakeAudio();
    const { result, rerender } = renderHook(
      (p: { a: FakeAudio | null }) => useAudioPlaying(p.a?.asElement() ?? null),
      { initialProps: { a: el as FakeAudio | null } },
    );
    act(() => {
      el.paused = false;
      el.dispatchEvent(new Event("playing"));
    });
    expect(result.current).toBe(true);
    rerender({ a: null });
    expect(result.current).toBe(false);
  });
});

// ---------- Avatar — render e fallback estático ----------

describe("Avatar", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it("renderiza cada estado com data-state distinto e formas próprias", () => {
    for (const state of [
      "idle",
      "listening",
      "thinking",
      "speaking",
      "interrupted",
      "error",
      "unavailable",
    ] as const) {
      const { container, unmount } = render(<Avatar state={state} />);
      const root = screen.getByTestId("mm-avatar");
      expect(root).toHaveAttribute("data-state", state);
      expect(root).toHaveAttribute("data-reduced", "false");
      if (state === "listening") expect(container.querySelectorAll(".mm-ring").length).toBe(2);
      if (state === "speaking") expect(container.querySelectorAll(".mm-bar").length).toBe(5);
      if (state === "thinking") expect(container.querySelector(".mm-orbit")).not.toBeNull();
      if (state === "interrupted" || state === "unavailable")
        expect(container.querySelector("line")).not.toBeNull();
      unmount();
    }
  });

  it("com prefers-reduced-motion, NÃO há classes de animação (fallback estático)", () => {
    window.matchMedia = ((q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const { container } = render(<Avatar state="listening" />);
    expect(screen.getByTestId("mm-avatar")).toHaveAttribute("data-reduced", "true");
    expect(container.querySelector(".mm-breathe")).toBeNull();
    expect(container.querySelector(".mm-ring")).toBeNull();
    expect(container.querySelector(".mm-bar")).toBeNull();
    expect(container.querySelector(".mm-orbit")).toBeNull();
  });

  it("respeita rótulo acessível (aria-label)", () => {
    render(<Avatar state="speaking" label="Assistente falando" />);
    expect(screen.getByRole("img", { name: "Assistente falando" })).toBeInTheDocument();
  });
});
