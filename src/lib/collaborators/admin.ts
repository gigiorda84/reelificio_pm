import type { SupabaseClient } from '@supabase/supabase-js';

// External collaborator accounts (docs/fase1-plan.md §S1, release step 6b).
// Used by scripts/fase1-collaborators.ts with a service-role client and an
// explicit acting admin; the admin UI (later) must check the session's
// is_admin before calling these with a service-role client.

export const EXTERNAL_KINDS = ['dubber', 'animator', 'validator'] as const;
export type ExternalKind = (typeof EXTERNAL_KINDS)[number];

export type CollaboratorRow = {
  email: string;
  full_name: string;
  external_kind: ExternalKind;
  drive_email: string | null;
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HEADER = ['email', 'full_name', 'external_kind', 'drive_email'];

// RFC 4180-ish: commas, double quotes, "" inside quotes. One record per line.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCollaboratorsCsv(text: string): { rows: CollaboratorRow[]; errors: string[] } {
  // Keep the file's own line numbers for the error messages.
  const lines = text
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.trim() && !line.trim().startsWith('#'));
  const errors: string[] = [];
  const rows: CollaboratorRow[] = [];
  if (lines.length === 0) return { rows, errors: ['empty file'] };

  const header = splitCsvLine(lines[0].line).map((h) => h.toLowerCase());
  if (header.join(',') !== HEADER.join(',')) {
    return { rows, errors: [`header must be: ${HEADER.join(',')}`] };
  }

  const seen = new Set<string>();
  lines.slice(1).forEach(({ line, n }) => {
    const [email, fullName, kind, drive] = splitCsvLine(line);
    const e = (email ?? '').toLowerCase();
    if (!EMAIL_RE.test(e)) return errors.push(`line ${n}: bad email "${email ?? ''}"`);
    if (seen.has(e)) return errors.push(`line ${n}: duplicate email ${e}`);
    seen.add(e);
    if (!fullName) return errors.push(`line ${n}: full_name missing`);
    if (!EXTERNAL_KINDS.includes(kind as ExternalKind)) {
      return errors.push(`line ${n}: external_kind must be ${EXTERNAL_KINDS.join('|')}`);
    }
    const d = (drive ?? '').toLowerCase();
    if (d && !EMAIL_RE.test(d)) return errors.push(`line ${n}: bad drive_email "${drive}"`);
    rows.push({ email: e, full_name: fullName, external_kind: kind as ExternalKind, drive_email: d || null });
  });
  return { rows, errors };
}

export type ExistingProfile = {
  id: string;
  email: string;
  account_type: 'internal' | 'external';
  is_admin: boolean;
};

export type PlanItem =
  | { action: 'create'; row: CollaboratorRow }
  | { action: 'update'; row: CollaboratorRow; profileId: string }
  | { action: 'convert'; row: CollaboratorRow; profileId: string }
  | { action: 'refuse'; row: CollaboratorRow; profileId: string; reason: string };

// What import would do for each row. An existing internal profile is refused
// unless it was reviewed as "actually external" (--convert-existing, I11);
// an admin is always refused.
export function planImport(
  rows: CollaboratorRow[],
  existing: Map<string, ExistingProfile>,
  opts: { convertExisting: boolean },
): PlanItem[] {
  return rows.map((row) => {
    const p = existing.get(row.email);
    if (!p) return { action: 'create', row };
    if (p.account_type === 'external') return { action: 'update', row, profileId: p.id };
    if (p.is_admin) return { action: 'refuse', row, profileId: p.id, reason: 'is an admin' };
    if (!opts.convertExisting) {
      return { action: 'refuse', row, profileId: p.id, reason: 'is internal (use --convert-existing after review)' };
    }
    return { action: 'convert', row, profileId: p.id };
  });
}

export async function loadExistingProfiles(
  admin: SupabaseClient,
  emails: string[],
): Promise<Map<string, ExistingProfile>> {
  const out = new Map<string, ExistingProfile>();
  if (emails.length === 0) return out;
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, account_type, is_admin')
    .in('email', emails);
  if (error) throw new Error(`profiles: ${error.message}`);
  for (const p of (data ?? []) as ExistingProfile[]) out.set(p.email.toLowerCase(), p);
  return out;
}

async function setCollaborator(
  admin: SupabaseClient,
  actorId: string,
  userId: string,
  row: CollaboratorRow,
): Promise<void> {
  const { data, error } = await admin.rpc('set_collaborator_as', {
    p_actor: actorId,
    p_user: userId,
    p_account_type: 'external',
    p_external_kind: row.external_kind,
    p_drive_email: row.drive_email,
    p_full_name: row.full_name,
  });
  if (error) throw new Error(`set_collaborator_as ${row.email}: ${error.message}`);
  if (data !== 'ok') throw new Error(`set_collaborator_as ${row.email}: ${data}`);
}

// Applies a plan with no `refuse` items. Returns the profile id per email.
export async function applyImport(
  admin: SupabaseClient,
  actorId: string,
  plan: PlanItem[],
): Promise<Map<string, string>> {
  if (plan.some((p) => p.action === 'refuse')) throw new Error('plan has refused rows');
  const ids = new Map<string, string>();
  for (const item of plan) {
    let userId: string;
    if (item.action === 'create') {
      const { data, error } = await admin.auth.admin.createUser({
        email: item.row.email,
        email_confirm: true,
        app_metadata: { account_type: 'external' },
        user_metadata: { full_name: item.row.full_name },
      });
      if (error || !data.user) throw new Error(`createUser ${item.row.email}: ${error?.message}`);
      userId = data.user.id;
    } else if (item.action === 'update' || item.action === 'convert') {
      userId = item.profileId;
    } else {
      continue;
    }
    // Explicit even for new users: GoTrue may write app_metadata after the
    // insert that creates the profile (I14).
    await setCollaborator(admin, actorId, userId, item.row);
    if (item.action === 'convert') {
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      if (error) throw new Error(`unban ${item.row.email}: ${error.message}`);
    }
    ids.set(item.row.email, userId);
  }
  return ids;
}

// Deactivates the profile and bans the auth user (~100 years).
export async function offboardCollaborator(
  admin: SupabaseClient,
  actorId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await admin.rpc('offboard_collaborator_as', {
    p_actor: actorId,
    p_user: userId,
  });
  if (error) throw new Error(`offboard_collaborator_as: ${error.message}`);
  if (data !== 'ok') throw new Error(`offboard_collaborator_as: ${data}`);
  const ban = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
  if (ban.error) throw new Error(`ban: ${ban.error.message}`);
}
