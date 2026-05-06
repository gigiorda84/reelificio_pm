'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import {
  ALL_PIPELINE_PHASES,
  RACI_ROLES,
  type PipelinePhase,
  type RaciRole,
} from '@/lib/reels/constants';

export type RaciActionResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_admin' | 'unknown'; message?: string };

const upsertSchema = z.object({
  page_id: z.string().uuid(),
  phase: z.enum(ALL_PIPELINE_PHASES),
  responsible: z.array(z.string().uuid()).default([]),
  approver: z.array(z.string().uuid()).default([]),
  consulted: z.array(z.string().uuid()).default([]),
  informed: z.array(z.string().uuid()).default([]),
});

async function ensureAdmin(): Promise<{ ok: true } | { ok: false }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { data } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();
  return data?.is_admin ? { ok: true } : { ok: false };
}

export async function upsertRaciRow(formData: FormData): Promise<RaciActionResult> {
  const admin = await ensureAdmin();
  if (!admin.ok) return { ok: false, error: 'not_admin' };

  const readUuidArray = (key: string): string[] =>
    formData
      .getAll(key)
      .map((v) => v.toString().trim())
      .filter((v) => v.length > 0);

  const parsed = upsertSchema.safeParse({
    page_id: formData.get('page_id')?.toString() ?? '',
    phase: (formData.get('phase')?.toString() ?? '') as PipelinePhase,
    responsible: readUuidArray('responsible'),
    approver: readUuidArray('approver'),
    consulted: readUuidArray('consulted'),
    informed: readUuidArray('informed'),
  });
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from('raci_configs')
    .upsert(parsed.data, { onConflict: 'page_id,phase' });
  if (error) return { ok: false, error: 'unknown', message: error.message };

  revalidatePath(`/pages/${parsed.data.page_id}`);
  return { ok: true };
}

export type RaciSnapshot = Record<PipelinePhase, Record<RaciRole, string[]>>;

export async function saveRaciSnapshot(
  pageId: string,
  snapshot: RaciSnapshot,
): Promise<RaciActionResult> {
  const admin = await ensureAdmin();
  if (!admin.ok) return { ok: false, error: 'not_admin' };

  const supabase = await getSupabaseServerClient();
  const rows = ALL_PIPELINE_PHASES.map((phase) => {
    const data = snapshot[phase] ?? {
      responsible: [],
      approver: [],
      consulted: [],
      informed: [],
    };
    return {
      page_id: pageId,
      phase,
      responsible: data.responsible ?? [],
      approver: data.approver ?? [],
      consulted: data.consulted ?? [],
      informed: data.informed ?? [],
    };
  });

  const { error } = await supabase
    .from('raci_configs')
    .upsert(rows, { onConflict: 'page_id,phase' });
  if (error) return { ok: false, error: 'unknown', message: error.message };

  revalidatePath(`/pages/${pageId}`);
  return { ok: true };
}

// Re-export so the role list is importable from the actions module.
export { RACI_ROLES };
