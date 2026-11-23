let primedOutputCtx: AudioContext | null = null;

export function createAudioContextSafe(preferredSampleRate?: number): AudioContext {
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (preferredSampleRate) {
    try {
      return new AudioCtx({ sampleRate: preferredSampleRate });
    } catch {
      return new AudioCtx();
    }
  }
  return new AudioCtx();
}

export function primeOutputAudioContext(): void {
  if (typeof window === 'undefined') return;
  try {
    if (!primedOutputCtx || primedOutputCtx.state === 'closed') {
      primedOutputCtx = createAudioContextSafe(24000);
    }
    if (primedOutputCtx.state === 'suspended') {
      primedOutputCtx.resume().catch(() => undefined);
    }
    // Play a 1-sample silent buffer synchronously within the user click gesture to unlock strict mobile/Safari audio
    const silent = primedOutputCtx.createBuffer(1, 1, 24000);
    const src = primedOutputCtx.createBufferSource();
    src.buffer = silent;
    src.connect(primedOutputCtx.destination);
    src.start(0);
  } catch {
    // ignore if browser disallows AudioContext here
  }
}

export function consumePrimedOutputAudioContext(): AudioContext {
  if (primedOutputCtx && primedOutputCtx.state !== 'closed') {
    const ctx = primedOutputCtx;
    primedOutputCtx = null;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => undefined);
    }
    return ctx;
  }
  return createAudioContextSafe(24000);
}
