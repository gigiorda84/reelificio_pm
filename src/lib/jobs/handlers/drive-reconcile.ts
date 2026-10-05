import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  createPermission,
  deletePermission,
  DriveApiError,
  findByTag,
  getFile,
  listPermissions,
  moveFile,
  serviceAccountEmail,
  trashFile,
  uploadText,
} from '@/lib/drive/api';
import { driveState, ensureFolder, ensureReelFolder, type DriveState } from '@/lib/drive/folders';
import { audioLinkText, scriptKitText } from '@/lib/drive/kit';
import { ARCHIVE_FOLDER, audioLinkFileName, scriptFileName } from '@/lib/drive/naming';
import { planShares } from '@/lib/drive/reconcile-plan';
import { PermanentJobError, type ClaimedJob } from '../notify';

// The one Drive job, drive_reconcile(reel) (docs/fase1-plan.md §S5). It reads
// the desired state once and converges, always in the same order:
// 1. the folder chain (each id saved right after it is created);
// 2. the kit, from animazione on: the script as <code>_script_v<n>.txt (and
//    the link of a legacy kit), when its hash changed;
// 3. archivio/: superseded versions, the old kit included — before the
//    animator hears of the new kit;
// 4. shares: the external holders of an in-progress dubbing or animation
//    task as reader, every other direct permission revoked;
// 5. mark_drive_reconciled(): kit hash, kit_ready_at, the waiting animation.
// With Drive switched off (an incident) the job still runs for a folder that
// is shared with someone, and only revokes what the tasks no longer want.
// Idempotent: a second run, or one after a crash, finds what the first did.
// A change while it runs raises the job's generation and it runs again.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ evt: 'drive_reconcile', ...fields }));
}

async function rpc<T>(admin: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

// Writes the kit files missing for the current hash. true when something was
// written (the archive list has changed).
async function writeKit(admin: SupabaseClient, s: DriveState, folderId: string): Promise<boolean> {
  const kit = s.kit!;
  const parts: { kind: 'script' | 'other'; version: number; name: string; text: string }[] = [
    {
      kind: 'script',
      version: kit.next_version.script,
      name: scriptFileName(s.reel.code, kit.next_version.script),
      text: scriptKitText({ code: s.reel.code, title: s.reel.title, version: kit.next_version.script, script: kit.script }),
    },
  ];
  if (kit.audio_url) {
    parts.push({
      kind: 'other',
      version: kit.next_version.other,
      name: audioLinkFileName(s.reel.code),
      text: audioLinkText({ code: s.reel.code, url: kit.audio_url }),
    });
  }

  let wrote = false;
  for (const part of parts) {
    if (kit.files.some((f) => f.kind === part.kind && f.kit_hash === kit.hash)) continue;
    const tag = `kit:${part.kind}:${kit.hash}`;
    let file = await findByTag(folderId, tag);
    const created = !file;
    if (!file) file = await uploadText({ name: part.name, parentId: folderId, tag, text: part.text });
    const code = await rpc<string>(admin, 'register_kit_file', {
      p_reel_id: s.reel.id,
      p_kind: part.kind,
      p_version: part.version,
      p_drive_file_id: file.id,
      p_name: file.name ?? part.name,
      p_size: Number(file.size ?? Buffer.byteLength(part.text)),
      p_link: file.webViewLink ?? null,
      p_kit_hash: kit.hash,
    });
    if (code === 'conflict' && created) await trashFile(file.id).catch(() => undefined);
    wrote = true;
  }
  return wrote;
}

async function archive(admin: SupabaseClient, s: DriveState, folderId: string): Promise<number> {
  const archiveId = await ensureFolder(admin, {
    reelId: s.reel.id,
    level: 'archive',
    storedId: s.reel.archive_folder_id,
    name: ARCHIVE_FOLDER,
    parentId: folderId,
    tag: `archive:${s.reel.id}`,
  });
  const done: string[] = [];
  for (const f of s.to_archive) {
    const meta = await getFile(f.drive_file_id);
    // Gone or trashed: nothing is left at the root either.
    if (meta && !meta.trashed && !meta.parents?.includes(archiveId)) {
      await moveFile(f.drive_file_id, archiveId, meta.parents ?? []);
    }
    done.push(f.id);
  }
  await rpc<number>(admin, 'archive_drive_files', { p_ids: done });
  return done.length;
}

async function share(admin: SupabaseClient, s: DriveState, folderId: string, opts: { grant: boolean } = { grant: true }) {
  const plan = planShares({
    desired: s.shares,
    recorded: s.recorded_shares,
    current: await listPermissions(folderId),
    ignoreEmails: [serviceAccountEmail()],
  });
  const record = (args: { user: string | null; email: string; action: string; permission?: string | null; error?: string }) =>
    rpc<string>(admin, 'record_drive_share', {
      p_reel_id: s.reel.id,
      p_user_id: args.user,
      p_email: args.email,
      p_action: args.action,
      p_permission_id: args.permission ?? null,
      p_error: args.error ?? null,
    });

  // Revocations first: a role change is a revoke and a new grant.
  for (const r of plan.revoke) {
    await deletePermission(folderId, r.permissionId);
    if (r.email) await record({ user: null, email: r.email, action: 'revoked', permission: r.permissionId });
  }
  for (const f of plan.forget) await record({ user: null, email: f.email, action: 'revoked', permission: f.permission_id });
  if (!opts.grant) return { granted: 0, revoked: plan.revoke.length + plan.forget.length };
  for (const c of plan.create) {
    try {
      const id = await createPermission(folderId, c.email, c.role);
      await record({ user: c.user_id, email: c.email, action: 'granted', permission: id });
    } catch (err) {
      // 400: not a Google account (or a malformed address). Recorded on the
      // share, the admins and the person hear once; the job goes on.
      if (err instanceof DriveApiError && (err.status === 400 || err.status === 404)) {
        await record({ user: c.user_id, email: c.email, action: 'error', error: err.message });
      } else {
        throw err;
      }
    }
  }
  return { granted: plan.create.length, revoked: plan.revoke.length + plan.forget.length };
}

export async function handleDriveReconcile(job: ClaimedJob): Promise<'sent' | 'stale'> {
  const reelId = String(job.payload.reel_id ?? '');
  if (!UUID.test(reelId)) throw new PermanentJobError('drive_reconcile without a reel_id');
  const admin = getSupabaseAdminClient();
  const started = Date.now();

  try {
    let s = await driveState(admin, reelId);
    if (!s) return 'stale'; // reel gone
    if (!s.enabled) {
      // Drive off: no folders or kits, but nobody keeps an access the tasks
      // no longer give.
      if (!s.reel.folder_id || s.recorded_shares.length === 0) return 'stale';
      const shares = await share(admin, s, s.reel.folder_id, { grant: false });
      log({ reel_id: reelId, code: 'drive_off', ...shares, ms: Date.now() - started });
      return 'sent';
    }

    const folderId = s.folder_needed ? await ensureReelFolder(admin, s) : s.reel.folder_id;
    if (!folderId) {
      await rpc<string>(admin, 'mark_drive_reconciled', { p_reel_id: reelId, p_kit_hash: null });
      return 'sent';
    }

    // The hash of the kit this run writes, not of a later re-read.
    const kitHash = s.kit?.hash ?? null;
    if (s.kit && (await writeKit(admin, s, folderId))) s = (await driveState(admin, reelId)) ?? s;
    const archived = s.to_archive.length ? await archive(admin, s, folderId) : 0;
    const shares = await share(admin, s, folderId);
    const code = await rpc<string>(admin, 'mark_drive_reconciled', { p_reel_id: reelId, p_kit_hash: kitHash });
    log({ reel_id: reelId, code, kit: !!kitHash, archived, ...shares, ms: Date.now() - started });
    return 'sent';
  } catch (err) {
    // Bad request or no permission: retrying cannot help (dead letter, then
    // the sweep tries again an hour later, at most three times a day).
    if (err instanceof DriveApiError && err.permanent) throw new PermanentJobError(err.message);
    throw err;
  }
}
