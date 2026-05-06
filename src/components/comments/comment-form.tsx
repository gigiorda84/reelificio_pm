'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { postComment } from '@/lib/comments/actions';
import type { CommentTarget } from '@/lib/comments/queries';

type Props = {
  targetType: CommentTarget;
  targetId: string;
};

export function CommentForm({ targetType, targetId }: Props) {
  const t = useTranslations('comments');
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState('');
  const formRef = useRef<HTMLFormElement>(null);

  const onSubmit = (formData: FormData) => {
    if (!body.trim()) {
      toast.error(t('errors.empty'));
      return;
    }
    startTransition(async () => {
      const result = await postComment(formData);
      if (result.ok) {
        setBody('');
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
      <textarea
        name="body"
        rows={3}
        required
        placeholder={t('writePlaceholder')}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="flex w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !body.trim()}>
          {pending ? t('posting') : t('post')}
        </Button>
      </div>
    </form>
  );
}
