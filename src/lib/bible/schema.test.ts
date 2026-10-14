import { describe, expect, it } from 'vitest';
import {
  BIBLE_LIMITS,
  EMPTY_BIBLE,
  bibleCompleteness,
  bibleSchema,
  firstNameMentions,
  firstNameOf,
  splitList,
  voiceSchema,
  type BibleFields,
} from './schema';

const full: BibleFields = {
  ...EMPTY_BIBLE,
  tone: 'Ironico',
  characters: 'Porcino e Papaya',
  duration_min_s: 30,
  duration_max_s: 45,
  allowed_ctas: ['Salva il reel'],
};

describe('bibleSchema', () => {
  it('trims texts and lists and drops empty items', () => {
    const r = bibleSchema.parse({ ...full, tone: '  Ironico  ', characters: '   ', themes: [' cucina ', '', '  '] });
    expect(r.tone).toBe('Ironico');
    expect(r.characters).toBeNull();
    expect(r.themes).toEqual(['cucina']);
  });

  it('keeps durations in 5–180, as a pair, min ≤ max', () => {
    expect(bibleSchema.safeParse({ ...full, duration_min_s: 4 }).success).toBe(false);
    expect(bibleSchema.safeParse({ ...full, duration_max_s: 181 }).success).toBe(false);
    expect(bibleSchema.safeParse({ ...full, duration_min_s: 50, duration_max_s: 45 }).success).toBe(false);
    expect(bibleSchema.safeParse({ ...full, duration_max_s: null }).success).toBe(false);
    expect(bibleSchema.safeParse({ ...full, duration_min_s: null, duration_max_s: null }).success).toBe(true);
  });

  it('limits models to 3 distinct ids', () => {
    expect(bibleSchema.safeParse({ ...full, default_models: ['a', 'b', 'c', 'd'] }).success).toBe(false);
    expect(bibleSchema.safeParse({ ...full, default_models: ['a', 'a'] }).success).toBe(false);
    expect(bibleSchema.safeParse({ ...full, default_models: ['a', 'b', 'c'] }).success).toBe(true);
  });

  it('keeps at most 5 example scripts with known keys only, dropping empty ones', () => {
    const ex = { title: 'T', hook: 'H' };
    expect(bibleSchema.safeParse({ ...full, example_scripts: Array(6).fill(ex) }).success).toBe(false);
    expect(bibleSchema.safeParse({ ...full, example_scripts: [{ ...ex, extra: 'x' }] }).success).toBe(false);
    const r = bibleSchema.parse({ ...full, example_scripts: [ex, { title: ' ', hook: '' }] });
    expect(r.example_scripts).toEqual([ex]);
  });

  it('refuses texts over the limits and words per second outside 1.5–4', () => {
    expect(bibleSchema.safeParse({ ...full, tone: 'x'.repeat(BIBLE_LIMITS.tone + 1) }).success).toBe(false);
    expect(bibleSchema.safeParse({ ...full, words_per_second: 1 }).success).toBe(false);
    expect(bibleSchema.safeParse({ ...full, words_per_second: 4.5 }).success).toBe(false);
  });
});

describe('voiceSchema', () => {
  const voice = { adjectives: [], banned_words: [], reference_audio_urls: [], allowed_liberties: null, anomaly_procedure: '' };
  it('accepts http(s) audio links only and maps empty texts to null', () => {
    expect(voiceSchema.parse({ ...voice, reference_audio_urls: ['https://x.test/a.wav'] }).anomaly_procedure).toBeNull();
    expect(voiceSchema.safeParse({ ...voice, reference_audio_urls: ['ftp://x.test/a.wav'] }).success).toBe(false);
  });
});

describe('splitList', () => {
  it('splits on commas or lines and trims', () => {
    expect(splitList('cane, gatto,  ,topo')).toEqual(['cane', 'gatto', 'topo']);
    expect(splitList('https://a\n\n https://b ', 'line')).toEqual(['https://a', 'https://b']);
  });
});

describe('bibleCompleteness', () => {
  it('needs tone, characters, duration and one CTA', () => {
    expect(bibleCompleteness(full)).toEqual({ complete: true, missing: [] });
    expect(bibleCompleteness(EMPTY_BIBLE).missing).toEqual(['tone', 'characters', 'duration', 'cta']);
  });
});

describe('first names', () => {
  it('takes the first word of a full name when it looks like a name', () => {
    expect(firstNameOf('Marco Rossi')).toBe('Marco');
    expect(firstNameOf('  Teo ')).toBe('Teo');
    expect(firstNameOf('Al Bano')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });

  it('finds whole-word mentions ignoring case and accents', () => {
    const texts = ['Porcino parla come Marco quando è stanco.', 'Niccolò lo ascolta'];
    expect(firstNameMentions(texts, ['Marco', 'Niccolo', 'Giulia'])).toEqual(['Marco', 'Niccolo']);
  });

  it('does not match inside other words', () => {
    expect(firstNameMentions(['Marcolino e Teodoro', 'un pomarco'], ['Marco', 'Teo'])).toEqual([]);
  });

  it('reports each name once', () => {
    expect(firstNameMentions(['Teo, teo e TEO'], ['Teo', 'teo'])).toEqual(['Teo']);
  });
});
