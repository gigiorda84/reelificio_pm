import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/dashboard';

  const dest = url.clone();
  dest.pathname = next.startsWith('/') ? next : `/${next}`;
  dest.search = '';

  let response = NextResponse.redirect(dest);

  if (code) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              response.cookies.set(name, value, options);
            });
          },
        },
      },
    );

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
      const errResponse = NextResponse.redirect(errUrl);
      // Preserve any cookies supabase already set (e.g. cleared PKCE verifier).
      response.cookies.getAll().forEach((c) => errResponse.cookies.set(c));
      response = errResponse;
    }
  }

  return response;
}
