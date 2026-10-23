import { useCallback, useEffect, useRef, useState } from "react";
import { api, ping } from "./bridge";
import {
  startHandsFreeSession,
  type HandsFreeConfig,
  createClapDetector,
  matchesWakeWord,
  thresholdFromSensitivity,
} from "./handsfree";

export { createClapDetector, matchesWakeWord, thresholdFromSensitivity };

type Rec = any;
const getRecognition = (): Rec | null => {
  const w = window as any;
  const C = w.SpeechRecognition || w.webkitSpeechRecognition;
  return C ? new C() : null;
};

export function listenOnce(lang: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rec = getRecognition();
    if (!rec) return reject(new Error("Speech recognition not supported in this browser"));
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => resolve(e.results[0][0].transcript);
    rec.onerror = (e: any) => reject(new Error(e.error));
    rec.onend = () => resolve("");
    rec.start();
  });
}

/** Controlador de reprodução atual para interrupção de fala (Barge-In) */
let currentPlayback: {
  stop: () => void;
} | null = null;

/**
 * Interrompe imediatamente qualquer reprodução de áudio/TTS em andamento.
 * Utilizado pelo mecanismo de Barge-In quando o usuário começa a falar.
 */
export function stopSpeaking() {
  if (currentPlayback) {
    try {
      currentPlayback.stop();
    } catch {}
    currentPlayback = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
}

/** P2-A: reconhece o estado de aquecimento do TTS local (cold-start do XTTS). */
export const isVoiceWarmingUp = (message: string) => /voice_warming_up/i.test(String(message ?? ""));

/** Espera antes de repetir uma síntese em aquecimento (usa o retryAfter anunciado, com teto). */
export function warmingRetryDelay(message: string, fallbackMs = 5000): number {
  const m = /retryAfter[^0-9]{0,6}(\d+)/i.exec(String(message ?? ""));
  const secs = m ? Number(m[1]) : NaN;
  const ms = Number.isFinite(secs) && secs >= 0 ? secs * 1000 : fallbackMs;
  return Math.min(Math.max(ms, 250), 30_000);
}

/**
 * Reproduz texto via TTS local (/api/tts) ou SpeechSynthesis do navegador.
 * Suporta cancelamento e sinal de interrupção (Barge-In).
 */
export async function speak(
  text: string,
  lang: string,
  engine: string,
  onLevel?: (l: number) => void,
  signal?: AbortSignal
): Promise<void> {
  stopSpeaking();
  if (signal?.aborted) return;

  const plain = text.replace(/[*_#`>\[\]()]/g, "");

  if (engine !== "browser" && (await ping())) {
    try {
      let blob: Blob;
      try {
        blob = await api<Blob>("/api/tts", {
          method: "POST",
          body: JSON.stringify({ text: plain, lang }),
        });
      } catch (e) {
        // Cold-start: o modelo local ainda está carregando — espera e tenta UMA vez.
        if (!isVoiceWarmingUp(String((e as Error)?.message ?? e))) throw e;
        await new Promise((r) => setTimeout(r, warmingRetryDelay(String((e as Error)?.message ?? e))));
        if (signal?.aborted) return;
        blob = await api<Blob>("/api/tts", {
          method: "POST",
          body: JSON.stringify({ text: plain, lang }),
        });
      }
      if (signal?.aborted) return;

      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = AudioContextClass ? new AudioContextClass() : null;
      let raf = 0;

      return new Promise<void>((resolve) => {
        let finished = false;
        const cleanup = () => {
          if (finished) return;
          finished = true;
          cancelAnimationFrame(raf);
          onLevel?.(0);
          audio.pause();
          audio.currentTime = 0;
          URL.revokeObjectURL(audioUrl);
          ctx?.close().catch(() => {});
          currentPlayback = null;
          resolve();
        };

        currentPlayback = { stop: cleanup };
        signal?.addEventListener("abort", cleanup, { once: true });

        if (ctx) {
          try {
            const src = ctx.createMediaElementSource(audio);
            const an = ctx.createAnalyser();
            src.connect(an);
            an.connect(ctx.destination);
            const buf = new Uint8Array(an.frequencyBinCount);

            const loop = () => {
              if (finished) return;
              an.getByteFrequencyData(buf);
              onLevel?.(buf.reduce((a, b) => a + b, 0) / buf.length / 255);
              raf = requestAnimationFrame(loop);
            };
            loop();
          } catch {
            // Em caso de restrição do AudioContext, prossegue com playback padrão
          }
        }

        audio.onended = cleanup;
        audio.onerror = cleanup;
        audio.play().catch(() => cleanup());
      });
    } catch (e) {
      console.warn("Local TTS failed, using browser voice", e);
    }
  }

  return new Promise<void>((resolve) => {
    let finished = false;
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (timer) clearInterval(timer);
      onLevel?.(0);
      try {
        window.speechSynthesis.cancel();
      } catch {}
      currentPlayback = null;
      resolve();
    };

    currentPlayback = { stop: cleanup };
    signal?.addEventListener("abort", cleanup, { once: true });

    if (typeof window === "undefined" || !window.speechSynthesis) {
      cleanup();
      return;
    }

    const UtteranceClass =
      (window as unknown as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance ||
      (globalThis as unknown as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }).SpeechSynthesisUtterance;

    if (!UtteranceClass) {
      cleanup();
      return;
    }

    const u = new UtteranceClass(plain);
    u.lang = lang;
    timer = setInterval(() => onLevel?.(0.2 + Math.random() * 0.5), 90);

    u.onend = cleanup;
    u.onerror = cleanup;

    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      cleanup();
    }
  });
}

/**
 * Hook de escuta Hands-Free unificado:
 * - Palmas duplas (Clap)
 * - Wake Word falada ("Jarvis" ou nome do agente)
 * - Atalho global de teclado (Ctrl+Shift+J)
 * - VAD e detecção de interrupção (Barge-In) em full-duplex
 */
export function useHandsFree(opts: {
  enabled: boolean;
  clap: boolean;
  word: boolean;
  hotkey: boolean;
  sensitivity: number;
  name: string;
  lang: string;
  isSpeaking?: boolean;
  onWake: () => void;
  onBargeIn?: () => void;
}) {
  const [micLevel, setMicLevel] = useState(0);
  const wakeCb = useRef(opts.onWake);
  const bargeCb = useRef(opts.onBargeIn);
  wakeCb.current = opts.onWake;
  bargeCb.current = opts.onBargeIn;

  useEffect(() => {
    if (!opts.enabled) return;

    const session = startHandsFreeSession({
      enabled: opts.enabled,
      clap: opts.clap,
      word: opts.word,
      hotkey: opts.hotkey,
      sensitivity: opts.sensitivity,
      agentName: opts.name,
      lang: opts.lang,
      isSpeaking: !!opts.isSpeaking,
      onWake: () => wakeCb.current(),
      onBargeIn: () => bargeCb.current?.(),
      onLevel: (l) => setMicLevel(l),
    });

    return () => {
      session.stop();
    };
  }, [
    opts.enabled,
    opts.clap,
    opts.word,
    opts.hotkey,
    opts.sensitivity,
    opts.name,
    opts.lang,
    opts.isSpeaking,
  ]);

  return micLevel;
}

/**
 * Hook legado compatível para escuta de wake background com suporte unificado a HandsFree e Barge-In.
 */
export function useWake(opts: {
  enabled: boolean;
  clap: boolean;
  word: boolean;
  hotkey: boolean;
  sensitivity: number;
  name: string;
  lang: string;
  isSpeaking?: boolean;
  onWake: () => void;
  onBargeIn?: () => void;
}) {
  return useHandsFree(opts);
}

export function useCallbackRef<T extends (...a: any[]) => any>(fn: T) {
  const r = useRef(fn);
  r.current = fn;
  return useCallback((...a: Parameters<T>) => r.current(...a), []) as T;
}
