import { BLOCKS, type Block } from './mix';

// Automatic checks on the working text (docs/fase2-plan.md S5, AC20–21).
// Warnings only: they never block the delivery. Pure functions, so the same
// code runs for the reel page, the approval queue and the task panel.

export type ScriptBlocks = Record<Block, string | null>;

export type RecentClosing = { code: string; cta: string | null; chiusura: string | null };

export type CheckInput = {
  blocks: ScriptBlocks;
  bannedWords: string[];
  duration: { min: number | null; max: number | null; wordsPerSecond: number };
  // The last reels of the page (not this one), newest first.
  recent: RecentClosing[];
};

export type CheckWarning =
  | { kind: 'banned_word'; word: string; block: Block; index: number; match: string }
  | { kind: 'duration'; seconds: number; words: number; min: number; max: number }
  | { kind: 'repeated'; block: 'cta' | 'chiusura'; code: string; similarity: number; same: boolean };

// From this trigram similarity a CTA or closing counts as "molto simile".
// Calibrated on the May Porcino & Papaya batch (tests/fixtures): its 20
// distinct CTAs, which all start with "Seguici.", reach at most 0.36 between
// them and its closings 0.23, while the same formula reworded scores
// 0.67–0.73 and with a word dropped 0.96. 0.8 would miss the rewordings.
export const SIMILARITY_THRESHOLD = 0.6;

// Lowercase, accents and punctuation removed, spaces collapsed:
// "L'IDIOTA, già!" → "l idiota gia".
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Lowercase and accent-free, one character for one character, so an index in
// the folded text is the index in the original.
function foldSameLength(text: string): string {
  return Array.from(text, (c) => {
    const base = Array.from(c.normalize('NFD'))[0];
    const lower = base.toLowerCase();
    // A character whose folded form has another length stays as it is.
    return lower.length === c.length ? lower : base.length === c.length ? base : c;
  }).join('');
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every whole-word occurrence of a banned word or phrase, ignoring case and
// accents ("idiota" finds "l'idiota" and "IDIOTA", not "idiotamente").
export function findBannedWords(blocks: ScriptBlocks, bannedWords: string[]): Extract<CheckWarning, { kind: 'banned_word' }>[] {
  const found: Extract<CheckWarning, { kind: 'banned_word' }>[] = [];
  const words = [...new Set(bannedWords.map((w) => w.trim()).filter((w) => w !== ''))];
  for (const block of BLOCKS) {
    const text = blocks[block];
    if (!text) continue;
    const folded = foldSameLength(text);
    for (const word of words) {
      const pattern = foldSameLength(word).split(/\s+/).map(escapeRegex).join('\\s+');
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'gu');
      for (const m of folded.matchAll(re)) {
        const index = m.index ?? 0;
        found.push({ kind: 'banned_word', word, block, index, match: text.slice(index, index + m[0].length) });
      }
    }
  }
  return found;
}

// Spoken words: speaker labels at the start of a line ("Porcino:", "Papaya
// (entra secca):", up to three capitalised words) and stage notes in
// parentheses are not read aloud. "Oggi vi spiego tre cose: …" is spoken.
export function spokenText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\p{Lu}[\p{L}'’]*(?:\s+\p{Lu}[\p{L}'’]*){0,2}\s*(\([^)]*\))?\s*:/u, ''))
    .join('\n')
    .replace(/\([^)]*\)/g, ' ');
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function estimateDuration(blocks: Partial<ScriptBlocks>, wordsPerSecond: number): { words: number; seconds: number } {
  const words = countWords(BLOCKS.map((b) => spokenText(blocks[b] ?? '')).join('\n'));
  return { words, seconds: wordsPerSecond > 0 ? Math.round(words / wordsPerSecond) : 0 };
}

function trigrams(text: string): Set<string> {
  const s = ` ${normalize(text)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

// Jaccard similarity of character trigrams of the normalized texts, 0–1.
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

export function runChecks(input: CheckInput): CheckWarning[] {
  const warnings: CheckWarning[] = [...findBannedWords(input.blocks, input.bannedWords)];

  const { min, max, wordsPerSecond } = input.duration;
  if (min !== null && max !== null) {
    const { words, seconds } = estimateDuration(input.blocks, wordsPerSecond);
    if (words > 0 && (seconds < min || seconds > max)) {
      warnings.push({ kind: 'duration', seconds, words, min, max });
    }
  }

  for (const block of ['cta', 'chiusura'] as const) {
    const mine = input.blocks[block];
    if (!mine || normalize(mine) === '') continue;
    let best: Extract<CheckWarning, { kind: 'repeated' }> | null = null;
    for (const other of input.recent) {
      const theirs = other[block];
      if (!theirs) continue;
      const same = normalize(mine) === normalize(theirs);
      const score = same ? 1 : similarity(mine, theirs);
      if (score >= SIMILARITY_THRESHOLD && (!best || score > best.similarity)) {
        best = { kind: 'repeated', block, code: other.code, similarity: Math.round(score * 100) / 100, same };
      }
    }
    if (best) warnings.push(best);
  }
  return warnings;
}
