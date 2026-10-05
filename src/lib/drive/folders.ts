import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createFolder, findByTag, getFile, sharedDriveId, trashFile } from './api';
import type { KitScript } from './kit';
import { batchFolderName, pageFolderName, reelFolderName } from './naming';
import type { DesiredShare, RecordedShare } from './reconcile-plan';

// What drive_desired_state() returns (supabase/migrations/*_fase1_drive.sql).
export type DriveState = {
  enabled: boolean;
  reel: {
    id: string;
    code: string;
    title: string;
    state: string;
    published: boolean;
    folder_id: string | null;
    archive_folder_id: string | null;
    kit_hash: string | null;
    kit_ready_at: string | null;
  };
  page: { id: string; prefix: string; name: string; folder_id: string | null };
  batch: { id: string; label: string; folder_id: string | null };
  folder_needed: boolean;
  kit: null | {
    hash: string;
    audio_ref: string;
    audio: { id: string; drive_file_id: string; name: string } | null;
    audio_url: string | null;
    script: KitScript;
    files: { id: string; kind: 'script' | 'other'; version: number; name: string; drive_file_id: string; kit_hash: string | null }[];
    next_version: { script: number; other: number };
  };
  to_archive: { id: string; drive_file_id: string; name: string }[];
  shares: DesiredShare[];
  recorded_shares: RecordedShare[];
};

export async function driveState(admin: SupabaseClient, reelId: string): Promise<DriveState | null> {
  const { data, error } = await admin.rpc('drive_desired_state', { p_reel_id: reelId });
  if (error) throw new Error(`drive_desired_state: ${error.message}`);
  return (data as DriveState | null) ?? null;
}

type Level = 'page' | 'batch' | 'reel' | 'archive';

// A folder of the chain, created at most once: the stored id if it still
// exists, else the one tagged for it under the parent (a run that crashed
// after files.create), else a new one. The id is saved at once; when a
// concurrent run saved another first, ours goes to the trash.
export async function ensureFolder(
  admin: SupabaseClient,
  args: { reelId: string; level: Level; storedId: string | null; name: string; parentId: string; tag: string },
): Promise<string> {
  if (args.storedId) {
    const stored = await getFile(args.storedId);
    if (stored && !stored.trashed) return args.storedId;
  }
  let id = (await findByTag(args.parentId, args.tag, { folder: true }))?.id ?? null;
  let created = false;
  if (!id) {
    id = (await createFolder({ name: args.name, parentId: args.parentId, tag: args.tag })).id;
    created = true;
  }
  const { data, error } = await admin.rpc('save_drive_folder', {
    p_reel_id: args.reelId,
    p_level: args.level,
    p_folder_id: id,
    p_stale: args.storedId,
  });
  if (error) throw new Error(`save_drive_folder: ${error.message}`);
  const saved = data as string;
  if (saved !== id && created) await trashFile(id).catch(() => undefined);
  return saved;
}

// <PP> — <Pagina>/<Batch>/<PP-2610-01> — <titolo>/ on the Shared Drive.
// Used by drive_reconcile and by an upload that arrives before it ran.
export async function ensureReelFolder(admin: SupabaseClient, s: DriveState): Promise<string> {
  if (s.reel.folder_id) {
    const stored = await getFile(s.reel.folder_id);
    if (stored && !stored.trashed) return s.reel.folder_id;
  }
  const page = await ensureFolder(admin, {
    reelId: s.reel.id,
    level: 'page',
    storedId: s.page.folder_id,
    name: pageFolderName(s.page.prefix, s.page.name),
    parentId: sharedDriveId(),
    tag: `page:${s.page.id}`,
  });
  const batch = await ensureFolder(admin, {
    reelId: s.reel.id,
    level: 'batch',
    storedId: s.batch.folder_id,
    name: batchFolderName(s.batch.label),
    parentId: page,
    tag: `batch:${s.batch.id}`,
  });
  return ensureFolder(admin, {
    reelId: s.reel.id,
    level: 'reel',
    storedId: s.reel.folder_id,
    name: reelFolderName(s.reel.code, s.reel.title),
    parentId: batch,
    tag: `reel:${s.reel.id}`,
  });
}
