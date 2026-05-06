import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  ALL_PIPELINE_PHASES,
  type PipelinePhase,
  type RaciRole,
} from '@/lib/reels/constants';

export type RaciRow = {
  page_id: string;
  phase: PipelinePhase;
  responsible: string[];
  approver: string[];
  consulted: string[];
  informed: string[];
};

export async function getRaciConfigForPage(pageId: string): Promise<RaciRow[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('raci_configs')
    .select('page_id, phase, responsible, approver, consulted, informed')
    .eq('page_id', pageId);
  if (error) throw error;

  const byPhase = new Map<string, RaciRow>();
  for (const row of (data ?? []) as RaciRow[]) byPhase.set(row.phase, row);

  // Ensure every phase is represented (empty rows for unconfigured phases).
  return ALL_PIPELINE_PHASES.map(
    (phase) =>
      byPhase.get(phase) ?? {
        page_id: pageId,
        phase,
        responsible: [],
        approver: [],
        consulted: [],
        informed: [],
      },
  );
}

export function getRaciUsers(row: RaciRow, role: RaciRole): string[] {
  switch (role) {
    case 'responsible':
      return row.responsible ?? [];
    case 'approver':
      return row.approver ?? [];
    case 'consulted':
      return row.consulted ?? [];
    case 'informed':
      return row.informed ?? [];
  }
}

export async function userHasRaciRole(
  pageId: string,
  phase: PipelinePhase,
  userId: string,
  role: RaciRole,
): Promise<boolean> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from('raci_configs')
    .select('responsible, approver, consulted, informed')
    .eq('page_id', pageId)
    .eq('phase', phase)
    .maybeSingle();
  if (!data) return false;
  const list = getRaciUsers(data as RaciRow, role);
  return list.includes(userId);
}
