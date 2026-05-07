'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { saveVoiceBrief } from '@/lib/voice-briefs/actions';
import type { VoiceBriefRow } from '@/lib/voice-briefs/queries';

type Props = {
  pageId: string;
  initial: VoiceBriefRow | null;
};

export function VoiceBriefEditor({ pageId, initial }: Props) {
  const t = useTranslations('voiceBriefs');
  const tCommon = useTranslations('common');
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  const [adjectives, setAdjectives] = useState((initial?.adjectives ?? []).join(', '));
  const [bannedWords, setBannedWords] = useState((initial?.banned_words ?? []).join(', '));
  const [audioUrls, setAudioUrls] = useState(
    (initial?.reference_audio_urls ?? []).join('\n'),
  );
  const [liberties, setLiberties] = useState(initial?.allowed_liberties ?? '');
  const [anomaly, setAnomaly] = useState(initial?.anomaly_procedure ?? '');

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await saveVoiceBrief(pageId, formData);
      if (result.ok) {
        toast.success(t('saved'));
      } else if (result.error === 'not_admin') {
        toast.error(t('errors.notAdmin'));
      } else {
        toast.error(result.message ?? tCommon('error'));
      }
    });
  };

  return (
    <form ref={formRef} action={onSubmit} className="space-y-5 max-w-3xl">
      <Field label={t('fields.adjectives')} hint={t('hints.csv')}>
        <input
          name="adjectives"
          type="text"
          value={adjectives}
          onChange={(e) => setAdjectives(e.target.value)}
          className={inputCls}
        />
      </Field>

      <Field label={t('fields.referenceAudio')} hint={t('hints.urlsPerLine')}>
        <textarea
          name="reference_audio_urls"
          rows={3}
          value={audioUrls}
          onChange={(e) => setAudioUrls(e.target.value)}
          className={textareaCls}
        />
      </Field>

      <Field label={t('fields.bannedWords')} hint={t('hints.csv')}>
        <input
          name="banned_words"
          type="text"
          value={bannedWords}
          onChange={(e) => setBannedWords(e.target.value)}
          className={inputCls}
        />
      </Field>

      <Field label={t('fields.allowedLiberties')}>
        <textarea
          name="allowed_liberties"
          rows={3}
          value={liberties}
          onChange={(e) => setLiberties(e.target.value)}
          className={textareaCls}
        />
      </Field>

      <Field label={t('fields.anomalyProcedure')}>
        <textarea
          name="anomaly_procedure"
          rows={3}
          value={anomaly}
          onChange={(e) => setAnomaly(e.target.value)}
          className={textareaCls}
        />
      </Field>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}

const inputCls =
  'flex h-9 w-full rounded-md border bg-background px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring';
const textareaCls =
  'flex w-full rounded-md border bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs uppercase tracking-wider text-muted-foreground block">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
