import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { TaskRow } from '@/components/tasks/task-row';
import { getViewer } from '@/lib/auth/viewer';
import { listMyOpenTasks, listUnassignedTasks } from '@/lib/tasks/queries';

// Home for everyone: my open tasks, Express first, then the nearest
// deadline. Admins also see the tasks nobody could take.
export default async function TasksPage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/login');
  const t = await getTranslations('tasks.list');
  const [mine, unassigned] = await Promise.all([
    listMyOpenTasks(viewer.userId),
    viewer.isAdmin ? listUnassignedTasks() : Promise.resolve([]),
  ]);

  return (
    <div className="max-w-3xl space-y-8">
      <section className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {mine.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">{t('empty')}</Card>
        ) : (
          <div className="space-y-2">
            {mine.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </section>

      {viewer.isAdmin && unassigned.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-medium tracking-tight">{t('unassignedTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('unassignedSubtitle')}</p>
          </div>
          <div className="space-y-2">
            {unassigned.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
