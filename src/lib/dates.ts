// Dates shown to people are Rome time whatever the server's zone (UTC on
// Vercel), and the same on server and client, so no hydration mismatch.
// Batch deadlines are computed on Rome wall-clock time in SQL.
export function formatRome(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'short', timeStyle: 'short' },
): string {
  return new Date(value).toLocaleString('it-IT', { ...options, timeZone: 'Europe/Rome' });
}

// Calendar fields of an instant in Rome.
export function romeParts(at: Date): { date: string; hour: number; minute: number; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday,
  };
}
