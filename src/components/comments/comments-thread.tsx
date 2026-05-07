import { getTranslations } from 'next-intl/server';
import { listComments, type CommentTarget } from '@/lib/comments/queries';
import { listProfiles } from '@/lib/profiles/queries';
import { CommentForm } from './comment-form';
import { CommentItem } from './comment-item';

type Props = {
  targetType: CommentTarget;
  targetId: string;
};

export async function CommentsThread({ targetType, targetId }: Props) {
  const [t, comments, profiles] = await Promise.all([
    getTranslations('comments'),
    listComments(targetType, targetId),
    listProfiles(),
  ]);

  return (
    <div className="space-y-4">
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ol className="space-y-3">
          {comments.map((c) => (
            <li key={c.id}>
              <CommentItem comment={c} profiles={profiles} />
            </li>
          ))}
        </ol>
      )}
      <CommentForm targetType={targetType} targetId={targetId} profiles={profiles} />
    </div>
  );
}
