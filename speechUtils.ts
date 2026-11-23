export function cleanTextForSpeech(content: string, maxLen = 1800): string {
  return String(content || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\bNova AI\b/gi, 'نوفا')
    .replace(/[*#`>_~[\](){}|\\]/g, ' ')
    .replace(/\s*&\s*/g, ' و ')
    .replace(/%/g, ' بالمئة ')
    .replace(/\r?\n+/g, '. ')
    .replace(/\s*([،؛.؟!])\s*/g, '$1 ')
    .replace(/([.؟!]){2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Splits a clean Arabic/multilingual text into short, natural spoken sentences
 * so sequential TTS streaming begins rapidly and flows without choppy pauses.
 */
export function splitArabicSpeechSentences(
  rawText: string,
  maxChunkChars = 110,
  minChunkChars = 28
): string[] {
  const cleaned = cleanTextForSpeech(rawText, 2400);
  if (!cleaned) return [];

  // Primary split on major sentence boundaries while preserving punctuation
  const rawSegments = cleaned
    .split(/(?<=[.؟!\n؛])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const subdivided: string[] = [];

  for (const seg of rawSegments) {
    if (seg.length <= maxChunkChars) {
      subdivided.push(seg);
      continue;
    }

    // Subdivide long clauses cleanly on Arabic/English commas first
    const clauseParts = seg
      .split(/(?<=[،,])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    let current = '';
    for (const part of clauseParts) {
      if (!current) {
        current = part;
      } else if (current.length + 1 + part.length <= maxChunkChars) {
        current = `${current} ${part}`;
      } else {
        subdivided.push(current);
        current = part;
      }
    }
    if (current) {
      if (current.length <= maxChunkChars) {
        subdivided.push(current);
      } else {
        // Hard wrap on word boundaries only if a single clause exceeds maxChunkChars
        const words = current.split(/\s+/);
        let acc = '';
        for (const w of words) {
          if (!acc) {
            acc = w;
          } else if (acc.length + 1 + w.length <= maxChunkChars) {
            acc = `${acc} ${w}`;
          } else {
            subdivided.push(acc);
            acc = w;
          }
        }
        if (acc) subdivided.push(acc);
      }
    }
  }

  // Merge tiny trailing/adjacent fragments so each TTS request carries fluent prosody
  const merged: string[] = [];
  for (const seg of subdivided) {
    if (
      merged.length > 0 &&
      seg.length < minChunkChars &&
      merged[merged.length - 1].length + 1 + seg.length <= maxChunkChars + 30
    ) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${seg}`;
    } else {
      merged.push(seg);
    }
  }

  if (
    merged.length > 1 &&
    merged[0].length < minChunkChars &&
    merged[0].length + 1 + merged[1].length <= maxChunkChars + 35
  ) {
    const first = merged.shift()!;
    merged[0] = `${first} ${merged[0]}`;
  }

  return merged.filter((s) => s.replace(/[،؛.؟!\s-]/g, '').length > 0);
}

/**
 * Buffers incoming 24kHz PCM chunks until enough initial audio has arrived
 * (pre-buffering) and emits smooth coalesced blocks to prevent WebAudio underruns
 * and choppy playback over jittery connections.
 */
export class PcmStreamJitterBuffer {
  private chunks: Float32Array[] = [];
  private totalSamples = 0;
  private started = false;
  readonly initialPrebufferSamples: number;
  readonly blockTargetSamples: number;

  constructor(options?: { initialPrebufferMs?: number; blockTargetMs?: number; sampleRate?: number }) {
    const sr = options?.sampleRate ?? 24000;
    const preMs = options?.initialPrebufferMs ?? 420;
    const blockMs = options?.blockTargetMs ?? 240;
    this.initialPrebufferSamples = Math.max(2400, Math.round((sr * preMs) / 1000));
    this.blockTargetSamples = Math.max(1200, Math.round((sr * blockMs) / 1000));
  }

  get bufferedSamples(): number {
    return this.totalSamples;
  }

  get hasStarted(): boolean {
    return this.started;
  }

  push(samples: Float32Array): void {
    if (!samples || samples.length === 0) return;
    this.chunks.push(samples);
    this.totalSamples += samples.length;
  }

  popReadyBlocks(flushAll = false): Float32Array[] {
    if (this.totalSamples === 0) {
      if (flushAll) this.started = false;
      return [];
    }

    if (!this.started) {
      if (!flushAll && this.totalSamples < this.initialPrebufferSamples) {
        return [];
      }
      this.started = true;
    }

    const out: Float32Array[] = [];
    while (this.totalSamples > 0) {
      if (!flushAll && this.totalSamples < this.blockTargetSamples) {
        break;
      }

      const takeCount = flushAll
        ? this.totalSamples
        : Math.min(this.totalSamples, Math.max(this.blockTargetSamples, this.chunks[0]?.length ?? this.blockTargetSamples));

      const merged = new Float32Array(takeCount);
      let written = 0;
      while (written < takeCount && this.chunks.length > 0) {
        const head = this.chunks[0];
        const needed = takeCount - written;
        if (head.length <= needed) {
          merged.set(head, written);
          written += head.length;
          this.chunks.shift();
        } else {
          merged.set(head.subarray(0, needed), written);
          this.chunks[0] = head.subarray(needed);
          written += needed;
        }
      }
      this.totalSamples -= written;
      out.push(merged);
    }

    if (flushAll) {
      this.started = false;
    }
    return out;
  }

  reset(): void {
    this.chunks = [];
    this.totalSamples = 0;
    this.started = false;
  }
}

export function decodeAudioBytesToPcmFloat32(bytes: Uint8Array): {
  samples: Float32Array;
  sampleRate: number;
} {
  if (bytes.byteLength < 4) {
    return { samples: new Float32Array(0), sampleRate: 24000 };
  }

  let sampleRate = 24000;
  let dataOffset = 0;
  let dataLength = bytes.byteLength;

  // Detect RIFF/WAVE header cleanly and locate "fmt " sampleRate + "data" subchunk
  const isRiff =
    bytes.byteLength >= 44 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x41 && // A
    bytes[10] === 0x56 && // V
    bytes[11] === 0x45; // E

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (isRiff) {
    let offset = 12;
    let foundData = false;
    while (offset + 8 <= bytes.byteLength) {
      const id =
        String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      const chunkSize = view.getUint32(offset + 4, true);
      if (id === 'fmt ' && offset + 16 <= bytes.byteLength) {
        sampleRate = view.getUint32(offset + 12, true) || 24000;
      } else if (id === 'data') {
        dataOffset = offset + 8;
        dataLength = Math.min(chunkSize, bytes.byteLength - dataOffset);
        foundData = true;
        break;
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
    if (!foundData) {
      dataOffset = 44;
      dataLength = Math.max(0, bytes.byteLength - 44);
    }
  }

  const sampleCount = Math.floor(dataLength / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = view.getInt16(dataOffset + i * 2, true) / 32768;
  }

  return { samples, sampleRate };
}
