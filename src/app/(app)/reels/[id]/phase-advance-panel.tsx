'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowRight, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  ALL_PIPELINE_PHASES,
  PIPELINE_PHASE_ORDER,
  type PipelinePhase,
} from '@/lib/reels/constants';
import {
  requestPhaseAdvance,
  decidePhaseAdvance,
  cancelPhaseAdvance,
} from '@/lib/phase-advance/actions';
import type { PhaseAdvanceRequest } from '@/lib/phase-advance/queries';

type Props = {
  reelId: string;
  currentPhase: PipelinePhase;
  pending: PhaseAdvanceRequest | null;
  currentUserId: string | null;
  isAdmin: boolean;
  isResponsible: boolean;
  isApprover: boolean;
};

function nextPhase(p: PipelinePhase): PipelinePhase | null {
  const i = PIPELINE_PHASE_ORDER[p];
  if (i >= ALL_PIPELINE_PHASES.length - 1) return null;
  return ALL_PIPELINE_PHASES[i + 1];
}

export function PhaseAdvancePanel({
  reelId,
  currentPhase,
  pending,
  currentUserId,
  isAdmin,
  isResponsible,
  isApprover,
}: Props) {
  const t = useTranslations('phaseAdvance');
  const tPhase = useTranslations('batches.reel.phase');
  const tCommon = useTranslations('common');
  const [isPending, startTransition] = useTransition();
  const [requestNote, setRequestNote] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [showRequestForm, setShowRequestForm] = useState(false);

  const target = nextPhase(currentPhase);
  const canRequest = (isResponsible || isAdmin) && !pending && target;
  const canDecide = !!pending && (isApprover || isAdmin);
  const canCancel = !!pending && pending.requested_by === currentUserId;

  const submitRequest = () => {
    if (!target) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('reel_id', reelId);
      fd.set('to_phase', target);
      if (requestNote.trim()) fd.set('request_note', requestNote.trim());
      const result = await requestPhaseAdvance(fd);
      if (result.ok) {
        toast.success(t('saved.requested'));
        setRequestNote('');
        setShowRequestForm(false);
      } else if (result.error === 'not_authorized') {
        toast.error(t('errors.notAuthorized'));
      } else if (result.error === 'already_pending') {
        toast.error(t('errors.alreadyPending'));
      } else {
        toast.error(t('errors.unknown'));
      }
    });
  };

  const decide = (decision: 'approved' | 'rejected') => {
    if (!pending) return;
    if (decision === 'rejected' && !decisionNote.trim()) {
      toast.error(t('errors.rejectNoteRequired'));
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('request_id', pending.id);
      fd.set('decision', decision);
      if (decisionNote.trim()) fd.set('decision_note', decisionNote.trim());
      const result = await decidePhaseAdvance(fd);
      if (result.ok) {
        toast.success(
          decision === 'approved' ? t('saved.approved') : t('saved.rejected'),
        );
        setDecisionNote('');
      } else if (result.error === 'not_authorized') {
        toast.error(t('errors.notAuthorized'));
      } else {
        toast.error(t('errors.unknown'));
      }
    });
  };

  const cancel = () => {
    if (!pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('request_id', pending.id);
      const result = await cancelPhaseAdvance(fd);
      if (result.ok) toast.success(t('saved.cancelled'));
      else toast.error(t('errors.unknown'));
    });
  };

  if (pending) {
    return (
      <div className="space-y-3 rounded-lg border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 p-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{t('pendingTitle')}</p>
            <p className="text-muted-foreground text-xs mt-0.5">
              {t('pendingFromTo', {
                from: tPhase(pending.from_phase),
                to: tPhase(pending.to_phase),
              })}
            </p>
            {pending.requester_name ? (
              <p className="text-muted-foreground text-xs mt-0.5">
                {t('requestedBy', { name: pending.requester_name })} ·{' '}
                {t('requestedAt', {
                  date: new Date(pending.created_at).toLocaleString('it-IT', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  }),
                })}
              </p>
            ) : null}
            {pending.request_note ? (
              <p className="mt-2 whitespace-pre-wrap">{pending.request_note}</p>
            ) : null}
          </div>
          {canCancel ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={cancel}
              disabled={isPending}
            >
              {t('cancel')}
            </Button>
          ) : null}
        </div>

        {canDecide ? (
          <div className="space-y-2">
            <Textarea
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              placeholder={t('decisionNotePlaceholder')}
              rows={2}
            />
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => decide('rejected')}
                disabled={isPending}
              >
                <X className="size-3" aria-hidden /> {t('reject')}
              </Button>
              <Button
                size="sm"
                onClick={() => decide('approved')}
                disabled={isPending}
              >
                <Check className="size-3" aria-hidden /> {t('approve')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (!target) {
    return (
      <p className="text-xs text-muted-foreground">{t('cannotAdvance')}</p>
    );
  }

  if (!canRequest) {
    // Read-only viewers: just show next-phase hint without an action.
    return (
      <p className="text-xs text-muted-foreground">{t('noPending')}</p>
    );
  }

  if (!showRequestForm) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setShowRequestForm(true)}
      >
        <ArrowRight className="size-3" aria-hidden />
        {t('requestTo', { phase: tPhase(target) })}
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border p-4 text-sm w-full max-w-md">
      <p className="text-xs text-muted-foreground">
        {t('requestTo', { phase: tPhase(target) })}
      </p>
      <Textarea
        value={requestNote}
        onChange={(e) => setRequestNote(e.target.value)}
        placeholder={t('requestNotePlaceholder')}
        rows={3}
      />
      <div className="flex gap-2 justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setShowRequestForm(false);
            setRequestNote('');
          }}
          disabled={isPending}
        >
          {tCommon('cancel')}
        </Button>
        <Button size="sm" onClick={submitRequest} disabled={isPending}>
          {isPending ? t('submitting') : t('submit')}
        </Button>
      </div>
    </div>
  );
}
