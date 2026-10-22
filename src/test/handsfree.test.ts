// src/test/handsfree.test.ts
// Validação do motor unificado Hands-Free, Wake Word offline, VAD e Barge-In para a Release v1.7.0.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createClapDetector,
  createVAD,
  createOfflineWakeWordDetector,
  matchesWakeWord,
  thresholdFromSensitivity,
  startHandsFreeSession,
} from "@/lib/handsfree";
import { speak, stopSpeaking } from "@/lib/voice";

describe("Hands-Free — VAD (Voice Activity Detection)", () => {
  it("discrimina buffers de silêncio de buffers de fala com base em RMS e ZCR", () => {
    const vad = createVAD({ energyThreshold: 0.03, speechHangoverMs: 100, silenceTimeoutMs: 200 });

    // Buffer de silêncio (amplitude 0.005)
    const silenceBuffer = new Float32Array(512).fill(0.005);
    const silenceResult = vad.process(silenceBuffer, 1000);
    expect(silenceResult.isVoice).toBe(false);
    expect(silenceResult.speechStarted).toBe(false);

    // Buffer com sinal senoidal com energia típica de voz humana (amplitude 0.15, frequência ~200Hz)
    const voiceBuffer = new Float32Array(512);
    for (let i = 0; i < voiceBuffer.length; i++) {
      voiceBuffer[i] = 0.15 * Math.sin((2 * Math.PI * 200 * i) / 16000);
    }

    // Primeiro frame: inicia detecção
    const frame1 = vad.process(voiceBuffer, 1050);
    expect(frame1.speechStarted).toBe(false); // ainda dentro do hangover (< 100ms)

    // Segundo frame após ultrapassar o speechHangoverMs (160ms decorridos)
    const frame2 = vad.process(voiceBuffer, 1160);
    expect(frame2.speechStarted).toBe(true);
    expect(vad.isSpeaking).toBe(true);

    // Retorno ao silêncio: após silenceTimeoutMs (200ms), deve sinalizar speechEnded
    vad.process(silenceBuffer, 1200);
    const endFrame = vad.process(silenceBuffer, 1420);
    expect(endFrame.speechEnded).toBe(true);
    expect(vad.isSpeaking).toBe(false);
  });
});

describe("Hands-Free — Offline Wake Word 'Jarvis'", () => {
  it("detecta envelope de energia acústica compatível com a palavra 'Jarvis'", () => {
    const detector = createOfflineWakeWordDetector({
      minDurationMs: 300,
      maxDurationMs: 1200,
      energyThreshold: 0.03,
    });

    const onsetBuffer = new Float32Array(512);
    // Ataque inicial [dʒ/j]
    for (let i = 0; i < onsetBuffer.length; i++) {
      onsetBuffer[i] = 0.06 * (Math.random() * 2 - 1);
    }
    detector.feed(onsetBuffer, undefined, 1000);

    // Corpo vocálico [ar]
    const vowelBuffer = new Float32Array(512);
    for (let i = 0; i < vowelBuffer.length; i++) {
      vowelBuffer[i] = 0.12 * Math.sin((2 * Math.PI * 400 * i) / 16000);
    }
    detector.feed(vowelBuffer, undefined, 1300);

    // Sibilante final [s] com ZCR alto
    const sibilantBuffer = new Float32Array(512);
    for (let i = 0; i < sibilantBuffer.length; i++) {
      sibilantBuffer[i] = 0.08 * ((i % 2 === 0 ? 1 : -1) * Math.random());
    }
    detector.feed(sibilantBuffer, undefined, 1500);

    // Fim da palavra (silêncio) -> ativação do Wake Word
    const silence = new Float32Array(512).fill(0);
    const triggered = detector.feed(silence, undefined, 1600);
    expect(triggered).toBe(true);
  });

  it("rejeita ruído estático e estalos curtos isolados", () => {
    const detector = createOfflineWakeWordDetector();
    const click = new Float32Array(512).fill(0);
    click[10] = 0.8; // pico isolado curto

    expect(detector.feed(click, undefined, 1000)).toBe(false);
    expect(detector.feed(new Float32Array(512).fill(0), undefined, 1050)).toBe(false);
  });
});

describe("Hands-Free — Duplo Aplauso e Compatibilidade", () => {
  it("dispara em dois aplausos no intervalo calibrado", () => {
    const clap = createClapDetector();
    expect(clap.feed(0.8, 1000)).toBe(false);
    expect(clap.feed(0.8, 1350)).toBe(true);
  });

  it("respeita mapeamento de sensibilidade para threshold", () => {
    expect(thresholdFromSensitivity(10)).toBeLessThan(thresholdFromSensitivity(1));
  });

  it("matchesWakeWord detecta 'Jarvis' com insensibilidade a acentos e caixa", () => {
    expect(matchesWakeWord("Olá, Jarvis, você está aí?", "Jarvis")).toBe(true);
    expect(matchesWakeWord("boa noite jàrvís", "jarvis")).toBe(true);
    expect(matchesWakeWord("nada a ver", "jarvis")).toBe(false);
  });
});

describe("Voz Full-Duplex — Interrupção (Barge-In) e Playback", () => {
  beforeEach(() => {
    class MockUtterance {
      text: string;
      lang = "";
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
    vi.stubGlobal("speechSynthesis", {
      speak: vi.fn(),
      cancel: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stopSpeaking cancela síntese de voz imediatamente", async () => {
    const promise = speak("Texto de resposta longo...", "pt-BR", "browser");
    stopSpeaking();
    await promise;

    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  it("speak respeita sinal de AbortController (Barge-In instantâneo)", async () => {
    const ac = new AbortController();
    ac.abort();

    const promise = speak("Interrompido antes de iniciar", "pt-BR", "browser", undefined, ac.signal);
    await promise;

    // Não deve invocar fala se o sinal já iniciou abortado
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });
});
