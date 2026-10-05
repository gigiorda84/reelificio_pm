'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { after } from 'next/server';
import { z } from 'zod';
import { drainOutbox } from '@/lib/jobs/drain';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { toTaskError, type TaskErrorCode } from '@/lib/tasks/constants';
import { createUploadSession, findByTag, getFile, trashFile, type DriveFile } from './api';
import { driveState, ensureReelFolder } from './folders';
import { uploadExtension, uploadMimeType } from './naming';

// Upload from the browser straight to Drive (docs/fase1-plan.md §S5, D6 → U1):
// prepareUpload reserves the version in SQL and opens a resumable session in
// the reel folder; the browser sends the chunks to Google; finishUpload
// checks the file on Drive (tag, folder, size) before recording it. The
// SQL functions are service-role only: the session is checked here first,
// and they check the task holder again with the explicit actor.

export type UploadError = TaskErrorCode | 'upload_failed' | 'unknown';
export type PrepareUploadResult =
  | { ok: true; fileId: string; sessionUrl: string; name: string }
  | { ok: false; error: UploadError };
export type UploadResult = { ok: true } | { ok: false; error: UploadError };

function log(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ evt: 'upload', ...fields }));
}

async function sessionUserId(): Promise<string | null> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// The page's origin: the resumable session answers CORS for it only.
async function pageOrigin(): Promise<string | null> {
  const origin = (await headers()).get('origin');
  return origin && /^https?:\/\/[^/\s]+$/.test(origin) ? origin : null;
}

const prepareSchema = z.object({
  taskId: z.string().uuid(),
  kind: z.enum(['audio', 'video']),
  fileName: z.string().max(500),
  mimeType: z.string().max(200),
  size: z.number().int().positive(),
});

type Prepared = { code: string; file_id: string; reel_id: string; name: string; folder_id: string | null };

export async function prepareUpload(input: z.infer<typeof prepareSchema>): Promise<PrepareUploadResult> {
  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const { taskId, kind, fileName, mimeType, size } = parsed.data;
  const uid = await sessionUserId();
  if (!uid) return { ok: false, error: 'not_authorized' };
  const ext = uploadExtension(fileName, mimeType, kind);
  const origin = await pageOrigin();
  if (!ext || !origin) return { ok: false, error: 'invalid_input' };
  const mime = uploadMimeType(mimeType, kind);

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.rpc('prepare_upload_as', {
    p_actor: uid,
    p_task_id: taskId,
    p_ext: ext,
    p_mime: mime,
    p_size: size,
  });
  if (error) return { ok: false, error: 'unknown' };
  const r = data as Prepared;
  if (r.code !== 'ok') return { ok: false, error: toTaskError(r.code) };

  try {
    // The job normally made the folder at confermato; if it has not run yet
    // the upload makes it now (same rules, no duplicates).
    let folderId = r.folder_id;
    if (!folderId) {
      const state = await driveState(admin, r.reel_id);
      if (!state) throw new Error('reel not found');
      folderId = await ensureReelFolder(admin, state);
    }
    const sessionUrl = await createUploadSession({
      folderId,
      name: r.name,
      mimeType: mime,
      size,
      origin,
      tag: `file:${r.file_id}`,
      appProperties: { reelId: r.reel_id, taskId },
    });
    log({ step: 'prepare', file_id: r.file_id, reel_id: r.reel_id, size });
    return { ok: true, fileId: r.file_id, sessionUrl, name: r.name };
  } catch (err) {
    await admin.rpc('fail_upload', { p_file_id: r.file_id });
    log({ level: 'warn', step: 'prepare', file_id: r.file_id, error: (err as Error).message.slice(0, 300) });
    return { ok: false, error: 'upload_failed' };
  }
}

const finishSchema = z.object({
  fileId: z.string().uuid(),
  // From Google's last response, when the browser could read it.
  driveFileId: z.string().regex(/^[A-Za-z0-9_-]{10,200}$/).optional(),
});

export async function finishUpload(input: z.infer<typeof finishSchema>): Promise<UploadResult> {
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const { fileId, driveFileId } = parsed.data;
  const uid = await sessionUserId();
  if (!uid) return { ok: false, error: 'not_authorized' };

  const admin = getSupabaseAdminClient();
  const { data: row } = await admin
    .from('reel_files')
    .select('id, reel_id, size_bytes, status, uploaded_by, reels(drive_folder_id)')
    .eq('id', fileId)
    .maybeSingle();
  // Only the uploader's own rows: nobody else can fail an upload in flight.
  if (!row || row.uploaded_by !== uid) return { ok: false, error: 'not_authorized' };
  const folderId = (row.reels as unknown as { drive_folder_id: string | null } | null)?.drive_folder_id ?? null;
  if (!folderId) return { ok: false, error: 'invalid_input' };

  if (row.status === 'ready') return { ok: true };
  if (row.status !== 'uploading') return { ok: false, error: 'invalid_state' };

  const tag = `file:${row.id}`;
  let file: DriveFile | null = driveFileId ? await getFile(driveFileId) : null;
  // Without the id from the browser, look for the tag; Drive's search may
  // lag a moment behind a fresh upload.
  for (let i = 0; i < 3 && (!file || file.appProperties?.reelificio !== tag); i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
    file = await findByTag(folderId, tag);
  }
  const verified =
    !!file &&
    !file.trashed &&
    file.appProperties?.reelificio === tag &&
    !!file.parents?.includes(folderId) &&
    Number(file.size) === Number(row.size_bytes) &&
    !!file.webViewLink;
  if (!verified) {
    if (file && file.appProperties?.reelificio === tag) await trashFile(file.id).catch(() => undefined);
    await admin.rpc('fail_upload', { p_file_id: row.id });
    log({ level: 'warn', step: 'finish', file_id: row.id, found: !!file, size: file?.size, expected: row.size_bytes });
    return { ok: false, error: 'upload_failed' };
  }

  const { data: code, error } = await admin.rpc('finish_upload_as', {
    p_actor: uid,
    p_file_id: row.id,
    p_drive_file_id: file!.id,
    p_web_view_link: file!.webViewLink,
  });
  if (error) return { ok: false, error: 'unknown' };
  if (code !== 'ok') {
    // The task closed or changed hands meanwhile: the file is not kept.
    if (code === 'invalid_state') {
      await trashFile(file!.id).catch(() => undefined);
      await admin.rpc('fail_upload', { p_file_id: row.id });
    }
    return { ok: false, error: toTaskError(code) };
  }
  log({ step: 'finish', file_id: row.id, reel_id: row.reel_id });
  revalidatePath(`/reels/${row.reel_id}`);
  // The job archives the version this one replaces.
  after(() => drainOutbox({ limit: 10, deadlineMs: 8_000 }).then(() => undefined));
  return { ok: true };
}

// The person gave up (or the browser could not go on): the reserved version
// is marked failed. Only the uploader's own rows.
export async function abandonUpload(fileId: string): Promise<UploadResult> {
  if (!z.string().uuid().safeParse(fileId).success) return { ok: false, error: 'invalid_input' };
  const uid = await sessionUserId();
  if (!uid) return { ok: false, error: 'not_authorized' };
  const admin = getSupabaseAdminClient();
  const { data: row } = await admin.from('reel_files').select('id, uploaded_by').eq('id', fileId).maybeSingle();
  if (!row || row.uploaded_by !== uid) return { ok: false, error: 'not_authorized' };
  await admin.rpc('fail_upload', { p_file_id: fileId });
  return { ok: true };
}
