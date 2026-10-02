import type { NextRequest } from 'next/server';
import { DRIVE_ID_RE, canAccessSpike, esc } from '@/lib/spike/access';
import { getFileMeta } from '@/lib/spike/drive';

// S0 spike, iPhone media test (AC2). A bare HTML page, outside the app layout,
// so it also opens in the Telegram in-app browser through a signed link:
//   (a) Drive's own preview iframe, (b) <audio> served by /api/spike/audio,
//   (c) "Apri in Drive". The page reports load and tap→playback times.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  const query = req.nextUrl.search; // carries exp/sig when signed
  const audioSrc = `/api/spike/audio/${fileId}${query}`;
  const mb = (meta.size / 1024 / 1024).toFixed(1);

  const html = `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spike media</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 16px; max-width: 640px; }
  h1 { font-size: 18px; } h2 { font-size: 15px; margin-top: 24px; }
  iframe { width: 100%; height: 160px; border: 1px solid #ccc; }
  audio { width: 100%; } code { font-size: 12px; }
  #log { font: 12px/1.5 ui-monospace, monospace; white-space: pre-wrap; background: #f4f4f4; padding: 8px; }
</style></head><body>
<h1>${esc(meta.name)} <small>(${mb} MB, ${esc(meta.mimeType)})</small></h1>

<h2>(a) Anteprima Drive in iframe</h2>
<iframe src="https://drive.google.com/file/d/${fileId}/preview" allow="autoplay"></iframe>

<h2>(b) Audio servito dal server (Range, 206 da max 4 MB)</h2>
<audio id="player" controls preload="metadata" src="${esc(audioSrc)}"></audio>

<h2>(c) Link</h2>
<p><a href="https://drive.google.com/file/d/${fileId}/view" target="_blank" rel="noopener">Apri in Drive</a></p>

<h2>Tempi</h2>
<div id="log"></div>
<script>
  const log = (m) => { document.getElementById('log').textContent += m + '\\n'; };
  const since = () => Math.round(performance.now()) + ' ms';
  log('UA: ' + navigator.userAgent);
  document.addEventListener('DOMContentLoaded', () => log('pagina pronta: ' + since()));
  const p = document.getElementById('player');
  let tapAt = 0, seekAt = 0;
  p.addEventListener('loadedmetadata', () => log('metadata (durata ' + Math.round(p.duration) + ' s): ' + since()));
  p.addEventListener('play', () => { tapAt = performance.now(); log('tap play: ' + since()); });
  p.addEventListener('playing', () => {
    if (tapAt) { log('tap → riproduzione: ' + Math.round(performance.now() - tapAt) + ' ms'); tapAt = 0; }
    if (seekAt) { log('salto → riproduzione: ' + Math.round(performance.now() - seekAt) + ' ms'); seekAt = 0; }
  });
  p.addEventListener('seeking', () => { seekAt = performance.now(); log('salto a ' + Math.round(p.currentTime) + ' s'); });
  p.addEventListener('error', () => log('errore audio: ' + (p.error && p.error.code)));
</script>
</body></html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
    },
  });
}
