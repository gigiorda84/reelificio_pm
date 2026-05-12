'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { postCommentAsInvitee } from '@/lib/invites/actions';
import type { InviteComment } from '@/lib/invites/queries';

type Props = {
  token: string;
  comments: InviteComment[];
};

export function InviteComments({ token, comments }: Props) {
  const t = useTranslations('invites.public');
  const tCommon = useTranslations('common');
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('token', token);
      fd.set('body', trimmed);
      const result = await postCommentAsInvitee(fd);
      if (result.ok) {
        toast.success(t('commentPosted'));
        setBody('');
      } else if (result.error === 'invite_invalid') {
        toast.error(t('inviteInvalid'));
      } else {
        toast.error(tCommon('error'));
      }
    });
  };

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('commentsEmpty')}</p>
      ) : (
        <ol className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border px-3 py-2">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="font-medium">
                  {c.author_label}
                  {c.is_external ? (
                    <span className="ml-2 inline-block rounded-full border px-1.5 py-0 text-[10px] text-muted-foreground">
                      {t('externalTag')}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">
                  {new Date(c.created_at).toLocaleString('it-IT', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap mt-1">{c.body}</p>
            </li>
          ))}
        </ol>
      )}
      <div className="space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={5000}
          placeholder={t('commentPlaceholder')}
        />
        <Button onClick={submit} disabled={pending || !body.trim()}>
          {pending ? tCommon('saving') : t('commentPost')}
        </Button>
      </div>
    </div>
  );
}
