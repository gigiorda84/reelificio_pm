import type { SupabaseClient } from '@supabase/supabase-js';

// Who may receive internal broadcasts (weekly digest, daily reminder) and
// mention notifications. External collaborators get neither broadcasts nor
// mentions they cannot see.
//
// Column-tolerant on purpose: this file ships before the Fase 1 migration
// (deployment `fase1-pre-r1`, the code rollback target in docs/fase1-plan.md
// §6), when `profiles` has no `account_type` or `deactivated_at` yet and
// every profile is internal.

export type ProfileLike = {
  id: string;
  account_type?: string | null;
  deactivated_at?: string | null;
};

export function isActiveInternal(p: ProfileLike): boolean {
  return p.account_type !== 'external' && !p.deactivated_at;
}

// `*`, not a column list: naming the Fase 1 columns would fail before the
// migration, and omitting them would let external profiles through after it.
export async function internalProfiles<T extends ProfileLike>(
  supabase: SupabaseClient,
): Promise<T[]> {
  const { data, error } = await supabase.from('profiles').select('*');
  if (error) throw new Error(`profiles: ${error.message}`);
  return ((data ?? []) as T[]).filter(isActiveInternal);
}

// Mentioned users who get a notification: never the author, never a
// deactivated profile; an external only when the comment is not
// `internal_only` and they can see the target (an open or recent task on
// the reel).
export function mentionRecipients(args: {
  authorId: string;
  mentioned: ProfileLike[];
  internalOnly: boolean;
  externalsWhoSeeTarget: ReadonlySet<string>;
}): string[] {
  const out = new Set<string>();
  for (const p of args.mentioned) {
    if (p.id === args.authorId || p.deactivated_at) continue;
    if (p.account_type === 'external') {
      if (args.internalOnly || !args.externalsWhoSeeTarget.has(p.id)) continue;
    }
    out.add(p.id);
  }
  return [...out];
}

const OPEN = ['unassigned', 'assigned', 'in_progress'];
const OUTCOME = ['delivered', 'approved', 'sent_back'];
const RECENT_MS = 7 * 24 * 3600 * 1000;

export type TaskLike = { assignee_id: string | null; status: string; closed_at: string | null };

// Mirrors public.visible_reel_ids() for notification targeting (RLS stays the
// authority on access): an open task, or one closed with an outcome in the
// last 7 days. Declined, expired and cancelled tasks give nothing.
export function taskGrantsVisibility(t: TaskLike, now: Date = new Date()): boolean {
  if (OPEN.includes(t.status)) return true;
  if (!OUTCOME.includes(t.status) || !t.closed_at) return false;
  return now.getTime() - Date.parse(t.closed_at) < RECENT_MS;
}
