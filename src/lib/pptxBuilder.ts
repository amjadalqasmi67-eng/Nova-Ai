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
  titleColor: string;
  textColor: string;
  mutedColor: string;
  accent: string;
  accentSoft: string;
  border: string;
}

const DECK_PALETTES: Record<PptxVisualTheme, ThemePalette> = {
  cosmos: {
    bg: '0B1020',
    surface: '141C38',
    titleColor: 'F8FAFC',
    textColor: 'E2E8F0',
    mutedColor: '94A3B8',
    accent: '8B5CF6',
    accentSoft: '2E1065',
    border: '334155',
  },
  'executive-blue': {
    bg: '0A192F',
    surface: '112240',
    titleColor: 'FFFFFF',
    textColor: 'CBD5E1',
    mutedColor: '94A3B8',
    accent: '3B82F6',
    accentSoft: '1E3A8A',
    border: '1E40AF',
  },
  'emerald-modern': {
    bg: '041D17',
    surface: '062E24',
    titleColor: 'F0FDF4',
    textColor: 'D1FAE5',
    mutedColor: '6EE7B7',
    accent: '10B981',
    accentSoft: '065F46',
    border: '047857',
  },
  'clean-light': {
    bg: 'F8FAFC',
    surface: 'FFFFFF',
    titleColor: '0F172A',
    textColor: '334155',
    mutedColor: '64748B',
    accent: '6D28D9',
    accentSoft: 'EDE9FE',
    border: 'CBD5E1',
  },
};

export async function exportDeckToPptx(
  deck: PptxDeck,
  visualTheme: PptxVisualTheme = 'cosmos',
  language: 'ar' | 'en' = 'ar'
): Promise<void> {
  const pres = new PptxGenJS();
  const isRtl = language === 'ar';
  const palette = DECK_PALETTES[visualTheme] || DECK_PALETTES.cosmos;
  const fontFace = isRtl ? 'Arial' : 'Calibri';

  pres.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in
  pres.rtlMode = isRtl;
  pres.title = deck.deckTitle;
  pres.subject = deck.deckSubtitle || deck.deckTitle;
  pres.author = 'Nova AI';

  const alignMain = isRtl ? 'right' : 'left';

  deck.slides.forEach((slideData, index) => {
    const slide = pres.addSlide();
    slide.background = { color: palette.bg };

    // Top accent stripe
    slide.addShape(pres.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 13.333,
      h: 0.1,
      fill: { color: palette.accent },
      line: { color: palette.accent, width: 0 },
    });

    if (slideData.layout === 'title' || index === 0) {
      slide.addShape(pres.ShapeType.roundRect, {
        x: 0.9,
        y: 1.4,
        w: 11.53,
        h: 4.7,
        rectRadius: 0.18,
        fill: { color: palette.surface },
        line: { color: palette.border, width: 1 },
      });

      slide.addText(slideData.title || deck.deckTitle, {
        x: 1.4,
        y: 2.0,
        w: 10.5,
        h: 1.5,
        fontFace,
        fontSize: 34,
        bold: true,
        color: palette.titleColor,
        align: 'center',
        valign: 'middle',
        rtlMode: isRtl,
      });

      const sub = slideData.subtitle || deck.deckSubtitle || '';
      if (sub) {
        slide.addText(sub, {
          x: 1.6,
          y: 3.6,
          w: 10.1,
          h: 1.1,
          fontFace,
          fontSize: 18,
          color: palette.mutedColor,
          align: 'center',
          valign: 'top',
          rtlMode: isRtl,
        });
      }

      if (slideData.bullets && slideData.bullets.length > 0) {
        slide.addText(slideData.bullets.slice(0, 3).join('  •  '), {
          x: 1.6,
          y: 4.95,
          w: 10.1,
          h: 0.7,
          fontFace,
          fontSize: 13,
          color: palette.accent,
          align: 'center',
          rtlMode: isRtl,
        });
      }

      slide.addText('Nova AI', {
        x: 0.9,
        y: 6.75,
        w: 11.5,
        h: 0.4,
        fontFace: 'Arial',
        fontSize: 11,
        color: palette.mutedColor,
        align: 'center',
      });
    } else {
      // Slide Title
      slide.addText(slideData.title, {
        x: 0.75,
        y: 0.42,
        w: 11.8,
        h: 0.75,
        fontFace,
        fontSize: 25,
        bold: true,
        color: palette.titleColor,
        align: alignMain,
        rtlMode: isRtl,
      });

      if (slideData.subtitle) {
        slide.addText(slideData.subtitle, {
          x: 0.75,
          y: 1.15,
          w: 11.8,
          h: 0.42,
          fontFace,
          fontSize: 14,
          color: palette.mutedColor,
          align: alignMain,
          rtlMode: isRtl,
        });
      }

      const contentTop = slideData.subtitle ? 1.72 : 1.38;

      if (slideData.layout === 'two-column' && slideData.rightColumnBullets?.length) {
        // Left/Right dual columns
        slide.addShape(pres.ShapeType.roundRect, {
          x: 0.75,
          y: contentTop,
          w: 5.7,
          h: 4.9,
          rectRadius: 0.14,
          fill: { color: palette.surface },
          line: { color: palette.border, width: 1 },
        });
        slide.addShape(pres.ShapeType.roundRect, {
          x: 6.88,
          y: contentTop,
          w: 5.7,
          h: 4.9,
          rectRadius: 0.14,
          fill: { color: palette.surface },
          line: { color: palette.border, width: 1 },
        });

        const leftText = (slideData.bullets || []).map((b) => `•  ${b}`).join('\n\n');
        const rightItems = slideData.rightColumnBullets || [];
        const rightText = [
          slideData.rightColumnTitle ? `${slideData.rightColumnTitle}\n` : '',
          ...rightItems.map((b) => `•  ${b}`),
        ]
          .filter(Boolean)
          .join('\n\n');

        slide.addText(leftText, {
          x: 1.05,
          y: contentTop + 0.3,
          w: 5.1,
          h: 4.3,
          fontFace,
          fontSize: 15,
          color: palette.textColor,
          align: alignMain,
          valign: 'top',
          rtlMode: isRtl,
        });
        slide.addText(rightText, {
          x: 7.18,
          y: contentTop + 0.3,
          w: 5.1,
          h: 4.3,
          fontFace,
          fontSize: 15,
          color: palette.textColor,
          align: alignMain,
          valign: 'top',
          rtlMode: isRtl,
        });
      } else if (slideData.layout === 'metrics' && slideData.metrics?.length) {
        const metrics = slideData.metrics.slice(0, 4);
        const cardW = (11.8 - (metrics.length - 1) * 0.28) / metrics.length;
        metrics.forEach((m, mIdx) => {
          const xPos = 0.75 + mIdx * (cardW + 0.28);
          slide.addShape(pres.ShapeType.roundRect, {
            x: xPos,
            y: contentTop,
            w: cardW,
            h: 2.0,
            rectRadius: 0.12,
            fill: { color: palette.surface },
            line: { color: palette.accent, width: 1.2 },
          });
          slide.addText(m.value, {
            x: xPos + 0.15,
            y: contentTop + 0.32,
            w: cardW - 0.3,
            h: 0.8,
            fontFace,
            fontSize: 26,
            bold: true,
            color: palette.accent,
            align: 'center',
            rtlMode: isRtl,
          });
          slide.addText(m.label, {
            x: xPos + 0.15,
            y: contentTop + 1.18,
            w: cardW - 0.3,
            h: 0.65,
            fontFace,
            fontSize: 13,
            color: palette.textColor,
            align: 'center',
            rtlMode: isRtl,
          });
        });

        if (slideData.bullets?.length) {
          slide.addText(slideData.bullets.map((b) => `•  ${b}`).join('\n\n'), {
            x: 0.85,
            y: contentTop + 2.35,
            w: 11.6,
            h: 2.5,
            fontFace,
            fontSize: 15,
            color: palette.textColor,
            align: alignMain,
            valign: 'top',
            rtlMode: isRtl,
          });
        }
      } else {
        slide.addShape(pres.ShapeType.roundRect, {
          x: 0.75,
          y: contentTop,
          w: 11.83,
          h: 5.05,
          rectRadius: 0.14,
          fill: { color: palette.surface },
          line: { color: palette.border, width: 1 },
        });

        const bulletsText = (slideData.bullets || []).map((b) => `•  ${b}`).join('\n\n');
        slide.addText(bulletsText, {
          x: 1.1,
          y: contentTop + 0.35,
          w: 11.1,
          h: 4.4,
          fontFace,
          fontSize: 16,
          color: palette.textColor,
          align: alignMain,
          valign: 'top',
          rtlMode: isRtl,
        });
      }

      // Footer
      slide.addText(`${index + 1} / ${deck.slides.length}`, {
        x: 0.75,
        y: 6.9,
        w: 2.0,
        h: 0.35,
        fontFace: 'Arial',
        fontSize: 11,
        color: palette.mutedColor,
        align: 'left',
      });
      slide.addText('Nova AI', {
        x: 10.55,
        y: 6.9,
        w: 2.0,
        h: 0.35,
        fontFace: 'Arial',
        fontSize: 11,
        color: palette.mutedColor,
        align: 'right',
      });
    }

    if (slideData.speakerNotes) {
      slide.addNotes(slideData.speakerNotes);
    }
  });

  const safeName = (deck.deckTitle || 'Nova-AI-Presentation')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60);
  await pres.writeFile({ fileName: `${safeName || 'Nova-AI-Presentation'}.pptx` });
}
