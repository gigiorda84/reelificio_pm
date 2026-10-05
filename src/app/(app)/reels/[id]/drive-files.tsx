import { getTranslations } from 'next-intl/server';
import { ExternalLink, FolderOpen } from 'lucide-react';
import type { ReelFile } from '@/lib/drive/queries';

// The reel's files on Drive (S5): each uploaded version and the kit, newest
// first, with what is approved and what went to archivio/. Audio plays here
// through /api/media (a phone needs no Google login).
export async function DriveFiles({ files, folderUrl }: { files: ReelFile[]; folderUrl: string | null }) {
  const t = await getTranslations('reels.files');
  if (files.length === 0 && !folderUrl) return null;

  return (
    <section className="max-w-2xl space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">{t('driveFiles')}</h2>
        {folderUrl ? (
          <a href={folderUrl} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
            <FolderOpen className="size-3" aria-hidden /> {t('openFolder')}
          </a>
        ) : null}
      </div>
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noDriveFiles')}</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {files.map((f) => (
            <li key={f.id} className={`space-y-1.5 px-3 py-2 ${f.archived_at ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-xs text-muted-foreground">{t(`kind.${f.kind}`)}</span>
                <span className="break-all font-mono text-xs">{f.name}</span>
                {f.approved_at ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    {t('approved')}
                  </span>
                ) : null}
                {f.archived_at ? (
                  <span className="rounded-full border px-2 py-0.5 text-[11px]">{t('archived')}</span>
                ) : null}
                {f.web_view_link ? (
                  <a href={f.web_view_link} target="_blank" rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                    <ExternalLink className="size-3" aria-hidden /> {t('openInDrive')}
                  </a>
                ) : null}
              </div>
              {f.kind === 'audio' && !f.archived_at ? (
                <audio controls preload="none" src={`/api/media/${f.id}`} className="h-8 w-full" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
