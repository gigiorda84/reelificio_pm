import type { NextRequest } from 'next/server';
import { clientWritingTo, loginError, redirectTo, safeNextPath } from '@/lib/auth/redirect';

// PKCE magic links: they only work in the browser that asked for them. New
// emails point to /auth/confirm (any browser); this stays for links already
// sent.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const response = redirectTo(request, safeNextPath(request.nextUrl.searchParams.get('next')));
  if (!code) return response;

  const supabase = clientWritingTo(request, response);
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[auth/callback] exchangeCodeForSession failed:', {
      message: error.message,
      status: error.status,
      name: error.name,
    });
    return loginError(request, response, error.message);
  }
  return response;
}
