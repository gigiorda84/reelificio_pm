'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateReelPublish } from '@/lib/reels/actions';
import type { ReelDetail } from '@/lib/reels/queries';

type Props = { reel: ReelDetail };

// Convert ISO timestamp to value compatible with <input type="datetime-local">.
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // YYYY-MM-DDTHH:MM (local time)
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function PublishTab({ reel }: Props) {
  const t = useTranslations('reels.publish');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateReelPublish(reel.id, formData);
      if (result.ok) toast.success(t('saved'));
      else toast.error(tCommon('error'));
    });
  };

  return (
    <form action={onSubmit} className="space-y-5 max-w-2xl">
      <div className="space-y-1.5">
        <Label htmlFor="caption">{t('caption')}</Label>
        <textarea
          id="caption"
          name="caption"
          rows={5}
          maxLength={2200}
          placeholder={t('captionPlaceholder')}
          defaultValue={reel.caption ?? ''}
          className="flex w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="scheduled_at">{t('scheduledAt')}</Label>
        <Input
          id="scheduled_at"
          name="scheduled_at"
          type="datetime-local"
          defaultValue={toDatetimeLocal(reel.scheduled_at)}
          className="max-w-xs"
        />
        <p className="text-xs text-muted-foreground">{t('scheduledAtHelp')}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="posted_url">{t('postedUrl')}</Label>
        <Input
          id="posted_url"
          name="posted_url"
          type="url"
          placeholder={t('postedUrlPlaceholder')}
          defaultValue={reel.posted_url ?? ''}
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? tCommon('saving') : t('save')}
      </Button>
    </form>
  );
}
