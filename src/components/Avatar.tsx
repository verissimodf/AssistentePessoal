import { shouldReduceMotion, type MmAvatarState } from "@/lib/multimodal-ui";

/**
 * Avatar visual do Multimodal Studio — SVG + CSS puro (sem dependências novas).
 * Cada estado tem cor E forma distintas; `prefers-reduced-motion` remove TODAS as
 * animações (fallback estático com cor/ícone). O estado `speaking` NUNCA é animado
 * por conta própria: quem decide é o chamador, sincronizado aos eventos reais de um
 * elemento <audio> (useAudioPlaying → avatarStateFromTurn).
 */
const STATE_COLOR: Record<MmAvatarState, string> = {
  idle: "var(--primary)",
  listening: "var(--chart-3)",
  thinking: "var(--accent)",
  speaking: "var(--chart-1)",
  interrupted: "var(--chart-2)",
  error: "var(--destructive)",
  unavailable: "var(--muted-foreground)",
};

export function Avatar({
  state,
  label,
  className,
}: {
  state: MmAvatarState;
  label?: string;
  className?: string;
}) {
  const reduced = shouldReduceMotion();
  const color = STATE_COLOR[state] ?? STATE_COLOR.idle;
  const anim = (name: string) => (reduced ? undefined : `mm-anim ${name}`);
  const dashed = state === "interrupted" || state === "unavailable";
  const speaking = state === "speaking";
  const bars = [0, 1, 2, 3, 4];

  return (
    <div
      data-testid="mm-avatar"
      data-state={state}
      data-reduced={reduced ? "true" : "false"}
      role="img"
      aria-label={label ?? state}
      className={`inline-flex items-center justify-center ${className ?? ""}`}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
        {/* anéis de escuta (pulsando) — estáticos sob movimento reduzido */}
        {state === "listening" && (
          <>
            <circle
              cx="50"
              cy="50"
              r="32"
              fill="none"
              stroke={color}
              strokeWidth="2"
              className={anim("mm-ring")}
              opacity={reduced ? 0.5 : undefined}
            />
            <circle
              cx="50"
              cy="50"
              r="32"
              fill="none"
              stroke={color}
              strokeWidth="2"
              className={anim("mm-ring mm-ring-2")}
              opacity={reduced ? 0.25 : undefined}
            />
          </>
        )}

        {/* ponto em órbita (pensando) */}
        {state === "thinking" && (
          <g className={reduced ? undefined : "mm-orbit"}>
            <circle cx="50" cy="16" r="5" fill={color} opacity="0.9" />
          </g>
        )}

        {/* núcleo: respira em idle, pulsa em thinking; estático nos demais */}
        <circle
          cx="50"
          cy="50"
          r="22"
          fill={color}
          opacity={state === "unavailable" ? 0.4 : 0.85}
          className={
            reduced
              ? undefined
              : state === "idle"
                ? "mm-anim mm-breathe"
                : speaking
                  ? undefined
                  : "mm-anim mm-think"
          }
        />

        {/* ondas de amplitude (falando) — só renderizadas quando há áudio tocando */}
        {speaking &&
          bars.map((i) => (
            <rect
              key={i}
              x={31 + i * 8}
              y="30"
              width="6"
              height="40"
              rx="3"
              fill={color}
              className={anim("mm-bar")}
              style={reduced ? undefined : { animationDelay: `${i * 110}ms` }}
            />
          ))}

        {/* traço: interrompido / indisponível */}
        {dashed && (
          <line
            x1="38"
            y1="50"
            x2="62"
            y2="50"
            stroke="var(--background)"
            strokeWidth="4"
            strokeLinecap="round"
          />
        )}
      </svg>
    </div>
  );
}
