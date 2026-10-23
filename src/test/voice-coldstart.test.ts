import { describe, expect, it } from "vitest";
import { isVoiceWarmingUp, warmingRetryDelay } from "@/lib/voice";

// P2-A (cliente): o painel distingue o cold-start do TTS local e espera o tempo anunciado antes de
// repetir uma única vez — em vez de tratar como falha genérica.
describe("TTS local — estado de aquecimento", () => {
  it("reconhece o estado de aquecimento pela mensagem do endpoint", () => {
    expect(isVoiceWarmingUp('503: {"error":"voice_warming_up","state":"warming_up"}')).toBe(true);
    expect(isVoiceWarmingUp('503: {"error":"voice_unavailable"}')).toBe(false);
    expect(isVoiceWarmingUp("")).toBe(false);
  });

  it("usa o retryAfter anunciado, com piso e teto", () => {
    expect(warmingRetryDelay('503: {"error":"voice_warming_up","retryAfter":3}')).toBe(3000);
    expect(warmingRetryDelay('503: {"error":"voice_warming_up","retryAfter":1}')).toBe(1000);
    // valor absurdo é limitado ao teto; ausência usa o fallback
    expect(warmingRetryDelay('"retryAfter":9999')).toBe(30_000);
    expect(warmingRetryDelay("sem retryAfter", 4000)).toBe(4000);
    // nunca espera zero/negativo
    expect(warmingRetryDelay("retryAfter: 0")).toBe(250);
  });
});
