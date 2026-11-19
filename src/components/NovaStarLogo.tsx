import { useId } from 'react';

interface NovaStarLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'hero';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<NovaStarLogoProps['size']>, string> = {
  xs: 'w-6 h-6',
  sm: 'w-8 h-8 sm:w-9 sm:h-9',
  md: 'w-11 h-11 sm:w-12 sm:h-12',
  lg: 'w-14 h-14 sm:w-[72px] sm:h-[72px]',
  hero: 'w-32 h-32 sm:w-44 sm:h-44 lg:w-56 lg:h-56',
};

export function NovaStarLogo({ size = 'sm', className = '' }: NovaStarLogoProps) {
  const uid = useId().replace(/:/g, '');
  const isHero = size === 'hero' || size === 'lg';

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none ${SIZE_CLASSES[size]} ${className}`}
    >
      {/* Ambient blue & violet neon aura */}
      <div
        className="absolute inset-0 rounded-full blur-xl pointer-events-none"
        style={{
          background:
            'radial-gradient(circle, rgba(59,130,246,0.48) 0%, rgba(139,92,246,0.38) 52%, transparent 76%)',
          transform: isHero ? 'scale(1.15)' : 'scale(1.25)',
        }}
      />

      <svg
        viewBox="0 0 120 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="شعار Nova AI النجمي المتوهج"
        className="relative z-10 w-full h-full drop-shadow-[0_0_16px_rgba(99,102,241,0.65)]"
      >
        <defs>
          <linearGradient id={`starGrad-${uid}`} x1="16" y1="16" x2="104" y2="104" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="48%" stopColor="#3B82F6" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
          <linearGradient id={`orbitGrad-${uid}`} x1="10" y1="25" x2="110" y2="95" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#A78BFA" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.85" />
          </linearGradient>
          <radialGradient id={`coreGlow-${uid}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <stop offset="45%" stopColor="#93C5FD" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Subtle celestial orbit ring */}
        <ellipse
          cx="60"
          cy="60"
          rx="48"
          ry="20"
          transform="rotate(-28 60 60)"
          stroke={`url(#orbitGrad-${uid})`}
          strokeWidth={isHero ? '1.6' : '2.2'}
          strokeDasharray={isHero ? '4 3' : undefined}
          opacity="0.78"
        />

        {/* Secondary diagonal star rays */}
        <path
          d="M60 28 L65 55 L92 60 L65 65 L60 92 L55 65 L28 60 L55 55 Z"
          transform="rotate(45 60 60)"
          fill={`url(#starGrad-${uid})`}
          opacity="0.35"
        />

        {/* Primary 4-point glowing star */}
        <path
          d="M60 8 C63.5 41 79 56.5 112 60 C79 63.5 63.5 79 60 112 C56.5 79 41 63.5 8 60 C41 56.5 56.5 41 60 8 Z"
          fill={`url(#starGrad-${uid})`}
        />

        {/* Inner radiant star core */}
        <path
          d="M60 32 C61.8 49 71 58.2 88 60 C71 61.8 61.8 71 60 88 C58.2 71 49 61.8 32 60 C49 58.2 58.2 49 60 32 Z"
          fill={`url(#coreGlow-${uid})`}
        />

        {/* Accent satellite sparkle dot */}
        <circle cx="94" cy="28" r={isHero ? '2.8' : '3.5'} fill="#93C5FD" opacity="0.9" />
      </svg>
    </div>
  );
}
