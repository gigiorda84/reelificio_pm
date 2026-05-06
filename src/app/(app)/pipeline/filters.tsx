'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

type Props = {
  pages: { id: string; name: string }[];
  batches: { id: string; label: string; page_id: string }[];
  selectedPageId?: string;
  selectedBatchId?: string;
};

export function PipelineFilters({
  pages,
  batches,
  selectedPageId,
  selectedBatchId,
}: Props) {
  const t = useTranslations('pipeline');
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParam = (key: 'page' | 'batch', value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing page resets the batch selection.
    if (key === 'page') next.delete('batch');
    const qs = next.toString();
    router.push(qs ? `/pipeline?${qs}` : '/pipeline');
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">{t('filterPage')}</span>
        <select
          value={selectedPageId ?? ''}
          onChange={(e) => updateParam('page', e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">{t('filterAllPages')}</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">{t('filterBatch')}</span>
        <select
          value={selectedBatchId ?? ''}
          onChange={(e) => updateParam('batch', e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">{t('filterAllBatches')}</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
