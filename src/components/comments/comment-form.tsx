'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { postComment } from '@/lib/comments/actions';
import type { CommentTarget } from '@/lib/comments/queries';
import type { ProfileLite } from '@/lib/profiles/queries';
import {
  MentionTextarea,
  type MentionTextareaHandle,
} from './mention-textarea';

type Props = {
  targetType: CommentTarget;
  targetId: string;
  profiles: ProfileLite[];
  // Internals on a reel thread may write a "Nota interna" externals never see.
  allowInternal?: boolean;
};

export function CommentForm({ targetType, targetId, profiles, allowInternal = false }: Props) {
  const t = useTranslations('comments');
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const editorRef = useRef<MentionTextareaHandle>(null);

  const onSubmit = (formData: FormData) => {
    if (!body.trim()) {
      toast.error(t('errors.empty'));
      return;
    }
    startTransition(async () => {
      const result = await postComment(formData);
      if (result.ok) {
        setBody('');
        editorRef.current?.reset('', []);
        formRef.current?.reset();
      } else {
        toast.error(t('errors.unknown'));
      }
    });
  };

  return (
    <form ref={formRef} action={onSubmit} className="space-y-2">
      <input type="hidden" name="target_type" value={targetType} />
      <input type="hidden" name="target_id" value={targetId} />
      <MentionTextarea
        ref={editorRef}
        name="body"
        profiles={profiles}
        rows={3}
        required
        onChange={(b) => setBody(b)}
      />
      <div className="flex items-center justify-end gap-4">
        {allowInternal ? (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={t('internalOnlyHint')}>
            <input type="checkbox" name="internal_only" />
            {t('internalOnly')}
          </label>
        ) : null}
        <Button type="submit" disabled={pending || !body.trim()}>
          {pending ? t('posting') : t('post')}
        </Button>
      </div>
    </form>
  );
}
