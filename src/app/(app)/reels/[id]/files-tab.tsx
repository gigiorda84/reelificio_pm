'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateReelFiles } from '@/lib/reels/actions';
import type { ReelDetail } from '@/lib/reels/queries';

type Props = { reel: ReelDetail };

export function FilesTab({ reel }: Props) {
  const t = useTranslations('reels.files');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateReelFiles(reel.id, formData);
      if (result.ok) toast.success(t('saved'));
      else toast.error(tCommon('error'));
    });
  };

  return (
    <form action={onSubmit} className="space-y-5 max-w-2xl">
      <FileField
        label={t('audio')}
        name="audio_drive_url"
        placeholder={t('audioPlaceholder')}
        defaultValue={reel.audio_drive_url ?? ''}
        currentLink={reel.audio_drive_url}
        openLabel={t('openLink')}
      />
      <FileField
        label={t('video')}
        name="video_drive_url"
        placeholder={t('videoPlaceholder')}
        defaultValue={reel.video_drive_url ?? ''}
        currentLink={reel.video_drive_url}
        openLabel={t('openLink')}
      />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon('saving') : t('save')}
      </Button>
    </form>
  );
}

function FileField({
  label,
  name,
  placeholder,
  defaultValue,
  currentLink,
  openLabel,
}: {
  label: string;
  name: string;
  placeholder: string;
  defaultValue: string;
  currentLink: string | null;
  openLabel: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={name}>{label}</Label>
        {currentLink ? (
          <a
            href={currentLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <ExternalLink className="size-3" aria-hidden />
            {openLabel}
          </a>
        ) : null}
      </div>
      <Input
        id={name}
        name={name}
        type="url"
        placeholder={placeholder}
        defaultValue={defaultValue}
      />
    </div>
  );
}
