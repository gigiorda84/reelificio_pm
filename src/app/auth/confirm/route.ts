import type { EmailOtpType } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { clientWritingTo, loginError, redirectTo, safeNextPath } from '@/lib/auth/redirect';

// Magic link valid in any browser (docs/fase1-plan.md I15): the email
// carries a token hash verified here on the server, so the login does not
// depend on a PKCE verifier saved in the browser that asked for the link
// (an external opening it from the Mail app or the phone).
const TYPES: readonly EmailOtpType[] = ['email', 'magiclink', 'signup', 'invite'];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;
  const response = redirectTo(request, safeNextPath(params.get('next')));
  if (!tokenHash || !type || !TYPES.includes(type)) {
    return loginError(request, response, 'link non valido');
  }

  const supabase = clientWritingTo(request, response);
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    console.error('[auth/confirm] verifyOtp failed:', {
      message: error.message,
      status: error.status,
      name: error.name,
    });
    return loginError(request, response, error.message);
  }
  return response;
}
