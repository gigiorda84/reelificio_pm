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
      const errUrl = url.clone();
      errUrl.pathname = '/login';
      errUrl.search = '';
      errUrl.searchParams.set('error', 'callback_failed');
      return NextResponse.redirect(errUrl);
    }
  }

  const dest = url.clone();
  dest.pathname = next.startsWith('/') ? next : `/${next}`;
  dest.search = '';
  return NextResponse.redirect(dest);
}
