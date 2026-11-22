import type { PptxDeck, PptxVisualTheme } from './pptxBuilder';

interface PdfPalette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  titleColor: string;
  textColor: string;
  mutedColor: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  border: string;
}

const PDF_PALETTES: Record<PptxVisualTheme, PdfPalette> = {
  cosmos: {
    bg: '#0B1020',
    surface: '#141C38',
    surfaceAlt: '#1B254B',
    titleColor: '#F8FAFC',
    textColor: '#E2E8F0',
    mutedColor: '#94A3B8',
    accent: '#8B5CF6',
    accentSoft: '#2E1065',
    accentText: '#DDD6FE',
    border: '#334155',
  },
  'executive-blue': {
    bg: '#0A192F',
    surface: '#112240',
    surfaceAlt: '#172E56',
    titleColor: '#FFFFFF',
    textColor: '#CBD5E1',
    mutedColor: '#94A3B8',
    accent: '#3B82F6',
    accentSoft: '#172554',
    accentText: '#BFDBFE',
    border: '#1E40AF',
  },
  'emerald-modern': {
    bg: '#041D17',
    surface: '#062E24',
    surfaceAlt: '#093F32',
    titleColor: '#F0FDF4',
    textColor: '#D1FAE5',
    mutedColor: '#6EE7B7',
    accent: '#10B981',
    accentSoft: '#064E3B',
    accentText: '#A7F3D0',
    border: '#047857',
  },
  'clean-light': {
    bg: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceAlt: '#F1F5F9',
    titleColor: '#0F172A',
    textColor: '#334155',
    mutedColor: '#64748B',
    accent: '#6D28D9',
    accentSoft: '#EDE9FE',
    accentText: '#5B21B6',
    border: '#CBD5E1',
  },
};

function sanitizeText(raw: unknown, maxLen = 280): string {
  const str = typeof raw === 'string' ? raw : String(raw ?? '');
  return str
    .replace(/\*\*/g, '')
    .replace(/[`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string,
  lineWidth = 1.5
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 4
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
      if (lines.length === maxLines - 1) {
        for (let j = i + 1; j < words.length; j++) {
          const rest = `${current} ${words[j]}`;
          if (ctx.measureText(`${rest}…`).width <= maxWidth) {
            current = rest;
          } else {
            current = `${current}…`;
            break;
          }
        }
        lines.push(current);
        return lines;
      }
    }
  }
  lines.push(current);
  return lines;
}

function drawWrappedBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  align: CanvasTextAlign,
  maxLines = 4
): number {
  const lines = wrapTextLines(ctx, text, maxWidth, maxLines);
  ctx.textAlign = align;
  lines.forEach((line, idx) => {
    ctx.fillText(line, x, y + idx * lineHeight);
  });
  return lines.length * lineHeight;
}

async function renderSlideToJpegBytes(
  slideData: PptxDeck['slides'][number],
  deck: PptxDeck,
  index: number,
  total: number,
  palette: PdfPalette,
  isRtl: boolean
): Promise<{ width: number; height: number; jpeg: Uint8Array }> {
  const W = 1600;
  const H = 900;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('CANVAS_CONTEXT_UNAVAILABLE');
  }

  const fontFamily = isRtl
    ? '"IBM Plex Sans Arabic", "Tahoma", "Segoe UI", sans-serif'
    : '"IBM Plex Sans Arabic", "Segoe UI", Arial, sans-serif';

  ctx.direction = isRtl ? 'rtl' : 'ltr';
  ctx.textBaseline = 'top';

  // Background
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);

  // Top accent bar & side ribbon
  ctx.fillStyle = palette.accent;
  ctx.fillRect(0, 0, W, 11);
  ctx.fillStyle = palette.accentSoft;
  ctx.fillRect(isRtl ? W - 14 : 0, 11, 14, H - 11);

  const cleanTitle = sanitizeText(slideData.title || deck.deckTitle, 110);
  const cleanSubtitle = sanitizeText(slideData.subtitle || '', 160);
  const rawBullets = Array.isArray(slideData.bullets)
    ? slideData.bullets.map((b) => sanitizeText(b, 240)).filter(Boolean)
    : [];

  if (slideData.layout === 'title' || index === 0) {
    drawRoundedRect(ctx, 108, 126, 1384, 636, 22, palette.surface, palette.border, 1.5);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(108, 126, 1384, 14);

    // Badge
    drawRoundedRect(ctx, 608, 180, 384, 50, 25, palette.accentSoft, palette.accent, 1.2);
    ctx.fillStyle = palette.accentText;
    ctx.font = `700 18px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText(isRtl ? 'عرض تقديمي متكامل' : 'EXECUTIVE PRESENTATION', W / 2, 194);

    // Main title
    ctx.fillStyle = palette.titleColor;
    ctx.font = `700 48px ${fontFamily}`;
    drawWrappedBlock(ctx, cleanTitle || deck.deckTitle, W / 2, 275, 1260, 62, 'center', 2);

    // Subtitle
    const heroSub = cleanSubtitle || sanitizeText(deck.deckSubtitle, 180);
    if (heroSub) {
      ctx.fillStyle = palette.mutedColor;
      ctx.font = `500 25px ${fontFamily}`;
      drawWrappedBlock(ctx, heroSub, W / 2, 435, 1160, 36, 'center', 2);
    }

    if (rawBullets.length > 0) {
      drawRoundedRect(ctx, 174, 594, 1252, 110, 14, palette.surfaceAlt, palette.border, 1);
      ctx.fillStyle = palette.accentText;
      ctx.font = `600 20px ${fontFamily}`;
      drawWrappedBlock(ctx, rawBullets.slice(0, 3).join('   |   '), W / 2, 622, 1180, 30, 'center', 2);
    }

    ctx.fillStyle = palette.mutedColor;
    ctx.font = `700 18px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText('Nova AI', W / 2, 805);
  } else {
    const padX = 90;
    const badgeX = isRtl ? 90 : 1360;
    drawRoundedRect(ctx, badgeX, 42, 150, 48, 16, palette.accentSoft, palette.accent, 1);
    ctx.fillStyle = palette.accentText;
    ctx.font = `700 18px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.fillText(isRtl ? `شريحة ${index + 1}` : `Slide ${index + 1}`, badgeX + 75, 55);

    const alignMain: CanvasTextAlign = isRtl ? 'right' : 'left';
    const titleAnchorX = isRtl ? W - 90 : 90;
    ctx.fillStyle = palette.titleColor;
    ctx.font = `700 34px ${fontFamily}`;
    drawWrappedBlock(ctx, cleanTitle, titleAnchorX, 42, 1220, 44, alignMain, 1);

    let dividerY = 132;
    if (cleanSubtitle) {
      ctx.fillStyle = palette.mutedColor;
      ctx.font = `500 20px ${fontFamily}`;
      drawWrappedBlock(ctx, cleanSubtitle, titleAnchorX, 102, 1420, 28, alignMain, 1);
      dividerY = 152;
    }

    ctx.fillStyle = palette.border;
    ctx.fillRect(padX, dividerY, W - padX * 2, 2);
    ctx.fillStyle = palette.accent;
    ctx.fillRect(isRtl ? W - padX - 180 : padX, dividerY - 2, 180, 6);

    const contentTop = dividerY + 28;
    const contentBottom = 806;
    const contentH = contentBottom - contentTop;

    if (slideData.layout === 'two-column' && slideData.rightColumnBullets?.length) {
      const secondaryItems = slideData.rightColumnBullets
        .map((b) => sanitizeText(b, 200))
        .filter(Boolean)
        .slice(0, 5);
      const primaryItems = rawBullets.slice(0, 5);
      const colW = 688;
      const rightBoxX = 822;
      const leftBoxX = 90;
      const primaryX = isRtl ? rightBoxX : leftBoxX;
      const secondaryX = isRtl ? leftBoxX : rightBoxX;

      const renderCol = (boxX: number, cardTitle: string, items: string[], highlight: boolean) => {
        drawRoundedRect(
          ctx,
          boxX,
          contentTop,
          colW,
          contentH,
          18,
          palette.surface,
          highlight ? palette.accent : palette.border,
          1.5
        );
        ctx.fillStyle = highlight ? palette.accentSoft : palette.surfaceAlt;
        ctx.fillRect(boxX, contentTop, colW, 66);
        ctx.fillStyle = highlight ? palette.accentText : palette.titleColor;
        ctx.font = `700 22px ${fontFamily}`;
        const hX = isRtl ? boxX + colW - 26 : boxX + 26;
        drawWrappedBlock(ctx, cardTitle, hX, contentTop + 19, colW - 52, 30, alignMain, 1);

        ctx.fillStyle = palette.textColor;
        ctx.font = `500 20px ${fontFamily}`;
        let curY = contentTop + 90;
        items.forEach((item) => {
          if (curY > contentBottom - 40) return;
          const used = drawWrappedBlock(ctx, `◆  ${item}`, hX, curY, colW - 52, 30, alignMain, 3);
          curY += used + 16;
        });
      };

      renderCol(primaryX, isRtl ? 'المحور الأساسي' : 'Primary Focus', primaryItems, true);
      renderCol(
        secondaryX,
        sanitizeText(slideData.rightColumnTitle || (isRtl ? 'التفاصيل والمقارنة' : 'Key Details'), 65),
        secondaryItems,
        false
      );
    } else if (slideData.layout === 'metrics' && slideData.metrics?.length) {
      const metricsRaw = slideData.metrics.slice(0, 4);
      const metricsOrdered = isRtl ? [...metricsRaw].reverse() : metricsRaw;
      const gap = 30;
      const cardW = (1420 - (metricsOrdered.length - 1) * gap) / metricsOrdered.length;
      const kpiH = 246;

      metricsOrdered.forEach((m, mIdx) => {
        const xPos = 90 + mIdx * (cardW + gap);
        drawRoundedRect(ctx, xPos, contentTop, cardW, kpiH, 16, palette.surface, palette.border, 1.5);
        ctx.fillStyle = palette.accent;
        ctx.fillRect(xPos, contentTop, cardW, 12);

        ctx.fillStyle = palette.accentText;
        ctx.font = `700 34px ${fontFamily}`;
        ctx.textAlign = 'center';
        drawWrappedBlock(ctx, sanitizeText(m.value, 32), xPos + cardW / 2, contentTop + 44, cardW - 36, 40, 'center', 2);

        ctx.fillStyle = palette.textColor;
        ctx.font = `500 19px ${fontFamily}`;
        drawWrappedBlock(ctx, sanitizeText(m.label, 80), xPos + cardW / 2, contentTop + 142, cardW - 36, 26, 'center', 3);
      });

      if (rawBullets.length > 0) {
        const notesTop = contentTop + kpiH + 28;
        const notesH = contentBottom - notesTop;
        drawRoundedRect(ctx, 90, notesTop, 1420, notesH, 16, palette.surfaceAlt, palette.border, 1.2);
        ctx.fillStyle = palette.textColor;
        ctx.font = `500 20px ${fontFamily}`;
        const nX = isRtl ? 1474 : 126;
        let curY = notesTop + 26;
        rawBullets.slice(0, 4).forEach((item) => {
          if (curY > contentBottom - 36) return;
          const used = drawWrappedBlock(ctx, `◆  ${item}`, nX, curY, 1348, 30, alignMain, 2);
          curY += used + 12;
        });
      }
    } else {
      const items = rawBullets.slice(0, 5);
      const rowGap = 18;
      const rowCount = Math.max(1, items.length);
      const rowH = Math.min(124, (contentH - (rowCount - 1) * rowGap) / rowCount);

      items.forEach((item, rIdx) => {
        const rowY = contentTop + rIdx * (rowH + rowGap);
        drawRoundedRect(
          ctx,
          90,
          rowY,
          1420,
          rowH,
          14,
          palette.surface,
          slideData.layout === 'conclusion' ? palette.accent : palette.border,
          1.2
        );

        const numX = isRtl ? 1436 : 114;
        drawRoundedRect(
          ctx,
          numX,
          rowY + (rowH - 46) / 2,
          50,
          46,
          10,
          slideData.layout === 'conclusion' ? palette.accent : palette.accentSoft,
          palette.accent,
          1
        );
        ctx.fillStyle = slideData.layout === 'conclusion' ? '#FFFFFF' : palette.accentText;
        ctx.font = `700 20px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.fillText(`${rIdx + 1}`, numX + 25, rowY + (rowH - 46) / 2 + 12);

        ctx.fillStyle = palette.textColor;
        ctx.font = `500 21px ${fontFamily}`;
        const textX = isRtl ? 1412 : 186;
        drawWrappedBlock(ctx, item, textX, rowY + Math.max(18, (rowH - 54) / 2), 1290, 29, alignMain, 2);
      });
    }

    // Footer
    ctx.fillStyle = palette.mutedColor;
    ctx.font = `600 16px ${fontFamily}`;
    ctx.textAlign = 'left';
    ctx.fillText(`${index + 1} / ${total}`, 90, 836);
    ctx.textAlign = 'right';
    ctx.fillText('Nova AI', W - 90, 836);
  }

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('PDF_SLIDE_RENDER_FAILED'))),
      'image/jpeg',
      0.92
    );
  });
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  return { width: W, height: H, jpeg };
}

function buildMultiPagePdfFromJpegs(
  pages: Array<{ width: number; height: number; jpeg: Uint8Array }>
): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0]; // 1-indexed objects; 0 is free head
  let totalBytes = 0;

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    totalBytes += bytes.length;
  };
  const pushStr = (s: string) => pushBytes(enc.encode(s));

  pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // Object 1: Catalog
  // Object 2: Pages
  // Each page i (0..N-1) creates 3 objects:
  //   pageObjId = 3 + i * 3
  //   contentObjId = 4 + i * 3
  //   imageObjId = 5 + i * 3
  const pageCount = pages.length;
  const pageIds = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');

  const startObj = (objNum: number) => {
    offsets[objNum] = totalBytes;
    pushStr(`${objNum} 0 obj\n`);
  };
  const endObj = () => pushStr('\nendobj\n');

  // 1: Catalog
  startObj(1);
  pushStr('<< /Type /Catalog /Pages 2 0 R >>');
  endObj();

  // 2: Pages
  startObj(2);
  pushStr(`<< /Type /Pages /Count ${pageCount} /Kids [ ${pageIds} ] >>`);
  endObj();

  // 16:9 standard presentation page size in PDF points (10 in x 5.625 in = 720 x 405 pt)
  const pagePtW = 720;
  const pagePtH = 405;

  pages.forEach((p, i) => {
    const pageObjId = 3 + i * 3;
    const contentObjId = 4 + i * 3;
    const imageObjId = 5 + i * 3;

    startObj(pageObjId);
    pushStr(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pagePtW} ${pagePtH}] ` +
        `/Resources << /XObject << /Im0 ${imageObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>`
    );
    endObj();

    const streamCmd = `q ${pagePtW} 0 0 ${pagePtH} 0 0 cm /Im0 Do Q`;
    startObj(contentObjId);
    pushStr(`<< /Length ${streamCmd.length} >>\nstream\n${streamCmd}\nendstream`);
    endObj();

    startObj(imageObjId);
    pushStr(
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`
    );
    pushBytes(p.jpeg);
    pushStr('\nendstream');
    endObj();
  });

  const xrefOffset = totalBytes;
  const totalObjects = 2 + pageCount * 3 + 1;
  pushStr(`xref\n0 ${totalObjects}\n`);
  pushStr('0000000000 65535 f \n');
  for (let objNum = 1; objNum < totalObjects; objNum++) {
    const offStr = String(offsets[objNum]).padStart(10, '0');
    pushStr(`${offStr} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const output = new Uint8Array(totalBytes);
  let cursor = 0;
  for (const chunk of chunks) {
    output.set(chunk, cursor);
    cursor += chunk.length;
  }
  return output;
}

export async function exportDeckToPdf(
  deck: PptxDeck,
  visualTheme: PptxVisualTheme = 'cosmos',
  language: 'ar' | 'en' = 'ar'
): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await document.fonts.ready.catch(() => undefined);
  }

  const isRtl = language === 'ar';
  const palette = PDF_PALETTES[visualTheme] || PDF_PALETTES.cosmos;
  const total = deck.slides.length;
  const renderedPages: Array<{ width: number; height: number; jpeg: Uint8Array }> = [];

  for (let i = 0; i < total; i++) {
    const frame = await renderSlideToJpegBytes(deck.slides[i], deck, i, total, palette, isRtl);
    renderedPages.push(frame);
  }

  const pdfBytes = buildMultiPagePdfFromJpegs(renderedPages);
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const safeName = (deck.deckTitle || 'Nova-AI-Presentation')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeName || 'Nova-AI-Presentation'}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
