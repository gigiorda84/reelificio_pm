'use client';

import { useTranslations } from 'next-intl';
import { CheckWarnings } from '@/components/script-lab/check-warnings';
import type { CheckWarning } from '@/lib/script-lab/checks';

// Checks on the saved text (docs/fase2-plan.md S5): banned words of the Voce,
// estimated duration against the bible, CTA and closing repeated from the
// last 20 reels of the page. Warnings only.
export function ChecksPanel({ warnings }: { warnings: CheckWarning[] }) {
  const t = useTranslations('scriptLab.checks');
  return (
    <section id="controlli" className="space-y-2 scroll-mt-24">
      <div>
        <h2 className="text-base font-medium">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{warnings.length ? t('hint') : t('none')}</p>
      </div>
      <CheckWarnings warnings={warnings} />
    </section>
  );
}
