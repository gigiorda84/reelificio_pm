import { getSupabaseServerClient } from '@/lib/supabase/server';

export type ProfileLite = {
  id: string;
  email: string;
  full_name: string | null;
};

export async function listProfiles(): Promise<ProfileLite[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .order('full_name', { ascending: true, nullsFirst: false })
    .order('email', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ProfileLite[];
}
