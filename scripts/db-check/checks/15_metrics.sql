-- Fase 2 S7 — script_lab_metrics (docs/fase2-plan.md AC22–AC25): admins
-- only (42501), a valid period (22023), and every section equal to the
-- numbers worked out by hand for the fixture below, months in Europe/Rome.
-- Users from seed.sql: a admin · b Responsible (Membro) · c internal without
-- a role · d RACI approver. Page P (PP) has the import batch "Batch Ottobre"
-- with PP-2610-01/02 (period null, as for imports after the migration).

create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_id, false);
$$;

-- Pages: P active with an empty bible; Q active with a complete one; R
-- inactive (left out).
insert into pages (id, slug, name, code_prefix) values
  ('10000000-0000-0000-0000-0000000000a2', 'quercia', 'Quercia', 'QQ');
insert into pages (id, slug, name, code_prefix, active) values
  ('10000000-0000-0000-0000-0000000000a3', 'riposo', 'Riposo', 'RR', false);
update page_bibles set tone = 'Ironico', characters = 'Quercia', duration_min_s = 30, duration_max_s = 45,
                       allowed_ctas = '{Seguici}'
 where page_id = '10000000-0000-0000-0000-0000000000a2';

-- Batches: an ideas batch in November with one reel; an import batch of Q
-- with no period and a September code; an import batch without reels or
-- period (no month: left out); an ideas batch in December (outside).
insert into batches (id, page_id, label, origin, period) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 'Batch Novembre', 'ideas', '2026-11-01'),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-0000000000a2', 'Batch Settembre', 'import', null),
  ('20000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-0000000000a2', 'Vuoto', 'import', null),
  ('20000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-000000000001', 'Batch Dicembre', 'ideas', '2026-12-01');
insert into reels (id, batch_id, page_id, code, ordinal, title) values
  ('30000000-0000-0000-0000-0000000000a3', '20000000-0000-0000-0000-0000000000a1',
   '10000000-0000-0000-0000-000000000001', 'PP-2611-01', 1, 'Reel tre'),
  ('30000000-0000-0000-0000-0000000000a4', '20000000-0000-0000-0000-0000000000a2',
   '10000000-0000-0000-0000-0000000000a2', 'QQ-2609-01', 1, 'Reel quattro');

-- Tasks. R1 = PP-2610-01, R2 = PP-2610-02, R3 = PP-2611-01, R4 = QQ-2609-01.
-- R1: written by b (4 Oct), sent back (5 Oct), rewritten (7 Oct), approved.
-- R2: written by d and reviewed just after midnight in Rome on 1 Nov (still
--     31 Oct in UTC): November. Delivered again on 2 Dec, so its last
--     delivery is outside the period (authors count the first, provenance
--     the last).
-- R3: written by b (9 Nov), reviewed and approved; a validation sent back
--     and a cancelled writing don't count.
-- R4: written and reviewed in August: outside the period.
insert into tasks (reel_id, kind, status, assignee_id, created_at, closed_at) values
  ('30000000-0000-0000-0000-000000000001', 'writing', 'delivered', '00000000-0000-0000-0000-00000000000b',
   '2026-10-01 08:00+00', '2026-10-04 10:00+00'),
  ('30000000-0000-0000-0000-000000000001', 'review', 'sent_back', '00000000-0000-0000-0000-00000000000d',
   '2026-10-04 10:00+00', '2026-10-05 09:00+00'),
  ('30000000-0000-0000-0000-000000000001', 'writing', 'delivered', '00000000-0000-0000-0000-00000000000b',
   '2026-10-05 09:00+00', '2026-10-07 10:00+00'),
  ('30000000-0000-0000-0000-000000000001', 'review', 'approved', '00000000-0000-0000-0000-00000000000d',
   '2026-10-07 10:00+00', '2026-10-08 10:00+00'),
  ('30000000-0000-0000-0000-000000000002', 'writing', 'delivered', '00000000-0000-0000-0000-00000000000d',
   '2026-10-30 08:00+00', '2026-10-31 23:10+00'),
  ('30000000-0000-0000-0000-000000000002', 'review', 'approved', '00000000-0000-0000-0000-00000000000b',
   '2026-10-31 23:30+00', '2026-11-02 10:00+00'),
  ('30000000-0000-0000-0000-000000000002', 'writing', 'delivered', '00000000-0000-0000-0000-00000000000d',
   '2026-12-01 08:00+00', '2026-12-02 10:00+00'),
  ('30000000-0000-0000-0000-0000000000a3', 'writing', 'cancelled', '00000000-0000-0000-0000-00000000000d',
   '2026-11-01 08:00+00', '2026-11-02 08:00+00'),
  ('30000000-0000-0000-0000-0000000000a3', 'writing', 'delivered', '00000000-0000-0000-0000-00000000000b',
   '2026-11-02 08:00+00', '2026-11-09 10:00+00'),
  ('30000000-0000-0000-0000-0000000000a3', 'review', 'approved', '00000000-0000-0000-0000-00000000000d',
   '2026-11-09 10:00+00', '2026-11-10 10:00+00'),
  ('30000000-0000-0000-0000-0000000000a3', 'validation', 'sent_back', '00000000-0000-0000-0000-00000000000d',
   '2026-11-10 10:00+00', '2026-11-11 10:00+00'),
  ('30000000-0000-0000-0000-0000000000a4', 'writing', 'delivered', '00000000-0000-0000-0000-00000000000b',
   '2026-08-18 08:00+00', '2026-08-19 10:00+00'),
  ('30000000-0000-0000-0000-0000000000a4', 'review', 'sent_back', '00000000-0000-0000-0000-00000000000d',
   '2026-08-20 10:00+00', '2026-08-21 10:00+00');

-- Versions. R1: two AI alternatives, a mix (base alfa, chiusura from beta),
-- then a manual edit of the corpo before the last delivery. R3: a mix that
-- takes everything from one beta alternative. R2 has no mix.
insert into script_versions (id, reel_id, source, model, created_at) values
  ('60000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-000000000001', 'ai', 'm/alfa', '2026-10-03 08:00+00'),
  ('60000000-0000-0000-0000-0000000000a2', '30000000-0000-0000-0000-000000000001', 'ai', 'm/beta', '2026-10-03 08:00+00'),
  ('60000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-0000000000a3', 'ai', 'm/beta', '2026-11-03 08:00+00');
insert into script_versions (reel_id, source, base_version_id, block_sources, hook, corpo, chiusura, cta,
                             script_rev, created_at) values
  ('30000000-0000-0000-0000-000000000001', 'mix', '60000000-0000-0000-0000-0000000000a1',
   '{"hook": "60000000-0000-0000-0000-0000000000a1", "corpo": "60000000-0000-0000-0000-0000000000a1",
     "chiusura": "60000000-0000-0000-0000-0000000000a2", "cta": "60000000-0000-0000-0000-0000000000a1"}',
   'h-a', 'c-a', 'k-b', 't-a', 1, '2026-10-03 12:00+00'),
  ('30000000-0000-0000-0000-0000000000a3', 'mix', '60000000-0000-0000-0000-0000000000a3',
   '{"hook": "60000000-0000-0000-0000-0000000000a3", "corpo": "60000000-0000-0000-0000-0000000000a3",
     "chiusura": "60000000-0000-0000-0000-0000000000a3", "cta": "60000000-0000-0000-0000-0000000000a3"}',
   'h-c', 'c-c', 'k-c', 't-c', 1, '2026-11-03 12:00+00');
insert into script_versions (reel_id, source, hook, corpo, chiusura, cta, script_rev, created_at) values
  ('30000000-0000-0000-0000-000000000001', 'manuale', 'h-a', 'c-a ritoccato', 'k-b', 't-a', 2, '2026-10-06 12:00+00');

set role authenticated;

-- Admins only; a valid period.
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  begin
    perform public.script_lab_metrics('2026-09-01', '2026-12-01');
    raise exception 'FAIL: the Responsible reads the metrics';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
  begin
    perform public.script_lab_metrics('2026-09-01', '2026-12-01');
    raise exception 'FAIL: an internal without a role reads the metrics';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  begin
    perform public.script_lab_metrics('2026-12-01', '2026-09-01');
    raise exception 'FAIL: a reversed period';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.script_lab_metrics('2024-01-01', '2026-12-01');
    raise exception 'FAIL: a period longer than 25 months';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- AC22–AC25 on the fixture, September to November 2026.
do $$
declare
  m jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  m := public.script_lab_metrics('2026-09-01', '2026-12-01');

  if m -> 'sendback' <> '[{"month": "2026-10", "reviewed": 1, "sent_back": 1},
                          {"month": "2026-11", "reviewed": 2, "sent_back": 0}]'::jsonb then
    raise exception 'FAIL: sendback %', m -> 'sendback';
  end if;
  if m -> 'batches' <> '[{"month": "2026-09", "origin": "import", "batches": 1, "reels": 1},
                         {"month": "2026-10", "origin": "import", "batches": 1, "reels": 2},
                         {"month": "2026-11", "origin": "ideas", "batches": 1, "reels": 1}]'::jsonb then
    raise exception 'FAIL: batches %', m -> 'batches';
  end if;
  if m -> 'bibles' <> '{"active_pages": 2, "complete": 1, "pages": [
        {"page_id": "10000000-0000-0000-0000-000000000001", "name": "Porcino & Papaya",
         "missing": ["tone", "characters", "duration", "cta"]},
        {"page_id": "10000000-0000-0000-0000-0000000000a2", "name": "Quercia", "missing": []}]}'::jsonb then
    raise exception 'FAIL: bibles %', m -> 'bibles';
  end if;
  if m -> 'authors' <> '[{"month": "2026-10", "author_id": "00000000-0000-0000-0000-00000000000b", "name": "Membro", "reels": 1},
                         {"month": "2026-11", "author_id": "00000000-0000-0000-0000-00000000000b", "name": "Membro", "reels": 1},
                         {"month": "2026-11", "author_id": "00000000-0000-0000-0000-00000000000d", "name": null, "reels": 1}]'::jsonb then
    raise exception 'FAIL: authors %', m -> 'authors';
  end if;
  if m -> 'provenance' <> '[{"month": "2026-10", "delivered": 1, "mixed": 1, "edited_after_mix": 1,
                             "bases": {"m/alfa": 1}, "blocks": {"m/alfa": 2, "m/beta": 1, "manuale": 1}},
                            {"month": "2026-11", "delivered": 1, "mixed": 1, "edited_after_mix": 0,
                             "bases": {"m/beta": 1}, "blocks": {"m/beta": 4}}]'::jsonb then
    raise exception 'FAIL: provenance %', m -> 'provenance';
  end if;
  if (m ->> 'from', m ->> 'to') is distinct from ('2026-09-01'::text, '2026-12-01'::text) then
    raise exception 'FAIL: the period in the result';
  end if;

  -- Control queries, written another way, on the whole history: the same
  -- numbers as a period that covers everything.
  m := public.script_lab_metrics('2026-01-01', '2027-01-01');
  if (select sum((e ->> 'sent_back')::int) from jsonb_array_elements(m -> 'sendback') e)
     <> (select count(distinct reel_id) from tasks where kind = 'review' and status = 'sent_back')
     or (select sum((e ->> 'reviewed')::int) from jsonb_array_elements(m -> 'sendback') e)
     <> (select count(distinct reel_id) from tasks where kind = 'review') then
    raise exception 'FAIL: sendback differs from the control query';
  end if;
  if (select sum((e ->> 'reels')::int) from jsonb_array_elements(m -> 'authors') e)
     <> (select count(distinct reel_id) from tasks where kind = 'writing' and status = 'delivered')
     or (select sum((e ->> 'delivered')::int) from jsonb_array_elements(m -> 'provenance') e)
     <> (select count(distinct reel_id) from tasks where kind = 'writing' and status = 'delivered') then
    raise exception 'FAIL: authors or provenance differ from the control query';
  end if;
  if (select sum((e ->> 'batches')::int) from jsonb_array_elements(m -> 'batches') e)
     <> (select count(*) from batches b where b.period is not null or exists (select 1 from reels r where r.batch_id = b.id)) then
    raise exception 'FAIL: batches differ from the control query';
  end if;
end $$;
reset role;

rollback;
