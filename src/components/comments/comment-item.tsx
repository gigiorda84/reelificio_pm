'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { updateComment, deleteComment } from '@/lib/comments/actions';
import type { CommentRow } from '@/lib/comments/queries';
import type { ProfileLite } from '@/lib/profiles/queries';
import {
  MentionTextarea,
  type MentionTextareaHandle,
} from './mention-textarea';

type Props = { comment: CommentRow; profiles: ProfileLite[] };

export function CommentItem({ comment, profiles }: Props) {
  const t = useTranslations('comments');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [pending, startTransition] = useTransition();
  const editorRef = useRef<MentionTextareaHandle>(null);

  const displayName =
    comment.author_full_name ||
    comment.author_email?.split('@')[0] ||
    '—';
  const created = new Date(comment.created_at);
  const wasEdited =
    new Date(comment.updated_at).getTime() - created.getTime() > 1500;

  const mentionLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const id of comment.mentions) {
      const p = profiles.find((x) => x.id === id);
      if (!p) continue;
      labels.add(p.full_name?.trim() || p.email);
    }
    return Array.from(labels).sort((a, b) => b.length - a.length);
  }, [comment.mentions, profiles]);

  const onSaveEdit = () => {
    if (!draft.trim()) {
      toast.error(t('errors.empty'));
      return;
    }
    startTransition(async () => {
      const formEl = document.getElementById(
        `cmt-edit-${comment.id}`,
      ) as HTMLFormElement | null;
      const fd = formEl ? new FormData(formEl) : new FormData();
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
              onClick={() => {
                setDraft(comment.body);
                setEditing(true);
              }}
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
        <form id={`cmt-edit-${comment.id}`} className="space-y-2">
          <MentionTextarea
            ref={editorRef}
            name="body"
            profiles={profiles}
            rows={3}
            required
            initialBody={comment.body}
            initialMentions={comment.mentions}
            onChange={(b) => setDraft(b)}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
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
            <Button type="button" size="sm" onClick={onSaveEdit} disabled={pending}>
              {t('save')}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm whitespace-pre-wrap">
          {renderBodyWithMentions(comment.body, mentionLabels)}
        </p>
      )}
    </article>
  );
}

function renderBodyWithMentions(body: string, labels: string[]): React.ReactNode {
  if (labels.length === 0) return body;
  const escaped = labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(?:${escaped.join('|')})`, 'g');
  const matches = Array.from(body.matchAll(re));
  if (matches.length === 0) return body;
  const parts: React.ReactNode[] = [];
  let last = 0;
  matches.forEach((m, i) => {
    const start = m.index ?? 0;
    if (start > last) parts.push(body.slice(last, start));
    parts.push(
      <span
        key={`mention-${i}`}
        className="font-medium text-primary bg-primary/10 rounded px-0.5"
      >
        {m[0]}
      </span>,
    );
    last = start + m[0].length;
  });
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}
