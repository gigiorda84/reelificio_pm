import { getSupabaseServerClient } from '@/lib/supabase/server';
import { ROLE_FIELDS, SLA_STEPS, type RoleField, type SlaStep, type SlaTrack } from './production-constants';

// Production settings of a page (docs/fase1-plan.md §S3): validation flag,
// titular and reserve workers, validator, SLA overrides, approval group.
// Internal-only data (RLS), edited by admins.

export type PageProduction = {
  requires_scientific_validation: boolean;
  approval_group_id: string | null;
} & Record<RoleField, string | null>;

export type SlaCell = {
  track: SlaTrack;
  step: SlaStep;
  defaultMinutes: number | null;
  pageMinutes: number | null;
};

export type ApprovalGroup = {
  id: string;
  name: string;
  approver_id: string | null;
  delegate_id: string | null;
  is_default: boolean;
};

export async function getPageProduction(pageId: string): Promise<PageProduction | null> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('pages')
    .select(`requires_scientific_validation, approval_group_id, ${ROLE_FIELDS.join(', ')}`)
    .eq('id', pageId)
    .maybeSingle();
  if (error) throw error;
  return (data as PageProduction | null) ?? null;
}

// Every (track, step) with the global default and this page's override.
export async function getPageSla(pageId: string): Promise<SlaCell[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('sla_policies')
    .select('page_id, track, step, minutes')
    .or(`page_id.is.null,page_id.eq.${pageId}`);
  if (error) throw error;
  const key = (track: string, step: string) => `${track}:${step}`;
  const defaults = new Map<string, number>();
  const overrides = new Map<string, number>();
  for (const r of data ?? []) {
    (r.page_id ? overrides : defaults).set(key(r.track, r.step), r.minutes);
  }
  return (['batch', 'express'] as const).flatMap((track) =>
    SLA_STEPS.map((step) => ({
      track,
      step,
      defaultMinutes: defaults.get(key(track, step)) ?? null,
      pageMinutes: overrides.get(key(track, step)) ?? null,
    })),
  );
}

export async function listApprovalGroups(): Promise<ApprovalGroup[]> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('approval_groups')
    .select('id, name, approver_id, delegate_id, is_default')
    .order('is_default', { ascending: false })
    .order('name');
  if (error) throw error;
  return (data ?? []) as ApprovalGroup[];
}
