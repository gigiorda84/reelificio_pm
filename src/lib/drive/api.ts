import 'server-only';
import { getDriveAuth } from './client';
import type { DrivePermission, ShareRole } from './reconcile-plan';

// Drive v3 over REST with the service account (docs/fase1-plan.md §S5): the
// calls drive_reconcile, the uploads and the media route need, on the Shared
// Drive set by GOOGLE_SHARED_DRIVE_ID (one for staging, one for production).
// Every item the app creates carries appProperties.reelificio = a tag
// ("reel:<id>", "file:<id>", …): a run that crashed finds it again instead
// of creating it twice.

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TIMEOUT_MS = 20_000;

export class DriveApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | null,
    message: string,
  ) {
    super(message);
  }

  // Retrying cannot help: a bad request or a missing permission. Rate limits
  // (429, 403 *RateLimitExceeded) and 5xx can.
  get permanent(): boolean {
    if (this.status === 429 || this.status >= 500) return false;
    if (this.status === 403 && /ratelimit/i.test(this.reason ?? '')) return false;
    return this.status >= 400;
  }
}

export function sharedDriveId(): string {
  const id = process.env.GOOGLE_SHARED_DRIVE_ID;
  if (!id) throw new Error('GOOGLE_SHARED_DRIVE_ID is not set');
  return id;
}

export function serviceAccountEmail(): string {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '';
}

async function token(): Promise<string> {
  const { token: t } = await getDriveAuth().getAccessToken();
  if (!t) throw new Error('No Drive access token');
  return t;
}

async function failure(res: Response, what: string): Promise<DriveApiError> {
  const text = await res.text();
  let reason: string | null = null;
  let message = text.slice(0, 300);
  try {
    const body = JSON.parse(text) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = body.error?.errors?.[0]?.reason ?? null;
    message = body.error?.message ?? message;
  } catch {
    // not JSON
  }
  return new DriveApiError(res.status, reason, `${what} → ${res.status} ${reason ?? ''} ${message}`.trim());
}

type Init = { method?: string; query?: Record<string, string>; body?: unknown };

async function call<T>(path: string, init: Init = {}): Promise<T> {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('supportsAllDrives', 'true');
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${await token()}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await failure(res, `${init.method ?? 'GET'} ${path}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// Drive query literals: backslash and quote escaped.
function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
  webViewLink?: string;
  appProperties?: Record<string, string>;
};

const FILE_FIELDS = 'id,name,mimeType,size,parents,trashed,webViewLink,appProperties';

// null when the file does not exist (or the service account cannot see it).
export async function getFile(id: string): Promise<DriveFile | null> {
  try {
    return await call<DriveFile>(`/files/${encodeURIComponent(id)}`, { query: { fields: FILE_FIELDS } });
  } catch (err) {
    if (err instanceof DriveApiError && err.status === 404) return null;
    throw err;
  }
}

// The live item tagged `tag` directly inside `parentId`, if any.
export async function findByTag(parentId: string, tag: string, opts: { folder?: boolean } = {}): Promise<DriveFile | null> {
  const clauses = [
    `${q(parentId)} in parents`,
    'trashed = false',
    `appProperties has { key='reelificio' and value=${q(tag)} }`,
  ];
  if (opts.folder) clauses.push(`mimeType = ${q(FOLDER_MIME)}`);
  const res = await call<{ files?: DriveFile[] }>('/files', {
    query: {
      q: clauses.join(' and '),
      corpora: 'drive',
      driveId: sharedDriveId(),
      includeItemsFromAllDrives: 'true',
      fields: `files(${FILE_FIELDS})`,
      pageSize: '10',
    },
  });
  return res.files?.[0] ?? null;
}

export async function createFolder(args: { name: string; parentId: string; tag: string }): Promise<DriveFile> {
  return call<DriveFile>('/files', {
    method: 'POST',
    query: { fields: FILE_FIELDS },
    body: { name: args.name, mimeType: FOLDER_MIME, parents: [args.parentId], appProperties: { reelificio: args.tag } },
  });
}

// A small text file (kit), in one multipart request.
export async function uploadText(args: { name: string; parentId: string; tag: string; text: string }): Promise<DriveFile> {
  const boundary = `reelificio-${crypto.randomUUID()}`;
  const meta = JSON.stringify({
    name: args.name,
    mimeType: 'text/plain',
    parents: [args.parentId],
    appProperties: { reelificio: args.tag },
  });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${args.text}\r\n--${boundary}--`;
  const url = new URL(`${UPLOAD_API}/files`);
  url.searchParams.set('uploadType', 'multipart');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', FILE_FIELDS);
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await failure(res, `upload ${args.name}`);
  return (await res.json()) as DriveFile;
}

export async function moveFile(id: string, to: string, from: string[]): Promise<void> {
  await call(`/files/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    query: { addParents: to, removeParents: from.join(','), fields: 'id' },
    body: {},
  });
}

export async function trashFile(id: string): Promise<void> {
  await call(`/files/${encodeURIComponent(id)}`, { method: 'PATCH', query: { fields: 'id' }, body: { trashed: true } });
}

export async function listPermissions(fileId: string): Promise<DrivePermission[]> {
  const res = await call<{ permissions?: DrivePermission[] }>(`/files/${encodeURIComponent(fileId)}/permissions`, {
    query: { fields: 'permissions(id,type,role,emailAddress,permissionDetails(inherited))', pageSize: '100' },
  });
  return res.permissions ?? [];
}

// No email from Google: the app sends its own messages.
export async function createPermission(fileId: string, email: string, role: ShareRole): Promise<string> {
  const res = await call<{ id: string }>(`/files/${encodeURIComponent(fileId)}/permissions`, {
    method: 'POST',
    query: { sendNotificationEmail: 'false', fields: 'id' },
    body: { type: 'user', role, emailAddress: email },
  });
  return res.id;
}

// Already gone counts as done.
export async function deletePermission(fileId: string, permissionId: string): Promise<void> {
  try {
    await call(`/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof DriveApiError && err.status === 404) return;
    throw err;
  }
}

// A resumable upload session the browser fills in 8 MiB chunks (D6 → U1).
// With the page's Origin the session answers the browser's CORS requests.
export async function createUploadSession(args: {
  folderId: string;
  name: string;
  mimeType: string;
  size: number;
  origin: string;
  tag: string;
  appProperties: Record<string, string>;
}): Promise<string> {
  const url = new URL(`${UPLOAD_API}/files`);
  url.searchParams.set('uploadType', 'resumable');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'id,name,size,webViewLink');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': args.mimeType,
      'X-Upload-Content-Length': String(args.size),
      Origin: args.origin,
    },
    body: JSON.stringify({
      name: args.name,
      parents: [args.folderId],
      appProperties: { ...args.appProperties, reelificio: args.tag },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const location = res.headers.get('location');
  if (!res.ok || !location) throw await failure(res, 'upload session');
  return location;
}

// Bytes [start, end] of a file, for the media route. The timeout covers the
// wait for Drive's answer only: the body streams to the player at the
// phone's own pace.
export async function fetchMediaRange(fileId: string, start: number, end: number): Promise<Response> {
  const url = new URL(`${API}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('alt', 'media');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${await token()}`, Range: `bytes=${start}-${end}` },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
