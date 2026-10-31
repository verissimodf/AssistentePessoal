// Helper de UI do Multimodal Studio (Fase 6) — arquivo separado para manter a rota
// exportando apenas componentes (react-refresh/only-export-components).
// Mapeamento HONESTO de estado: o avatar nunca mostra "listening" sem microfone ligado
// nem "speaking" sem áudio em reprodução real no cliente.
import { useEffect, useState } from "react";

export type MmAvatarState =
  "idle" | "listening" | "thinking" | "speaking" | "interrupted" | "error" | "unavailable";

/**
 * Estado do turno + contexto real do cliente → estado visual do avatar.
 *  - sessão fechada (ou status inesperado) → `unavailable`;
 *  - turno `failed` → `error`; `interrupted` → `interrupted`;
 *  - `listening` SÓ vira `listening` com o microfone ligado (micOn) — caso contrário `idle`;
 *  - `transcribing`/`processing`/`generating` → `thinking`;
 *  - `speaking` SÓ vira `speaking` com áudio em reprodução (audioPlaying) — durante a
 *    síntese sem áudio tocando, ainda é `thinking`.
 *  - qualquer outro estado (idle/completed/desconhecido) → `idle`.
 */
export function avatarStateFromTurn(
  turnState: string,
  micOn: boolean,
  sessionStatus: string,
  audioPlaying = false,
): MmAvatarState {
  if (sessionStatus !== "active") return "unavailable";
  switch (turnState) {
    case "failed":
      return "error";
    case "interrupted":
      return "interrupted";
    case "listening":
      return micOn ? "listening" : "idle";
    case "transcribing":
    case "processing":
    case "generating":
      return "thinking";
    case "speaking":
      return audioPlaying ? "speaking" : "thinking";
    default:
      return "idle";
  }
}

/** Estado do turno → chave i18n estável (mm_state_*) para rótulo legível. */
export function describeTurnState(state: string, micOn = true): string {
  switch (state) {
    case "listening":
      return micOn ? "mm_state_listening" : "mm_state_idle";
    case "transcribing":
      return "mm_state_transcribing";
    case "processing":
      return "mm_state_processing";
    case "generating":
      return "mm_state_generating";
    case "speaking":
      return "mm_state_speaking";
    case "interrupted":
      return "mm_state_interrupted";
    case "completed":
      return "mm_state_completed";
    case "failed":
      return "mm_state_failed";
    default:
      return "mm_state_unknown";
  }
}

/** Classe de destaque do badge por estado do turno (mesma paleta do computer-ui). */
export function mmTurnBadgeClass(state: string): string {
  switch (state) {
    case "completed":
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-600";
    case "speaking":
      return "border-blue-500/40 bg-blue-500/15 text-blue-500";
    case "listening":
    case "transcribing":
    case "processing":
    case "generating":
    case "interrupted":
      return "border-yellow-500/40 bg-yellow-500/15 text-yellow-600";
    default:
      return "text-muted-foreground";
  }
}

/** Preferência do sistema por movimento reduzido (com fallback seguro fora do DOM). */
export function shouldReduceMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Captura de voz disponível neste navegador (getUserMedia + MediaRecorder). */
export function voiceCaptureAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

/**
 * Sincroniza a reprodução aos eventos REAIS de um elemento <audio>: `speaking` só é
 * verdadeiro enquanto o áudio toca (play/playing), e volta a falso em pause/ended/error.
 */
export function useAudioPlaying(audio: HTMLAudioElement | null): boolean {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!audio) {
      setPlaying(false);
      return;
    }
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    audio.addEventListener("play", on);
    audio.addEventListener("playing", on);
    audio.addEventListener("pause", off);
    audio.addEventListener("ended", off);
    audio.addEventListener("error", off);
    setPlaying(!audio.paused && !audio.ended);
    return () => {
      audio.removeEventListener("play", on);
      audio.removeEventListener("playing", on);
      audio.removeEventListener("pause", off);
      audio.removeEventListener("ended", off);
      audio.removeEventListener("error", off);
      setPlaying(false);
    };
  }, [audio]);
  return playing;
}
