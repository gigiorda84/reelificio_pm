'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createBatchFromIdeas } from '@/lib/ideas/actions';
import { MAX_IDEAS_PER_BATCH } from '@/lib/ideas/constants';
import type { IdeasBatch } from '@/lib/ideas/queries';
import { romeParts } from '@/lib/dates';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: string;
  ideaIds: string[];
  batches: IdeasBatch[];
};

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border bg-background px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring';

// The month after today in Rome: a batch is usually prepared for next month.
function nextMonth(): { year: number; month: number } {
  const [y, m] = romeParts(new Date()).date.split('-').map(Number);
  return m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
}

// Selected ideas → reels in `idea`: a new batch for a month, or more reels in
// a batch already born from ideas (docs/fase2-plan.md AC6).
export function CreateBatchDialog({ open, onOpenChange, pageId, ideaIds, batches }: Props) {
  const t = useTranslations('ideas.dialog');
  const tErr = useTranslations('ideas.errors');
  const tMonths = useTranslations('ideas.months');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [month, setMonth] = useState(() => nextMonth().month);
  // Kept as typed, so clearing the field doesn't turn it into 0.
  const [yearText, setYearText] = useState(() => String(nextMonth().year));
  const [batchId, setBatchId] = useState(batches[0]?.id ?? '');
  // The same limits as create_batch_from_ideas, said here rather than as a
  // generic refusal.
  const year = Number(yearText);
  const yearValid = yearText !== '' && Number.isInteger(year) && year >= 2020 && year <= 2099;
  const tooMany = ideaIds.length > MAX_IDEAS_PER_BATCH;
  const ready = ideaIds.length > 0 && !tooMany && (mode === 'existing' ? batchId !== '' : yearValid);

  const submit = () => {
    startTransition(async () => {
      const result = await createBatchFromIdeas(
        pageId,
        mode === 'existing' ? { batchId } : { year, month },
        ideaIds,
      );
      if (result.ok && result.batchId) {
        toast.success(t('done', { count: ideaIds.length }));
        onOpenChange(false);
        router.push(`/batches/${result.batchId}`);
      } else if (!result.ok) {
        toast.error(tErr(result.error));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { count: ideaIds.length })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
            {t('newBatch')}
          </label>
          {mode === 'new' ? (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <div className="space-y-1.5">
                <Label htmlFor="batch-month">{t('month')}</Label>
                <select
                  id="batch-month"
                  className={SELECT_CLASS}
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {tMonths(String(m))}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="batch-year">{t('year')}</Label>
                <Input
                  id="batch-year"
                  type="number"
                  min={2020}
                  max={2099}
                  value={yearText}
                  onChange={(e) => setYearText(e.target.value)}
                  aria-invalid={!yearValid}
                />
              </div>
              {!yearValid ? <p className="col-span-2 text-xs text-destructive">{t('invalidYear')}</p> : null}
            </div>
          ) : null}

          <label className={`flex items-center gap-2 ${batches.length === 0 ? 'opacity-50' : ''}`}>
            <input
              type="radio"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
              disabled={batches.length === 0}
            />
            {batches.length === 0 ? t('noIdeasBatch') : t('existingBatch')}
          </label>
          {mode === 'existing' ? (
            <div className="pl-6">
              <select
                aria-label={t('existingBatch')}
                className={SELECT_CLASS}
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label} · {b.period.slice(0, 7)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('numbering')}</p>
          {tooMany ? <p className="text-xs text-destructive">{t('tooMany', { max: MAX_IDEAS_PER_BATCH })}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={pending || !ready}>
            {pending ? t('creating') : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
