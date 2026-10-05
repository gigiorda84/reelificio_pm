'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Pause, Play, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { abandonUpload, finishUpload, prepareUpload, type UploadError } from '@/lib/drive/actions';
import { UPLOAD_EXTENSIONS, UPLOAD_MAX_BYTES, uploadExtension, type UploadKind } from '@/lib/drive/naming';

// Browser → Google resumable session (docs/fase1-plan.md §S5, D6 → U1): the
// server reserves the version and opens the session in the reel folder, the
// file goes to Google in 8 MiB chunks (never through our server), each 308
// says how far Google got. A dropped connection is retried, then the upload
// pauses: "Riprendi" asks Google where it stopped (`bytes */<size>`) and goes
// on from there. At the end the server checks the file on Drive.

const CHUNK = 8 * 1024 * 1024; // a multiple of 256 KiB, as Drive requires
const RETRIES = 3;

type Phase = 'idle' | 'uploading' | 'paused' | 'verifying' | 'done' | 'error';
type Session = { url: string; fileId: string; name: string; file: File };

// "bytes=0-1234" → next offset 1235; none → nothing stored yet.
function nextOffset(res: Response): number {
  const range = res.headers.get('Range');
  return range ? Number(range.split('-')[1]) + 1 : 0;
}

async function driveId(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => null)) as { id?: string } | null;
  return body?.id && /^[A-Za-z0-9_-]{10,200}$/.test(body.id) ? body.id : undefined;
}

function megabytes(n: number): string {
  return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(0)} GB` : `${Math.round(n / 1024 ** 2)} MB`;
}

export function ResumableUpload({ taskId, kind }: { taskId: string; kind: UploadKind }) {
  const t = useTranslations('upload');
  const tErr = useTranslations('tasks.errors');
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [pct, setPct] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Why the running chunk was aborted: a pause keeps the session, a cancel
  // drops it.
  const stop = useRef<'pause' | 'cancel' | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Leaving the page mid-upload loses the session: ask first.
  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'paused') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [phase]);

  const showError = (text: string) => {
    setPhase('error');
    setMessage(text);
  };
  const fail = (error: UploadError) =>
    showError(error === 'upload_failed' || error === 'unknown' ? t('failed') : tErr(error));

  const finish = async (s: Session, drive?: string) => {
    setPhase('verifying');
    const result = await finishUpload({ fileId: s.fileId, driveFileId: drive });
    if (!result.ok) return fail(result.error);
    setPhase('done');
    setPct(100);
    toast.success(t('done', { name: s.name }));
    router.refresh();
  };

  // Where Google stopped; null when the session cannot answer.
  const status = async (s: Session): Promise<{ offset: number; drive?: string } | null> => {
    try {
      const res = await fetch(s.url, { method: 'PUT', headers: { 'Content-Range': `bytes */${s.file.size}` } });
      if (res.status === 308) return { offset: nextOffset(res) };
      if (res.ok) return { offset: s.file.size, drive: await driveId(res) };
      return null;
    } catch {
      return null;
    }
  };

  // The upload gave up for good: the reserved version is marked failed so
  // the next attempt starts clean.
  const giveUp = (s: Session) => {
    session.current = null;
    void abandonUpload(s.fileId);
    fail('upload_failed');
  };

  const pausedAt = (s: Session, offset: number) => {
    setPhase('paused');
    setMessage(t('paused', { pct: Math.floor((offset / s.file.size) * 100) }));
  };

  // One loop at a time: "Riprendi" and the online event must not start two.
  const running = useRef(false);

  const send = async (s: Session, from: number) => {
    if (running.current) return;
    running.current = true;
    try {
      await sendChunks(s, from);
    } finally {
      running.current = false;
    }
  };

  const sendChunks = async (s: Session, from: number) => {
    setPhase('uploading');
    setMessage(null);
    stop.current = null;
    let offset = from;
    let failures = 0;
    while (offset < s.file.size) {
      const end = Math.min(offset + CHUNK, s.file.size);
      abort.current = new AbortController();
      let res: Response;
      try {
        res = await fetch(s.url, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${s.file.size}` },
          body: s.file.slice(offset, end),
          signal: abort.current.signal,
        });
      } catch {
        if (abort.current.signal.aborted) {
          if (stop.current === 'pause') pausedAt(s, offset);
          return;
        }
        res = new Response(null, { status: 599 });
      }
      if (res.status === 308) {
        const next = nextOffset(res);
        if (next > offset) {
          offset = next;
          failures = 0;
          setPct(Math.floor((offset / s.file.size) * 100));
          continue;
        }
        // Google kept nothing of this chunk: counts as a failure below.
      } else if (res.ok) {
        return finish(s, await driveId(res));
      } else if (res.status === 404 || res.status === 410) {
        return giveUp(s); // the session expired
      }
      // Network drop, a 5xx, or no progress: ask Google where it got to.
      failures += 1;
      if (failures > RETRIES) return pausedAt(s, offset);
      await new Promise((r) => setTimeout(r, 1500 * failures));
      if (stop.current === 'cancel') return;
      if (stop.current === 'pause') return pausedAt(s, offset);
      const st = await status(s);
      if (st && st.offset >= s.file.size) return finish(s, st.drive);
      if (st) offset = st.offset;
    }
  };

  const resume = async () => {
    const s = session.current;
    if (!s || running.current) return;
    const st = await status(s);
    if (!st) return giveUp(s);
    if (st.offset >= s.file.size) return finish(s, st.drive);
    await send(s, st.offset);
  };

  // Back online: carry on by itself.
  useEffect(() => {
    if (phase !== 'paused') return;
    const online = () => void resume();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  });

  const start = async (file: File) => {
    setMessage(null);
    setPct(0);
    if (input.current) input.current.value = ''; // the same file can be picked again
    if (!uploadExtension(file.name, file.type, kind)) {
      return showError(t('wrongType', { types: UPLOAD_EXTENSIONS[kind].join(', ') }));
    }
    if (file.size > UPLOAD_MAX_BYTES[kind]) {
      return showError(t('tooLarge', { max: megabytes(UPLOAD_MAX_BYTES[kind]) }));
    }
    stop.current = null;
    setPhase('uploading');
    const prep = await prepareUpload({ taskId, kind, fileName: file.name, mimeType: file.type, size: file.size });
    if (!prep.ok) return fail(prep.error);
    if (stop.current === 'cancel') {
      // Cancelled while the session was being opened.
      void abandonUpload(prep.fileId);
      return;
    }
    session.current = { url: prep.sessionUrl, fileId: prep.fileId, name: prep.name, file };
    await send(session.current, 0);
  };

  const cancel = async () => {
    stop.current = 'cancel';
    abort.current?.abort();
    const s = session.current;
    session.current = null;
    setPhase('idle');
    setPct(0);
    setMessage(null);
    if (s) {
      // Google drops the partial upload; the reserved version is marked failed.
      void fetch(s.url, { method: 'DELETE' }).catch(() => undefined);
      await abandonUpload(s.fileId);
    }
  };

  const accept = [`${kind}/*`, ...UPLOAD_EXTENSIONS[kind].map((e) => `.${e}`)].join(',');
  const busy = phase === 'uploading' || phase === 'verifying';

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3 text-xs">
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        id={`upload-${taskId}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void start(file);
        }}
      />
      {phase === 'idle' || phase === 'error' || phase === 'done' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant={phase === 'done' ? 'outline' : 'default'} onClick={() => input.current?.click()}>
            <Upload className="size-3" aria-hidden /> {kind === 'audio' ? t('chooseAudio') : t('chooseVideo')}
          </Button>
          <span className="text-muted-foreground">{t('limit', { max: megabytes(UPLOAD_MAX_BYTES[kind]) })}</span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-2 rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>
              {phase === 'verifying' ? t('verifying') : phase === 'paused' ? t('pausedShort', { pct }) : t('uploading', { pct })}
            </span>
            <div className="flex gap-1">
              {phase === 'paused' ? (
                <Button size="sm" variant="outline" onClick={() => void resume()}>
                  <Play className="size-3" aria-hidden /> {t('resume')}
                </Button>
              ) : null}
              {phase === 'uploading' ? (
                <Button size="sm" variant="ghost" aria-label={t('pause')}
                  onClick={() => {
                    stop.current = 'pause';
                    abort.current?.abort();
                  }}>
                  <Pause className="size-3" aria-hidden />
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" disabled={phase === 'verifying'} onClick={() => void cancel()} aria-label={t('cancel')}>
                <X className="size-3" aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      )}
      {message ? <p className={phase === 'error' ? 'text-destructive' : 'text-muted-foreground'}>{message}</p> : null}
      {busy ? <p className="text-muted-foreground">{t('keepOpen')}</p> : null}
    </div>
  );
}
