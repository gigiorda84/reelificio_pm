// Reel code: <PAGE_PREFIX>-YYMM-NN. The YYMM is the *batch* month (extracted
// from the batch label when possible, else the current month), so re-syncs
// produce stable codes.

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

export function detectBatchYearMonth(
  label: string | null,
  now = new Date(),
): { year: number; month: number } {
  const fallback = { year: now.getFullYear(), month: now.getMonth() + 1 };
  if (!label) return fallback;
  const lower = label.toLowerCase();
  for (const [name, num] of Object.entries(ITALIAN_MONTHS)) {
    if (lower.includes(name)) {
      return { year: now.getFullYear(), month: num };
    }
  }
  return fallback;
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
