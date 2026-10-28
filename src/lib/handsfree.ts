// src/lib/handsfree.ts
// Motor unificado de ativação Hands-Free, Wake Word offline, VAD e Barge-In para J.A.R.V.I.S.
import {
  createClapDetector,
  DEFAULT_CLAP,
  matchesWakeWord,
  thresholdFromSensitivity,
  type ClapOptions,
} from "./clap";

export {
  createClapDetector,
  DEFAULT_CLAP,
  matchesWakeWord,
  thresholdFromSensitivity,
  type ClapOptions,
};

export type VADOptions = {
  energyThreshold: number; // Teto de energia RMS para considerar voz humana (padrão: 0.035)
  silenceThreshold: number; // Teto para silêncio
  speechHangoverMs: number; // Duração mínima de fala para confirmação (padrão: 180ms)
  silenceTimeoutMs: number; // Tempo de silêncio para término de fala (padrão: 600ms)
  zcrMin: number; // Taxa mínima de cruzamento por zero
  zcrMax: number; // Taxa máxima de cruzamento por zero
};

export const DEFAULT_VAD: VADOptions = {
  energyThreshold: 0.035,
  silenceThreshold: 0.015,
  speechHangoverMs: 180,
  silenceTimeoutMs: 600,
  zcrMin: 0.02,
  zcrMax: 0.65,
};

/**
 * Voice Activity Detection (VAD) puro em memória.
 * Analisa energia RMS (Root Mean Square) e Zero-Crossing Rate (ZCR) de buffers de áudio PCM.
 */
export function createVAD(opts: Partial<VADOptions> = {}) {
  const o = { ...DEFAULT_VAD, ...opts };
  let speechStartTime = 0;
  let silenceStartTime = 0;
  let isSpeaking = false;
  let noiseFloor = 0.01;

  return {
    process(
      buffer: Float32Array,
      nowMs: number = performance.now(),
    ): {
      isVoice: boolean;
      rms: number;
      zcr: number;
      speechStarted: boolean;
      speechEnded: boolean;
    } {
      if (!buffer || buffer.length === 0) {
        return { isVoice: false, rms: 0, zcr: 0, speechStarted: false, speechEnded: false };
      }

      // 1. Cálculo de RMS (Energia)
      let sumSq = 0;
      let zeroCrossings = 0;
      let prevSign = (buffer[0] ?? 0) >= 0;

      for (let i = 0; i < buffer.length; i++) {
        const val = buffer[i] ?? 0;
        sumSq += val * val;

        const currentSign = val >= 0;
        if (currentSign !== prevSign) {
          zeroCrossings++;
          prevSign = currentSign;
        }
      }

      const rms = Math.sqrt(sumSq / buffer.length);
      const zcr = zeroCrossings / buffer.length;

      // Adaptação suave do ruído de fundo
      if (rms < o.silenceThreshold) {
        noiseFloor = 0.95 * noiseFloor + 0.05 * rms;
      }

      const dynamicThreshold = Math.max(o.energyThreshold, noiseFloor * 2.2);
      const isVoiceCandidate = rms > dynamicThreshold && zcr >= o.zcrMin && zcr <= o.zcrMax;

      let speechStarted = false;
      let speechEnded = false;

      if (isVoiceCandidate) {
        silenceStartTime = 0;
        if (!speechStartTime) {
          speechStartTime = nowMs;
        } else if (nowMs - speechStartTime >= o.speechHangoverMs && !isSpeaking) {
          isSpeaking = true;
          speechStarted = true;
        }
      } else {
        if (!silenceStartTime) {
          silenceStartTime = nowMs;
        } else if (nowMs - silenceStartTime >= o.silenceTimeoutMs && isSpeaking) {
          isSpeaking = false;
          speechEnded = true;
          speechStartTime = 0;
        }
      }

      return {
        isVoice: isSpeaking || isVoiceCandidate,
        rms,
        zcr,
        speechStarted,
        speechEnded,
      };
    },
    reset() {
      speechStartTime = 0;
      silenceStartTime = 0;
      isSpeaking = false;
    },
    get isSpeaking() {
      return isSpeaking;
    },
  };
}

export type OfflineWakeWordOptions = {
  keyword: string; // Ex: "jarvis"
  minDurationMs: number; // Duração mínima do envelope acústico
  maxDurationMs: number; // Duração máxima do envelope acústico
  energyThreshold: number; // Energia mínima
};

export const DEFAULT_OFFLINE_WAKE: OfflineWakeWordOptions = {
  keyword: "jarvis",
  minDurationMs: 350,
  maxDurationMs: 1400,
  energyThreshold: 0.04,
};

/**
 * Detector acústico/espectral leve offline para o comando "Jarvis".
 * Avalia envelopes de energia fonética (ataque de fricativa/africada, corpo vocálico e sibilante final).
 */
export function createOfflineWakeWordDetector(opts: Partial<OfflineWakeWordOptions> = {}) {
  const o = { ...DEFAULT_OFFLINE_WAKE, ...opts };
  let startMs = 0;
  let peakRms = 0;
  let phase: "idle" | "onset" | "vowel" | "coda" = "idle";

  return {
    feed(
      buffer: Float32Array,
      frequencyData?: Uint8Array,
      nowMs: number = performance.now(),
    ): boolean {
      if (!buffer || buffer.length === 0) return false;

      let sumSq = 0;
      let zeroCrossings = 0;
      let prevSign = (buffer[0] ?? 0) >= 0;

      for (let i = 0; i < buffer.length; i++) {
        const val = buffer[i] ?? 0;
        sumSq += val * val;
        const currentSign = val >= 0;
        if (currentSign !== prevSign) {
          zeroCrossings++;
          prevSign = currentSign;
        }
      }

      const rms = Math.sqrt(sumSq / buffer.length);
      const zcr = zeroCrossings / buffer.length;

      // Análise espectral de formantes se dados de frequência estiverem disponíveis
      let highFreqEnergy = 0;
      let midFreqEnergy = 0;
      if (frequencyData && frequencyData.length > 0) {
        const half = Math.floor(frequencyData.length / 2);
        let midSum = 0;
        let highSum = 0;
        for (let i = 0; i < half; i++) midSum += frequencyData[i] ?? 0;
        for (let i = half; i < frequencyData.length; i++) highSum += frequencyData[i] ?? 0;
        midFreqEnergy = midSum / (half * 255);
        highFreqEnergy = highSum / ((frequencyData.length - half) * 255);
      }

      if (rms < o.energyThreshold * 0.5) {
        if (phase !== "idle") {
          const duration = nowMs - startMs;
          const wasTriggered =
            phase === "coda" &&
            duration >= o.minDurationMs &&
            duration <= o.maxDurationMs &&
            peakRms >= o.energyThreshold;
          phase = "idle";
          startMs = 0;
          peakRms = 0;
          return wasTriggered;
        }
        return false;
      }

      if (phase === "idle") {
        if (rms >= o.energyThreshold && zcr >= 0.08) {
          // Fase 1: Onset / Fricativa [j/dʒ]
          phase = "onset";
          startMs = nowMs;
          peakRms = rms;
        }
      } else if (phase === "onset") {
        peakRms = Math.max(peakRms, rms);
        if (nowMs - startMs > o.maxDurationMs) {
          phase = "idle";
          return false;
        }
        // Transição para vogal aberta [ar] (alta energia de frequências médias e ZCR mais baixo)
        if (rms > o.energyThreshold * 1.2 && (midFreqEnergy > 0.15 || zcr < 0.25)) {
          phase = "vowel";
        }
      } else if (phase === "vowel") {
        peakRms = Math.max(peakRms, rms);
        if (nowMs - startMs > o.maxDurationMs) {
          phase = "idle";
          return false;
        }
        // Transição para sibilante final [s/is] (alta frequência espectral ou alto ZCR)
        if (highFreqEnergy > 0.2 || zcr >= 0.28) {
          phase = "coda";
        }
      } else if (phase === "coda") {
        peakRms = Math.max(peakRms, rms);
        if (nowMs - startMs > o.maxDurationMs) {
          phase = "idle";
          return false;
        }
      }

      return false;
    },
    reset() {
      phase = "idle";
      startMs = 0;
      peakRms = 0;
    },
  };
}

/**
 * Singleton AudioEngine para gerenciamento eficiente de stream do microfone e AudioContext.
 * Evita vazamento de AudioContexts e elimina o estalo ('mic pop') nas trocas de estado.
 */
class SharedAudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private refCount = 0;

  async acquire(): Promise<{ ctx: AudioContext; analyser: AnalyserNode; stream: MediaStream }> {
    this.refCount++;
    if (this.ctx && this.analyser && this.stream && this.stream.active) {
      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }
      return { ctx: this.ctx, analyser: this.analyser, stream: this.stream };
    }

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("AudioContext not supported in this environment");
    }

    this.ctx = new AudioContextClass();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.2;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);

    return { ctx: this.ctx, analyser: this.analyser, stream: this.stream };
  }

  release() {
    this.refCount = Math.max(0, this.refCount - 1);
    if (this.refCount === 0) {
      this.stream?.getTracks().forEach((t) => t.stop());
      this.source?.disconnect();
      this.ctx?.close().catch(() => {});
      this.stream = null;
      this.source = null;
      this.analyser = null;
      this.ctx = null;
    }
  }

  isAcquired(): boolean {
    return this.refCount > 0 && !!this.ctx;
  }
}

export const sharedAudioEngine = new SharedAudioEngine();

export type HandsFreeConfig = {
  enabled: boolean;
  clap: boolean;
  word: boolean;
  hotkey: boolean;
  sensitivity: number;
  agentName: string;
  lang: string;
  isSpeaking: boolean; // Se o assistente está vocalizando atualmente (para Barge-In)
  onWake: () => void;
  onBargeIn?: () => void;
  onLevel?: (level: number) => void;
};

/**
 * Cria e controla a escuta contínua de Hands-Free com suporte unificado a:
 * - Palmas duplas (Clap)
 * - Wake Word falada ("Jarvis" ou nome do agente)
 * - VAD contínuo
 * - Interrupção de fala (Barge-In) imediata
 */
export function startHandsFreeSession(config: HandsFreeConfig) {
  let active = true;
  let raf = 0;
  let recognition: unknown = null;

  const clapDetector = createClapDetector({
    threshold: thresholdFromSensitivity(config.sensitivity),
  });
  const vad = createVAD();
  const offlineWake = createOfflineWakeWordDetector({
    keyword: config.agentName.toLowerCase(),
  });

  // Inicializa escuta de microfone via engine compartilhado
  sharedAudioEngine
    .acquire()
    .then(({ analyser }) => {
      if (!active) {
        sharedAudioEngine.release();
        return;
      }

      const timeBuf = new Float32Array(analyser.fftSize);
      const freqBuf = new Uint8Array(analyser.frequencyBinCount);

      const loop = () => {
        if (!active) return;

        analyser.getFloatTimeDomainData(timeBuf);
        analyser.getByteFrequencyData(freqBuf);

        // Nível de amplitude instantâneo
        let peak = 0;
        for (let i = 0; i < timeBuf.length; i++) {
          const abs = Math.abs(timeBuf[i] ?? 0);
          if (abs > peak) peak = abs;
        }

        config.onLevel?.(peak);

        const now = performance.now();

        // 1. Barge-In: Se o assistente estiver vocalizando e o usuário falar
        if (config.isSpeaking) {
          const vadState = vad.process(timeBuf, now);
          if (vadState.speechStarted || (vadState.isVoice && vadState.rms > 0.04)) {
            config.onBargeIn?.();
            vad.reset();
          }
        } else {
          // 2. Detecção de Duplo Aplauso
          if (config.clap && clapDetector.feed(peak, now)) {
            config.onWake();
          }

          // 3. Detecção Acústica Offline de Wake Word
          if (config.word && offlineWake.feed(timeBuf, freqBuf, now)) {
            config.onWake();
          }
        }

        raf = requestAnimationFrame(loop);
      };

      loop();
    })
    .catch((err) => {
      console.warn("[HandsFree] Microfone não acessível ou permissão negada:", err);
    });

  // 4. Reconhecimento Contínuo Híbrido de Wake Word no Browser (se suportado)
  if (config.word) {
    const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : {};
    const Rec =
      (w["SpeechRecognition"] as unknown as {
        new (): {
          lang: string;
          continuous: boolean;
          interimResults: boolean;
          onresult: (e: {
            results: ArrayLike<{ [index: number]: { transcript: string } }>;
          }) => void;
          onend: () => void;
          start: () => void;
          abort: () => void;
        };
      }) ||
      (w["webkitSpeechRecognition"] as unknown as {
        new (): {
          lang: string;
          continuous: boolean;
          interimResults: boolean;
          onresult: (e: {
            results: ArrayLike<{ [index: number]: { transcript: string } }>;
          }) => void;
          onend: () => void;
          start: () => void;
          abort: () => void;
        };
      });

    if (Rec) {
      try {
        const rec = new Rec();
        rec.lang = config.lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (e: { results: ArrayLike<{ [index: number]: { transcript: string } }> }) => {
          if (!active) return;
          const txt = Array.from(e.results)
            .map((r) => r[0]?.transcript ?? "")
            .join(" ");
          if (matchesWakeWord(txt, config.agentName)) {
            rec.abort();
            if (config.isSpeaking) {
              config.onBargeIn?.();
            } else {
              config.onWake();
            }
          }
        };
        rec.onend = () => {
          if (active) {
            setTimeout(() => {
              try {
                if (active) rec.start();
              } catch {
                // SpeechRecognition.start may race with the browser's end event; retry next cycle.
              }
            }, 350);
          }
        };
        rec.start();
        recognition = rec;
      } catch {
        // Speech recognition is optional and may be unavailable or denied by browser policy.
      }
    }
  }

  // 5. Atalho Global de Teclado (Ctrl+Shift+J)
  const keyHandler = (e: KeyboardEvent) => {
    if (config.hotkey && e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "j") {
      e.preventDefault();
      if (config.isSpeaking) {
        config.onBargeIn?.();
      } else {
        config.onWake();
      }
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("keydown", keyHandler);
  }

  return {
    stop() {
      active = false;
      cancelAnimationFrame(raf);
      sharedAudioEngine.release();
      if (typeof window !== "undefined") {
        window.removeEventListener("keydown", keyHandler);
      }
      if (recognition && typeof (recognition as { abort?: () => void }).abort === "function") {
        try {
          (recognition as { abort: () => void }).abort();
        } catch {
          // abort() may throw after the recognition service has already stopped.
        }
      }
    },
  };
}
