'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { saveBible } from '@/lib/bible/actions';
import type { ApprovedScript, BibleRow } from '@/lib/bible/queries';
import {
  BIBLE_LIMITS,
  bibleCompleteness,
  firstNameMentions,
  splitList,
  type ExampleScript,
  type VoiceFields,
} from '@/lib/bible/schema';

type Props = {
  pageId: string;
  initialBible: BibleRow;
  initialVoice: VoiceFields;
  editable: boolean;
  approved: ApprovedScript[];
  firstNames: string[];
};

const EXAMPLE_KEYS = ['title', 'hook', 'corpo', 'chiusura', 'cta'] as const;
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border bg-background px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60';

const toInt = (s: string): number | null => (s.trim() === '' ? null : Math.round(Number(s.replace(',', '.'))));

export function BibleEditor({ pageId, initialBible, initialVoice, editable, approved, firstNames }: Props) {
  const t = useTranslations('bible');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [version, setVersion] = useState(initialBible.version);

  const [tone, setTone] = useState(initialBible.tone ?? '');
  const [characters, setCharacters] = useState(initialBible.characters ?? '');
  const [durationMin, setDurationMin] = useState(initialBible.duration_min_s?.toString() ?? '');
  const [durationMax, setDurationMax] = useState(initialBible.duration_max_s?.toString() ?? '');
  const [wps, setWps] = useState(initialBible.words_per_second.toString());
  const [ctas, setCtas] = useState(initialBible.allowed_ctas.join('\n'));
  const [themes, setThemes] = useState(initialBible.themes.join(', '));
  const [keywords, setKeywords] = useState(initialBible.keywords.join(', '));
  const [models, setModels] = useState(initialBible.default_models.join(', '));
  const [examples, setExamples] = useState<ExampleScript[]>(initialBible.example_scripts);
  const [copyFrom, setCopyFrom] = useState('');

  const [adjectives, setAdjectives] = useState(initialVoice.adjectives.join(', '));
  const [banned, setBanned] = useState(initialVoice.banned_words.join(', '));
  const [audio, setAudio] = useState(initialVoice.reference_audio_urls.join('\n'));
  const [liberties, setLiberties] = useState(initialVoice.allowed_liberties ?? '');
  const [anomaly, setAnomaly] = useState(initialVoice.anomaly_procedure ?? '');

  const bible = {
    tone: tone.trim() || null,
    characters: characters.trim() || null,
    themes: splitList(themes),
    keywords: splitList(keywords),
    allowed_ctas: splitList(ctas, 'line'),
    duration_min_s: toInt(durationMin),
    duration_max_s: toInt(durationMax),
    words_per_second: Number(wps.replace(',', '.')),
    example_scripts: examples,
    default_models: splitList(models),
  };
  const { missing } = bibleCompleteness(bible);

  // Names of real people in the creative fields: a warning only (AC15).
  const mentioned = useMemo(
    () =>
      firstNameMentions(
        [tone, characters, themes, keywords, ctas, ...examples.flatMap((e) => EXAMPLE_KEYS.map((k) => e[k]))],
        firstNames,
      ),
    [tone, characters, themes, keywords, ctas, examples, firstNames],
  );

  const setExample = (i: number, key: (typeof EXAMPLE_KEYS)[number], value: string) =>
    setExamples(examples.map((e, j) => (j === i ? { ...e, [key]: value } : e)));

  const addExample = (from?: ApprovedScript) => {
    if (examples.length >= BIBLE_LIMITS.examples) return;
    const copy: ExampleScript = {};
    if (from) for (const k of EXAMPLE_KEYS) if (from[k]) copy[k] = from[k];
    setExamples([...examples, copy]);
  };

  const save = () => {
    startTransition(async () => {
      const result = await saveBible(pageId, {
        bible,
        voice: {
          adjectives: splitList(adjectives),
          banned_words: splitList(banned),
          reference_audio_urls: splitList(audio, 'line'),
          allowed_liberties: liberties.trim() || null,
          anomaly_procedure: anomaly.trim() || null,
        },
        expectedVersion: version,
      });
      if (result.ok) {
        setVersion(result.version);
        toast.success(t('saved'));
        router.refresh();
      } else if (result.error === 'stale') {
        toast.error(t('errors.stale'));
      } else {
        toast.error(t(`errors.${result.error}`));
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border px-4 py-3 text-sm">
        {missing.length === 0 ? (
          <p className="text-green-700 dark:text-green-400">{t('complete')}</p>
        ) : (
          <p className="text-muted-foreground">
            {t('incomplete', { missing: missing.map((m) => t(`gaps.${m}`)).join(', ') })}
          </p>
        )}
      </div>

      {mentioned.length > 0 ? (
        <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{t('namesWarning', { names: mentioned.join(', ') })}</p>
        </div>
      ) : null}

      <fieldset disabled={!editable || pending} className="space-y-6">
        <Section title={t('sections.tone')} hint={t('hints.tone')}>
          <Textarea rows={4} value={tone} onChange={(e) => setTone(e.target.value)} maxLength={BIBLE_LIMITS.tone} />
        </Section>

        <Section title={t('sections.characters')} hint={t('hints.characters')}>
          <Textarea
            rows={8}
            value={characters}
            onChange={(e) => setCharacters(e.target.value)}
            maxLength={BIBLE_LIMITS.characters}
          />
        </Section>

        <Section title={t('sections.duration')} hint={t('hints.duration')}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="duration_min" label={t('fields.durationMin')}>
              <Input id="duration_min" type="number" min={5} max={180} value={durationMin} onChange={(e) => setDurationMin(e.target.value)} />
            </Field>
            <Field id="duration_max" label={t('fields.durationMax')}>
              <Input id="duration_max" type="number" min={5} max={180} value={durationMax} onChange={(e) => setDurationMax(e.target.value)} />
            </Field>
            <Field id="wps" label={t('fields.wordsPerSecond')}>
              <Input id="wps" type="number" min={1.5} max={4} step={0.1} value={wps} onChange={(e) => setWps(e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title={t('sections.ctas')} hint={t('hints.onePerLine')}>
          <Textarea rows={4} value={ctas} onChange={(e) => setCtas(e.target.value)} />
        </Section>

        <Section title={t('sections.themes')} hint={t('hints.themes')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="themes" label={t('fields.themes')}>
              <Input id="themes" value={themes} onChange={(e) => setThemes(e.target.value)} />
            </Field>
            <Field id="keywords" label={t('fields.keywords')}>
              <Input id="keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title={t('sections.examples')} hint={t('hints.examples', { max: BIBLE_LIMITS.examples })}>
          <div className="space-y-4">
            {examples.map((ex, i) => (
              <div key={i} className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={t('fields.exampleTitle')}
                    placeholder={t('fields.exampleTitle')}
                    value={ex.title ?? ''}
                    onChange={(e) => setExample(i, 'title', e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('removeExample')}
                    onClick={() => setExamples(examples.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
                {(['hook', 'corpo', 'chiusura', 'cta'] as const).map((k) => (
                  <Textarea
                    key={k}
                    rows={k === 'corpo' ? 4 : 2}
                    aria-label={k.toUpperCase()}
                    placeholder={k.toUpperCase()}
                    value={ex[k] ?? ''}
                    onChange={(e) => setExample(i, k, e.target.value)}
                  />
                ))}
              </div>
            ))}
            {examples.length < BIBLE_LIMITS.examples ? (
              <div className="flex flex-wrap items-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => addExample()}>
                  <Plus className="size-4" aria-hidden /> {t('addExample')}
                </Button>
                {approved.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={t('copyFrom')}
                      className={`${SELECT_CLASS} w-64`}
                      value={copyFrom}
                      onChange={(e) => setCopyFrom(e.target.value)}
                    >
                      <option value="">{t('copyFrom')}</option>
                      {approved.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.code} · {r.title ?? ''}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!copyFrom}
                      onClick={() => {
                        addExample(approved.find((r) => r.id === copyFrom));
                        setCopyFrom('');
                      }}
                    >
                      {t('copy')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </Section>

        <Section title={t('sections.models')} hint={t('hints.models')}>
          <Input value={models} onChange={(e) => setModels(e.target.value)} placeholder="anthropic/claude-sonnet-4.5, …" />
        </Section>

        <Section title={t('sections.voice')} hint={t('hints.voice')}>
          <div className="space-y-4">
            <Field id="adjectives" label={t('fields.adjectives')} hint={t('hints.csv')}>
              <Input id="adjectives" value={adjectives} onChange={(e) => setAdjectives(e.target.value)} />
            </Field>
            <Field id="banned" label={t('fields.bannedWords')} hint={t('hints.banned')}>
              <Input id="banned" value={banned} onChange={(e) => setBanned(e.target.value)} />
            </Field>
            <Field id="audio" label={t('fields.referenceAudio')} hint={t('hints.onePerLine')}>
              <Textarea id="audio" rows={3} value={audio} onChange={(e) => setAudio(e.target.value)} />
            </Field>
            <Field id="liberties" label={t('fields.allowedLiberties')}>
              <Textarea id="liberties" rows={3} value={liberties} onChange={(e) => setLiberties(e.target.value)} />
            </Field>
            <Field id="anomaly" label={t('fields.anomalyProcedure')}>
              <Textarea id="anomaly" rows={3} value={anomaly} onChange={(e) => setAnomaly(e.target.value)} />
            </Field>
          </div>
        </Section>

        {editable ? (
          <div className="flex justify-end">
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? t('saving') : t('save')}
            </Button>
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        {hint ? <CardDescription>{hint}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
