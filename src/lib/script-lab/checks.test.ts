import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScriptDoc } from '@/lib/parser/parse';
import {
  SIMILARITY_THRESHOLD,
  estimateDuration,
  findBannedWords,
  normalize,
  runChecks,
  similarity,
  spokenText,
  type CheckInput,
  type ScriptBlocks,
} from './checks';

const blocks = (b: Partial<ScriptBlocks>): ScriptBlocks => ({ hook: null, corpo: null, chiusura: null, cta: null, ...b });

describe('normalize', () => {
  it('drops case, accents and punctuation', () => {
    expect(normalize("L'IDIOTA, già!  Perché?")).toBe('l idiota gia perche');
  });
});

describe('findBannedWords (AC20)', () => {
  it("finds a banned word in \"l'idiota\" and \"IDIOTA\", with its block and position", () => {
    const text = "Sei proprio l'idiota del gruppo. IDIOTA!";
    const found = findBannedWords(blocks({ corpo: text }), ['idiota']);
    expect(found.map((f) => [f.block, f.index, f.match])).toEqual([
      ['corpo', text.indexOf('idiota'), 'idiota'],
      ['corpo', text.indexOf('IDIOTA'), 'IDIOTA'],
    ]);
  });

  it('ignores accents both ways and does not match inside longer words', () => {
    expect(findBannedWords(blocks({ hook: 'Perche no?' }), ['perché'])).toHaveLength(1);
    expect(findBannedWords(blocks({ hook: 'idiotamente, ripidiota' }), ['idiota'])).toHaveLength(0);
  });

  it('matches a banned phrase across extra spaces', () => {
    expect(findBannedWords(blocks({ cta: 'Che  schifo  di app' }), ['che schifo'])).toHaveLength(1);
  });

  it('keeps positions right after accented and emoji characters', () => {
    const text = 'Città 🎉 città: idiota';
    const [f] = findBannedWords(blocks({ hook: text }), ['idiota']);
    expect(text.slice(f.index, f.index + 6)).toBe('idiota');
  });
});

describe('estimateDuration (AC20)', () => {
  it('120 words at 2.5 words per second are 48 seconds', () => {
    expect(estimateDuration(blocks({ corpo: 'parola '.repeat(120) }), 2.5)).toEqual({ words: 120, seconds: 48 });
  });

  it('does not read speaker labels and stage notes aloud', () => {
    const chiusura = 'Papaya (entra secca):  "Non sono un farmaco."\nPorcino:  "Strano. Funziona."';
    expect(spokenText(chiusura).trim()).toBe('"Non sono un farmaco."\n  "Strano. Funziona."');
    expect(estimateDuration(blocks({ chiusura }), 1).words).toBe(6);
  });
});

describe('similarity', () => {
  it('is 1 for the same text and low for unrelated ones', () => {
    expect(similarity('Seguici!', 'seguici')).toBe(1);
    expect(similarity('Seguici. Che stai invecchiando comunque.', 'Parla col tuo cardiologo.')).toBeLessThan(0.2);
  });

  it('flags the same formula reworded', () => {
    const base = 'Seguici. Che qui i dati fanno più rumore delle opinioni.';
    expect(similarity(base, 'Seguici. Che qui i numeri fanno più rumore delle opinioni.')).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
    expect(similarity(base, 'Seguici. Che stai invecchiando comunque… tanto vale farlo bene.')).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it('keeps the distinct CTAs and closings of the May batch below the threshold', () => {
    const doc = parseScriptDoc(readFileSync(join(__dirname, '../../../tests/fixtures/porcino-papaya-may.txt'), 'utf8'));
    for (const block of ['cta', 'chiusura'] as const) {
      const texts = doc.reels.map((r) => r[block]).filter((t): t is string => !!t);
      expect(texts.length).toBeGreaterThan(10);
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          if (normalize(texts[i]) !== normalize(texts[j])) {
            expect(similarity(texts[i], texts[j])).toBeLessThan(SIMILARITY_THRESHOLD);
          }
        }
      }
    }
  });
});

describe('runChecks (AC20)', () => {
  const input: CheckInput = {
    blocks: blocks({
      // 4 + 102 + 4 (the label is not read) + 10 = 120 words → 48 s.
      hook: 'Che schifo questa dieta.',
      corpo: 'parola '.repeat(102),
      chiusura: 'Papaya: "Non parlavo con te."',
      cta: 'Seguici! Che qui i dati fanno più rumore delle opinioni.',
    }),
    bannedWords: ['schifo'],
    duration: { min: 30, max: 45, wordsPerSecond: 2.5 },
    recent: [
      { code: 'PP-2605-02', cta: 'Seguici. Che qui i dati fanno più rumore delle opinioni.', chiusura: null },
      { code: 'PP-2605-03', cta: 'Seguici. Che qui i numeri fanno più rumore delle opinioni.', chiusura: 'Altro finale.' },
    ],
  };

  it('reports a banned word, a duration out of range and a repeated CTA', () => {
    const w = runChecks(input);
    expect(w.map((x) => x.kind)).toEqual(['banned_word', 'duration', 'repeated']);
    expect(w[1]).toMatchObject({ kind: 'duration', seconds: 48, min: 30, max: 45 });
    // The same CTA once normalized ("uguale") wins over a merely similar one.
    expect(w[2]).toMatchObject({ kind: 'repeated', block: 'cta', code: 'PP-2605-02', same: true, similarity: 1 });
  });

  it('reports "molto simile" when no CTA is the same', () => {
    const w = runChecks({ ...input, recent: [input.recent[1]] });
    expect(w.find((x) => x.kind === 'repeated')).toMatchObject({ code: 'PP-2605-03', same: false });
  });

  it('has nothing to say about a clean script', () => {
    expect(
      runChecks({
        ...input,
        blocks: blocks({ hook: 'Lo sapevi?', corpo: 'parola '.repeat(90), cta: 'Salva il reel.' }),
      }),
    ).toEqual([]);
  });

  it('skips the duration without a range in the bible', () => {
    expect(runChecks({ ...input, duration: { min: null, max: null, wordsPerSecond: 2.5 } }).some((x) => x.kind === 'duration')).toBe(false);
  });
});
