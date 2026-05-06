import mammoth from 'mammoth';
import { getDriveAuth } from './client';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const GDOC_MIME = 'application/vnd.google-apps.document';

export type DriveDocFetch = {
  text: string;
  fileId: string;
  name: string;
  modifiedTime: string;
  revisionId: string | null;
};

export class DriveFetchError extends Error {
  constructor(
    public readonly kind:
      | 'not_configured'
      | 'invalid_url'
      | 'not_found'
      | 'forbidden'
      | 'unsupported_type'
      | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'DriveFetchError';
  }
}

// Accepts a Drive URL, document URL, or bare file id.
export function extractFileId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Bare id: 25–60 characters of [A-Za-z0-9_-].
  if (/^[A-Za-z0-9_-]{20,80}$/.test(trimmed)) return trimmed;
  // /document/d/<id>/, /file/d/<id>/, /spreadsheets/d/<id>/.
  const dPath = trimmed.match(/\/d\/([A-Za-z0-9_-]{20,80})/);
  if (dPath) return dPath[1];
  // ?id=<id>
  const idParam = trimmed.match(/[?&]id=([A-Za-z0-9_-]{20,80})/);
  if (idParam) return idParam[1];
  return null;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const auth = getDriveAuth();
  const token = await auth.getAccessToken();
  if (!token.token) throw new DriveFetchError('not_configured', 'No access token');
  return {
    Authorization: `Bearer ${token.token}`,
    Accept: 'application/json',
  };
}

async function getMetadata(fileId: string) {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
  url.searchParams.set('fields', 'id,name,mimeType,modifiedTime,headRevisionId');
  url.searchParams.set('supportsAllDrives', 'true');

  const res = await fetch(url, {
    headers: await getAuthHeaders(),
    cache: 'no-store',
  });
  if (res.status === 404) throw new DriveFetchError('not_found', 'File not found');
  if (res.status === 403) throw new DriveFetchError('forbidden', 'Access denied');
  if (!res.ok) throw new DriveFetchError('unknown', `Drive metadata ${res.status}`);
  return res.json() as Promise<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    headRevisionId?: string;
  }>;
}

async function exportGoogleDocAsText(fileId: string): Promise<string> {
  const url = new URL(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export`,
  );
  url.searchParams.set('mimeType', 'text/plain');
  url.searchParams.set('supportsAllDrives', 'true');

  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    headers: { Authorization: (headers as Record<string, string>).Authorization },
    cache: 'no-store',
  });
  if (res.status === 404) throw new DriveFetchError('not_found', 'File not found');
  if (res.status === 403) throw new DriveFetchError('forbidden', 'Access denied');
  if (!res.ok) throw new DriveFetchError('unknown', `Drive export ${res.status}`);
  return res.text();
}

async function downloadAsBuffer(fileId: string): Promise<Buffer> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${fileId}`);
  url.searchParams.set('alt', 'media');
  url.searchParams.set('supportsAllDrives', 'true');

  const headers = await getAuthHeaders();
  const res = await fetch(url, {
    headers: { Authorization: (headers as Record<string, string>).Authorization },
    cache: 'no-store',
  });
  if (res.status === 404) throw new DriveFetchError('not_found', 'File not found');
  if (res.status === 403) throw new DriveFetchError('forbidden', 'Access denied');
  if (!res.ok) throw new DriveFetchError('unknown', `Drive download ${res.status}`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

async function extractDocxText(fileId: string): Promise<string> {
  const buffer = await downloadAsBuffer(fileId);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

export async function fetchDocAsText(input: string): Promise<DriveDocFetch> {
  const fileId = extractFileId(input);
  if (!fileId) throw new DriveFetchError('invalid_url', 'Could not extract file id');

  const meta = await getMetadata(fileId);

  let text: string;
  if (meta.mimeType === GDOC_MIME) {
    text = await exportGoogleDocAsText(fileId);
  } else if (meta.mimeType === DOCX_MIME) {
    text = await extractDocxText(fileId);
  } else {
    throw new DriveFetchError(
      'unsupported_type',
      `Expected Google Doc or .docx, got ${meta.mimeType}`,
    );
  }

  return {
    text,
    fileId: meta.id,
    name: meta.name,
    modifiedTime: meta.modifiedTime,
    revisionId: meta.headRevisionId ?? null,
  };
}
