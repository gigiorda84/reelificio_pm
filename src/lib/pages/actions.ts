'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase/server';
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
