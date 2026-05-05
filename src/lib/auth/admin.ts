'use server';

import { revalidatePath } from 'next/cache';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export type AdminStatus = {
  isAdmin: boolean;
  hasAnyAdmin: boolean;
  userId: string | null;
};

export async function getAdminStatus(): Promise<AdminStatus> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { isAdmin: false, hasAnyAdmin: false, userId: null };
  }

  const { data: rows, error } = await supabase
    .from('profiles')
    .select('id, is_admin')
    .eq('is_admin', true);

  if (error) {
    return { isAdmin: false, hasAnyAdmin: false, userId: user.id };
  }

  const hasAnyAdmin = (rows?.length ?? 0) > 0;
  const isAdmin = !!rows?.some((r) => r.id === user.id);
  return { isAdmin, hasAnyAdmin, userId: user.id };
}

export type ClaimAdminResult =
  | { ok: true }
  | { ok: false; error: 'not_authenticated' | 'admin_already_exists' | 'unknown' };

// Promote the current user to admin only if no admins exist yet. Idempotent
// and safe to expose to any signed-in user — once any admin is created the
// action becomes a no-op.
export async function claimAdminIfFirst(): Promise<ClaimAdminResult> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { ok: false, error: 'not_authenticated' };

  const { count } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('is_admin', true);

  if ((count ?? 0) > 0) {
    return { ok: false, error: 'admin_already_exists' };
  }

  // The RLS update policy only lets a profile update itself — perfect: the
  // user promoting themselves is the same row they're authorised to update.
  const { error } = await supabase
    .from('profiles')
    .update({ is_admin: true })
    .eq('id', user.id);

  if (error) return { ok: false, error: 'unknown' };

  revalidatePath('/', 'layout');
  return { ok: true };
}
