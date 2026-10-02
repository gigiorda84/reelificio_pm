-- Legacy fixture for upgrade.sh (AC7): data as the Fase 0 schema holds it,
-- loaded before the Fase 1 migrations. upgrade_snap keeps what must survive
-- unchanged and what each reel must become.
--
-- People (all internal before Fase 1): A admin · W writer · V validator ·
-- D dubber · E editor · S SMM · P approver. Page PP has a full RACI; page QQ
-- has none (its migrated task stays unassigned).

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin@legacy.test'),
  ('a0000000-0000-0000-0000-000000000001', 'writer@legacy.test'),
  ('a0000000-0000-0000-0000-000000000002', 'validator@legacy.test'),
  ('a0000000-0000-0000-0000-000000000003', 'dubber@legacy.test'),
  ('a0000000-0000-0000-0000-000000000004', 'editor@legacy.test'),
  ('a0000000-0000-0000-0000-000000000005', 'smm@legacy.test'),
  ('a0000000-0000-0000-0000-000000000006', 'approver@legacy.test');
update profiles set is_admin = true where id = 'a0000000-0000-0000-0000-00000000000a';

-- Telegram: W and V share a chat (V linked last and keeps it); E linked a group.
update profiles set telegram_chat_id = '111', updated_at = now() - interval '2 days'
 where id = 'a0000000-0000-0000-0000-000000000001';
update profiles set telegram_chat_id = '111', updated_at = now() - interval '1 day'
 where id = 'a0000000-0000-0000-0000-000000000002';
update profiles set telegram_chat_id = '-100123' where id = 'a0000000-0000-0000-0000-000000000004';

-- Old-default preference rows (cleared by the migration) and one that stays.
insert into notification_prefs (user_id, event, channel, enabled) values
  ('a0000000-0000-0000-0000-000000000001', 'assignment', 'telegram', false),
  ('a0000000-0000-0000-0000-000000000001', 'phase_approval_request', 'telegram', false),
  ('a0000000-0000-0000-0000-000000000001', 'phase_rejected', 'email', true),
  ('a0000000-0000-0000-0000-000000000001', 'mention', 'email', false);

insert into pages (id, slug, name, code_prefix) values
  ('b0000000-0000-0000-0000-000000000001', 'legacy-pp', 'Legacy PP', 'LG'),
  ('b0000000-0000-0000-0000-000000000002', 'legacy-qq', 'Legacy QQ', 'QQ');
insert into batches (id, page_id, label) values
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Batch Settembre'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Batch Settembre');

insert into raci_configs (page_id, phase, responsible, approver)
select 'b0000000-0000-0000-0000-000000000001', p, array[r]::uuid[],
       array['a0000000-0000-0000-0000-000000000006']::uuid[]
from (values
  ('scientific_validation'::pipeline_phase, 'a0000000-0000-0000-0000-000000000002'),
  ('script_writing', 'a0000000-0000-0000-0000-000000000001'),
  ('dubbing', 'a0000000-0000-0000-0000-000000000003'),
  ('editing', 'a0000000-0000-0000-0000-000000000004'),
  ('publication', 'a0000000-0000-0000-0000-000000000005')
) as x(p, r);

-- One reel per legacy situation.
insert into reels (id, batch_id, page_id, code, ordinal, title, hook, corpo, phase, phase_entered_at,
                   scheduled_at, posted_url)
select ('d0000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       case when code like 'QQ%' then 'c0000000-0000-0000-0000-000000000002'::uuid
            else 'c0000000-0000-0000-0000-000000000001'::uuid end,
       case when code like 'QQ%' then 'b0000000-0000-0000-0000-000000000002'::uuid
            else 'b0000000-0000-0000-0000-000000000001'::uuid end,
       code, n, 'Reel ' || code, 'hook ' || n, 'corpo ' || n, phase::pipeline_phase,
       now() - (n || ' days')::interval, scheduled_at, posted_url
from (values
  (1, 'LG-2609-01', 'research_prescript', null::timestamptz, null::text),
  (2, 'LG-2609-02', 'scientific_validation', null, null),
  (3, 'LG-2609-03', 'script_writing', null, null),
  (4, 'LG-2609-04', 'dubbing', null, null),
  (5, 'LG-2609-05', 'editing', null, null),
  (6, 'LG-2609-06', 'qc', null, null),
  (7, 'LG-2609-07', 'publication', null, null),
  (8, 'LG-2609-08', 'publication', now() + interval '2 days', null),
  (9, 'LG-2609-09', 'published', null, null),
  (10, 'LG-2609-10', 'editing', null, 'https://instagram.com/p/legacy10'),
  (11, 'LG-2609-11', 'dubbing', null, null),
  (12, 'QQ-2609-01', 'script_writing', null, null)
) as v(n, code, phase, scheduled_at, posted_url);

insert into comments (target_type, target_id, author_id, body) values
  ('reel', 'd0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 'Audio quasi pronto'),
  ('reel', 'd0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000004', 'Montaggio in corso'),
  ('batch', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Batch avviato');

-- A DoD row checked by a person, which the backfill must leave untouched.
insert into reel_dod_items (reel_id, key, checked_by, note) values
  ('d0000000-0000-0000-0000-000000000005', 'audio_recorded', 'a0000000-0000-0000-0000-000000000004', 'ok');

insert into phase_advance_requests (reel_id, from_phase, to_phase, requested_by, status) values
  ('d0000000-0000-0000-0000-000000000011', 'dubbing', 'editing', 'a0000000-0000-0000-0000-000000000003', 'pending');

-------------------------------------------------------------------------------
-- Snapshot of what must survive, and the expected result per reel.
-------------------------------------------------------------------------------

create schema upgrade_snap;

create table upgrade_snap.reels as
  select id, code, phase::text as phase, published_at, posted_url, phase_entered_at from reels;

create table upgrade_snap.comments as
  select id, md5(concat_ws('|', target_type, target_id, parent_id, author_id, body, mentions,
                           created_at, updated_at)) as h
  from comments;

create table upgrade_snap.dod as
  select reel_id, key::text as key, checked_by, checked_at, note from reel_dod_items;

-- state, phase after the migration, task kind and assignee after the backfill
-- (P is the default approver, set like fase1-prod-config.sql does).
create table upgrade_snap.expected (code text primary key, state text, phase text, kind text, assignee uuid);
insert into upgrade_snap.expected values
  ('LG-2609-01', 'idea', 'research_prescript', null, null),
  ('LG-2609-02', 'validazione', 'scientific_validation', 'validation', 'a0000000-0000-0000-0000-000000000002'),
  ('LG-2609-03', 'bozza', 'script_writing', 'writing', 'a0000000-0000-0000-0000-000000000001'),
  ('LG-2609-04', 'doppiaggio', 'dubbing', 'dubbing', 'a0000000-0000-0000-0000-000000000003'),
  ('LG-2609-05', 'animazione', 'editing', 'animation', 'a0000000-0000-0000-0000-000000000004'),
  ('LG-2609-06', 'approvazione_finale', 'editing', 'final_approval', 'a0000000-0000-0000-0000-000000000006'),
  ('LG-2609-07', 'programmato', 'publication', 'scheduling', 'a0000000-0000-0000-0000-000000000005'),
  ('LG-2609-08', 'programmato', 'publication', null, null),
  ('LG-2609-09', 'pubblicato', 'publication', null, null),
  ('LG-2609-10', 'pubblicato', 'publication', null, null),
  ('LG-2609-11', 'doppiaggio', 'dubbing', 'dubbing', 'a0000000-0000-0000-0000-000000000003'),
  ('QQ-2609-01', 'bozza', 'script_writing', 'writing', null);
