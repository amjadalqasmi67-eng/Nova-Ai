import { useEffect, useRef } from 'react';
import { BACKGROUND_PRESETS, BackgroundStyle, ThemeMode } from '../lib/theme';

interface Star {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  opacity: number;
  twinkleSpeed: number;
  phase: number;
  tint: 'white' | 'blue' | 'violet';
}

interface StarfieldCanvasProps {
  themeMode: ThemeMode;
  backgroundStyle?: BackgroundStyle;
}

export function StarfieldCanvas({ themeMode, backgroundStyle = 'cosmos' }: StarfieldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeRef = useRef<ThemeMode>(themeMode);
  const preset = BACKGROUND_PRESETS[backgroundStyle] || BACKGROUND_PRESETS.cosmos;

  useEffect(() => {
    themeRef.current = themeMode;
  }, [themeMode]);

  useEffect(() => {
    if (!preset.showStars) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let animationId = 0;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let stars: Star[] = [];

    const createStars = () => {
      const count = Math.min(220, Math.floor((width * height) / 7800));
      stars = Array.from({ length: count }, (_, idx) => {
        const layer = idx % 3;
        const tintRoll = idx % 8;
        const tint: Star['tint'] = tintRoll === 0 ? 'violet' : tintRoll <= 2 ? 'blue' : 'white';
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          radius:
            layer === 0
              ? Math.random() * 0.8 + 0.35
              : layer === 1
                ? Math.random() * 1.15 + 0.55
                : Math.random() * 1.55 + 0.8,
          vx: (Math.random() - 0.5) * 0.08,
          vy: -(layer === 0 ? 0.06 : layer === 1 ? 0.14 : 0.24),
          opacity: layer === 0 ? 0.38 : layer === 1 ? 0.62 : 0.88,
          twinkleSpeed: Math.random() * 0.018 + 0.006,
          phase: Math.random() * Math.PI * 2,
          tint,
        };
      });
    };

    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      createStars();
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const isDark = themeRef.current === 'dark';

      for (const star of stars) {
        if (!prefersReducedMotion) {
          star.x += star.vx;
          star.y += star.vy;
          star.phase += star.twinkleSpeed;
          if (star.y < -6) {
            star.y = height + 6;
            star.x = Math.random() * width;
          }
          if (star.x < -6) star.x = width + 6;
          if (star.x > width + 6) star.x = -6;
        }

        const alpha = star.opacity * (0.6 + 0.4 * Math.sin(star.phase));

        if (isDark) {
          if (star.tint === 'blue') {
            ctx.fillStyle = `rgba(96, 165, 250, ${alpha})`;
          } else if (star.tint === 'violet') {
            ctx.fillStyle = `rgba(167, 139, 250, ${alpha})`;
          } else {
            ctx.fillStyle = `rgba(241, 245, 249, ${alpha})`;
          }
        } else {
          if (star.tint === 'blue') {
            ctx.fillStyle = `rgba(37, 99, 235, ${alpha * 0.42})`;
          } else if (star.tint === 'violet') {
            ctx.fillStyle = `rgba(124, 58, 237, ${alpha * 0.42})`;
          } else {
            ctx.fillStyle = `rgba(71, 85, 105, ${alpha * 0.35})`;
          }
        }

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!prefersReducedMotion) {
        animationId = requestAnimationFrame(draw);
      }
    };

    draw();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [preset.showStars]);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
      {themeMode === 'dark' && backgroundStyle === 'cosmos' && (
        <img
          src="/src/assets/images/nova_cosmos_backdrop_1795088891481.jpg"
          alt=""
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-35 mix-blend-screen select-none"
        />
      )}
      <div
        className="absolute inset-0 transition-all duration-300"
        style={{
          background: themeMode === 'dark' ? preset.auraDark : preset.auraLight,
        }}
      />
      {preset.showStars && <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />}
    </div>
  );
}
