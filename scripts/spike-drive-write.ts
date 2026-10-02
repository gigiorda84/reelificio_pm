// S0 spike: can the service account write to the staging Shared Drive, share
// a folder with an outside Gmail and revoke it, and open resumable upload
// sessions for the browser? Each step is a subcommand, because the Gmail side
// (open, download, upload, try to delete) is done by hand between steps.
//
//   pnpm exec tsx scripts/spike-drive-write.ts drives
//   pnpm exec tsx scripts/spike-drive-write.ts setup                 # step 1–2: drive info, folder + test file
//   pnpm exec tsx scripts/spike-drive-write.ts share <folderId> <gmail> [reader|writer]
//   pnpm exec tsx scripts/spike-drive-write.ts perms <folderId>      # incl. permissionDetails[].inherited
//   pnpm exec tsx scripts/spike-drive-write.ts revoke <folderId> <permissionId>
//   pnpm exec tsx scripts/spike-drive-write.ts files <folderId>
//   pnpm exec tsx scripts/spike-drive-write.ts resumable <folderId> [bytes] [name]   # step 4
//   pnpm exec tsx scripts/spike-drive-write.ts upload-wav <folderId> <megabytes>    # media spike files
//   pnpm exec tsx scripts/spike-drive-write.ts trash <fileOrFolderId>
//
// Env (.env.local): GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
// GOOGLE_SHARED_DRIVE_ID (staging drive), NEXT_PUBLIC_APP_URL (Origin of the session).
import { config } from 'dotenv';
import { JWT } from 'google-auth-library';

config({ path: '.env.local' });

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const CHUNK = 8 * 1024 * 1024; // 8 MiB, a multiple of 256 KiB as Drive requires

function auth(): JWT {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Service account env missing');
  // Full drive scope: the app's client (src/lib/drive/client.ts) stays read-only until S5.
  return new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/drive'] });
}

const jwt = auth();

async function token(): Promise<string> {
  const { token: t } = await jwt.getAccessToken();
  if (!t) throw new Error('No access token');
  return t;
}

async function drive<T>(
  path: string,
  init: { method?: string; query?: Record<string, string>; body?: unknown } = {},
): Promise<T> {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('supportsAllDrives', 'true');
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${await token()}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function sharedDriveId(): string {
  const id = process.env.GOOGLE_SHARED_DRIVE_ID;
  if (!id) throw new Error('Set GOOGLE_SHARED_DRIVE_ID in .env.local (see the `drives` command)');
  return id;
}

async function cmdDrives() {
  const res = await drive<{ drives: Array<Record<string, unknown>> }>('/drives', {
    query: { fields: 'drives(id,name,restrictions,capabilities(canManageMembers,canAddChildren))' },
  });
  console.log(JSON.stringify(res.drives, null, 2));
}

async function cmdSetup() {
  const driveId = sharedDriveId();
  const info = await drive<Record<string, unknown>>(`/drives/${driveId}`, {
    query: { fields: 'id,name,restrictions,capabilities(canManageMembers,canAddChildren,canShare)' },
  });
  console.log('Shared Drive:', JSON.stringify(info, null, 2));

  const folder = await drive<{ id: string; webViewLink: string }>('/files', {
    method: 'POST',
    query: { fields: 'id,webViewLink' },
    body: {
      name: `spike-S0 ${new Date().toISOString().slice(0, 16)}`,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [driveId],
    },
  });
  console.log('Folder:', folder.id, folder.webViewLink);

  const text = `Spike S0 — file di prova per il download (${new Date().toISOString()})\n`;
  const file = await uploadBytes(folder.id, 'spike-download.txt', 'text/plain', Buffer.from(text));
  console.log('Test file:', file.id, file.webViewLink);
  console.log(`\nNext: share ${folder.id} <gmail> reader`);
}

async function cmdShare(folderId: string, email: string, role = 'reader') {
  if (!['reader', 'writer'].includes(role)) throw new Error('role must be reader or writer');
  const perm = await drive<{ id: string; role: string }>(`/files/${folderId}/permissions`, {
    method: 'POST',
    query: { sendNotificationEmail: 'false', fields: 'id,role,emailAddress' },
    body: { type: 'user', role, emailAddress: email },
  });
  console.log('Permission created:', JSON.stringify(perm));
  console.log(`Folder link for the Gmail: https://drive.google.com/drive/folders/${folderId}`);
}

async function cmdPerms(fileId: string) {
  const res = await drive<{ permissions: unknown[] }>(`/files/${fileId}/permissions`, {
    query: {
      fields:
        'permissions(id,type,role,emailAddress,displayName,permissionDetails(permissionType,role,inherited,inheritedFrom))',
    },
  });
  console.log(JSON.stringify(res.permissions, null, 2));
}

async function cmdRevoke(fileId: string, permissionId: string) {
  await drive(`/files/${fileId}/permissions/${permissionId}`, { method: 'DELETE' });
  console.log('Revoked', permissionId);
}

async function cmdFiles(folderId: string) {
  const res = await drive<{ files: unknown[] }>('/files', {
    query: {
      q: `'${folderId}' in parents and trashed = false`,
      includeItemsFromAllDrives: 'true',
      corpora: 'drive',
      driveId: sharedDriveId(),
      fields: 'files(id,name,mimeType,size,createdTime,lastModifyingUser(emailAddress),webViewLink)',
    },
  });
  console.log(JSON.stringify(res.files, null, 2));
}

async function createSession(
  folderId: string,
  name: string,
  mimeType: string,
  size: number,
  origin?: string,
): Promise<string> {
  const url = new URL(`${UPLOAD_API}/files`);
  url.searchParams.set('uploadType', 'resumable');
  url.searchParams.set('supportsAllDrives', 'true');
  url.searchParams.set('fields', 'id,name,size,webViewLink');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mimeType,
      'X-Upload-Content-Length': String(size),
      // With an Origin the session answers the browser's CORS requests.
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const location = res.headers.get('location');
  if (!res.ok || !location) throw new Error(`session → ${res.status} ${await res.text()}`);
  return location;
}

async function cmdResumable(folderId: string, bytes = String(20 * 1024 * 1024), name?: string) {
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!origin) throw new Error('NEXT_PUBLIC_APP_URL missing');
  const size = Number(bytes);
  const session = await createSession(
    folderId,
    name ?? `spike-browser-${Date.now()}.bin`,
    'application/octet-stream',
    size,
    origin,
  );
  console.log(`Origin: ${origin}\nSize: ${size}\nSession URL (valid ~1 week):\n${session}`);
}

type DriveFile = { id: string; name: string; size?: string; webViewLink?: string };

async function uploadBytes(folderId: string, name: string, mimeType: string, data: Buffer) {
  const session = await createSession(folderId, name, mimeType, data.length);
  const res = await fetch(session, { method: 'PUT', body: new Uint8Array(data) });
  if (!res.ok) throw new Error(`upload → ${res.status} ${await res.text()}`);
  return (await res.json()) as DriveFile;
}

// 48 kHz, 16-bit stereo sine tone, generated chunk by chunk so a 300 MB file
// never sits in memory or on disk; sent in 8 MiB chunks through a resumable
// session, the same protocol the browser uploader will use.
async function cmdUploadWav(folderId: string, megabytes: string) {
  const RATE = 48_000;
  const CHANNELS = 2;
  const BYTES_PER_FRAME = CHANNELS * 2;
  const dataBytes = Math.floor((Number(megabytes) * 1024 * 1024) / BYTES_PER_FRAME) * BYTES_PER_FRAME;
  const total = 44 + dataBytes;
  const seconds = dataBytes / (RATE * BYTES_PER_FRAME);

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(total - 8, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * BYTES_PER_FRAME, 28);
  header.writeUInt16LE(BYTES_PER_FRAME, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);

  // Bytes [start, end) of the file. The tone steps up every 10 s, so a seek
  // is audible.
  function fillChunk(start: number, end: number): Buffer {
    const buf = Buffer.alloc(end - start);
    let pos = start;
    for (; pos < Math.min(end, 44); pos++) buf[pos - start] = header[pos];
    if (pos >= end) return buf;

    const firstFrame = Math.floor((pos - 44) / BYTES_PER_FRAME);
    const endFrame = Math.ceil((end - 44) / BYTES_PER_FRAME);
    const frames = Buffer.alloc((endFrame - firstFrame) * BYTES_PER_FRAME);
    for (let f = firstFrame; f < endFrame; f++) {
      const t = f / RATE;
      const freq = 220 + 20 * Math.floor(t / 10);
      const sample = Math.round(Math.sin(2 * Math.PI * freq * t) * 8000);
      const o = (f - firstFrame) * BYTES_PER_FRAME;
      frames.writeInt16LE(sample, o);
      frames.writeInt16LE(sample, o + 2);
    }
    const from = pos - 44 - firstFrame * BYTES_PER_FRAME;
    frames.copy(buf, pos - start, from, from + (end - pos));
    return buf;
  }

  const name = `spike-audio-${megabytes}MB.wav`;
  const session = await createSession(folderId, name, 'audio/wav', total);
  console.log(`${name}: ${total} bytes, ${(seconds / 60).toFixed(1)} min`);

  for (let start = 0; start < total; start += CHUNK) {
    const end = Math.min(start + CHUNK, total);
    const res = await fetch(session, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` },
      body: new Uint8Array(fillChunk(start, end)),
    });
    if (res.status === 308) {
      process.stdout.write(`\r  ${Math.round((end / total) * 100)}%`);
      continue;
    }
    if (!res.ok) throw new Error(`chunk ${start} → ${res.status} ${await res.text()}`);
    const file = (await res.json()) as DriveFile;
    console.log(`\nUploaded: ${file.id} ${file.webViewLink ?? ''}`);
  }
}

async function cmdTrash(fileId: string) {
  await drive(`/files/${fileId}`, { method: 'PATCH', body: { trashed: true } });
  console.log('Trashed', fileId);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const need = (n: number) => {
    if (rest.length < n) throw new Error(`${cmd} needs ${n} argument(s); see the header of this file`);
  };
  switch (cmd) {
    case 'drives':
      return cmdDrives();
    case 'setup':
      return cmdSetup();
    case 'share':
      need(2);
      return cmdShare(rest[0], rest[1], rest[2]);
    case 'perms':
      need(1);
      return cmdPerms(rest[0]);
    case 'revoke':
      need(2);
      return cmdRevoke(rest[0], rest[1]);
    case 'files':
      need(1);
      return cmdFiles(rest[0]);
    case 'resumable':
      need(1);
      return cmdResumable(rest[0], rest[1], rest[2]);
    case 'upload-wav':
      need(2);
      return cmdUploadWav(rest[0], rest[1]);
    case 'trash':
      need(1);
      return cmdTrash(rest[0]);
    default:
      throw new Error('Unknown command; see the header of this file');
  }
}

main().catch((err) => {
  console.error('FAIL:', (err as Error).message);
  process.exit(1);
});
