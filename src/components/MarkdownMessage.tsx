import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface MarkdownMessageProps {
  content: string;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = async (code: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const segments = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="min-w-0 max-w-full space-y-3 text-sm sm:text-[15px] leading-[1.75] text-slate-800 dark:text-slate-100 break-words">
      {segments.map((segment, index) => {
        if (segment.startsWith('```') && segment.endsWith('```')) {
          const inner = segment.slice(3, -3);
          const firstNewline = inner.indexOf('\n');
          const lang = firstNewline > -1 ? inner.slice(0, firstNewline).trim() : '';
          const code = firstNewline > -1 ? inner.slice(firstNewline + 1) : inner;

          return (
            <div
              key={index}
              dir="ltr"
              className="rounded-xl overflow-hidden border border-slate-200 dark:border-blue-500/20 bg-slate-900 dark:bg-[#050814] text-left my-3"
            >
              <div className="flex items-center justify-between px-4 py-2 bg-slate-800 dark:bg-[#0B1124] border-b border-white/10 text-xs text-slate-300">
                <span className="font-mono">{lang || 'code'}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(code, index)}
                  className="inline-flex items-center gap-1.5 text-slate-200 hover:text-white transition-colors cursor-pointer"
                >
                  {copiedIndex === index ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>تم النسخ</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>نسخ</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 overflow-x-auto text-xs sm:text-[13px] leading-relaxed font-mono text-blue-100">
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        const lines = segment.split('\n');
        return (
          <div key={index} className="space-y-2">
            {lines.map((line, lineIdx) => {
              const trimmed = line.trim();
              if (!trimmed) return <div key={lineIdx} className="h-1" />;

              if (trimmed.startsWith('### ')) {
                return (
                  <h4 key={lineIdx} className="text-base font-bold text-slate-900 dark:text-blue-200 pt-1">
                    {renderInlineFormatting(trimmed.slice(4))}
                  </h4>
                );
              }
              if (trimmed.startsWith('## ')) {
                return (
                  <h3 key={lineIdx} className="text-lg font-bold text-slate-950 dark:text-white pt-1.5">
                    {renderInlineFormatting(trimmed.slice(3))}
                  </h3>
                );
              }
              if (trimmed.startsWith('# ')) {
                return (
                  <h2 key={lineIdx} className="text-xl font-bold text-slate-950 dark:text-white pt-2">
                    {renderInlineFormatting(trimmed.slice(2))}
                  </h2>
                );
              }
              if (/^[-*•]\s+/.test(trimmed)) {
                return (
                  <div key={lineIdx} className="flex items-start gap-2.5 pr-1">
                    <span className="mt-1.5 text-xs select-none" style={{ color: 'var(--accent-primary)' }} aria-hidden="true">
                      ◆
                    </span>
                    <span className="flex-1">{renderInlineFormatting(trimmed.replace(/^[-*•]\s+/, ''))}</span>
                  </div>
                );
              }
              if (/^\d+\.\s+/.test(trimmed)) {
                const match = trimmed.match(/^(\d+\.)\s+(.*)$/);
                return (
                  <div key={lineIdx} className="flex items-start gap-2.5 pr-1">
                    <span
                      className="font-semibold tabular-nums shrink-0"
                      style={{ color: 'var(--accent-primary)' }}
                    >
                      {match?.[1]}
                    </span>
                    <span className="flex-1">{renderInlineFormatting(match?.[2] || trimmed)}</span>
                  </div>
                );
              }

              return <p key={lineIdx}>{renderInlineFormatting(line)}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}

function renderInlineFormatting(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-semibold text-slate-950 dark:text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={idx}
          dir="ltr"
          className="inline-block max-w-full break-all px-1.5 py-0.5 mx-0.5 rounded bg-slate-200/80 dark:bg-blue-500/15 border border-slate-300 dark:border-blue-400/20 text-slate-900 dark:text-blue-200 font-mono text-xs sm:text-[13px] align-middle"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}
