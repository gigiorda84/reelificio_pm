'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setReelPhase } from '@/lib/reels/actions';
import { ALL_PIPELINE_PHASES } from '@/lib/reels/constants';

type Props = {
  reelId: string;
  currentPhase: string;
};

export function PhaseControl({ reelId, currentPhase }: Props) {
  const t = useTranslations('reels');
  const tPhase = useTranslations('batches.reel.phase');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();

  const idx = ALL_PIPELINE_PHASES.indexOf(currentPhase as 'research');
  const next = idx >= 0 && idx < ALL_PIPELINE_PHASES.length - 1
    ? ALL_PIPELINE_PHASES[idx + 1]
    : null;

  const advance = (phase: string) => {
    if (!confirm(t('phase.advanceConfirm'))) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('phase', phase);
      const result = await setReelPhase(reelId, fd);
      if (result.ok) toast.success(t('phase.saved'));
      else toast.error(tCommon('error'));
    });
  };

  const onSelect = (phase: string) => {
    if (phase === currentPhase) return;
    advance(phase);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={currentPhase}
        onChange={(e) => onSelect(e.target.value)}
        disabled={pending}
        className="h-8 rounded-md border bg-background px-2 py-1 text-xs shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {ALL_PIPELINE_PHASES.map((p) => (
          <option key={p} value={p}>
            {tPhase(p)}
          </option>
        ))}
      </select>
      {next ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => advance(next)}
          disabled={pending}
        >
          <ArrowRight className="size-3" aria-hidden />
          {t('phase.advanceTo')} {tPhase(next)}
        </Button>
      ) : null}
    </div>
  );
}
