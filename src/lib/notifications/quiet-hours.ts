// Batch notifications between 20:00 and 08:00 (Europe/Rome) arrive without
// sound (Telegram disable_notification); Express always rings
// (docs/fase1-plan.md §3, "Notifiche notturne"). Nothing is postponed.

const ROME_HOUR = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome',
  hour: '2-digit',
  hourCycle: 'h23',
});

export function romeHour(at: Date): number {
  return Number(ROME_HOUR.format(at));
}

export function isQuietHour(at: Date, track: 'batch' | 'express'): boolean {
  if (track === 'express') return false;
  const h = romeHour(at);
  return h >= 20 || h < 8;
}
