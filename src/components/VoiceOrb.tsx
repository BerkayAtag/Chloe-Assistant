'use client';

import { useEffect, useRef } from 'react';

export type VoiceState = 'ready' | 'starting' | 'listening' | 'thinking' | 'preparing' | 'speaking';

/** A procedural sphere: no remote assets, WebGL or microphone permissions needed.
 * Motion represents the voice lifecycle, not a simulated audio-level measurement. */
export default function VoiceOrb({ state = 'ready', compact = false, theme }: {
  state?: VoiceState;
  compact?: boolean;
  theme: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let color = '';
    const count = compact ? 130 : 1100;
    const points = Array.from({ length: count }, (_, index) => {
      const y = 1 - (index / (count - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const angle = Math.PI * (3 - Math.sqrt(5)) * index;
      return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius, angle };
    });
    let size = 0;
    let frame = 0;
    let lastTime = 0;
    let phase = 0;
    let visible = true;
    let motion = 0;
    const paint = (time: number) => {
      frame = 0;
      // Parent theme effects run after child effects. Resolve on the first frame
      // so a live theme switch never keeps the previous palette in the canvas.
      if (!color) color = getComputedStyle(canvas).getPropertyValue('--orb-rgb').trim();
      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
      lastTime = time;
      const current = stateRef.current;
      const target = current === 'speaking' ? 1 : current === 'listening' ? 0.48 : current === 'thinking' || current === 'preparing' ? 0.25 : 0.06;
      motion += (target - motion) * Math.min(1, delta * 5);
      phase += reducedMotion.matches ? 0 : delta * (0.12 + motion * 0.52);
      context.clearRect(0, 0, size, size);
      const center = size / 2;
      // 20% breathing room contains all deformation and glow, including speech peaks.
      const radius = size * 0.34;
      const halo = context.createRadialGradient(center, center, radius * 0.15, center, center, radius * 1.35);
      halo.addColorStop(0, `rgba(${color},0.035)`);
      halo.addColorStop(0.68, `rgba(${color},0.025)`);
      halo.addColorStop(1, `rgba(${color},0)`);
      context.fillStyle = halo;
      context.fillRect(0, 0, size, size);
      const sin = Math.sin(phase), cos = Math.cos(phase);
      const projected = points.map((point) => {
        const x = point.x * cos - point.z * sin;
        const z = point.x * sin + point.z * cos;
        const wave = reducedMotion.matches ? 0 : Math.sin(point.y * 9 + phase * 11 + point.angle * 0.4) * motion * 0.095;
        const ripple = reducedMotion.matches ? 0 : Math.cos(point.angle + phase * 7) * motion * 0.035;
        const scale = 1 + wave + ripple;
        return { x: center + x * radius * scale, y: center + (point.y * 0.96 + z * 0.16) * radius * scale, z };
      });
      for (const point of projected) {
        const depth = (point.z + 1) / 2;
        const dot = compact ? 0.6 + depth * 0.45 : (size / 420) * (0.6 + depth * 1.1 + motion * 0.3);
        context.fillStyle = `rgba(${color},${0.13 + depth * 0.8})`;
        context.beginPath();
        context.arc(point.x, point.y, dot, 0, Math.PI * 2);
        context.fill();
      }
      if (!reducedMotion.matches && !document.hidden && visible) frame = requestAnimationFrame(paint);
    };
    const refresh = () => {
      cancelAnimationFrame(frame);
      lastTime = 0;
      frame = requestAnimationFrame(paint);
    };
    const resize = new ResizeObserver(([entry]) => {
      size = Math.min(entry.contentRect.width, entry.contentRect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      refresh();
    });
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; refresh(); });
    resize.observe(canvas);
    intersection.observe(canvas);
    reducedMotion.addEventListener('change', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      reducedMotion.removeEventListener('change', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [compact, theme]);

  return <canvas ref={canvasRef} className="voice-orb" data-state={state} aria-hidden="true" />;
}
