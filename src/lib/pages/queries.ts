import { getSupabaseServerClient } from '@/lib/supabase/server';

export type PageRow = {
  id: string;
  slug: string;
  name: string;
  code_prefix: string;
  description: string | null;
  buffer_threshold: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export async function listPages(): Promise<PageRow[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('pages')
    .select(
      'id, slug, name, code_prefix, description, buffer_threshold, active, created_at, updated_at',
    )
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as PageRow[];
}

export async function getPage(id: string): Promise<PageRow | null> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('pages')
    .select(
      'id, slug, name, code_prefix, description, buffer_threshold, active, created_at, updated_at',
    )
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return (data as PageRow) ?? null;
}
