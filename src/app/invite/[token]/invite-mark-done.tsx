'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { markDoneAsInvitee } from '@/lib/invites/actions';

export function InviteMarkDone({ token }: { token: string }) {
  const t = useTranslations('invites.public');
  const tCommon = useTranslations('common');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();

  const submit = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('token', token);
      if (note.trim()) fd.set('note', note.trim());
      const result = await markDoneAsInvitee(fd);
      if (result.ok) {
        toast.success(t('markDoneSuccess'));
        setNote('');
      } else if (result.error === 'invite_invalid') {
        toast.error(t('inviteInvalid'));
      } else if (result.error === 'already_pending') {
        toast.error(t('markDoneAlreadyPending'));
      } else if (result.error === 'invalid_phase') {
        toast.error(t('markDoneFinalPhase'));
      } else {
        toast.error(tCommon('error'));
      }
    });
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder={t('markDoneNotePlaceholder')}
      />
      <Button onClick={submit} disabled={pending}>
        <Check className="size-3" aria-hidden />
        {pending ? tCommon('saving') : t('markDoneAction')}
      </Button>
    </div>
  );
}
