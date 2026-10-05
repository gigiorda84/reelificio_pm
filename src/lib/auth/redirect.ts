import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Shared by the auth routes (/auth/callback, /auth/confirm), which set the
// session cookies straight on the redirect response: Next.js 16 Route
// Handlers don't reliably carry cookies() writes onto a hand-built redirect.

// Only a same-origin path: never `//host`, a full URL or a backslash (the
// URL parser reads `/\host` as `//host`).
export function safeNextPath(raw: string | null): string {
  return raw && /^\/(?![/\\])[^\s\\]*$/.test(raw) ? raw : '/compiti';
}

// `path` comes from safeNextPath (it may carry a query, e.g. ?task=).
export function redirectTo(request: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, request.nextUrl.origin));
}

// A Supabase client whose cookie writes land on `response`.
export function clientWritingTo(request: NextRequest, response: NextResponse) {
  return createServerClient(
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
}

// Back to /login with the reason, keeping any cookie Supabase already set
// (e.g. a cleared PKCE verifier).
export function loginError(request: NextRequest, response: NextResponse, detail: string): NextResponse {
  const errUrl = request.nextUrl.clone();
  errUrl.pathname = '/login';
  errUrl.search = '';
  errUrl.searchParams.set('error', 'callback_failed');
  errUrl.searchParams.set('detail', detail.slice(0, 160));
  const errResponse = NextResponse.redirect(errUrl);
  response.cookies.getAll().forEach((c) => errResponse.cookies.set(c));
  return errResponse;
}
