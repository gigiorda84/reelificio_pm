import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession failed:', {
        message: error.message,
        status: error.status,
        name: error.name,
      });
      const errUrl = url.clone();
      errUrl.pathname = '/login';
      errUrl.search = '';
      errUrl.searchParams.set('error', 'callback_failed');
      errUrl.searchParams.set('detail', error.message.slice(0, 160));
      return NextResponse.redirect(errUrl);
    }
  }

  const dest = url.clone();
  dest.pathname = next.startsWith('/') ? next : `/${next}`;
  dest.search = '';
  return NextResponse.redirect(dest);
}
