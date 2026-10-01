-- Fixture loaded before each check file; the check ends with ROLLBACK.
-- Users: ...a admin · ...b member (Responsible) · ...c outsider · ...d approver.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'member@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'outsider@example.test'),
  ('00000000-0000-0000-0000-00000000000d', 'approver@example.test');

update profiles set is_admin = true where id = '00000000-0000-0000-0000-00000000000a';

insert into pages (id, slug, name, code_prefix)
values ('10000000-0000-0000-0000-000000000001', 'porcino-papaya', 'Porcino & Papaya', 'PP');

insert into batches (id, page_id, label)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Batch Ottobre');

insert into reels (id, batch_id, page_id, code, ordinal, title, phase) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-01', 1, 'Reel uno', 'script_writing'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'PP-2610-02', 2, 'Reel due', 'editing');

insert into raci_configs (page_id, phase, responsible, approver) values
  ('10000000-0000-0000-0000-000000000001', 'script_writing',
   '{00000000-0000-0000-0000-00000000000b}', '{00000000-0000-0000-0000-00000000000d}'),
  ('10000000-0000-0000-0000-000000000001', 'editing',
   '{00000000-0000-0000-0000-00000000000b}', '{00000000-0000-0000-0000-00000000000d}');
