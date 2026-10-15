import { romeParts } from '@/lib/dates';

// Reel code: <PAGE_PREFIX>-YYMM-NN. The YYMM is the *batch* month (extracted
// from the batch label when possible, else the current month). Re-sync takes
// it from the batch's existing codes (reelCodeYearMonth), so codes stay stable.

const ITALIAN_MONTHS: Record<string, number> = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
};

// "Now" is the Rome month, whatever the server's zone (UTC on Vercel). The
// label's month gets the year that puts it nearest to now: batches are
// imported ahead of time, so a "Batch Gennaio" imported in December is next
// January. More than 6 months before now → next year, more than 6 after →
// previous year: the same rule as private._code_month (Fase 2, 040_ideas.sql).
export function detectBatchYearMonth(
  label: string | null,
  now = new Date(),
): { year: number; month: number } {
  const [year, current] = romeParts(now).date.split('-').map(Number);
  const fallback = { year, month: current };
  if (!label) return fallback;
  const lower = label.toLowerCase();
  for (const [name, month] of Object.entries(ITALIAN_MONTHS)) {
    if (lower.includes(name)) {
      const diff = month - current;
      if (diff < -6) return { year: year + 1, month };
      if (diff > 6) return { year: year - 1, month };
      return { year, month };
    }
  }
  return fallback;
}

// Year and month of a code built by buildReelCode, or null if it is not one.
export function reelCodeYearMonth(code: string): { year: number; month: number } | null {
  const m = /^[A-Z0-9]{2}-(\d{2})(\d{2})-/.exec(code);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: 2000 + Number(m[1]), month };
}

export function buildReelCode(
  pagePrefix: string,
  year: number,
  month: number,
  ordinal: number,
): string {
  const yy = String(year).slice(-2);
  const mm = String(month).padStart(2, '0');
  const nn = String(ordinal).padStart(2, '0');
  return `${pagePrefix.toUpperCase()}-${yy}${mm}-${nn}`;
}
