import type { NextRequest } from 'next/server';
import { fetchMediaRange } from '@/lib/drive/api';
import { audioContentType } from '@/lib/drive/naming';
import { getSupabaseServerClient } from '@/lib/supabase/server';

// Audio for the approvals, served from Drive by the service account (S0
// spike: the Drive preview asks a phone to log in, this plays). Only to
// whoever sees the file: the row is read through RLS (reel_files has the
// reel's visibility). Size and type come from that row, so a range costs one
// Drive call. Each 206 carries at most CAP bytes; the player asks for more.
// Video opens in Drive (approvers are members of the Shared Drive).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CAP = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseRange(header: string | null, size: number): [number, number] | null {
  if (!header) return [0, Math.min(size, CAP) - 1];
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    // Suffix range: the last N bytes.
    const n = Number(m[2]);
    if (!n) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return null;
  return [start, Math.min(end, start + CAP - 1)];
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  if (!UUID.test(fileId)) return new Response('not found', { status: 404 });

  const supabase = await getSupabaseServerClient();
  const { data: file } = await supabase
    .from('reel_files')
    .select('drive_file_id, name, mime_type, size_bytes, kind, status')
    .eq('id', fileId)
    .maybeSingle();
  if (!file || file.kind !== 'audio' || file.status !== 'ready' || !file.drive_file_id || !file.size_bytes) {
    return new Response('not found', { status: 404 });
  }

  const size = Number(file.size_bytes);
  const range = parseRange(req.headers.get('range'), size);
  if (!range) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const [start, end] = range;
  const upstream = await fetchMediaRange(file.drive_file_id, start, end);
  if (upstream.status !== 206 && upstream.status !== 200) {
    console.log(JSON.stringify({ evt: 'media', level: 'warn', file_id: fileId, status: upstream.status }));
    return new Response('upstream error', { status: 502 });
  }
  return new Response(upstream.body, {
    status: 206,
    headers: {
      'Content-Type': audioContentType(file.name, file.mime_type),
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
    },
  });
}
