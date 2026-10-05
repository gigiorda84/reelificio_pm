'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { SLA_STEPS } from './production-constants';
import { pageInputSchema } from './schema';

export type PageActionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | 'invalid_input'
        | 'slug_taken'
        | 'code_prefix_taken'
        | 'not_admin'
        | 'unknown';
      fieldErrors?: Record<string, string>;
    };

function readFormData(formData: FormData) {
  return {
    name: formData.get('name')?.toString() ?? '',
    slug: formData.get('slug')?.toString() ?? '',
    code_prefix: formData.get('code_prefix')?.toString().toUpperCase() ?? '',
    description: (formData.get('description')?.toString() ?? '').trim() || null,
    buffer_threshold: formData.get('buffer_threshold')?.toString() ?? '3',
    active: formData.get('active') === 'on' || formData.get('active') === 'true',
  };
}

function fieldErrorsFromZod(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}

export async function createPage(formData: FormData): Promise<PageActionResult> {
  const parsed = pageInputSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const supabase = await getSupabaseServerClient();
  const { data: inserted, error } = await supabase
    .from('pages')
    .insert({
      name: parsed.data.name,
      slug: parsed.data.slug,
      code_prefix: parsed.data.code_prefix,
      description: parsed.data.description,
      buffer_threshold: parsed.data.buffer_threshold,
      active: parsed.data.active,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      // unique violation — figure out which constraint
      const msg = error.message.toLowerCase();
      if (msg.includes('code_prefix')) return { ok: false, error: 'code_prefix_taken' };
      if (msg.includes('slug')) return { ok: false, error: 'slug_taken' };
    }
    if (error.code === '42501' || error.message.toLowerCase().includes('row-level security')) {
      return { ok: false, error: 'not_admin' };
    }
    return { ok: false, error: 'unknown' };
  }

  revalidatePath('/pages');
  redirect(`/pages/${inserted.id}`);
}

export async function updatePage(
  id: string,
  formData: FormData,
): Promise<PageActionResult> {
  const parsed = pageInputSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_input',
      fieldErrors: fieldErrorsFromZod(parsed.error.issues),
    };
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from('pages')
    .update({
      name: parsed.data.name,
      slug: parsed.data.slug,
      code_prefix: parsed.data.code_prefix,
      description: parsed.data.description,
      buffer_threshold: parsed.data.buffer_threshold,
      active: parsed.data.active,
    })
    .eq('id', id);

  if (error) {
    if (error.code === '23505') {
      const msg = error.message.toLowerCase();
      if (msg.includes('code_prefix')) return { ok: false, error: 'code_prefix_taken' };
      if (msg.includes('slug')) return { ok: false, error: 'slug_taken' };
    }
    if (error.code === '42501' || error.message.toLowerCase().includes('row-level security')) {
      return { ok: false, error: 'not_admin' };
    }
    return { ok: false, error: 'unknown' };
  }

  revalidatePath(`/pages/${id}`);
  revalidatePath('/pages');
  return { ok: true, id };
}

// --- Production settings (Fase 1, admin) ---------------------------------

export type ProductionActionResult =
  | { ok: true }
  | {
      ok: false;
      error: 'invalid_input' | 'not_admin' | 'invalid_assignee' | 'same_person' | 'unknown';
    };

const optionalUuid = z.string().uuid().nullable();
const productionSchema = z.object({
  requires_scientific_validation: z.boolean(),
  dubber_titular_id: optionalUuid,
  dubber_reserve_id: optionalUuid,
  animator_titular_id: optionalUuid,
  animator_reserve_id: optionalUuid,
  validator_id: optionalUuid,
  approval_group_id: optionalUuid.optional(),
});

// Validation flag, titulars, reserves, validator and group, written directly
// (admin policy on pages). The role-fit trigger refuses a profile of the
// wrong kind; check constraints refuse titular = reserve and the same
// titular dubber and animator.
export async function updatePageProduction(
  pageId: string,
  input: z.infer<typeof productionSchema>,
): Promise<ProductionActionResult> {
  const parsed = productionSchema.safeParse(input);
  if (!z.string().uuid().safeParse(pageId).success || !parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from('pages')
    .update(parsed.data)
    .eq('id', pageId)
    .select('id');
  if (error) {
    if (error.message.includes('invalid_assignee')) return { ok: false, error: 'invalid_assignee' };
    if (error.code === '23514') return { ok: false, error: 'same_person' };
    return { ok: false, error: 'unknown' };
  }
  if (!data?.length) return { ok: false, error: 'not_admin' };
  revalidatePath(`/pages/${pageId}`);
  return { ok: true };
}

const slaChangeSchema = z.array(
  z.object({
    track: z.enum(['batch', 'express']),
    step: z.enum(SLA_STEPS),
    // null removes the page override (the global default applies again).
    minutes: z.number().int().positive().max(60 * 24 * 60).nullable(),
  }),
).max(SLA_STEPS.length * 2);

// Page SLA overrides, one set_sla_policy() call per changed cell. They apply
// to tasks created from now on.
export async function savePageSla(
  pageId: string,
  changes: z.infer<typeof slaChangeSchema>,
): Promise<ProductionActionResult> {
  const parsed = slaChangeSchema.safeParse(changes);
  if (!z.string().uuid().safeParse(pageId).success || !parsed.success) {
    return { ok: false, error: 'invalid_input' };
  }
  const supabase = await getSupabaseServerClient();
  for (const c of parsed.data) {
    const { data, error } = await supabase.rpc('set_sla_policy', {
      p_page_id: pageId,
      p_track: c.track,
      p_step: c.step,
      p_minutes: c.minutes,
    });
    if (error) return { ok: false, error: 'unknown' };
    if (data === 'not_authorized') return { ok: false, error: 'not_admin' };
    if (data !== 'ok') return { ok: false, error: 'invalid_input' };
  }
  revalidatePath(`/pages/${pageId}`);
  return { ok: true };
}

// Approver and delegate of a group (internals only; absence moves the open
// approvals, these do not).
export async function saveApprovalGroup(
  groupId: string,
  approverId: string | null,
  delegateId: string | null,
): Promise<ProductionActionResult> {
  const ids = z.tuple([z.string().uuid(), optionalUuid, optionalUuid]);
  if (!ids.safeParse([groupId, approverId, delegateId]).success) {
    return { ok: false, error: 'invalid_input' };
  }
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc('set_approval_group', {
    p_group_id: groupId,
    p_approver: approverId,
    p_delegate: delegateId,
  });
  if (error) return { ok: false, error: 'unknown' };
  if (data === 'not_authorized') return { ok: false, error: 'not_admin' };
  if (data === 'invalid_assignee') return { ok: false, error: 'invalid_assignee' };
  if (data === 'invalid_input') {
    return { ok: false, error: approverId && approverId === delegateId ? 'same_person' : 'invalid_input' };
  }
  revalidatePath('/settings');
  return { ok: true };
}
