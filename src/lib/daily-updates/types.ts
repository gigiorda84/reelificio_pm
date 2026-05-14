export type DailyUpdateRow = {
  id: string;
  user_id: string;
  date: string; // YYYY-MM-DD
  did_today: string;
  blockers: string | null;
  tomorrow: string | null;
  created_at: string;
  updated_at: string;
};

export type DailyUpdateWithAuthor = DailyUpdateRow & {
  author_name: string | null;
  author_email: string | null;
};

// Returns today's date in Europe/Rome as YYYY-MM-DD. The team is Italy-based;
// using a fixed civil calendar avoids cross-midnight surprises when the
// servers run in UTC.
export function todayIsoInRome(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

export function isoDaysAgoInRome(days: number, now: Date = new Date()): string {
  const ref = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return todayIsoInRome(ref);
}
