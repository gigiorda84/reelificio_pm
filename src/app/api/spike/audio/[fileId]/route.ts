import type { NextRequest } from 'next/server';
import { DRIVE_ID_RE, canAccessSpike } from '@/lib/spike/access';
import { fetchFileRange, getFileMeta } from '@/lib/spike/drive';

// S0 spike: serves a Drive file to <audio> with HTTP Range support. Every 206
// carries at most CAP bytes (Content-Range truncated), keeping each response
// under Vercel's body and duration limits; the player asks for the next range.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const CAP = 4 * 1024 * 1024;

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  if (!DRIVE_ID_RE.test(fileId)) return new Response('bad id', { status: 400 });
  if (!(await canAccessSpike(req, 'media', fileId))) {
    return new Response('unauthorized', { status: 401 });
  }

  const meta = await getFileMeta(fileId);
  const range = parseRange(req.headers.get('range'), meta.size);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${meta.size}` },
    });
  }

  const [start, end] = range;
  const upstream = await fetchFileRange(fileId, start, end);
  if (upstream.status !== 206 && upstream.status !== 200) {
    return new Response(`drive ${upstream.status}`, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 206,
    headers: {
      'Content-Type': meta.mimeType || 'application/octet-stream',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${meta.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
    },
  });
}
