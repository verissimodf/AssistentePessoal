import { describe, expect, it } from "vitest";
import { createClapDetector, matchesWakeWord, thresholdFromSensitivity } from "@/lib/clap";

describe("double clap", () => {
  it("fires on two claps 300ms apart", () => {
    const d = createClapDetector();
    expect(d.feed(0.8, 1000)).toBe(false);
    expect(d.feed(0.8, 1300)).toBe(true);
  });
  it("does not fire when claps are 1.5s apart", () => {
    const d = createClapDetector();
    d.feed(0.8, 1000);
    expect(d.feed(0.8, 2500)).toBe(false);
  });
  it("ignores quiet sounds", () => {
    const d = createClapDetector();
    d.feed(0.1, 1000);
    expect(d.feed(0.1, 1300)).toBe(false);
  });
  it("max sensitivity lowers threshold", () => {
    expect(thresholdFromSensitivity(10)).toBeLessThan(thresholdFromSensitivity(1));
  });
});

describe("wake word", () => {
  it("matches the agent name in a sentence", () => {
    expect(matchesWakeWord("Ei Jarvis, que horas são?", "jarvis")).toBe(true);
  });
  it("does not match unrelated speech", () => {
    expect(matchesWakeWord("vamos jantar", "jarvis")).toBe(false);
  });
});
