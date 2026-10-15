-- Fase 2 applied over R2 with reels in flight (docs/fase2-plan.md §6, §7.2).
-- AC2: voice_briefs is untouched (same rows, same checksum as
-- seed-fase2-before.sql recorded), every page has exactly one empty bible,
-- and the Script Lab is off on every page.
do $$
declare
  v_before db_check.voice_briefs_before%rowtype;
  v_n bigint;
  v_h text;
begin
  select * into v_before from db_check.voice_briefs_before;
  select count(*), md5(coalesce(string_agg(row_to_json(v)::text, '|' order by v.id), ''))
    into v_n, v_h from voice_briefs v;
  if v_n <> v_before.n or v_h <> v_before.h then
    raise exception 'FAIL: voice_briefs changed by Fase 2 (% rows before, % after)', v_before.n, v_n;
  end if;
  if v_n < 1 then
    raise exception 'FAIL: the fixture has no voice brief to compare';
  end if;

  if exists (select 1 from pages p
              where (select count(*) from page_bibles b where b.page_id = p.id) <> 1) then
    raise exception 'FAIL: a page without exactly one bible';
  end if;
  if exists (select 1 from page_bibles
              where version <> 1 or tone is not null or characters is not null
                 or themes <> '{}' or allowed_ctas <> '{}' or default_models <> '{}'
                 or example_scripts <> '[]'::jsonb or duration_min_s is not null) then
    raise exception 'FAIL: a backfilled bible is not empty';
  end if;
  if exists (select 1 from pages where script_lab_enabled) then
    raise exception 'FAIL: the Script Lab is on for a page after the migration';
  end if;

  -- S4 backfill: every reel with text has exactly one `import` version with
  -- its current text and revision; a reel without text has none.
  if exists (
       select 1 from reels r
        where coalesce(r.hook, r.corpo, r.chiusura, r.cta, r.notes, r.raw_content) is not null
          and (select count(*) from script_versions v
                where v.reel_id = r.id and v.source = 'import'
                  and (v.hook, v.corpo, v.chiusura, v.cta, v.notes, v.raw_content, v.script_rev)
                      is not distinct from (r.hook, r.corpo, r.chiusura, r.cta, r.notes, r.raw_content, r.script_rev)) <> 1)
     or exists (
       select 1 from reels r join script_versions v on v.reel_id = r.id
        where coalesce(r.hook, r.corpo, r.chiusura, r.cta, r.notes, r.raw_content) is null) then
    raise exception 'FAIL: the import backfill of script_versions';
  end if;
  if (select count(*) from script_versions) = 0 then
    raise exception 'FAIL: the fixture has no reel with text to backfill';
  end if;

  -- S3 backfill: every existing batch is `import`, with the month of its
  -- first reel's code, moved by a year when it is more than 6 months from
  -- the batch's creation (the January batch imported in December); every
  -- reel has exactly one chosen `doc` idea.
  if exists (select 1 from batches where origin <> 'import')
     or exists (
       select 1 from batches b
        where exists (select 1 from reels r where r.batch_id = b.id)
          and (
            select case
                     when c < created - 6 then c + 12
                     when c > created + 6 then c - 12
                     else c
                   end
              from (select (2000 + substr(m[1], 1, 2)::int) * 12 + substr(m[1], 3, 2)::int - 1 as c,
                           extract(year from b.created_at at time zone 'Europe/Rome')::int * 12
                             + extract(month from b.created_at at time zone 'Europe/Rome')::int - 1 as created
                      from (select regexp_match(r.code, '-(\d{4})-') m from reels r
                             where r.batch_id = b.id order by r.ordinal, r.created_at limit 1) f) x
          ) is distinct from (extract(year from b.period)::int * 12 + extract(month from b.period)::int - 1)) then
    raise exception 'FAIL: the period backfill of import batches';
  end if;
  if (select period from batches where id = 'c0000000-0000-0000-0000-000000000013') is distinct from '2027-01-01'::date then
    raise exception 'FAIL: a January batch imported in December is not January of the next year';
  end if;
  if exists (
       select 1 from reels r
        where (select count(*) from ideas i
                where i.reel_id = r.id and i.source = 'doc' and i.status = 'scelta'
                  and i.page_id = r.page_id
                  and i.title = coalesce(nullif(left(btrim(r.title), 200), ''), r.code)) <> 1) then
    raise exception 'FAIL: the doc ideas backfill';
  end if;
end $$;
