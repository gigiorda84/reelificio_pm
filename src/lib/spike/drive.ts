import 'server-only';
import { JWT } from 'google-auth-library';

// S0 spike helpers (upload from the browser, media on iPhone). Removed with
// the spike pages at the end of S0; S5 rebuilds the parts that survive.

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

let jwt: JWT | null = null;

async function token(): Promise<string> {
  if (!jwt) {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!email || !key) throw new Error('Drive service account not configured');
    jwt = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/drive'] });
  }
  const { token: t } = await jwt.getAccessToken();
  if (!t) throw new Error('No Drive access token');
  return t;
}

export async function createUploadSession(input: {
  folderId: string;
  name: string;
  mimeType: string;
  size: number;
  origin: string;
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
      'X-Upload-Content-Type': input.mimeType || 'application/octet-stream',
      'X-Upload-Content-Length': String(input.size),
      Origin: input.origin,
    },
    body: JSON.stringify({ name: input.name, parents: [input.folderId] }),
  });
  const location = res.headers.get('location');
  if (!res.ok || !location) {
    throw new Error(`Drive session ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return location;
}

export type DriveFileMeta = { name: string; mimeType: string; size: number };

export async function getFileMeta(fileId: string): Promise<DriveFileMeta> {
  const url = new URL(`${API}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'name,mimeType,size');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!res.ok) throw new Error(`Drive meta ${res.status}`);
  const body = (await res.json()) as { name: string; mimeType: string; size?: string };
  return { name: body.name, mimeType: body.mimeType, size: Number(body.size ?? 0) };
}

export async function fetchFileRange(fileId: string, start: number, end: number) {
  const url = new URL(`${API}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('alt', 'media');
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${await token()}`,
      Range: `bytes=${start}-${end}`,
    },
  });
}
