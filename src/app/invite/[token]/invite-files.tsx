'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateFilesAsInvitee } from '@/lib/invites/actions';

type Props = {
  token: string;
  audio: string | null;
  video: string | null;
};

export function InviteFiles({ token, audio, video }: Props) {
  const t = useTranslations('invites.public');
  const tCommon = useTranslations('common');
  const [pending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    formData.set('token', token);
    startTransition(async () => {
      const result = await updateFilesAsInvitee(formData);
      if (result.ok) toast.success(t('filesSaved'));
      else if (result.error === 'invite_invalid') toast.error(t('inviteInvalid'));
      else toast.error(tCommon('error'));
    });
  };

  return (
    <form action={onSubmit} className="space-y-4">
      <FileField
        label={t('audio')}
        name="audio_drive_url"
        defaultValue={audio ?? ''}
        currentLink={audio}
        openLabel={t('openLink')}
      />
      <FileField
        label={t('video')}
        name="video_drive_url"
        defaultValue={video ?? ''}
        currentLink={video}
        openLabel={t('openLink')}
      />
      <Button type="submit" disabled={pending}>
        {pending ? tCommon('saving') : t('filesSave')}
      </Button>
    </form>
  );
}

function FileField({
  label,
  name,
  defaultValue,
  currentLink,
  openLabel,
}: {
  label: string;
  name: string;
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
            <ExternalLink className="size-3" aria-hidden /> {openLabel}
          </a>
        ) : null}
      </div>
      <Input
        id={name}
        name={name}
        type="url"
        placeholder="https://drive.google.com/..."
        defaultValue={defaultValue}
      />
    </div>
  );
}
