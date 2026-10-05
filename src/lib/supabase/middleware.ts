import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/auth/callback',
  '/auth/confirm',
  '/invite',
  '/api/telegram/webhook',
  '/api/cron',
];

// Where everyone lands: the open tasks of the signed-in user.
export const HOME = '/compiti';

const EXTERNAL_PATHS = [
  /^\/compiti(\/|$)/,
  /^\/reels\/[^/]+$/,
  /^\/settings(\/|$)/,
  /^\/auth\//,
];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touching getUser() refreshes the session and writes back updated cookies
  // via setAll. Do not remove this call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === '/login') {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = HOME;
    homeUrl.search = '';
    return NextResponse.redirect(homeUrl);
  }

  // External collaborators only reach their tasks, the reels of those tasks
  // and their settings (RLS already hides everything else; this keeps them
  // off pages built for internals). Server Components check again.
  if (user && !isPublic && !EXTERNAL_PATHS.some((re) => re.test(pathname))) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_type')
      .eq('id', user.id)
      .maybeSingle();
    if (profile?.account_type === 'external') {
      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = HOME;
      homeUrl.search = '';
      return NextResponse.redirect(homeUrl);
    }
  }

  return response;
}
