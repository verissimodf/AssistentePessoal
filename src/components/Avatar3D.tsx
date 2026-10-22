import { useEffect, useRef, useState } from "react";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

export interface Avatar3DProps {
  state: AvatarState;
  level?: number;
  audioLevel?: number;
}

/**
 * Holographic 3D Avatar Core (Three.js WebGL with memory hygiene & harmonic damping).
 * Dynamic import ensures SSR safety. Includes graceful CSS/SVG fallback for headless/jsdom environments.
 */
export function Avatar3D({ state, level = 0, audioLevel }: Avatar3DProps) {
  const mount = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(audioLevel !== undefined ? audioLevel : level);
  const [webglSupported, setWebglSupported] = useState(true);

  stateRef.current = state;
  levelRef.current = audioLevel !== undefined ? audioLevel : level;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};

    import("three")
      .then((THREE) => {
        if (disposed || !mount.current) return;
        const el = mount.current;

        // Paleta holográfica inspirada em design-dna (--primary, --accent, --cyan)
        const colorPrimary = new THREE.Color("#3fd6f0");
        const colorAccent = new THREE.Color("#f2a93b");
        const colorListening = new THREE.Color("#22d3ee");
        const colorSpeaking = new THREE.Color("#38bdf8");

        let renderer: InstanceType<typeof THREE.WebGLRenderer>;
        try {
          renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        } catch {
          setWebglSupported(false);
          return;
        }

        if (!renderer.getContext()) {
          setWebglSupported(false);
          return;
        }

        renderer.setPixelRatio(Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio : 1));
        el.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.position.z = 8.5;

        const group = new THREE.Group();
        scene.add(group);

        // Geometrias e Materiais com gerenciamento de ciclo de vida
        const shellGeo = new THREE.IcosahedronGeometry(1.6, 2);
        const shellMat = new THREE.MeshBasicMaterial({
          color: colorPrimary,
          wireframe: true,
          transparent: true,
          opacity: 0.35,
        });
        const shell = new THREE.Mesh(shellGeo, shellMat);

        const coreGeo = new THREE.SphereGeometry(0.75, 48, 48);
        const coreMat = new THREE.MeshBasicMaterial({
          color: colorPrimary,
          transparent: true,
          opacity: 0.85,
        });
        const core = new THREE.Mesh(coreGeo, coreMat);

        const haloGeo = new THREE.SphereGeometry(0.95, 32, 32);
        const haloMat = new THREE.MeshBasicMaterial({
          color: colorPrimary,
          transparent: true,
          opacity: 0.12,
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);

        group.add(shell, core, halo);

        // Anéis orbitais
        const ringConfigs = [2.1, 2.5, 2.9];
        const rings = ringConfigs.map((r, i) => {
          const rGeo = new THREE.TorusGeometry(r, 0.012, 8, 160);
          const rMat = new THREE.MeshBasicMaterial({
            color: i === 1 ? colorAccent : colorPrimary,
            transparent: true,
            opacity: 0.6,
          });
          const ring = new THREE.Mesh(rGeo, rMat);
          ring.rotation.x = Math.PI / 2 + i * 0.35;
          group.add(ring);
          return ring;
        });

        // Partículas ambientais
        const particleCount = 600;
        const pts = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount; i++) {
          const r = 2 + Math.random() * 1.8;
          const th = Math.random() * Math.PI * 2;
          const ph = Math.acos(2 * Math.random() - 1);
          pts.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)], i * 3);
        }
        const particleGeo = new THREE.BufferGeometry();
        particleGeo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
        const particleMat = new THREE.PointsMaterial({
          color: colorPrimary,
          size: 0.025,
          transparent: true,
          opacity: 0.7,
        });
        const particles = new THREE.Points(particleGeo, particleMat);
        scene.add(particles);

        const resize = () => {
          if (!el) return;
          const w = el.clientWidth || 300;
          const h = el.clientHeight || 300;
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        resize();

        const ro = new ResizeObserver(resize);
        ro.observe(el);

        let raf = 0;
        let smoothSpeed = 0.5;
        let smoothLevel = 0;
        const clock = new THREE.Clock();

        const tick = () => {
          const t = clock.getElapsedTime();
          const s = stateRef.current;
          const rawLvl = Math.max(0, Math.min(1, levelRef.current || 0));

          // Modulação acústica orgânica multi-frequência
          const harmonic =
            Math.sin(t * 7.5) * 0.12 + Math.cos(t * 13.2) * 0.08 + Math.sin(t * 21.0) * 0.04;
          const audioBoost =
            s === "speaking"
              ? Math.max(rawLvl, 0.28 + harmonic)
              : s === "listening"
                ? Math.max(rawLvl, 0.12 + harmonic * 0.6)
                : rawLvl;

          const targetSpeed =
            s === "thinking" ? 2.6 : s === "listening" ? 1.5 : s === "speaking" ? 1.25 : 0.45;
          smoothSpeed += (targetSpeed - smoothSpeed) * 0.08;
          smoothLevel += (audioBoost - smoothLevel) * 0.12;

          // Pulsação suave (lerp harmônico)
          const pulse = 1 + Math.sin(t * 2.2) * 0.035 + smoothLevel * 0.38;
          core.scale.setScalar(pulse);
          halo.scale.setScalar(pulse * (1.12 + smoothLevel * 0.42));

          // Rotação dos elementos
          shell.rotation.y += 0.004 * smoothSpeed;
          shell.rotation.x += 0.002 * smoothSpeed;
          rings.forEach((r, i) => {
            r.rotation.z += (0.003 + i * 0.002) * smoothSpeed * (i % 2 ? -1 : 1);
          });
          particles.rotation.y -= 0.0008 * smoothSpeed;

          // Transição de cor contínua entre estados
          const targetColor =
            s === "thinking"
              ? colorAccent
              : s === "speaking"
                ? colorSpeaking
                : s === "listening"
                  ? colorListening
                  : colorPrimary;

          coreMat.color.lerp(targetColor, 0.08);
          haloMat.color.lerp(targetColor, 0.06);

          renderer.render(scene, camera);
          raf = requestAnimationFrame(tick);
        };

        // Pausa automática quando a aba está em background para economia de GPU/CPU
        const onVisibilityChange = () => {
          if (typeof document !== "undefined" && document.hidden) {
            if (raf) {
              cancelAnimationFrame(raf);
              raf = 0;
            }
          } else if (!raf) {
            clock.start();
            tick();
          }
        };

        if (typeof document !== "undefined") {
          document.addEventListener("visibilitychange", onVisibilityChange);
        }

        tick();

        cleanup = () => {
          if (typeof document !== "undefined") {
            document.removeEventListener("visibilitychange", onVisibilityChange);
          }
          if (raf) cancelAnimationFrame(raf);
          ro.disconnect();

          // Higiene Estrita de Memória Three.js: liberação de recursos GPU e geometrias
          scene.traverse((obj) => {
            if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
              if (obj.geometry) obj.geometry.dispose();
              if (obj.material) {
                if (Array.isArray(obj.material)) {
                  obj.material.forEach((m) => m.dispose());
                } else {
                  obj.material.dispose();
                }
              }
            }
          });

          renderer.dispose();
          renderer.forceContextLoss();
          if (renderer.domElement.parentElement === el) {
            el.removeChild(renderer.domElement);
          }
        };
      })
      .catch(() => {
        setWebglSupported(false);
      });

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  if (!webglSupported) {
    // Fallback gracioso para ambientes headless/jsdom
    const color =
      state === "thinking"
        ? "#f2a93b"
        : state === "speaking"
          ? "#38bdf8"
          : state === "listening"
            ? "#22d3ee"
            : "#3fd6f0";

    return (
      <div
        className="flex h-full w-full items-center justify-center p-6"
        aria-label="Jarvis 3D avatar (fallback)"
        role="img"
      >
        <div
          className="relative flex items-center justify-center rounded-full transition-all duration-300"
          style={{
            width: "120px",
            height: "120px",
            background: `radial-gradient(circle, ${color}33 0%, transparent 70%)`,
            border: `1px solid ${color}66`,
          }}
        >
          <div
            className="h-10 w-10 rounded-full animate-pulse"
            style={{ backgroundColor: color, boxShadow: `0 0 24px ${color}` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mount}
      className="h-full w-full"
      aria-label="Jarvis 3D avatar"
      role="img"
      data-state={state}
    />
  );
}
