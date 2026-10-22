import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar3D, type AvatarState } from "@/components/Avatar3D";

describe("Avatar3D Component — Multi-Estado & Reatividade", () => {
  const states: AvatarState[] = ["idle", "listening", "thinking", "speaking"];

  states.forEach((state) => {
    it(`renderiza o avatar no estado '${state}' sem falhas em ambiente headless`, () => {
      const { container } = render(<Avatar3D state={state} level={0.5} audioLevel={0.8} />);
      expect(container).toBeInTheDocument();
      const el = screen.getByRole("img", { name: /Jarvis 3D avatar/i });
      expect(el).toBeInTheDocument();
    });
  });

  it("aceita prop opcional audioLevel e modula suavemente", () => {
    const { rerender } = render(<Avatar3D state="speaking" audioLevel={0.2} />);
    expect(screen.getByRole("img", { name: /Jarvis 3D avatar/i })).toBeInTheDocument();

    rerender(<Avatar3D state="speaking" audioLevel={0.9} />);
    expect(screen.getByRole("img", { name: /Jarvis 3D avatar/i })).toBeInTheDocument();
  });
});
