import type { NextRequest } from 'next/server';
import { DRIVE_ID_RE, canAccessSpike } from '@/lib/spike/access';
import { createUploadSession } from '@/lib/spike/drive';

// S0 spike (D6): browser → Google resumable session in 8 MiB chunks, with an
// interruption and a resume through `Content-Range: bytes */<size>`. U1 holds
// if Chrome desktop and Safari iOS both upload and resume, which needs CORS on
// the session and a readable `Range` header on each 308; otherwise U3.
// GET = the page (bare HTML, opens from a signed link with no app session);
// POST = a session created with the page's own Origin.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ folderId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { folderId } = await params;
  if (!DRIVE_ID_RE.test(folderId)) return Response.json({ error: 'bad_id' }, { status: 400 });
  if (!(await canAccessSpike(req, 'upload', folderId))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = (await req.json()) as { name?: string; size?: number; mimeType?: string };
  if (!Number.isInteger(body.size) || !body.size || body.size <= 0) {
    return Response.json({ error: 'bad_size' }, { status: 400 });
  }
  const origin = req.headers.get('origin') ?? req.nextUrl.origin;
  const safeName = (body.name ?? 'file').replace(/[^\w.-]+/g, '_').slice(0, 60);
  try {
    const sessionUrl = await createUploadSession({
      folderId,
      name: `spike-browser-${Date.now()}-${safeName}`,
      mimeType: body.mimeType || 'application/octet-stream',
      size: body.size,
      origin,
    });
    return Response.json({ sessionUrl, origin });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  const { folderId } = await params;
  if (!DRIVE_ID_RE.test(folderId)) return new Response('bad id', { status: 400 });
  if (!(await canAccessSpike(req, 'upload', folderId))) {
    return new Response('unauthorized', { status: 401 });
  }
  const sessionEndpoint = `/api/spike/upload/${folderId}${req.nextUrl.search}`;

  const html = `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spike upload</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 16px; max-width: 640px; }
  h1 { font-size: 18px; } button { font-size: 15px; padding: 8px 14px; margin: 4px 4px 4px 0; }
  #log { font: 12px/1.5 ui-monospace, monospace; white-space: pre-wrap; background: #f4f4f4; padding: 8px; min-height: 4em; }
</style></head><body>
<h1>Spike upload su Drive (U1)</h1>
<p>Scegli un file da ~20 MB. Su iPhone prova anche la modalità aereo a metà, poi «Riprendi».</p>
<p><input type="file" id="file"></p>
<p><label><input type="checkbox" id="auto" checked> Interrompi automaticamente a metà</label></p>
<p>
  <button id="start">Carica</button>
  <button id="stop" disabled>Interrompi</button>
  <button id="resume" disabled>Riprendi</button>
</p>
<p>Stato: <strong id="status">idle</strong> · <span id="pct">0</span>%</p>
<div id="log"></div>
<script>
const CHUNK = 8 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
let file = null, session = null, ctrl = null, interrupted = false, t0 = 0;
const log = (m) => { $('log').textContent += ((performance.now() - t0) / 1000).toFixed(1) + 's  ' + m + '\\n'; };
const setStatus = (s) => {
  $('status').textContent = s;
  $('start').disabled = !file || s === 'uploading';
  $('stop').disabled = s !== 'uploading';
  $('resume').disabled = !session || s === 'uploading' || s === 'done';
};
const setSent = (n) => { $('pct').textContent = file ? Math.round(n / file.size * 100) : 0; };
log('UA: ' + navigator.userAgent);
$('file').onchange = (e) => { file = e.target.files[0] || null; session = null; setSent(0); setStatus('idle'); };

async function sendFrom(offset) {
  setStatus('uploading');
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size);
    ctrl = new AbortController();
    if ($('auto').checked && !interrupted && end >= file.size / 2) {
      interrupted = true;
      const c = ctrl; setTimeout(() => c.abort(), 200);
    }
    let res;
    try {
      res = await fetch(session, {
        method: 'PUT',
        headers: { 'Content-Range': 'bytes ' + offset + '-' + (end - 1) + '/' + file.size },
        body: file.slice(offset, end),
        signal: ctrl.signal,
      });
    } catch (err) {
      log('interrotto nel chunk ' + offset + '–' + (end - 1) + ': ' + err.name + ' ' + err.message);
      setStatus('interrupted');
      return;
    }
    if (res.status === 308) {
      const range = res.headers.get('Range');
      log('308 chunk ' + offset + '–' + (end - 1) + ' · Range = ' + (range || 'NON LEGGIBILE (header non esposto)'));
      offset = range ? Number(range.split('-')[1]) + 1 : end;
      setSent(offset);
      continue;
    }
    const text = (await res.text()).slice(0, 300);
    if (res.ok) { log('completato ' + res.status + ': ' + text); setSent(file.size); setStatus('done'); }
    else { log('errore ' + res.status + ': ' + text); setStatus('error'); }
    return;
  }
}

$('start').onclick = async () => {
  if (!file) return;
  t0 = performance.now(); interrupted = false; $('log').textContent = ''; setSent(0);
  log('file ' + file.name + ', ' + file.size + ' byte, ' + (file.type || 'tipo sconosciuto'));
  const res = await fetch(${JSON.stringify(sessionEndpoint).replace(/</g, '\\u003c')}, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, size: file.size, mimeType: file.type }),
  });
  const body = await res.json();
  if (!res.ok) { log('sessione non creata: ' + body.error); setStatus('error'); return; }
  session = body.sessionUrl;
  log('sessione creata con Origin ' + body.origin);
  await sendFrom(0);
};
$('stop').onclick = () => ctrl && ctrl.abort();
$('resume').onclick = async () => {
  let res;
  try {
    res = await fetch(session, { method: 'PUT', headers: { 'Content-Range': 'bytes */' + file.size } });
  } catch (err) { log('richiesta di stato fallita: ' + err.message); return; }
  if (res.status === 308) {
    const range = res.headers.get('Range');
    const next = range ? Number(range.split('-')[1]) + 1 : 0;
    log('stato: Range = ' + (range || 'assente') + ' → riprendo da ' + next);
    setSent(next);
    await sendFrom(next);
  } else if (res.ok) { log('già completato (' + res.status + ')'); setStatus('done'); }
  else { log('stato ' + res.status); setStatus('error'); }
};
setStatus('idle');
</script>
</body></html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  });
}
