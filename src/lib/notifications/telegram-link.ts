import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';

const SEPARATOR = '.';

function getSecret(): string {
  const s = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!s) throw new Error('TELEGRAM_WEBHOOK_SECRET missing');
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret())
    .update(payload)
    .digest('base64url')
    .slice(0, 24);
}

// HMAC-signed link token: `<userId>.<sig>`. Stateless — no DB column needed.
export function buildTelegramLinkToken(userId: string): string {
  return `${userId}${SEPARATOR}${sign(userId)}`;
}

export function verifyTelegramLinkToken(token: string): string | null {
  const [userId, sig] = token.split(SEPARATOR);
  if (!userId || !sig) return null;
  const expected = sign(userId);
  if (sig.length !== expected.length) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? userId : null;
}
