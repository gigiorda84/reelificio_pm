// Names on the Shared Drive (docs/fase1-plan.md §S5, AC8):
//   <PP> — <Pagina>/<Batch>/<PP-2610-01> — <titolo>/  (+ archivio/)
//   PP-2610-01_audio_v1.wav · PP-2610-01_script_v2.txt · PP-2610-01_audio_link.txt
// Pure functions; the uploaded file names are decided in SQL
// (prepare_upload_as) with the same rule as uploadedFileName().

export type UploadKind = 'audio' | 'video';

export const ARCHIVE_FOLDER = 'archivio';

// Mirror of prepare_upload_as(): accepted extensions and size limits.
export const UPLOAD_EXTENSIONS: Record<UploadKind, readonly string[]> = {
  audio: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'aif', 'aiff', 'ogg', 'opus'],
  video: ['mp4', 'mov', 'm4v', 'webm'],
};
export const UPLOAD_MAX_BYTES: Record<UploadKind, number> = {
  audio: 300 * 1024 * 1024,
  video: 4 * 1024 * 1024 * 1024,
};

const MIME_EXTENSIONS: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/webm': 'webm',
};

// Folder and file names: no slashes or control characters, no emoji, typographic
// apostrophes and quotes made plain, spaces collapsed, at most `max` characters.
export function sanitizeName(input: string, max = 80): string {
  const cleaned = input
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    // Emoji with their modifiers, joiners, variation selectors, flags, tags.
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}‍️⃣\u{E0020}-\u{E007F}]/gu, '')
    .replace(/[/\\\p{Cc}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(cleaned);
  const cut = chars.length > max ? chars.slice(0, max).join('').trimEnd() : cleaned;
  return cut || '—';
}

export function pageFolderName(prefix: string, name: string): string {
  return `${prefix} — ${sanitizeName(name, 60)}`;
}

export function batchFolderName(label: string): string {
  return sanitizeName(label, 60);
}

export function reelFolderName(code: string, title: string): string {
  return `${code} — ${sanitizeName(title, 80)}`;
}

export function uploadedFileName(code: string, kind: UploadKind, version: number, ext: string): string {
  return `${code}_${kind}_v${version}.${ext.toLowerCase()}`;
}

export function scriptFileName(code: string, version: number): string {
  return `${code}_script_v${version}.txt`;
}

export function audioLinkFileName(code: string): string {
  return `${code}_audio_link.txt`;
}

export function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

// The extension to store an upload under: the file's own when accepted for
// the kind, else the one of its MIME type; null when neither is accepted.
export function uploadExtension(fileName: string, mimeType: string, kind: UploadKind): string | null {
  const allowed = UPLOAD_EXTENSIONS[kind];
  const own = /\.([A-Za-z0-9]{1,5})$/.exec(fileName)?.[1]?.toLowerCase();
  if (own && allowed.includes(own)) return own;
  const fromMime = MIME_EXTENSIONS[mimeType.toLowerCase()];
  return fromMime && allowed.includes(fromMime) ? fromMime : null;
}

// What the session and prepare_upload_as() get as type: the browser's when
// it matches the kind, else a neutral one (iOS sometimes sends none).
export function uploadMimeType(mimeType: string, kind: UploadKind): string {
  const m = mimeType.toLowerCase();
  return m.startsWith(`${kind}/`) ? m : 'application/octet-stream';
}

const AUDIO_TYPES: Record<string, string> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
};

// What the media route answers as Content-Type: the stored type when it is an
// audio one, else the one of the standard name's extension.
export function audioContentType(name: string, stored: string | null): string {
  if (stored?.startsWith('audio/')) return stored;
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  return AUDIO_TYPES[ext] ?? 'application/octet-stream';
}
