import { useCallback, useEffect, useRef, useState } from "react";
import { api, ping } from "./bridge";
import { createClapDetector, matchesWakeWord, thresholdFromSensitivity } from "./clap";

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

export async function speak(text: string, lang: string, engine: string, onLevel?: (l: number) => void): Promise<void> {
  const plain = text.replace(/[*_#`>\[\]()]/g, "");
  if (engine !== "browser" && (await ping())) {
    try {
      const blob = await api<Blob>("/api/tts", { method: "POST", body: JSON.stringify({ text: plain, lang }) });
      const audio = new Audio(URL.createObjectURL(blob));
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(audio);
      const an = ctx.createAnalyser();
      src.connect(an);
      an.connect(ctx.destination);
      const buf = new Uint8Array(an.frequencyBinCount);
      let raf = 0;
      const loop = () => {
        an.getByteFrequencyData(buf);
        onLevel?.(buf.reduce((a, b) => a + b, 0) / buf.length / 255);
        raf = requestAnimationFrame(loop);
      };
      loop();
      await audio.play();
      await new Promise((r) => (audio.onended = r));
      cancelAnimationFrame(raf);
      onLevel?.(0);
      ctx.close();
      return;
    } catch (e) {
      console.warn("Local TTS failed, using browser voice", e);
    }
  }
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = lang;
    const id = setInterval(() => onLevel?.(0.2 + Math.random() * 0.5), 90);
    u.onend = () => {
      clearInterval(id);
      onLevel?.(0);
      resolve();
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

/** Background wake listeners: double clap, wake word (agent name) and keyboard shortcut. */
export function useWake(opts: {
  enabled: boolean; clap: boolean; word: boolean; hotkey: boolean;
  sensitivity: number; name: string; lang: string; onWake: () => void;
}) {
  const [micLevel, setMicLevel] = useState(0);
  const cb = useRef(opts.onWake);
  cb.current = opts.onWake;

  useEffect(() => {
    if (!opts.enabled || !opts.clap) return;
    let stream: MediaStream | null = null, ctx: AudioContext | null = null, raf = 0;
    const det = createClapDetector({ threshold: thresholdFromSensitivity(opts.sensitivity) });
    navigator.mediaDevices?.getUserMedia({ audio: true }).then((s) => {
      stream = s;
      ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Float32Array(an.fftSize);
      const loop = () => {
        an.getFloatTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        setMicLevel(peak);
        if (det.feed(peak, performance.now())) cb.current();
        raf = requestAnimationFrame(loop);
      };
      loop();
    }).catch(() => {});
    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
    };
  }, [opts.enabled, opts.clap, opts.sensitivity]);

  useEffect(() => {
    if (!opts.enabled || !opts.word) return;
    const rec = getRecognition();
    if (!rec) return;
    let alive = true;
    rec.lang = opts.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      const txt = Array.from(e.results).map((r: any) => r[0].transcript).join(" ");
      if (matchesWakeWord(txt, opts.name)) {
        rec.abort();
        cb.current();
      }
    };
    rec.onend = () => alive && setTimeout(() => { try { rec.start(); } catch {} }, 400);
    try { rec.start(); } catch {}
    return () => { alive = false; rec.abort(); };
  }, [opts.enabled, opts.word, opts.name, opts.lang]);

  useEffect(() => {
    if (!opts.hotkey) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        cb.current();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [opts.hotkey]);

  return micLevel;
}

export function useCallbackRef<T extends (...a: any[]) => any>(fn: T) {
  const r = useRef(fn);
  r.current = fn;
  return useCallback((...a: Parameters<T>) => r.current(...a), []) as T;
}
