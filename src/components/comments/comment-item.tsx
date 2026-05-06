'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { updateComment, deleteComment } from '@/lib/comments/actions';
import type { CommentRow } from '@/lib/comments/queries';

type Props = { comment: CommentRow };

export function CommentItem({ comment }: Props) {
  const t = useTranslations('comments');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [pending, startTransition] = useTransition();

  const displayName =
    comment.author_full_name ||
    comment.author_email?.split('@')[0] ||
    '—';
  const created = new Date(comment.created_at);
  const wasEdited =
    new Date(comment.updated_at).getTime() - created.getTime() > 1500;

  const onSaveEdit = () => {
    if (!draft.trim()) {
      toast.error(t('errors.empty'));
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('body', draft);
      const result = await updateComment(comment.id, fd);
      if (result.ok) {
        setEditing(false);
      } else {
        toast.error(t('errors.unknown'));
      }
    });
  };

  const onDelete = () => {
    if (!confirm(t('deleteConfirm'))) return;
    startTransition(async () => {
      const result = await deleteComment(comment.id);
      if (!result.ok) toast.error(t('errors.unknown'));
    });
  };

  return (
    <article className="rounded-md border bg-card px-4 py-3">
      <header className="flex items-baseline justify-between gap-3 mb-1.5">
        <div className="flex items-baseline gap-2">
          <p className="text-sm font-medium">{displayName}</p>
          <p className="text-xs text-muted-foreground">
            {created.toLocaleString('it-IT', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
            {wasEdited ? ` · ${t('edited')}` : ''}
          </p>
        </div>
        {comment.is_own && !editing ? (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setEditing(true)}
              disabled={pending}
              aria-label={t('edit')}
            >
              <Pencil className="size-3.5" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onDelete}
              disabled={pending}
              aria-label={t('delete')}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
          </div>
        ) : null}
      </header>

      {editing ? (
        <div className="space-y-2">
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
              disabled={pending}
            >
              {t('cancel')}
            </Button>
            <Button size="sm" onClick={onSaveEdit} disabled={pending}>
              {t('save')}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
      )}
    </article>
  );
}
