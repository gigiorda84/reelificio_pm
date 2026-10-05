import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export type Viewer = {
  userId: string;
  isAdmin: boolean;
  isExternal: boolean;
};

// The signed-in user from their own profile row (RLS lets everyone read it),
// once per request.
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('is_admin, account_type')
    .eq('id', user.id)
    .maybeSingle();
  return {
    userId: user.id,
    isAdmin: !!data?.is_admin,
    isExternal: data?.account_type === 'external',
  };
});

// Pages built for internals. src/proxy.ts already sends externals home; this
// is the second check (RLS stays the authority on data).
export async function requireInternal(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  if (viewer.isExternal) redirect('/compiti');
  return viewer;
}
