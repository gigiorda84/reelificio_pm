import { createHash, createHmac, timingSafeEqual } from 'crypto';

// S0 spike only. Signed links open the spike pages with no app session
// (iPhone Safari, Telegram in-app browser, Vercel Preview). The key is
// derived from the Drive service-account key, which every environment that
// runs the spike already has, so no new secret needs configuring and links
// can be signed locally by scripts/spike-sign.ts.

export type SpikePurpose = 'media' | 'upload' | 'sentry';

function key(): Buffer {
  const pem = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!pem) throw new Error('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY missing');
  return createHash('sha256').update(`reelificio-spike-s0:${pem}`).digest();
}

function mac(purpose: SpikePurpose, id: string, exp: number): string {
  return createHmac('sha256', key()).update(`${purpose}:${id}:${exp}`).digest('base64url');
}

export function signSpike(purpose: SpikePurpose, id: string, ttlSeconds = 24 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `exp=${exp}&sig=${mac(purpose, id, exp)}`;
}

export function verifySpike(
  purpose: SpikePurpose,
  id: string,
  exp: string | null,
  sig: string | null,
): boolean {
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || expNum < Date.now() / 1000) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(purpose, id, expNum));
  return a.length === b.length && timingSafeEqual(a, b);
}
