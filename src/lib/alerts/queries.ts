import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { AlertRow, AlertStatus } from './types';

export type AlertWithRefs = AlertRow & {
  page_name: string | null;
  page_code_prefix: string | null;
  reel_code: string | null;
  reel_title: string | null;
  closed_by_name: string | null;
};

export async function listAlerts(status: AlertStatus = 'open'): Promise<AlertWithRefs[]> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from('alerts')
    .select(`
      id, kind, dedup_key, page_id, reel_id, phase, payload, status,
      opened_at, last_seen_at, closed_at, closed_by, proposed_solution,
      created_at, updated_at,
      page:pages(name, code_prefix),
      reel:reels(code, title),
      closer:profiles!alerts_closed_by_fkey(full_name, email)
    `)
    .eq('status', status)
    .order('opened_at', { ascending: false })
    .limit(200);

  type Row = AlertRow & {
    page: { name: string; code_prefix: string } | null;
    reel: { code: string; title: string } | null;
    closer: { full_name: string | null; email: string } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    ...r,
    page_name: r.page?.name ?? null,
    page_code_prefix: r.page?.code_prefix ?? null,
    reel_code: r.reel?.code ?? null,
    reel_title: r.reel?.title ?? null,
    closed_by_name: r.closer?.full_name ?? r.closer?.email ?? null,
  }));
}

export async function countOpenAlerts(): Promise<number> {
  const supabase = await getSupabaseServerClient();
  const { count } = await supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');
  return count ?? 0;
}
