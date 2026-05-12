import type { ParsedDoc, ParsedReel, ParsedReelFormat } from './types';

// Permissive parser for the monthly script doc. Goal: never lose content.
// When a section can't be detected we still produce a reel record with
// `rawContent` populated and a `parserWarning` flag so a human can review.

const SCRIPT_HEADER_RE = /^SCRIPT\s+(\d+)\b[^\n]*?[—–-]\s*(.+?)\s*$/i;
const SECTION_NAMES = ['HOOK', 'CORPO', 'CHIUSURA', 'CTA'] as const;
type SectionName = (typeof SECTION_NAMES)[number];

function detectFormat(tag: string | null): ParsedReelFormat {
  if (!tag) return 'other';
  const upper = tag.toUpperCase();
  if (upper.includes('BOTTA E RISPOSTA')) return 'botta_e_risposta';
  if (upper.includes('PORCINO MONOLOGO')) return 'porcino_mono';
  if (upper.includes('PAPAYA MONOLOGO')) return 'papaya_mono';
  if (upper.startsWith('DUO')) return 'duo';
  return 'other';
}

function isSectionLine(line: string): SectionName | null {
  const trimmed = line.trim().toUpperCase();
  for (const name of SECTION_NAMES) {
    if (trimmed === name) return name;
  }
  return null;
}

function isFormatTagLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^[✅✓✔]/.test(trimmed)) return true;
  // Bare format names without the check-mark prefix.
  const upper = trimmed.toUpperCase();
  if (upper.startsWith('PORCINO MONOLOGO')) return true;
  if (upper.startsWith('PAPAYA MONOLOGO')) return true;
  if (upper.startsWith('BOTTA E RISPOSTA')) return true;
  return false;
}

function joinTrim(lines: string[]): string | null {
  const joined = lines
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n[ \t]*\n+/g, '\n')
    .trim();
  return joined.length > 0 ? joined : null;
}

type Chunk = { headerLine: string; bodyLines: string[] };

function splitIntoScriptChunks(lines: string[]): {
  preamble: string[];
  chunks: Chunk[];
} {
  const headerIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (SCRIPT_HEADER_RE.test(lines[i])) headerIndices.push(i);
  }
  if (headerIndices.length === 0) {
    return { preamble: lines, chunks: [] };
  }
  const preamble = lines.slice(0, headerIndices[0]);
  const chunks: Chunk[] = [];
  for (let i = 0; i < headerIndices.length; i++) {
    const start = headerIndices[i];
    const end = i + 1 < headerIndices.length ? headerIndices[i + 1] : lines.length;
    chunks.push({
      headerLine: lines[start],
      bodyLines: lines.slice(start + 1, end),
    });
  }
  return { preamble, chunks };
}

function parseHeaderMeta(preamble: string[]): {
  pageName: string | null;
  batchLabel: string | null;
} {
  const nonEmpty = preamble.map((l) => l.trim()).filter(Boolean);
  let pageName: string | null = null;
  let batchLabel: string | null = null;

  // First non-empty line is conventionally the page name (all-caps in the source).
  if (nonEmpty.length > 0) {
    pageName = nonEmpty[0];
  }
  // Look for any line containing "batch" (case-insensitive) — usually "Batch Maggio".
  const batchLine = nonEmpty.find((l) => /\bbatch\b/i.test(l));
  if (batchLine) batchLabel = batchLine;

  return { pageName, batchLabel };
}

function parseChunk(chunk: Chunk, fallbackOrdinal: number): ParsedReel {
  const headerMatch = chunk.headerLine.match(SCRIPT_HEADER_RE);
  const ordinal = headerMatch ? Number(headerMatch[1]) : fallbackOrdinal;
  // Strip trailing parenthetical annotations from the title (e.g. "(codice)").
  const rawTitle = headerMatch ? headerMatch[2] : `Script ${fallbackOrdinal}`;
  const title = rawTitle.replace(/\s*\([^)]*\)\s*$/, '').trim() || rawTitle.trim();

  // Find the format-tag line (skip blank lines after the header).
  const body = chunk.bodyLines;
  let cursor = 0;
  while (cursor < body.length && body[cursor].trim() === '') cursor++;

  let formatTag: string | null = null;
  if (cursor < body.length && isFormatTagLine(body[cursor])) {
    formatTag = body[cursor].replace(/^[✅✓✔]\s*/, '').trim();
    cursor++;
  }
  const format = detectFormat(formatTag);

  // Walk remaining lines, bucketing into HOOK / CORPO / CHIUSURA / CTA.
  // Anything before the first section marker (after the format tag) is treated
  // as pre-section notes; anything after CTA is treated as trailing notes.
  const buckets: Record<SectionName, string[]> = {
    HOOK: [],
    CORPO: [],
    CHIUSURA: [],
    CTA: [],
  };
  const preSectionNotes: string[] = [];
  const trailingNotes: string[] = [];
  let currentSection: SectionName | null = null;
  let cta_finished = false;

  for (; cursor < body.length; cursor++) {
    const line = body[cursor];
    const sectionName = isSectionLine(line);
    if (sectionName) {
      currentSection = sectionName;
      cta_finished = false;
      continue;
    }
    if (currentSection === null) {
      preSectionNotes.push(line);
      continue;
    }
    if (currentSection === 'CTA' && line.trim() === '') {
      // Blank lines inside CTA stay attached to CTA; once we see two
      // consecutive blanks treat the rest as trailing notes.
      const next = body[cursor + 1]?.trim();
      if (next === '') {
        cta_finished = true;
        cursor++;
        continue;
      }
    }
    if (currentSection === 'CTA' && cta_finished) {
      trailingNotes.push(line);
      continue;
    }
    buckets[currentSection].push(line);
  }

  const notes = joinTrim([...preSectionNotes, ...trailingNotes]);

  // Decide whether to treat this as a clean parse or a fallback.
  const cleanParse =
    buckets.HOOK.some((l) => l.trim().length > 0) ||
    buckets.CORPO.some((l) => l.trim().length > 0);

  if (!cleanParse) {
    return {
      ordinal,
      title,
      format,
      formatTag,
      hook: null,
      corpo: null,
      chiusura: null,
      cta: null,
      notes: null,
      rawContent: [chunk.headerLine, ...body].join('\n'),
      parserWarning: 'Could not detect HOOK/CORPO sections; raw content kept.',
    };
  }

  return {
    ordinal,
    title,
    format,
    formatTag,
    hook: joinTrim(buckets.HOOK),
    corpo: joinTrim(buckets.CORPO),
    chiusura: joinTrim(buckets.CHIUSURA),
    cta: joinTrim(buckets.CTA),
    notes,
    rawContent: null,
    parserWarning: null,
  };
}

export function parseScriptDoc(rawText: string): ParsedDoc {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const { preamble, chunks } = splitIntoScriptChunks(lines);

  const { pageName, batchLabel } = parseHeaderMeta(preamble);

  const warnings: string[] = [];
  if (!pageName) warnings.push('Page name missing from document header.');
  if (!batchLabel) warnings.push('Batch label missing from document header.');
  if (chunks.length === 0) warnings.push('No SCRIPT N — TITLE blocks detected.');

  const seenOrdinals = new Set<number>();
  const reels = chunks.map((chunk, idx) => {
    const reel = parseChunk(chunk, idx + 1);
    if (seenOrdinals.has(reel.ordinal)) {
      warnings.push(`Duplicate ordinal ${reel.ordinal} detected.`);
    }
    seenOrdinals.add(reel.ordinal);
    return reel;
  });

  return { pageName, batchLabel, reels, warnings };
}
