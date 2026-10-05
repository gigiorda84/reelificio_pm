// Who keeps access to a reel folder (docs/fase1-plan.md §S5, step 4): the
// difference between the shares the tasks want and the permissions on
// Drive. Pure, so the rules are unit tested:
// - a wanted share is there when the person already reaches the folder with
//   that role or more, directly or as a member of the Shared Drive;
// - only purely direct permissions are revoked: anything with an inherited
//   part (a Shared Drive member) stays, as removing it from a folder fails
//   on every run;
// - user and anyone-with-the-link permissions not wanted are revoked;
// - a wanted share with a lower direct role is revoked and granted again;
// - a share live in the database with nothing on Drive and no longer wanted
//   is just closed (forget).

export type ShareRole = 'reader' | 'writer';

export type DrivePermission = {
  id: string;
  type: string;
  role: string;
  emailAddress?: string;
  permissionDetails?: { inherited?: boolean }[];
};

export type DesiredShare = { user_id: string | null; email: string; role: ShareRole };

export type RecordedShare = {
  user_id: string | null;
  email: string;
  role: string;
  permission_id: string | null;
  last_error: string | null;
};

export type SharePlan = {
  create: DesiredShare[];
  revoke: { permissionId: string; email: string | null }[];
  forget: RecordedShare[];
};

// Nothing inherited from the Shared Drive: the app (or someone by hand)
// shared it on the folder itself.
export function isDirect(p: DrivePermission): boolean {
  return !p.permissionDetails?.length || p.permissionDetails.every((d) => d.inherited === false);
}

const RANK: Record<string, number> = { reader: 1, commenter: 2, writer: 3, fileOrganizer: 4, organizer: 5, owner: 6 };

const lower = (s: string | undefined | null) => (s ?? '').trim().toLowerCase();

export function planShares(args: {
  desired: DesiredShare[];
  recorded: RecordedShare[];
  current: DrivePermission[];
  // Never touched: the service account itself.
  ignoreEmails?: string[];
}): SharePlan {
  const ignore = new Set((args.ignoreEmails ?? []).map(lower));
  const direct = args.current.filter(
    (p) => (p.type === 'user' || p.type === 'anyone') && isDirect(p) && !ignore.has(lower(p.emailAddress)),
  );

  const create: DesiredShare[] = [];
  const kept = new Set<string>();
  for (const d of args.desired) {
    const enough = args.current.filter(
      (p) => p.type === 'user' && lower(p.emailAddress) === lower(d.email) && (RANK[p.role] ?? 0) >= RANK[d.role],
    );
    if (enough.length) enough.forEach((p) => kept.add(p.id));
    else create.push(d);
  }

  const revoke = direct
    .filter((p) => !kept.has(p.id))
    .map((p) => ({ permissionId: p.id, email: p.emailAddress ? lower(p.emailAddress) : null }));

  const wanted = new Set(args.desired.map((d) => lower(d.email)));
  const onDrive = new Set(direct.map((p) => lower(p.emailAddress)).filter(Boolean));
  const onDriveIds = new Set(direct.map((p) => p.id));
  const forget = args.recorded.filter(
    (r) =>
      !wanted.has(lower(r.email)) &&
      !onDrive.has(lower(r.email)) &&
      !(r.permission_id && onDriveIds.has(r.permission_id)),
  );

  return { create, revoke, forget };
}
