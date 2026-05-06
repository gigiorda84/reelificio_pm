import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CommentsThread } from '@/components/comments/comments-thread';
import { getReelDetail } from '@/lib/reels/queries';
import { ScriptTab } from './script-tab';
import { VoiceTab } from './voice-tab';
import { FilesTab } from './files-tab';
import { PublishTab } from './publish-tab';
import { PhaseControl } from './phase-control';

export default async function ReelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const reel = await getReelDetail(id);
  if (!reel) notFound();

  const [tDetail, tTabs, tPhase, tFmt, tCat] = await Promise.all([
    getTranslations('reels.detail'),
    getTranslations('reels.tabs'),
    getTranslations('batches.reel.phase'),
    getTranslations('batches.reel.format'),
    getTranslations('batches.reel.category'),
  ]);

  const phaseEntered = new Date(reel.phase_entered_at);

  return (
    <div className="space-y-6 max-w-6xl">
      <Link
        href={`/batches/${reel.batch_id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {tDetail('back')}
      </Link>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            <span className="font-mono mr-2">{reel.code}</span>
            <span>{reel.page_name}</span>
            <span className="mx-2">·</span>
            <span>{reel.batch_label}</span>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {reel.title}
          </h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Pill>{tFmt(reel.format as 'porcino_mono')}</Pill>
            <Pill>{tCat(reel.category as 'safe')}</Pill>
            <span>·</span>
            <span>
              {tDetail('currentPhase')}:{' '}
              <span className="font-medium text-foreground">
                {tPhase(reel.phase as 'research')}
              </span>
              <span className="ml-2">
                {tDetail('phaseEnteredAt')}{' '}
                {phaseEntered.toLocaleString('it-IT', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}
              </span>
            </span>
          </div>
        </div>
        <PhaseControl reelId={reel.id} currentPhase={reel.phase} />
      </header>

      <Tabs defaultValue="script">
        <TabsList>
          <TabsTrigger value="script">{tTabs('script')}</TabsTrigger>
          <TabsTrigger value="voice">{tTabs('voice')}</TabsTrigger>
          <TabsTrigger value="files">{tTabs('files')}</TabsTrigger>
          <TabsTrigger value="publish">{tTabs('publish')}</TabsTrigger>
          <TabsTrigger value="comments">{tTabs('comments')}</TabsTrigger>
        </TabsList>

        <TabsContent value="script" className="pt-4">
          <ScriptTab reel={reel} />
        </TabsContent>
        <TabsContent value="voice" className="pt-4">
          <VoiceTab pageId={reel.page_id} />
        </TabsContent>
        <TabsContent value="files" className="pt-4">
          <FilesTab reel={reel} />
        </TabsContent>
        <TabsContent value="publish" className="pt-4">
          <PublishTab reel={reel} />
        </TabsContent>
        <TabsContent value="comments" className="pt-4">
          <CommentsThread targetType="reel" targetId={reel.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
      {children}
    </span>
  );
}
