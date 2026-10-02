'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { startWriting } from '@/lib/tasks/actions';

// "Avvia stesura": the first N reels still in idea (by ordinal) get a
// writing task. N defaults to 10 so a month's batch does not turn red all at
// once (docs/fase1-plan.md §3).
export function StartWriting({ batchId, ideaCount }: { batchId: string; ideaCount: number }) {
  const t = useTranslations('tasks');
  const [n, setN] = useState(Math.min(10, ideaCount));
  const [pending, startTransition] = useTransition();

  if (ideaCount === 0) return null;

  const submit = () => {
    startTransition(async () => {
      const result = await startWriting(batchId, n);
      if (result.ok) toast.success(t('done.startWriting'));
      else toast.error(t(`errors.${result.error}`));
    });
  };

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="start-writing-n">{t('actions.startWritingCount')}</label>
      <Input
        id="start-writing-n"
        type="number"
        min={1}
        max={ideaCount}
        value={n}
        onChange={(e) => setN(Math.max(1, Math.min(ideaCount, Number(e.target.value) || 1)))}
        className="h-8 w-16"
      />
      <Button size="sm" variant="outline" onClick={submit} disabled={pending}>
        <PenLine className="size-3" aria-hidden /> {t('actions.startWriting')}
      </Button>
    </div>
  );
}
