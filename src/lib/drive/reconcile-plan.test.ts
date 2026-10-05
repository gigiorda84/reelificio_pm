import { describe, expect, it } from 'vitest';
import { planShares, type DrivePermission } from './reconcile-plan';

const member: DrivePermission = {
  id: 'm1',
  type: 'user',
  role: 'organizer',
  emailAddress: 'gabri@reelificio.com',
  permissionDetails: [{ inherited: true }],
};
const robot: DrivePermission = {
  id: 'sa',
  type: 'user',
  role: 'organizer',
  emailAddress: 'robot@project.iam.gserviceaccount.com',
  permissionDetails: [{ inherited: false }],
};
const animator: DrivePermission = {
  id: 'p91',
  type: 'user',
  role: 'reader',
  emailAddress: 'Animatore@Gmail.com',
  permissionDetails: [{ inherited: false }],
};

const want = { user_id: 'u91', email: 'animatore@gmail.com', role: 'reader' as const };

describe('planShares', () => {
  it('creates what the tasks want and is missing', () => {
    const plan = planShares({ desired: [want], recorded: [], current: [member] });
    expect(plan).toEqual({ create: [want], revoke: [], forget: [] });
  });

  it('keeps a matching direct permission (email case ignored)', () => {
    const plan = planShares({ desired: [want], recorded: [], current: [member, animator] });
    expect(plan).toEqual({ create: [], revoke: [], forget: [] });
  });

  it('revokes direct permissions nobody wants, never inherited ones or the service account', () => {
    const plan = planShares({
      desired: [],
      recorded: [],
      current: [member, robot, animator],
      ignoreEmails: ['robot@project.iam.gserviceaccount.com'],
    });
    expect(plan.revoke).toEqual([{ permissionId: 'p91', email: 'animatore@gmail.com' }]);
    expect(plan.create).toEqual([]);
  });

  it('revokes an anyone-with-the-link permission', () => {
    const plan = planShares({
      desired: [],
      recorded: [],
      current: [{ id: 'anyoneWithLink', type: 'anyone', role: 'reader', permissionDetails: [{ inherited: false }] }],
    });
    expect(plan.revoke).toEqual([{ permissionId: 'anyoneWithLink', email: null }]);
  });

  it('never revokes a permission with an inherited part (a Shared Drive member)', () => {
    const both: DrivePermission = { ...member, id: 'm2', role: 'reader', permissionDetails: [{ inherited: true }, { inherited: false }] };
    expect(planShares({ desired: [], recorded: [], current: [both] }).revoke).toEqual([]);
  });

  it('a member already reaches the folder: nothing to grant', () => {
    const plan = planShares({
      desired: [{ user_id: 'u1', email: 'gabri@reelificio.com', role: 'reader' }],
      recorded: [],
      current: [member],
    });
    expect(plan).toEqual({ create: [], revoke: [], forget: [] });
  });

  it('a wanted share with a lower role is replaced; a higher one is enough', () => {
    const commenter = { ...animator, role: 'commenter' };
    const writerWanted = { ...want, role: 'writer' as const };
    const plan = planShares({ desired: [writerWanted], recorded: [], current: [commenter] });
    expect(plan.create).toEqual([writerWanted]);
    expect(plan.revoke).toEqual([{ permissionId: 'p91', email: 'animatore@gmail.com' }]);
    expect(planShares({ desired: [want], recorded: [], current: [{ ...animator, role: 'writer' }] }).create).toEqual([]);
  });

  it('closes recorded shares with nothing on Drive and no task', () => {
    const failed = { user_id: 'u1', email: 'not.google@example.com', role: 'reader', permission_id: null, last_error: 'no Google account' };
    const stillOnDrive = { user_id: 'u91', email: 'animatore@gmail.com', role: 'reader', permission_id: 'p91', last_error: null };
    const plan = planShares({ desired: [], recorded: [failed, stillOnDrive], current: [animator] });
    expect(plan.forget).toEqual([failed]);
    expect(plan.revoke).toEqual([{ permissionId: 'p91', email: 'animatore@gmail.com' }]);
  });

  it('retries a wanted share that failed before', () => {
    const failed = { user_id: 'u91', email: 'animatore@gmail.com', role: 'reader', permission_id: null, last_error: 'x' };
    const plan = planShares({ desired: [want], recorded: [failed], current: [] });
    expect(plan.create).toEqual([want]);
    expect(plan.forget).toEqual([]);
  });
});
