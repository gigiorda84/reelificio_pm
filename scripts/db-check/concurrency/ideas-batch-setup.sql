-- Committed fixture for the concurrent batches-from-ideas check in run.sh
-- (Fase 2 S3): two backlog ideas of page P, for two batches of one month.
insert into ideas (id, page_id, title) values
  ('90000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-000000000001', 'Prima in gara'),
  ('90000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-000000000001', 'Seconda in gara');
