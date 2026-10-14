import { z } from 'zod';

// Page bible (docs/fase2-plan.md S2, D-D): the creative fields live in
// page_bibles, the Voce section in voice_briefs; save_bible() writes both.
// The limits mirror supabase/fase2/010_bible.sql, which enforces them again.

export const BIBLE_LIMITS = {
  tone: 4000,
  characters: 8000,
  themes: { items: 40, length: 120 },
  keywords: { items: 80, length: 60 },
  ctas: { items: 20, length: 300 },
  models: { items: 3, length: 120 },
  examples: 5,
  // The reel limits (src/lib/reels/actions.ts): any approved reel can be copied.
  example: { title: 200, hook: 2000, corpo: 8000, chiusura: 2000, cta: 2000 },
  duration: { min: 5, max: 180 },
  wordsPerSecond: { min: 1.5, max: 4, default: 2.5 },
  voice: {
    adjectives: { items: 40, length: 60 },
    bannedWords: { items: 80, length: 60 },
    audio: { items: 40, length: 1000 },
    text: 5000,
  },
} as const;

export type ExampleScript = {
  title?: string;
  hook?: string;
  corpo?: string;
  chiusura?: string;
  cta?: string;
};

export type BibleFields = {
  tone: string | null;
  characters: string | null;
  themes: string[];
  keywords: string[];
  allowed_ctas: string[];
  duration_min_s: number | null;
  duration_max_s: number | null;
  words_per_second: number;
  example_scripts: ExampleScript[];
  default_models: string[];
};

export type VoiceFields = {
  adjectives: string[];
  banned_words: string[];
  reference_audio_urls: string[];
  allowed_liberties: string | null;
  anomaly_procedure: string | null;
};

export const EMPTY_BIBLE: BibleFields = {
  tone: null,
  characters: null,
  themes: [],
  keywords: [],
  allowed_ctas: [],
  duration_min_s: null,
  duration_max_s: null,
  words_per_second: BIBLE_LIMITS.wordsPerSecond.default,
  example_scripts: [],
  default_models: [],
};

export const EMPTY_VOICE: VoiceFields = {
  adjectives: [],
  banned_words: [],
  reference_audio_urls: [],
  allowed_liberties: null,
  anomaly_procedure: null,
};

// Optional text: trimmed, empty → null.
const optionalText = (max: number) =>
  z
    .string()
    .nullable()
    .transform((s) => (s ?? '').trim())
    .pipe(z.string().max(max))
    .transform((s) => (s === '' ? null : s));

// A list of short strings: trimmed, empty items dropped, then limited.
const textList = (items: number, length: number) =>
  z
    .array(z.string())
    .transform((list) => list.map((s) => s.trim()).filter((s) => s !== ''))
    .pipe(z.array(z.string().max(length)).max(items));

const exampleSchema = z
  .object({
    title: z.string().trim().max(BIBLE_LIMITS.example.title).optional(),
    hook: z.string().trim().max(BIBLE_LIMITS.example.hook).optional(),
    corpo: z.string().trim().max(BIBLE_LIMITS.example.corpo).optional(),
    chiusura: z.string().trim().max(BIBLE_LIMITS.example.chiusura).optional(),
    cta: z.string().trim().max(BIBLE_LIMITS.example.cta).optional(),
  })
  .strict()
  .transform((e) =>
    Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined && v !== '')) as ExampleScript,
  );

const durationSchema = z.number().int().min(BIBLE_LIMITS.duration.min).max(BIBLE_LIMITS.duration.max).nullable();

export const bibleSchema = z
  .object({
    tone: optionalText(BIBLE_LIMITS.tone),
    characters: optionalText(BIBLE_LIMITS.characters),
    themes: textList(BIBLE_LIMITS.themes.items, BIBLE_LIMITS.themes.length),
    keywords: textList(BIBLE_LIMITS.keywords.items, BIBLE_LIMITS.keywords.length),
    allowed_ctas: textList(BIBLE_LIMITS.ctas.items, BIBLE_LIMITS.ctas.length),
    duration_min_s: durationSchema,
    duration_max_s: durationSchema,
    words_per_second: z.number().min(BIBLE_LIMITS.wordsPerSecond.min).max(BIBLE_LIMITS.wordsPerSecond.max),
    example_scripts: z
      .array(exampleSchema)
      .transform((list) => list.filter((e) => Object.keys(e).length > 0))
      .pipe(z.array(z.custom<ExampleScript>()).max(BIBLE_LIMITS.examples)),
    default_models: textList(BIBLE_LIMITS.models.items, BIBLE_LIMITS.models.length),
  })
  .superRefine((b, ctx) => {
    if ((b.duration_min_s === null) !== (b.duration_max_s === null)) {
      ctx.addIssue({ code: 'custom', path: ['duration_max_s'], message: 'duration_pair' });
    } else if (b.duration_min_s !== null && b.duration_max_s !== null && b.duration_min_s > b.duration_max_s) {
      ctx.addIssue({ code: 'custom', path: ['duration_max_s'], message: 'duration_order' });
    }
    if (new Set(b.default_models).size !== b.default_models.length) {
      ctx.addIssue({ code: 'custom', path: ['default_models'], message: 'duplicate_model' });
    }
  });

export const voiceSchema = z.object({
  adjectives: textList(BIBLE_LIMITS.voice.adjectives.items, BIBLE_LIMITS.voice.adjectives.length),
  banned_words: textList(BIBLE_LIMITS.voice.bannedWords.items, BIBLE_LIMITS.voice.bannedWords.length),
  reference_audio_urls: textList(BIBLE_LIMITS.voice.audio.items, BIBLE_LIMITS.voice.audio.length).pipe(
    z.array(z.string().regex(/^https?:\/\/\S+$/i)),
  ),
  allowed_liberties: optionalText(BIBLE_LIMITS.voice.text),
  anomaly_procedure: optionalText(BIBLE_LIMITS.voice.text),
});

// "Cane, gatto,  ,topo" → ['Cane', 'gatto', 'topo']; lines for URLs.
export function splitList(raw: string, by: 'comma' | 'line' = 'comma'): string[] {
  return raw
    .split(by === 'comma' ? ',' : /\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

// A bible is complete when the generation has what it needs: tone,
// characters, the duration range and at least one allowed CTA.
export type BibleGap = 'tone' | 'characters' | 'duration' | 'cta';

export function bibleCompleteness(b: BibleFields): { complete: boolean; missing: BibleGap[] } {
  const missing: BibleGap[] = [];
  if (!b.tone?.trim()) missing.push('tone');
  if (!b.characters?.trim()) missing.push('characters');
  if (b.duration_min_s === null || b.duration_max_s === null) missing.push('duration');
  if (b.allowed_ctas.length === 0) missing.push('cta');
  return { complete: missing.length === 0, missing };
}

// First name of a profile, for the editor warning: the first word of the
// full name, if it is at least 3 letters long.
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0] ?? '';
  return /^\p{L}[\p{L}'’-]{2,}$/u.test(first) ? first : null;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// First names of real people that appear as whole words in the texts, so the
// editor can warn before they reach a model (docs/fase2-plan.md S2, AC15).
// Matching ignores case and accents; nothing is changed, only reported.
export function firstNameMentions(texts: (string | null | undefined)[], firstNames: string[]): string[] {
  const haystack = fold(texts.filter(Boolean).join('\n'));
  if (!haystack) return [];
  const found = new Map<string, string>();
  for (const name of firstNames) {
    const key = fold(name);
    if (key.length < 3 || found.has(key)) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(key)}(?![\\p{L}\\p{N}])`, 'u');
    if (re.test(haystack)) found.set(key, name);
  }
  return [...found.values()];
}
