'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { decideTextProposal } from '@/lib/tasks/actions';
import type { TextProposal } from '@/lib/tasks/queries';
import { formatRome } from '@/lib/dates';

type Props = {
  reelId: string;
  proposals: TextProposal[];
  scriptRev: number;
  // Approver, delegate or admin (the SQL checks it again).
  canDecide: boolean;
};

// Text proposals with the original and the proposed text side by side (the
// word-level diff is cut from R1).
export function Proposals({ reelId, proposals, scriptRev, canDecide }: Props) {
  const t = useTranslations('reels.proposals');
  if (proposals.length === 0) return null;

  return (
    <section className="max-w-5xl space-y-3">
      <h2 className="text-base font-medium">{t('title')}</h2>
      {proposals.map((p) => (
        <ProposalCard key={p.id} reelId={reelId} proposal={p} scriptRev={scriptRev} canDecide={canDecide} />
      ))}
    </section>
  );
}

function ProposalCard({
  reelId,
  proposal: p,
  scriptRev,
  canDecide,
}: {
  reelId: string;
  proposal: TextProposal;
  scriptRev: number;
  canDecide: boolean;
}) {
  const t = useTranslations('reels.proposals');
  const tScript = useTranslations('reels.script');
  const tTasks = useTranslations('tasks');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const stale = p.status === 'pending' && p.base_rev !== scriptRev;

  const decide = (decision: 'accepted' | 'rejected') => {
    startTransition(async () => {
      const result = await decideTextProposal(reelId, p.id, decision, note);
      if (result.ok) toast.success(t(decision === 'accepted' ? 'accepted' : 'rejected'));
      else toast.error(tTasks(`errors.${result.error}`));
    });
  };

  return (
    <article className="space-y-3 rounded-lg border bg-background p-4">
      <header className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{tScript(p.field)}</span>
        <span>·</span>
        <span>{p.proposer_name ?? '—'}</span>
        <span>·</span>
        <span>{formatRome(p.created_at)}</span>
        <span className="ml-auto rounded-full border px-2 py-0.5">{t(`status.${p.status}`)}</span>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('original', { rev: p.base_rev })}
          </p>
          <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-3 py-2 font-mono text-sm">
            {p.original_text || '—'}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('proposed')}</p>
          <p className="whitespace-pre-wrap rounded-md bg-emerald-50 px-3 py-2 font-mono text-sm dark:bg-emerald-950/30">
            {p.proposed_text}
          </p>
        </div>
      </div>
      {p.decision_note ? <p className="text-xs text-muted-foreground">{p.decision_note}</p> : null}
      {stale ? <p className="text-xs text-amber-700 dark:text-amber-300">{tTasks('errors.proposal_stale')}</p> : null}
      {canDecide && p.status === 'pending' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('note')}
            className="h-9 min-w-48 flex-1"
            aria-label={t('note')}
          />
          <Button variant="outline" disabled={pending} onClick={() => decide('rejected')}>
            <X className="size-4" aria-hidden /> {t('reject')}
          </Button>
          <Button disabled={pending || stale} onClick={() => decide('accepted')}>
            <Check className="size-4" aria-hidden /> {t('accept')}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
