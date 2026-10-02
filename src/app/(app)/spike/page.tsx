import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { getAdminStatus } from '@/lib/auth/admin';
import { DRIVE_ID_RE } from '@/lib/spike/access';
import { signSpike } from '@/lib/spike/sign';
import { SentryClientTest } from './sentry-client-test';

// S0 spikes (docs/fase1-plan.md §S0), admin only. Removed at the end of S0
// together with /api/spike and src/lib/spike, so the copy stays inline here
// instead of in it.json. For links to a Vercel Preview use
// scripts/spike-sign.ts instead.
export const dynamic = 'force-dynamic';

function SignedLink({ label, href }: { label: string; href: string }) {
  return (
    <div className="space-y-1">
      <a className="text-sm underline" href={href}>
        {label}
      </a>
      <pre className="text-xs whitespace-pre-wrap break-all bg-muted p-2 rounded-md">{href}</pre>
    </div>
  );
}

export default async function SpikePage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string }>;
}) {
  const { isAdmin } = await getAdminStatus();
  if (!isAdmin) redirect('/dashboard');

  const { file } = await searchParams;
  const fileId = file && DRIVE_ID_RE.test(file) ? file : null;
  const folderId = process.env.SPIKE_DRIVE_FOLDER_ID ?? '';
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Spike S0</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Prove temporanee per upload su Drive, media su iPhone e Sentry. Link firmati validi 24 ore,
          apribili senza login. Origine: {origin}
        </p>
      </div>

      <Card className="p-5 space-y-3">
        <h2 className="font-medium">1 · Upload dal browser (U1 o U3)</h2>
        {DRIVE_ID_RE.test(folderId) ? (
          <SignedLink
            label="Apri la pagina di upload"
            href={`${origin}/api/spike/upload/${folderId}?${signSpike('upload', folderId)}`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Imposta SPIKE_DRIVE_FOLDER_ID.</p>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-medium">2 · Media su iPhone (AC2)</h2>
        <form className="flex gap-2" method="get">
          <input
            name="file"
            defaultValue={fileId ?? ''}
            placeholder="id del file Drive"
            className="flex-1 rounded-md border px-3 py-1.5 text-sm"
          />
          <button type="submit" className="rounded-md border px-3 py-1.5 text-sm">
            Prepara
          </button>
        </form>
        {fileId && (
          <SignedLink
            label="Apri la pagina media"
            href={`${origin}/api/spike/media/${fileId}?${signSpike('media', fileId)}`}
          />
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-medium">3 · Sentry</h2>
        <div className="flex flex-wrap gap-2">
          <a className="rounded-md border px-3 py-1.5 text-sm" href="/api/spike/sentry">
            Errore di prova (server)
          </a>
          <SentryClientTest />
        </div>
      </Card>
    </div>
  );
}
