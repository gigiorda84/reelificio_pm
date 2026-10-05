-- Committed fixture for the locked-reel sweep check in run.sh: a reel with a
-- writing task past due (escalation off: the sweep only stamps it).
insert into reels (id, batch_id, page_id, code, ordinal, title, state) values
  ('30000000-0000-0000-0000-0000000000a1', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-A1', 101, 'Reel bloccato', 'bozza');
insert into tasks (id, reel_id, kind, status, assignee_id, started_at, yellow_at, due_at, escalate_at) values
  ('50000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000a1', 'writing', 'in_progress',
   '00000000-0000-0000-0000-00000000000b', now() - interval '2 hours', now() - interval '1 hour',
   now() - interval '1 minute', now() + interval '1 hour');
