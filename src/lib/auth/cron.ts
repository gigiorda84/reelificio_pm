import 'server-only';
import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';

// Cron routes are public paths (see proxy.ts); this is their only gate.
// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` automatically.
// The secret is accepted only in that header, never as a query param, so it
// can't leak into request logs or browser history. For a manual run:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/<job>
export function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get('authorization') ?? '');
  const b = Buffer.from(`Bearer ${secret}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
