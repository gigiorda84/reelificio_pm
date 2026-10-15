import { romeParts } from '@/lib/dates';

// The period of the Script Lab metrics page (docs/fase2-plan.md S7): the
// last N calendar months in Rome, the current one included, as the
// [from, to) dates script_lab_metrics takes, plus the months in order.

export const PERIOD_CHOICES = [3, 6, 12] as const;
export type PeriodChoice = (typeof PERIOD_CHOICES)[number];
const DEFAULT_PERIOD: PeriodChoice = 6;

// Rimandi: at most 1 reel in 5 sent back (AC22).
export const SENDBACK_TARGET = 0.2;

export function parsePeriod(raw: string | string[] | undefined): PeriodChoice {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (PERIOD_CHOICES as readonly number[]).includes(n) ? (n as PeriodChoice) : DEFAULT_PERIOD;
}

const ym = (index: number) => {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
};

// `to` also takes in next month: batches are prepared for the month after
// (their month is the batch's, not a timestamp), and the other sections
// can't have anything there yet.
export function metricsPeriod(
  months: number,
  now: Date,
): { from: string; to: string; months: string[]; next: string } {
  const [y, m] = romeParts(now).date.split('-').map(Number);
  const current = y * 12 + (m - 1);
  const first = current - months + 1;
  return {
    from: `${ym(first)}-01`,
    to: `${ym(current + 2)}-01`,
    months: Array.from({ length: months }, (_, i) => ym(first + i)),
    next: ym(current + 1),
  };
}

// "2026-10" → "ott 2026".
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('it-IT', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    Date.UTC(y, m - 1, 1),
  );
}

// part / total, or null when there is nothing to divide.
export function share(part: number, total: number): number | null {
  return total > 0 ? part / total : null;
}
