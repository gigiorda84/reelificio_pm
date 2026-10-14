'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import type { CheckWarning } from '@/lib/script-lab/checks';

// The warnings of the automatic checks (docs/fase2-plan.md S5, AC21), on the
// reel and in the approval queue. They inform, they never block.
export function CheckWarnings({ warnings, compact = false }: { warnings: CheckWarning[]; compact?: boolean }) {
  const t = useTranslations('scriptLab.checks');
  const tBlock = useTranslations('reels.script');
  if (warnings.length === 0) return null;

  const text = (w: CheckWarning) => {
    switch (w.kind) {
      case 'banned_word':
        return t('bannedWord', { match: w.match, block: tBlock(w.block) });
      case 'duration':
        return t('duration', { seconds: w.seconds, words: w.words, min: w.min, max: w.max });
      case 'repeated':
        return w.same
          ? t('repeatedSame', { block: tBlock(w.block), code: w.code })
          : t('repeatedSimilar', { block: tBlock(w.block), code: w.code, percent: Math.round(w.similarity * 100) });
    }
  };

  return (
    <ul
      className={`space-y-1 rounded-md border border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-100 ${compact ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'}`}
    >
      {warnings.map((w, i) => (
        <li key={i} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{text(w)}</span>
        </li>
      ))}
    </ul>
  );
}
