import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { redeemInviteToken, listInviteComments } from '@/lib/invites/queries';
import { InviteScript } from './invite-script';
import { InviteFiles } from './invite-files';
import { InviteComments } from './invite-comments';
import { InviteMarkDone } from './invite-mark-done';

export const dynamic = 'force-dynamic';

export default async function InviteTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await redeemInviteToken(token);

  const [t, tPhase] = await Promise.all([
    getTranslations('invites.public'),
    getTranslations('batches.reel.phase'),
  ]);

  if (!result.ok) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-lg border p-6 space-y-2">
          <h1 className="text-lg font-semibold">{t('unavailableTitle')}</h1>
          <p className="text-sm text-muted-foreground">
            {result.error === 'expired'
              ? t('expired')
              : result.error === 'revoked'
                ? t('revoked')
                : t('notFound')}
          </p>
        </div>
      </main>
    );
  }

  const { invite, reel } = result.data;
  if (!reel) notFound();

  const comments = await listInviteComments(reel.id);

  return (
    <main className="min-h-screen bg-muted/20">
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <header className="space-y-1">
          <p className="text-xs text-muted-foreground">
            <span className="font-mono mr-2">{reel.code}</span>
            <span>{reel.page_name}</span>
            <span className="mx-2">·</span>
            <span>{reel.batch_label}</span>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{reel.title}</h1>
          <p className="text-xs text-muted-foreground">
            {t('currentPhase')}:{' '}
            <span className="font-medium text-foreground">
              {tPhase(reel.phase as 'research_prescript')}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {t('youAre')}: <strong>{invite.external_label ?? '—'}</strong>
          </p>
        </header>

        <InviteScript reel={reel} />

        <section className="rounded-lg border bg-background p-4 space-y-3">
          <h2 className="text-sm font-medium">{t('filesTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('filesHelp')}</p>
          <InviteFiles
            token={token}
            audio={reel.audio_drive_url}
            video={reel.video_drive_url}
          />
        </section>

        <section className="rounded-lg border bg-background p-4 space-y-3">
          <h2 className="text-sm font-medium">{t('commentsTitle')}</h2>
          <InviteComments token={token} comments={comments} />
        </section>

        <section className="rounded-lg border bg-background p-4 space-y-3">
          <h2 className="text-sm font-medium">{t('markDoneTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('markDoneHelp')}</p>
          <InviteMarkDone token={token} />
        </section>
      </div>
    </main>
  );
}
