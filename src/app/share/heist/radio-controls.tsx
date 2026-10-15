"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface RadioControlsProps {
  enabled: boolean;
  analyser: AnalyserNode | null;
  onToggle: () => void;
  className?: string;
}

export function RadioControls({ enabled, analyser, onToggle, className }: RadioControlsProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser || !enabled) return;
    const g = canvas.getContext("2d");
    if (!g) return;

    const bins = new Uint8Array(analyser.frequencyBinCount);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;

    const draw = () => {
      analyser.getByteFrequencyData(bins);
      g.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = canvas.width / bins.length;
      g.fillStyle = "#22c55e";
      bins.forEach((v, i) => {
        const h = (v / 255) * canvas.height;
        g.fillRect(i * barWidth, canvas.height - h, Math.max(1, barWidth - 1), h);
      });
      if (!reduced) raf = requestAnimationFrame(draw);
    };
    draw();

    return () => cancelAnimationFrame(raf);
  }, [analyser, enabled]);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={enabled}
        aria-label={enabled ? "Mute radio chatter" : "Enable radio chatter"}
        className="rounded border border-green-500/30 px-2 py-1 font-mono text-xs uppercase tracking-widest text-green-400/80 hover:text-green-300"
      >
        {enabled ? "radio: on" : "radio: off"}
      </button>
      {enabled && (
        <canvas ref={canvasRef} width={96} height={24} aria-hidden="true" className="opacity-80" />
      )}
    </div>
  );
}
