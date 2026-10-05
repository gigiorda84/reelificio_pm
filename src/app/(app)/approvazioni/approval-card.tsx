'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, ExternalLink, Undo2, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { decideTask } from '@/lib/tasks/actions';
import type { ApprovalItem } from '@/lib/tasks/queries';

// One approval, built for a phone: what to judge, then Approva (one tap) or
// Rimanda (tap → optional note → confirm; final approval goes back to the
// animator unless "dubbing" is chosen).
export function ApprovalCard({ item }: { item: ApprovalItem }) {
  const t = useTranslations('tasks');
  const [pending, startTransition] = useTransition();
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState('');
  const [to, setTo] = useState<'animation' | 'dubbing'>('animation');
  const [done, setDone] = useState(false);
  const isScript = item.kind === 'review' || item.kind === 'validation';

  const decide = (decision: 'approve' | 'send_back') => {
    startTransition(async () => {
      const result = await decideTask(item.reel.id, item.id, {
        decision,
        // The note belongs to a send-back only (a cancelled one must not
        // ride along with an approval).
        note: decision === 'send_back' ? note : undefined,
        expectedRev: isScript && decision === 'approve' ? item.reel.script_rev : undefined,
        to: decision === 'send_back' && item.kind === 'final_approval' ? to : undefined,
      });
      if (result.ok) {
        toast.success(t('done.ok'));
        setDone(true);
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });
  };

  if (done) return null;

  const blocks = [
    ['HOOK', item.reel.hook],
    ['CORPO', item.reel.corpo],
    ['CHIUSURA', item.reel.chiusura],
    ['CTA', item.reel.cta],
  ].filter(([, text]) => !!text) as [string, string][];
  const media = item.kind === 'audio_approval' ? item.reel.audio_drive_url
    : item.kind === 'final_approval' ? item.reel.video_drive_url : null;

  return (
    <article className="space-y-3 rounded-xl border bg-background p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{item.reel.code}</span>
            {item.reel.page_name ? ` · ${item.reel.page_name}` : ''}
          </p>
          <h2 className="font-medium leading-snug">{item.reel.title}</h2>
          <p className="text-xs text-muted-foreground">{t(`kind.${item.kind}`)}</p>
        </div>
        {item.reel.track === 'express' ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
            <Zap className="size-3" aria-hidden /> {t('panel.express')}
          </span>
        ) : null}
      </header>

      {item.previous_note ? (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/30">
          <p className="font-medium">{t('panel.previousNote')}</p>
          <p className="whitespace-pre-wrap">{item.previous_note}</p>
        </div>
      ) : null}

      {isScript ? (
        <div className="space-y-2 text-sm">
          {blocks.length ? (
            blocks.map(([label, text]) => (
              <div key={label}>
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground">{label}</p>
                <p className="whitespace-pre-wrap">{text}</p>
              </div>
            ))
          ) : (
            <p className="whitespace-pre-wrap">{item.reel.raw_content}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('panel.scriptRev', { rev: item.reel.script_rev })}</p>
        </div>
      ) : null}

      {media ? (
        <a href={media} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm underline">
          <ExternalLink className="size-3.5" aria-hidden />
          {item.kind === 'audio_approval' ? t('approvals.openAudio') : t('approvals.openVideo')}
        </a>
      ) : null}

      {item.pending_proposals > 0 ? (
        <Link href={`/reels/${item.reel.id}`} className="block text-xs underline">
          {t('approvals.pendingProposals', { count: item.pending_proposals })}
        </Link>
      ) : null}

      {sendingBack ? (
        <div className="space-y-2">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('panel.note')} />
          {item.kind === 'final_approval' ? (
            <div className="flex gap-4 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={to === 'animation'} onChange={() => setTo('animation')} />
                {t('panel.toAnimation')}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={to === 'dubbing'} onChange={() => setTo('dubbing')} />
                {t('panel.toDubbing')}
              </label>
            </div>
          ) : null}
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button
              variant="ghost"
              disabled={pending}
              aria-label={t('actions.cancel')}
              onClick={() => {
                setSendingBack(false);
                setNote('');
              }}
            >
              <X className="size-4" aria-hidden />
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => decide('send_back')}>
              <Undo2 className="size-4" aria-hidden /> {t('actions.confirmSendBack')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11" disabled={pending} onClick={() => setSendingBack(true)}>
            <Undo2 className="size-4" aria-hidden /> {t('actions.sendBack')}
          </Button>
          <Button className="h-11" disabled={pending} onClick={() => decide('approve')}>
            <Check className="size-4" aria-hidden /> {t('actions.approve')}
          </Button>
        </div>
      )}
    </article>
  );
}
