import { getTranslations } from 'next-intl/server';
import { getViewer } from '@/lib/auth/viewer';
import { listComments, type CommentRow, type CommentTarget } from '@/lib/comments/queries';
import { listProfiles, type ProfileLite } from '@/lib/profiles/queries';
import { CommentForm } from './comment-form';
import { CommentItem } from './comment-item';

type Props = {
  targetType: CommentTarget;
  targetId: string;
};

// An external may mention the people already in the thread (names only:
// profile_names() never returns emails).
function threadPeople(comments: CommentRow[]): ProfileLite[] {
  const byId = new Map<string, ProfileLite>();
  for (const c of comments) {
    if (c.author_id && c.author_full_name && !byId.has(c.author_id)) {
      byId.set(c.author_id, { id: c.author_id, email: '', full_name: c.author_full_name });
    }
  }
  return [...byId.values()];
}

export async function CommentsThread({ targetType, targetId }: Props) {
  const [t, comments, viewer] = await Promise.all([
    getTranslations('comments'),
    listComments(targetType, targetId),
    getViewer(),
  ]);
  const isInternal = !!viewer && !viewer.isExternal;
  const profiles = isInternal ? await listProfiles() : threadPeople(comments);

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="space-y-3">
          {comments.map((c) => (
            <li key={c.id}>
              <CommentItem comment={c} profiles={profiles} allowInternal={isInternal && targetType === 'reel'} />
            </li>
          ))}
        </ol>
      )}
      <CommentForm
        targetType={targetType}
        targetId={targetId}
        profiles={profiles}
        allowInternal={isInternal && targetType === 'reel'}
      />
    </div>
  );
}
