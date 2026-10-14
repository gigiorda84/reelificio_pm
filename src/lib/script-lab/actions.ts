'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { BLOCKS } from './mix';

// Mix and restore (docs/fase2-plan.md D-E, AC16–17). Both SQL functions run
// as the user, check bozza, the revision and who may compose, and record the
// version; these actions validate the shape and map the code.

export type ScriptLabActionResult =
  | { ok: true }
  | { ok: false; error: 'invalid_input' | 'not_authorized' | 'stale' | 'invalid_state' | 'unknown' };

const CODES = ['invalid_input', 'not_authorized', 'stale', 'invalid_state'] as const;
const uuid = z.string().uuid();
const overridesSchema = z.partialRecord(z.enum(BLOCKS), uuid);

async function call(fn: string, args: Record<string, unknown>, reelId: string): Promise<ScriptLabActionResult> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501') return { ok: false, error: 'not_authorized' };
    console.error(`[script-lab] ${fn} failed`, error.code);
    return { ok: false, error: 'unknown' };
  }
  if (data !== 'ok') {
    return { ok: false, error: (CODES as readonly string[]).includes(data) ? (data as (typeof CODES)[number]) : 'unknown' };
  }
  revalidatePath(`/reels/${reelId}`);
  return { ok: true };
}

export async function applyScriptVersion(
  reelId: string,
  baseId: string,
  overrides: Partial<Record<(typeof BLOCKS)[number], string>>,
  expectedRev: number,
): Promise<ScriptLabActionResult> {
  if (!uuid.safeParse(reelId).success || !uuid.safeParse(baseId).success || !Number.isInteger(expectedRev)) {
    return { ok: false, error: 'invalid_input' };
  }
  const parsed = overridesSchema.safeParse(overrides);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  return call(
    'apply_script_version',
    { p_reel_id: reelId, p_base: baseId, p_blocks: parsed.data, p_expected_rev: expectedRev },
    reelId,
  );
}

export async function restoreScriptVersion(
  reelId: string,
  versionId: string,
  expectedRev: number,
): Promise<ScriptLabActionResult> {
  if (!uuid.safeParse(reelId).success || !uuid.safeParse(versionId).success || !Number.isInteger(expectedRev)) {
    return { ok: false, error: 'invalid_input' };
  }
  return call(
    'restore_script_version',
    { p_reel_id: reelId, p_version_id: versionId, p_expected_rev: expectedRev },
    reelId,
  );
}
