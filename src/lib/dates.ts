// Dates shown to people are Rome time whatever the server's zone (UTC on
// Vercel), and the same on server and client, so no hydration mismatch.
// Batch deadlines are computed on Rome wall-clock time in SQL.
export function formatRome(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
): string {
  return new Date(value).toLocaleString('it-IT', { ...options, timeZone: 'Europe/Rome' });
}
