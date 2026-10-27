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

type RecognitionEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type RecognitionErrorEvent = { error: string };
type Rec = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
const getRecognition = (): Rec | null => {
  const w = window as Window & {
    SpeechRecognition?: new () => Rec;
    webkitSpeechRecognition?: new () => Rec;
  };
  const C = w.SpeechRecognition || w.webkitSpeechRecognition;
  return C ? new C() : null;
};

async function listenLocalOnce(lang: string): Promise<string> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
    throw new Error("local_stt_browser_unsupported");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"].find((x) =>
    MediaRecorder.isTypeSupported(x),
  );
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);

  return new Promise((resolve, reject) => {
    let startedSpeech = false;
    let lastSpeechAt = 0;
    let settled = false;
    let forcedError = false;
    const start = Date.now();
    const cleanup = () => {
      clearInterval(levelTimer);
      clearTimeout(maxTimer);
      stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => undefined);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      forcedError = !!error;
      if (recorder.state !== "inactive") recorder.stop();
      cleanup();
      if (error) reject(error);
    };
    const levelTimer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const v = (sample - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / samples.length);
      if (rms > 0.025) {
        startedSpeech = true;
        lastSpeechAt = Date.now();
      } else if (startedSpeech && Date.now() - lastSpeechAt > 1200) finish();
    }, 100);
    const maxTimer = setTimeout(
      () => finish(startedSpeech ? undefined : new Error("stt_no_speech")),
      20_000,
    );
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => finish(new Error("stt_recording_failed"));
    recorder.onstop = async () => {
      cleanup();
      if (forcedError) return;
      if (!startedSpeech) {
        if (!settled) reject(new Error("stt_no_speech"));
        return;
      }
      const type = recorder.mimeType.split(";")[0] || "audio/webm";
      const form = new FormData();
      const ext = type.includes("ogg")
        ? "ogg"
        : type.includes("mp4")
          ? "m4a"
          : type.includes("wav")
            ? "wav"
            : "webm";
      form.append("file", new Blob(chunks, { type }), `speech.${ext}`);
      form.append("language", lang.split("-")[0] || "auto");
      try {
        const result = await api<{ text: string }>("/api/stt", { method: "POST", body: form });
        resolve(result.text);
      } catch (error) {
        reject(error);
      }
    };
    try {
      recorder.start(250);
    } catch {
      finish(new Error("stt_recording_failed"));
    }
    // Fail closed if microphone permission is granted but no recording data arrives.
    if (Date.now() - start > 20_000) finish(new Error("stt_recording_timeout"));
  });
}

export function listenOnce(lang: string, engine = "browser"): Promise<string> {
  if (engine === "local") return listenLocalOnce(lang);
  return new Promise((resolve, reject) => {
    const rec = getRecognition();
    if (!rec) return reject(new Error("Speech recognition not supported in this browser"));
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => resolve(e.results[0]?.[0]?.transcript ?? "");
    rec.onerror = (e) => reject(new Error(e.error));
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
    } catch {
      /* playback cleanup must continue */
    }
    currentPlayback = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* speech synthesis is best-effort */
    }
  }
}

/** P2-A: reconhece o estado de aquecimento do TTS local (cold-start do XTTS). */
export const isVoiceWarmingUp = (message: string) =>
  /voice_warming_up/i.test(String(message ?? ""));

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
  signal?: AbortSignal,
): Promise<void> {
  stopSpeaking();
  if (signal?.aborted) return;

  const plain = text.replace(/[*_#`>\u005B\u005D()]/g, "");

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
        await new Promise((r) =>
          setTimeout(r, warmingRetryDelay(String((e as Error)?.message ?? e))),
        );
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
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
      } catch {
        /* cancellation still resolves the playback promise */
      }
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
      (window as unknown as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
        .SpeechSynthesisUtterance ||
      (globalThis as unknown as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance })
        .SpeechSynthesisUtterance;

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useCallbackRef<T extends (...a: any[]) => any>(fn: T) {
  const r = useRef(fn);
  r.current = fn;
  return useCallback((...a: Parameters<T>) => r.current(...a), []) as T;
}
