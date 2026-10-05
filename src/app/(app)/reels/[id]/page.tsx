import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CommentsThread } from '@/components/comments/comments-thread';
import { getReelDetail } from '@/lib/reels/queries';
import { getRaciConfigForPage, getRaciUsers } from '@/lib/raci/queries';
import { getAdminStatus } from '@/lib/auth/admin';
import { getViewer } from '@/lib/auth/viewer';
import { listInvitesForReel } from '@/lib/invites/queries';
import { listDodForReel } from '@/lib/dod/queries';
import { getOpenTask, getTaskPeople, listAssignableProfiles, listProposals } from '@/lib/tasks/queries';
import { REEL_STATES } from '@/lib/reels/constants';
import { ScriptTab } from './script-tab';
import { ScriptReadOnly } from './script-read-only';
import { Proposals } from './proposals';
import { VoiceTab } from './voice-tab';
import { FilesTab } from './files-tab';
import { PublishTab } from './publish-tab';
import { TaskPanel } from './task-panel';
import { InvitePanel } from './invite-panel';
import { DoDChecklist } from './dod-checklist';
import { formatRome } from '@/lib/dates';

export default async function ReelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { id } = await params;
  const { task: linkedTaskId } = await searchParams;
  const reel = await getReelDetail(id);
  if (!reel) notFound();

  const [tDetail, tTabs, tPhase, tFmt, tCat, tState, tFiles, openTask, people, raci, admin, me, proposals] =
    await Promise.all([
      getTranslations('reels.detail'),
      getTranslations('reels.tabs'),
      getTranslations('batches.reel.phase'),
      getTranslations('batches.reel.format'),
      getTranslations('batches.reel.category'),
      getTranslations('states'),
      getTranslations('reels.files'),
      getOpenTask(id),
      getTaskPeople(reel.page_id),
      getRaciConfigForPage(reel.page_id),
      getAdminStatus(),
      getViewer(),
      listProposals(id),
    ]);
  // Externals see the script, the voice brief, the delivered files, the
  // comments and their task; not RACI, DoD, invites or the batch.
  const isExternal = !!me?.isExternal;
  const [invites, assignable] = admin.isAdmin
    ? await Promise.all([listInvitesForReel(id), listAssignableProfiles()])
    : [[], []];

  // What the viewer may do with the task panel; the SQL checks it again.
  const uid = admin.userId;
  const isGroupApprover = !!uid && (uid === people.approverId || uid === people.delegateId);
  const publicationRaci = raci.find((r) => r.phase === 'publication');
  const inPublicationRaci =
    !!uid &&
    !!publicationRaci &&
    (['responsible', 'approver', 'consulted'] as const).some((role) =>
      getRaciUsers(publicationRaci, role).includes(uid),
    );
  const viewer = {
    userId: uid,
    isAdmin: admin.isAdmin,
    canDecide:
      !!openTask &&
      (admin.isAdmin ||
        openTask.assignee_id === uid ||
        (openTask.kind !== 'validation' && isGroupApprover)),
    canSetTrack: admin.isAdmin || (!!uid && uid === people.approverId),
    canPublish:
      admin.isAdmin ||
      inPublicationRaci ||
      (openTask?.kind === 'scheduling' && openTask.assignee_id === uid),
  };
  const linkedTaskClosed = !!linkedTaskId && linkedTaskId !== openTask?.id;

  // From revisione on the script is locked except for admins; whoever works
  // on the reel proposes changes (SQL: open task, RACI on the page, admin).
  const stateIdx = REEL_STATES.indexOf(reel.state);
  const scriptLocked = stateIdx >= REEL_STATES.indexOf('revisione');
  const inPageRaci =
    !!uid &&
    raci.some((r) =>
      (['responsible', 'approver', 'consulted', 'informed'] as const).some((role) =>
        getRaciUsers(r, role).includes(uid),
      ),
    );
  const canPropose =
    scriptLocked &&
    reel.state !== 'pubblicato' &&
    (admin.isAdmin || inPageRaci || (!!openTask && openTask.assignee_id === uid));
  const canDecideProposals = admin.isAdmin || isGroupApprover;

  const currentRaci = raci.find((r) => r.phase === reel.phase);
  const isResponsible =
    !!admin.userId &&
    !!currentRaci &&
    getRaciUsers(currentRaci, 'responsible').includes(admin.userId);
  const isApprover =
    !!admin.userId &&
    !!currentRaci &&
    getRaciUsers(currentRaci, 'approver').includes(admin.userId);

  const showDod =
    !isExternal && (reel.phase === 'editing' || reel.phase === 'publication');
  const dodItems = showDod ? await listDodForReel(id) : [];
  const dodEditable =
    reel.phase === 'editing' && (admin.isAdmin || isResponsible || isApprover);

  const phaseEntered = new Date(reel.phase_entered_at);

  return (
    <div className="space-y-6 max-w-6xl">
      <Link
        href={isExternal ? '/compiti' : `/batches/${reel.batch_id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {isExternal ? tDetail('backToTasks') : tDetail('back')}
      </Link>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            <span className="font-mono mr-2">{reel.code}</span>
            <span>{reel.page_name}</span>
            {isExternal ? null : (
              <>
                <span className="mx-2">·</span>
                <span>{reel.batch_label}</span>
              </>
            )}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {reel.title}
          </h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Pill>{tFmt(reel.format as 'porcino_mono')}</Pill>
            <Pill>{tCat(reel.category as 'safe')}</Pill>
            <span>·</span>
            <span>
              {tDetail('currentState')}:{' '}
              <span className="font-medium text-foreground">{tState(reel.state)}</span>
            </span>
            {isExternal ? null : (
              <>
                <span>·</span>
                <span>
                  {tDetail('currentPhase')}:{' '}
                  <span className="font-medium text-foreground">
                    {tPhase(reel.phase as 'research_prescript')}
                  </span>
                  <span className="ml-2">
                    {tDetail('phaseEnteredAt')}{' '}
                    {formatRome(phaseEntered)}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
        <TaskPanel
          reelId={reel.id}
          state={reel.state}
          track={reel.track}
          scriptRev={reel.script_rev}
          caption={reel.caption}
          postedUrl={reel.posted_url}
          task={openTask}
          linkedTaskClosed={linkedTaskClosed}
          viewer={viewer}
          assignable={assignable}
        />
      </header>

      <Tabs defaultValue="script">
        <TabsList>
          <TabsTrigger value="script">{tTabs('script')}</TabsTrigger>
          <TabsTrigger value="voice">{tTabs('voice')}</TabsTrigger>
          <TabsTrigger value="files">{tTabs('files')}</TabsTrigger>
          {isExternal ? null : <TabsTrigger value="publish">{tTabs('publish')}</TabsTrigger>}
          <TabsTrigger value="comments">{tTabs('comments')}</TabsTrigger>
        </TabsList>

        <TabsContent value="script" className="space-y-8 pt-4">
          {isExternal || (scriptLocked && !admin.isAdmin) ? (
            <ScriptReadOnly reel={reel} canPropose={canPropose} />
          ) : (
            <ScriptTab reel={reel} />
          )}
          <Proposals
            reelId={reel.id}
            proposals={proposals}
            scriptRev={reel.script_rev}
            canDecide={canDecideProposals}
          />
        </TabsContent>
        <TabsContent value="voice" className="pt-4">
          <VoiceTab pageId={reel.page_id} />
        </TabsContent>
        <TabsContent value="files" className="pt-4">
          {isExternal ? (
            <DeliveredFiles
              links={[
                [tFiles('audio'), reel.audio_drive_url],
                [tFiles('video'), reel.video_drive_url],
              ]}
              empty={tFiles('noneDelivered')}
            />
          ) : (
            <FilesTab reel={reel} />
          )}
        </TabsContent>
        {isExternal ? null : (
          <TabsContent value="publish" className="pt-4">
            <PublishTab reel={reel} />
          </TabsContent>
        )}
        <TabsContent value="comments" className="pt-4">
          <CommentsThread targetType="reel" targetId={reel.id} />
        </TabsContent>
      </Tabs>

      {showDod ? (
        <DoDChecklist reelId={reel.id} items={dodItems} editable={dodEditable} />
      ) : null}

      {admin.isAdmin ? <InvitePanel invites={invites} /> : null}
    </div>
  );
}

// What the previous step delivered (the approved audio for the animator),
// read-only: externals cannot write the reel.
function DeliveredFiles({ links, empty }: { links: [string, string | null][]; empty: string }) {
  const present = links.filter((l): l is [string, string] => !!l[1]);
  if (present.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="max-w-2xl space-y-2 text-sm">
      {present.map(([label, url]) => (
        <li key={label} className="flex items-center gap-2">
          <span className="text-muted-foreground">{label}:</span>
          <a href={url} target="_blank" rel="noreferrer" className="truncate underline">
            {url}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
      {children}
    </span>
  );
}
