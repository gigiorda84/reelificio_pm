import { describe, expect, it } from 'vitest';
import { parseCallback } from '@/lib/telegram/callback';
import { proposalMessage, taskMessage, type MessageReel, type MessageTask } from './task-messages';

const APP = 'https://app.reelificio.com';
const reel: MessageReel = {
  id: 'r1',
  code: 'TT-2611-01',
  title: 'Il <segreto> dell’amico & co',
  express: false,
  scriptRev: 7,
  hook: 'Lo sapevi?',
  corpo: 'Corpo del testo',
  chiusura: null,
  cta: 'Seguici',
  rawContent: null,
  audioUrl: 'https://drive.google.com/file/d/audio',
  videoUrl: null,
};
const task = (over: Partial<MessageTask> = {}): MessageTask => ({
  id: '0f8b2c1e-1d2a-4c3b-9a8e-7f6d5c4b3a21',
  kind: 'review',
  status: 'in_progress',
  dueAt: '2026-10-23T16:00:00Z',
  ...over,
});
const ops = (m: { buttons: { text: string; callback_data?: string; url?: string }[][] }) =>
  m.buttons.flat().map((b) => (b.callback_data ? parseCallback(b.callback_data)?.op : 'url'));

describe('taskMessage', () => {
  it('escapes HTML in titles and links to the task', () => {
    const m = taskMessage({ event: 'assignment', appUrl: APP, task: task({ kind: 'writing' }), reel, role: 'assignee' });
    expect(m.telegram).toContain('Il &lt;segreto&gt; dell’amico &amp; co');
    expect(m.telegram).not.toContain('<segreto>');
    expect(m.link).toBe(`${APP}/reels/r1?task=0f8b2c1e-1d2a-4c3b-9a8e-7f6d5c4b3a21`);
    expect(m.text).toContain(m.link);
  });

  it('shows deadlines in Rome time', () => {
    const m = taskMessage({ event: 'assignment', appUrl: APP, task: task({ kind: 'writing' }), reel, role: 'assignee' });
    expect(m.text).toContain('18:00');
  });

  it('a script approval carries the script and the revision seen', () => {
    const m = taskMessage({ event: 'phase_approval_request', appUrl: APP, task: task(), reel, role: 'approver' });
    expect(m.telegram).toContain('Lo sapevi?');
    const approve = m.buttons.flat().find((b) => 'callback_data' in b && parseCallback(b.callback_data)?.op === 'apr');
    expect(approve && 'callback_data' in approve && parseCallback(approve.callback_data)?.rev).toBe(7);
    expect(ops(m)).toEqual(['apr', 'rim', 'url']);
  });

  it('a script too long for Telegram cannot be approved there', () => {
    const long = { ...reel, corpo: 'x'.repeat(5000) };
    const m = taskMessage({ event: 'phase_approval_request', appUrl: APP, task: task(), reel: long, role: 'approver' });
    expect(ops(m)).toEqual(['url']);
    expect(m.telegram.length).toBeLessThan(4096);
  });

  it('buttons by kind: accept/decline, audio approval with the audio, nothing for observers', () => {
    expect(ops(taskMessage({ event: 'assignment', appUrl: APP, task: task({ kind: 'dubbing', status: 'assigned' }), reel, role: 'assignee' })))
      .toEqual(['acc', 'dec', 'url']);
    expect(ops(taskMessage({ event: 'phase_approval_request', appUrl: APP, task: task({ kind: 'audio_approval' }), reel, role: 'approver' })))
      .toEqual(['apr', 'rim', 'url', 'url']);
    expect(ops(taskMessage({ event: 'task_escalated', appUrl: APP, task: task({ kind: 'animation' }), reel, role: 'observer', assigneeName: 'Ada' })))
      .toEqual(['url']);
  });

  it('no URL buttons for a local app (Telegram refuses them), the link stays in the text', () => {
    const m = taskMessage({ event: 'assignment', appUrl: 'http://localhost:3000', task: task({ kind: 'writing' }), reel, role: 'assignee' });
    expect(m.buttons).toEqual([]);
    expect(m.telegram).toContain('http://localhost:3000/reels/r1');
  });

  it('a send-back carries its note; an unassigned task says so', () => {
    const back = taskMessage({ event: 'phase_rejected', appUrl: APP, task: task({ kind: 'animation' }), reel, role: 'assignee', note: 'Sottotitoli <fuori> sincrono' });
    expect(back.telegram).toContain('Sottotitoli &lt;fuori&gt; sincrono');
    const nobody = taskMessage({ event: 'assignment', appUrl: APP, task: task({ kind: 'dubbing', status: 'unassigned' }), reel, role: 'observer', assigneeName: null });
    expect(nobody.subject).toContain('Da assegnare');
  });
});

describe('proposalMessage', () => {
  it('shows original and proposed text to the approver', () => {
    const m = proposalMessage({
      appUrl: APP, reel, field: 'hook', originalText: 'Lo sapevi?', proposedText: 'Lo sapevate?',
      proposerName: 'Doppiatore', to: 'approver',
    });
    expect(m.text).toContain('Lo sapevi?');
    expect(m.text).toContain('Lo sapevate?');
    expect(m.subject).toContain('TT-2611-01');
  });
});
