// Pure double-clap detector: feed it amplitude peaks (0..1) with timestamps (ms).
// A "clap" is a sharp peak above the threshold; two claps between minGap and maxGap ms
// trigger activation. Mirrors the calibrated logic of the original Jarvis "modo show".
export type ClapOptions = {
  threshold: number;
  minGapMs: number;
  maxGapMs: number;
  refractoryMs: number;
};

export const DEFAULT_CLAP: ClapOptions = {
  threshold: 0.35,
  minGapMs: 120,
  maxGapMs: 700,
  refractoryMs: 90,
};

/** sensitivity 1..10 → threshold (higher sensitivity = lower threshold) */
export function thresholdFromSensitivity(s: number): number {
  const clamped = Math.min(10, Math.max(1, s));
  return Number((0.6 - (clamped - 1) * 0.05).toFixed(2));
}

export function createClapDetector(opts: Partial<ClapOptions> = {}) {
  const o = { ...DEFAULT_CLAP, ...opts };
  let lastClap = -Infinity;
  let lastPeak = -Infinity;
  return {
    /** returns true when a double clap is completed */
    feed(level: number, t: number): boolean {
      if (level < o.threshold) return false;
      if (t - lastPeak < o.refractoryMs) return false;
      lastPeak = t;
      const gap = t - lastClap;
      if (gap >= o.minGapMs && gap <= o.maxGapMs) {
        lastClap = -Infinity;
        return true;
      }
      lastClap = t;
      return false;
    },
  };
}

/** Wake-word match: does the transcript contain the agent name (accent/case-insensitive)? */
export function matchesWakeWord(transcript: string, name: string): boolean {
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const n = norm(name).trim();
  if (!n) return false;
  return new RegExp(`(^|\\W)${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\W|$)`).test(
    norm(transcript),
  );
}
