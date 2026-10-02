import type { NextRequest } from 'next/server';
import { canAccessSpike } from '@/lib/spike/access';

// S0: a deliberate server error to check that Sentry receives it (with the
// email in the message redacted by beforeSend). Admin session, or a signed
// link from `scripts/spike-sign.ts <base> sentry test` for a Preview.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await canAccessSpike(req, 'sentry', 'test'))) {
    return new Response('unauthorized', { status: 401 });
  }
  throw new Error('Sentry S0 test (server) for test.user@example.com');
}
