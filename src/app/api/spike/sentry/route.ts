import { getAdminStatus } from '@/lib/auth/admin';

// S0: a deliberate server error to check that Sentry receives it (with the
// email in the message redacted by beforeSend).
export const dynamic = 'force-dynamic';

export async function GET() {
  const { isAdmin } = await getAdminStatus();
  if (!isAdmin) return new Response('unauthorized', { status: 401 });
  throw new Error('Sentry S0 test (server) for test.user@example.com');
}
