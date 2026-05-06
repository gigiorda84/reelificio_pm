import { getTranslations } from 'next-intl/server';
import { ExternalLink } from 'lucide-react';
import { getVoiceBriefForPage } from '@/lib/voice-briefs/queries';

type Props = { pageId: string };

export async function VoiceTab({ pageId }: Props) {
  const [t, brief] = await Promise.all([
    getTranslations('reels.voice'),
    getVoiceBriefForPage(pageId),
  ]);

  if (!brief) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <div className="space-y-5 max-w-3xl text-sm">
      {brief.adjectives.length > 0 ? (
        <Field label={t('adjectives')}>
          <p>{brief.adjectives.join(', ')}</p>
        </Field>
      ) : null}

      {brief.reference_audio_urls.length > 0 ? (
        <Field label={t('referenceAudio')}>
          <ul className="space-y-1">
            {brief.reference_audio_urls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                >
                  <ExternalLink className="size-3" aria-hidden />
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </Field>
      ) : null}

      {brief.banned_words.length > 0 ? (
        <Field label={t('bannedWords')}>
          <p className="font-mono">{brief.banned_words.join(' · ')}</p>
        </Field>
      ) : null}

      {brief.allowed_liberties ? (
        <Field label={t('allowedLiberties')}>
          <p className="whitespace-pre-wrap">{brief.allowed_liberties}</p>
        </Field>
      ) : null}

      {brief.anomaly_procedure ? (
        <Field label={t('anomalyProcedure')}>
          <p className="whitespace-pre-wrap">{brief.anomaly_procedure}</p>
        </Field>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}
