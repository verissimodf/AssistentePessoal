import { useEffect, useRef } from "react";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

// Holographic 3D core. three.js is imported dynamically so SSR never loads WebGL code.
export function Avatar3D({ state, level = 0 }: { state: AvatarState; level?: number }) {
  const mount = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  stateRef.current = state;
  levelRef.current = level;

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    import("three").then((THREE) => {
      if (disposed || !mount.current) return;
      const el = mount.current;
      // three.js cannot parse oklch(); these sRGB values mirror --primary / --accent.
      const primary = new THREE.Color("#3fd6f0");
      const accent = new THREE.Color("#f2a93b");

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.z = 8.5;

      const group = new THREE.Group();
      scene.add(group);
      const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.6, 2),
        new THREE.MeshBasicMaterial({ color: primary, wireframe: true, transparent: true, opacity: 0.35 }),
      );
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.75, 48, 48),
        new THREE.MeshBasicMaterial({ color: primary, transparent: true, opacity: 0.85 }),
      );
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.95, 32, 32),
        new THREE.MeshBasicMaterial({ color: primary, transparent: true, opacity: 0.12 }),
      );
      group.add(shell, core, halo);
      const rings = [2.1, 2.5, 2.9].map((r, i) => {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(r, 0.012, 8, 160),
          new THREE.MeshBasicMaterial({ color: i === 1 ? accent : primary, transparent: true, opacity: 0.6 }),
        );
        ring.rotation.x = Math.PI / 2 + i * 0.35;
        group.add(ring);
        return ring;
      });
      const pts = new Float32Array(600 * 3);
      for (let i = 0; i < 600; i++) {
        const r = 2 + Math.random() * 1.8, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
        pts.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph)], i * 3);
      }
      const pg = new THREE.BufferGeometry();
      pg.setAttribute("position", new THREE.BufferAttribute(pts, 3));
      const particles = new THREE.Points(pg, new THREE.PointsMaterial({ color: primary, size: 0.025, transparent: true, opacity: 0.7 }));
      scene.add(particles);

      const resize = () => {
        const w = el.clientWidth, h = el.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(el);

      let raf = 0, smooth = 0;
      const clock = new THREE.Clock();
      const tick = () => {
        const t = clock.getElapsedTime();
        const s = stateRef.current;
        const speed = s === "thinking" ? 2.4 : s === "listening" ? 1.4 : s === "speaking" ? 1.1 : 0.4;
        const target = s === "speaking" ? 0.25 + levelRef.current : s === "listening" ? levelRef.current * 0.8 : 0;
        smooth += (target - smooth) * 0.15;
        const pulse = 1 + Math.sin(t * 2) * 0.03 + smooth * 0.35;
        core.scale.setScalar(pulse);
        halo.scale.setScalar(pulse * (1.1 + smooth * 0.4));
        shell.rotation.y += 0.004 * speed;
        shell.rotation.x += 0.002 * speed;
        rings.forEach((r, i) => (r.rotation.z += (0.003 + i * 0.002) * speed * (i % 2 ? -1 : 1)));
        particles.rotation.y -= 0.0008 * speed;
        const c = s === "thinking" ? accent : primary;
        (core.material as InstanceType<typeof THREE.MeshBasicMaterial>).color.lerp(c, 0.08);
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();
      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        renderer.dispose();
        el.removeChild(renderer.domElement);
      };
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return <div ref={mount} className="h-full w-full" aria-label="Jarvis 3D avatar" role="img" />;
}
