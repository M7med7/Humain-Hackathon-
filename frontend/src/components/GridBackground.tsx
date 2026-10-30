import { useEffect, useRef } from "react";

interface GridBackgroundProps {
  isAIActive?: boolean;
  theme?: "dark" | "light";
}

export function GridBackground({ isAIActive = false, theme = "dark" }: GridBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;
    let offset = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const RINGS = 14;
    const SPOKES = 24;
    const SPEED = 0.0017;
    const isLight = theme === "light";
    const LINE_COLOR = isLight ? "0,0,0" : "148,163,184";

    function draw() {
      if (!canvas || !ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;

      ctx.fillStyle = isLight ? "#f8fafc" : "#000";
      ctx.fillRect(0, 0, W, H);

      offset = (offset + SPEED) % 1;

      const maxW = W * 0.75;
      const maxH = H * 0.75;

      const spokeAlpha = isLight ? (isAIActive ? 0.25 : 0.15) : (isAIActive ? 0.22 : 0.16);
      ctx.strokeStyle = `rgba(${LINE_COLOR},${spokeAlpha})`;
      ctx.lineWidth = 0.8;
      for (let i = 0; i < SPOKES; i++) {
        const angle = (i / SPOKES) * Math.PI * 2;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const len = Math.max(W, H);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * len, cy + dy * len);
        ctx.stroke();
      }

      for (let i = 0; i <= RINGS; i++) {
        const raw = (i + offset) / RINGS;
        const t = raw * raw;
        const rw = maxW * t;
        const rh = maxH * t;
        const fade = Math.min(1, raw * 1.2);
        const alpha = isLight
          ? (isAIActive ? 0.15 + fade * 0.25 : 0.10 + fade * 0.20)
          : (isAIActive ? 0.15 + fade * 0.38 : 0.10 + fade * 0.26);
        ctx.strokeStyle = `rgba(${LINE_COLOR},${alpha.toFixed(3)})`;
        ctx.lineWidth = 0.75 + t * 0.75;
        ctx.strokeRect(cx - rw, cy - rh, rw * 2, rh * 2);
      }

      animFrameId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", resize);
    };
  }, [isAIActive, theme]);

  return (
    <div className="fixed inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}
