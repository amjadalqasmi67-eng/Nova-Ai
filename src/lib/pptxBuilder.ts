import PptxGenJS from 'pptxgenjs';

export interface PptxMetric {
  label: string;
  value: string;
}

export interface PptxSlideData {
  layout: 'title' | 'bullets' | 'two-column' | 'metrics' | 'conclusion';
  title: string;
  subtitle?: string;
  bullets: string[];
  rightColumnTitle?: string;
  rightColumnBullets?: string[];
  metrics?: PptxMetric[];
  speakerNotes: string;
}

export interface PptxDeck {
  deckTitle: string;
  deckSubtitle: string;
  slides: PptxSlideData[];
  language?: 'ar' | 'en';
}

export type PptxVisualTheme = 'cosmos' | 'executive-blue' | 'emerald-modern' | 'clean-light';

interface ThemePalette {
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

const DECK_PALETTES: Record<PptxVisualTheme, ThemePalette> = {
  cosmos: {
    bg: '0B1020',
    surface: '141C38',
    surfaceAlt: '1B254B',
    titleColor: 'F8FAFC',
    textColor: 'E2E8F0',
    mutedColor: '94A3B8',
    accent: '8B5CF6',
    accentSoft: '2E1065',
    accentText: 'DDD6FE',
    border: '334155',
  },
  'executive-blue': {
    bg: '0A192F',
    surface: '112240',
    surfaceAlt: '172E56',
    titleColor: 'FFFFFF',
    textColor: 'CBD5E1',
    mutedColor: '94A3B8',
    accent: '3B82F6',
    accentSoft: '172554',
    accentText: 'BFDBFE',
    border: '1E40AF',
  },
  'emerald-modern': {
    bg: '041D17',
    surface: '062E24',
    surfaceAlt: '093F32',
    titleColor: 'F0FDF4',
    textColor: 'D1FAE5',
    mutedColor: '6EE7B7',
    accent: '10B981',
    accentSoft: '064E3B',
    accentText: 'A7F3D0',
    border: '047857',
  },
  'clean-light': {
    bg: 'F8FAFC',
    surface: 'FFFFFF',
    surfaceAlt: 'F1F5F9',
    titleColor: '0F172A',
    textColor: '334155',
    mutedColor: '64748B',
    accent: '6D28D9',
    accentSoft: 'EDE9FE',
    accentText: '5B21B6',
    border: 'CBD5E1',
  },
};

function sanitizeSlideText(raw: unknown, maxLen = 280): string {
  const str = typeof raw === 'string' ? raw : String(raw ?? '');
  return str
    .replace(/\*\*/g, '')
    .replace(/[`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function buildParagraphRuns(
  items: string[],
  fontFace: string,
  fontSize: number,
  color: string,
  isRtl: boolean,
  bulletPrefix = '◆  '
): PptxGenJS.TextProps[] {
  return items
    .map((item) => sanitizeSlideText(item, 240))
    .filter(Boolean)
    .map((clean, idx, arr) => ({
      text: `${bulletPrefix}${clean}`,
      options: {
        fontFace,
        fontSize,
        color,
        rtlMode: isRtl,
        breakLine: idx < arr.length - 1,
        paraSpaceAfter: 9,
      },
    }));
}

export async function exportDeckToPptx(
  deck: PptxDeck,
  visualTheme: PptxVisualTheme = 'cosmos',
  language: 'ar' | 'en' = 'ar'
): Promise<void> {
  const pres = new PptxGenJS();
  const isRtl = language === 'ar';
  const palette = DECK_PALETTES[visualTheme] || DECK_PALETTES.cosmos;
  const fontFace = isRtl ? 'Tahoma' : 'Calibri';

  pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
  pres.rtlMode = isRtl;
  pres.title = deck.deckTitle;
  pres.subject = deck.deckSubtitle || deck.deckTitle;
  pres.author = 'Nova AI';

  const alignMain = isRtl ? 'right' : 'left';
  const slideTotal = deck.slides.length;

  deck.slides.forEach((slideData, index) => {
    const slide = pres.addSlide();
    slide.background = { color: palette.bg };

    // Top accent stripe across full width
    slide.addShape(pres.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.333,
      h: 0.09,
      fill: { color: palette.accent },
      line: { color: palette.accent, width: 0 },
    });

    // Side reading-edge accent ribbon
    slide.addShape(pres.ShapeType.rect, {
      x: isRtl ? 13.223 : 0,
      y: 0.09,
      w: 0.11,
      h: 7.41,
      fill: { color: palette.accentSoft },
      line: { color: palette.accentSoft, width: 0 },
    });

    const cleanTitle = sanitizeSlideText(slideData.title || deck.deckTitle, 110);
    const cleanSubtitle = sanitizeSlideText(slideData.subtitle || '', 160);
    const rawBullets = Array.isArray(slideData.bullets)
      ? slideData.bullets.map((b) => sanitizeSlideText(b, 240)).filter(Boolean)
      : [];

    if (slideData.layout === 'title' || index === 0) {
      // Hero Title Card
      slide.addShape(pres.ShapeType.roundRect, {
        x: 0.9,
        y: 1.05,
        w: 11.53,
        h: 5.3,
        rectRadius: 0.16,
        fill: { color: palette.surface },
        line: { color: palette.border, width: 1.1 },
      });

      // Top accent strip on title card
      slide.addShape(pres.ShapeType.rect, {
        x: 0.9,
        y: 1.05,
        w: 11.53,
        h: 0.12,
        fill: { color: palette.accent },
        line: { color: palette.accent, width: 0 },
      });

      // Pill badge
      slide.addShape(pres.ShapeType.roundRect, {
        x: 5.06,
        y: 1.5,
        w: 3.2,
        h: 0.42,
        rectRadius: 0.21,
        fill: { color: palette.accentSoft },
        line: { color: palette.accent, width: 0.75 },
      });
      slide.addText(isRtl ? 'عرض تقديمي متكامل' : 'EXECUTIVE PRESENTATION', {
        x: 5.06,
        y: 1.5,
        w: 3.2,
        h: 0.42,
        fontFace,
        fontSize: 11,
        bold: true,
        color: palette.accentText,
        align: 'center',
        valign: 'middle',
        rtlMode: isRtl,
      });

      // Main Deck Title
      slide.addText(cleanTitle || deck.deckTitle, {
        x: 1.35,
        y: 2.1,
        w: 10.63,
        h: 1.45,
        fontFace,
        fontSize: 33,
        bold: true,
        color: palette.titleColor,
        align: 'center',
        valign: 'middle',
        fit: 'shrink',
        lineSpacingMultiple: 1.18,
        rtlMode: isRtl,
      });

      const heroSub = cleanSubtitle || sanitizeSlideText(deck.deckSubtitle, 180);
      if (heroSub) {
        slide.addText(heroSub, {
          x: 1.75,
          y: 3.65,
          w: 9.83,
          h: 1.0,
          fontFace,
          fontSize: 17,
          color: palette.mutedColor,
          align: 'center',
          valign: 'top',
          fit: 'shrink',
          lineSpacingMultiple: 1.3,
          rtlMode: isRtl,
        });
      }

      if (rawBullets.length > 0) {
        slide.addShape(pres.ShapeType.roundRect, {
          x: 1.45,
          y: 4.95,
          w: 10.43,
          h: 0.92,
          rectRadius: 0.1,
          fill: { color: palette.surfaceAlt },
          line: { color: palette.border, width: 0.75 },
        });
        slide.addText(rawBullets.slice(0, 3).join('   |   '), {
          x: 1.65,
          y: 5.02,
          w: 10.03,
          h: 0.78,
          fontFace,
          fontSize: 12.5,
          bold: true,
          color: palette.accentText,
          align: 'center',
          valign: 'middle',
          fit: 'shrink',
          rtlMode: isRtl,
        });
      }

      slide.addText('Nova AI', {
        x: 0.9,
        y: 6.72,
        w: 11.53,
        h: 0.4,
        fontFace: 'Tahoma',
        fontSize: 11,
        bold: true,
        color: palette.mutedColor,
        align: 'center',
      });
    } else {
      // Slide Number Badge (far opposite side of reading direction)
      const badgeX = isRtl ? 0.75 : 11.33;
      const titleX = isRtl ? 2.15 : 0.75;
      const titleW = 10.43;

      slide.addShape(pres.ShapeType.roundRect, {
        x: badgeX,
        y: 0.36,
        w: 1.25,
        h: 0.4,
        rectRadius: 0.14,
        fill: { color: palette.accentSoft },
        line: { color: palette.accent, width: 0.75 },
      });
      slide.addText(isRtl ? `شريحة ${index + 1}` : `Slide ${index + 1}`, {
        x: badgeX,
        y: 0.36,
        w: 1.25,
        h: 0.4,
        fontFace,
        fontSize: 10.5,
        bold: true,
        color: palette.accentText,
        align: 'center',
        valign: 'middle',
        rtlMode: isRtl,
      });

      // Slide Title
      slide.addText(cleanTitle, {
        x: titleX,
        y: 0.3,
        w: titleW,
        h: 0.62,
        fontFace,
        fontSize: 23,
        bold: true,
        color: palette.titleColor,
        align: alignMain,
        valign: 'middle',
        fit: 'shrink',
        rtlMode: isRtl,
      });

      if (cleanSubtitle) {
        slide.addText(cleanSubtitle, {
          x: 0.75,
          y: 0.94,
          w: 11.83,
          h: 0.38,
          fontFace,
          fontSize: 13,
          color: palette.mutedColor,
          align: alignMain,
          fit: 'shrink',
          rtlMode: isRtl,
        });
      }

      // Header Divider Line + Short Accent Bar
      const dividerY = cleanSubtitle ? 1.4 : 1.08;
      slide.addShape(pres.ShapeType.rect, {
        x: 0.75,
        y: dividerY,
        w: 11.83,
        h: 0.02,
        fill: { color: palette.border },
        line: { color: palette.border, width: 0 },
      });
      slide.addShape(pres.ShapeType.rect, {
        x: isRtl ? 11.08 : 0.75,
        y: dividerY - 0.015,
        w: 1.5,
        h: 0.05,
        fill: { color: palette.accent },
        line: { color: palette.accent, width: 0 },
      });

      const contentTop = dividerY + 0.24;
      const contentBottom = 6.72;
      const contentH = contentBottom - contentTop;

      if (slideData.layout === 'two-column' && slideData.rightColumnBullets?.length) {
        const secondaryItems = slideData.rightColumnBullets
          .map((b) => sanitizeSlideText(b, 200))
          .filter(Boolean);
        const primaryItems = rawBullets;

        const rightBoxX = 6.85;
        const leftBoxX = 0.75;
        const colW = 5.73;

        // In RTL: primary bullets go on the RIGHT card, secondary column goes on the LEFT card.
        const primaryX = isRtl ? rightBoxX : leftBoxX;
        const secondaryX = isRtl ? leftBoxX : rightBoxX;

        const primaryCardTitle = isRtl ? 'المحور الأساسي' : 'Primary Focus';
        const secondaryCardTitle = sanitizeSlideText(
          slideData.rightColumnTitle || (isRtl ? 'التفاصيل والمقارنة' : 'Key Details'),
          65
        );

        const renderColumnCard = (
          boxX: number,
          cardTitle: string,
          items: string[],
          isHighlighted: boolean
        ) => {
          slide.addShape(pres.ShapeType.roundRect, {
            x: boxX,
            y: contentTop,
            w: colW,
            h: contentH,
            rectRadius: 0.14,
            fill: { color: palette.surface },
            line: { color: isHighlighted ? palette.accent : palette.border, width: isHighlighted ? 1.15 : 1 },
          });
          // Header strip
          slide.addShape(pres.ShapeType.rect, {
            x: boxX,
            y: contentTop,
            w: colW,
            h: 0.56,
            fill: { color: isHighlighted ? palette.accentSoft : palette.surfaceAlt },
            line: { color: isHighlighted ? palette.accent : palette.border, width: 0.5 },
          });
          slide.addText(cardTitle, {
            x: boxX + 0.22,
            y: contentTop + 0.04,
            w: colW - 0.44,
            h: 0.48,
            fontFace,
            fontSize: 15,
            bold: true,
            color: isHighlighted ? palette.accentText : palette.titleColor,
            align: alignMain,
            valign: 'middle',
            fit: 'shrink',
            rtlMode: isRtl,
          });

          const bodyFontSize = items.length >= 5 ? 13.5 : 14.5;
          const runs = buildParagraphRuns(items.slice(0, 6), fontFace, bodyFontSize, palette.textColor, isRtl);
          if (runs.length > 0) {
            slide.addText(runs, {
              x: boxX + 0.24,
              y: contentTop + 0.72,
              w: colW - 0.48,
              h: contentH - 0.9,
              align: alignMain,
              valign: 'top',
              fit: 'shrink',
              lineSpacingMultiple: 1.25,
              rtlMode: isRtl,
            });
          }
        };

        renderColumnCard(primaryX, primaryCardTitle, primaryItems, true);
        renderColumnCard(secondaryX, secondaryCardTitle, secondaryItems, false);
      } else if (slideData.layout === 'metrics' && slideData.metrics?.length) {
        const metricsRaw = slideData.metrics.slice(0, 4);
        const metricsOrdered = isRtl ? [...metricsRaw].reverse() : metricsRaw;
        const gap = 0.26;
        const cardW = (11.83 - (metricsOrdered.length - 1) * gap) / metricsOrdered.length;
        const kpiH = 2.05;

        metricsOrdered.forEach((m, mIdx) => {
          const xPos = 0.75 + mIdx * (cardW + gap);
          slide.addShape(pres.ShapeType.roundRect, {
            x: xPos,
            y: contentTop,
            w: cardW,
            h: kpiH,
            rectRadius: 0.14,
            fill: { color: palette.surface },
            line: { color: palette.border, width: 1 },
          });
          slide.addShape(pres.ShapeType.rect, {
            x: xPos,
            y: contentTop,
            w: cardW,
            h: 0.1,
            fill: { color: palette.accent },
            line: { color: palette.accent, width: 0 },
          });
          slide.addText(sanitizeSlideText(m.value, 32), {
            x: xPos + 0.15,
            y: contentTop + 0.28,
            w: cardW - 0.3,
            h: 0.82,
            fontFace,
            fontSize: 25,
            bold: true,
            color: palette.accentText,
            align: 'center',
            valign: 'middle',
            fit: 'shrink',
            rtlMode: isRtl,
          });
          slide.addText(sanitizeSlideText(m.label, 80), {
            x: xPos + 0.15,
            y: contentTop + 1.15,
            w: cardW - 0.3,
            h: 0.72,
            fontFace,
            fontSize: 12.5,
            color: palette.textColor,
            align: 'center',
            valign: 'top',
            fit: 'shrink',
            lineSpacingMultiple: 1.18,
            rtlMode: isRtl,
          });
        });

        if (rawBullets.length > 0) {
          const notesTop = contentTop + kpiH + 0.24;
          const notesH = contentBottom - notesTop;
          slide.addShape(pres.ShapeType.roundRect, {
            x: 0.75,
            y: notesTop,
            w: 11.83,
            h: notesH,
            rectRadius: 0.14,
            fill: { color: palette.surfaceAlt },
            line: { color: palette.border, width: 0.9 },
          });

          const runs = buildParagraphRuns(rawBullets.slice(0, 4), fontFace, 14, palette.textColor, isRtl);
          slide.addText(runs, {
            x: 1.05,
            y: notesTop + 0.2,
            w: 11.23,
            h: notesH - 0.38,
            align: alignMain,
            valign: 'top',
            fit: 'shrink',
            lineSpacingMultiple: 1.24,
            rtlMode: isRtl,
          });
        }
      } else if (slideData.layout === 'conclusion') {
        // Executive conclusion banner card with strong reading-edge accent bar
        slide.addShape(pres.ShapeType.roundRect, {
          x: 0.75,
          y: contentTop,
          w: 11.83,
          h: contentH,
          rectRadius: 0.16,
          fill: { color: palette.surface },
          line: { color: palette.accent, width: 1.2 },
        });
        slide.addShape(pres.ShapeType.rect, {
          x: isRtl ? 12.42 : 0.75,
          y: contentTop,
          w: 0.16,
          h: contentH,
          fill: { color: palette.accent },
          line: { color: palette.accent, width: 0 },
        });

        const takeawayItems = rawBullets.slice(0, 5);
        const rowGap = 0.14;
        const rowCount = Math.max(1, takeawayItems.length);
        const availH = contentH - 0.44;
        const rowH = Math.min(1.02, (availH - (rowCount - 1) * rowGap) / rowCount);

        takeawayItems.forEach((item, rIdx) => {
          const rowY = contentTop + 0.22 + rIdx * (rowH + rowGap);
          slide.addShape(pres.ShapeType.roundRect, {
            x: isRtl ? 1.05 : 1.15,
            y: rowY,
            w: 11.15,
            h: rowH,
            rectRadius: 0.1,
            fill: { color: palette.surfaceAlt },
            line: { color: palette.border, width: 0.6 },
          });

          const numX = isRtl ? 11.62 : 1.28;
          slide.addShape(pres.ShapeType.roundRect, {
            x: numX,
            y: rowY + (rowH - 0.36) / 2,
            w: 0.4,
            h: 0.36,
            rectRadius: 0.08,
            fill: { color: palette.accent },
            line: { color: palette.accent, width: 0 },
          });
          slide.addText(`${rIdx + 1}`, {
            x: numX,
            y: rowY + (rowH - 0.36) / 2,
            w: 0.4,
            h: 0.36,
            fontFace: 'Tahoma',
            fontSize: 12,
            bold: true,
            color: 'FFFFFF',
            align: 'center',
            valign: 'middle',
          });

          slide.addText(item, {
            x: isRtl ? 1.2 : 1.82,
            y: rowY + 0.06,
            w: 10.28,
            h: rowH - 0.12,
            fontFace,
            fontSize: 14.5,
            color: palette.textColor,
            align: alignMain,
            valign: 'middle',
            fit: 'shrink',
            lineSpacingMultiple: 1.2,
            rtlMode: isRtl,
          });
        });
      } else {
        // Structured Bullet Cards (up to 5 bullets rendered as crisp row cards, 6+ in a framed bullet container)
        if (rawBullets.length > 0 && rawBullets.length <= 5) {
          const rowGap = 0.16;
          const rowCount = rawBullets.length;
          const rowH = Math.min(1.08, (contentH - (rowCount - 1) * rowGap) / rowCount);

          rawBullets.forEach((item, rIdx) => {
            const rowY = contentTop + rIdx * (rowH + rowGap);
            slide.addShape(pres.ShapeType.roundRect, {
              x: 0.75,
              y: rowY,
              w: 11.83,
              h: rowH,
              rectRadius: 0.12,
              fill: { color: palette.surface },
              line: { color: palette.border, width: 0.9 },
            });

            // Small reading-edge accent indicator badge inside each row
            const badgeBoxX = isRtl ? 11.96 : 0.94;
            slide.addShape(pres.ShapeType.roundRect, {
              x: badgeBoxX,
              y: rowY + (rowH - 0.4) / 2,
              w: 0.42,
              h: 0.4,
              rectRadius: 0.09,
              fill: { color: palette.accentSoft },
              line: { color: palette.accent, width: 0.8 },
            });
            slide.addText(`${rIdx + 1}`, {
              x: badgeBoxX,
              y: rowY + (rowH - 0.4) / 2,
              w: 0.42,
              h: 0.4,
              fontFace: 'Tahoma',
              fontSize: 12,
              bold: true,
              color: palette.accentText,
              align: 'center',
              valign: 'middle',
            });

            slide.addText(item, {
              x: isRtl ? 0.95 : 1.52,
              y: rowY + 0.06,
              w: 10.85,
              h: rowH - 0.12,
              fontFace,
              fontSize: 15,
              color: palette.textColor,
              align: alignMain,
              valign: 'middle',
              fit: 'shrink',
              lineSpacingMultiple: 1.22,
              rtlMode: isRtl,
            });
          });
        } else {
          slide.addShape(pres.ShapeType.roundRect, {
            x: 0.75,
            y: contentTop,
            w: 11.83,
            h: contentH,
            rectRadius: 0.14,
            fill: { color: palette.surface },
            line: { color: palette.border, width: 1 },
          });

          const runs = buildParagraphRuns(rawBullets.slice(0, 8), fontFace, 14, palette.textColor, isRtl);
          if (runs.length > 0) {
            slide.addText(runs, {
              x: 1.05,
              y: contentTop + 0.28,
              w: 11.23,
              h: contentH - 0.56,
              align: alignMain,
              valign: 'top',
              fit: 'shrink',
              lineSpacingMultiple: 1.24,
              rtlMode: isRtl,
            });
          }
        }
      }

      // Clean Footer
      slide.addText(`${index + 1} / ${slideTotal}`, {
        x: 0.75,
        y: 6.92,
        w: 2.0,
        h: 0.35,
        fontFace: 'Tahoma',
        fontSize: 10.5,
        color: palette.mutedColor,
        align: 'left',
      });
      slide.addText('Nova AI', {
        x: 10.58,
        y: 6.92,
        w: 2.0,
        h: 0.35,
        fontFace: 'Tahoma',
        fontSize: 10.5,
        bold: true,
        color: palette.mutedColor,
        align: 'right',
      });
    }

    if (slideData.speakerNotes) {
      slide.addNotes(sanitizeSlideText(slideData.speakerNotes, 800));
    }
  });

  const safeName = (deck.deckTitle || 'Nova-AI-Presentation')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60);
  await pres.writeFile({ fileName: `${safeName || 'Nova-AI-Presentation'}.pptx` });
}
