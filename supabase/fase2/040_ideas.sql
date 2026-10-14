-- Fase 2 S3 — ideas backlog and batches born from ideas (docs/fase2-plan.md
-- S3, AC5–AC7, §3 "Batch da idee", "Aggiunta a un batch", "Fonte doc").
--
-- An idea belongs to a page backlog (status backlog / scelta / scartata).
-- Choosing ideas creates a batch with origin `ideas` whose reels are born in
-- `idea`, coded like buildReelCode (src/lib/batches/codes.ts) and numbered
-- after the last code of that page and month. Every reel imported from the
-- Doc gets a `doc` idea, already `scelta` (Q5). Users have no write grant on
-- ideas: three SECURITY DEFINER functions are the only write paths.

-------------------------------------------------------------------------------
-- Tables
-------------------------------------------------------------------------------

create table ideas (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  spunto text check (spunto is null or length(spunto) <= 2000),
  -- Release B adds `intelligence`.
  source text not null default 'manuale' check (source in ('manuale', 'doc')),
  status text not null default 'backlog' check (status in ('backlog', 'scelta', 'scartata')),
  reel_id uuid unique references reels(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ideas_page_idx on ideas (page_id, status, created_at desc);

comment on table ideas is 'Fase 2 ideas backlog per page (internals only); written through upsert_idea, set_idea_status, create_batch_from_ideas.';

alter table ideas enable row level security;
revoke all on ideas from anon, authenticated;
grant select on ideas to authenticated;
grant all on ideas to service_role;

create policy ideas_read on ideas
  for select to authenticated
  using ((select public.is_internal()));

-- Where a batch comes from, and its month (first day). `ideas` batches always
-- have a period; import batches get it from the code of their first reel
-- (backfill below) and stay null afterwards, since createBatch is unchanged
-- (metrics use coalesce(period, month of the first code)).
alter table batches
  add column origin text not null default 'import' check (origin in ('import', 'ideas')),
  add column period date check (period is null or extract(day from period) = 1),
  add constraint batches_ideas_period_chk check (origin <> 'ideas' or period is not null);

update batches b
   set period = make_date(2000 + substr(m[1], 1, 2)::int, substr(m[1], 3, 2)::int, 1)
  from (
    select distinct on (r.batch_id) r.batch_id, regexp_match(r.code, '^[A-Z0-9]{2}-(\d{4})-\d+$') as m
      from reels r
     order by r.batch_id, r.ordinal, r.created_at
  ) first_reel
 where first_reel.batch_id = b.id
   and first_reel.m is not null
   and substr(first_reel.m[1], 3, 2)::int between 1 and 12;

-------------------------------------------------------------------------------
-- Reel codes, the SQL twin of buildReelCode: PP-yymm-NN, NN at least two
-- digits (PP-2701-100 for the hundredth).
-------------------------------------------------------------------------------

create function private._reel_code(p_prefix text, p_year integer, p_month integer, p_ordinal integer)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select upper(p_prefix) || '-'
      || right('0' || (p_year % 100)::text, 2)
      || right('0' || p_month::text, 2) || '-'
      || case when p_ordinal < 10 then '0' || p_ordinal::text else p_ordinal::text end;
$$;

-- The next free NN for a page prefix and month, over every batch of the page
-- (codes are unique across the app).
create function private._next_reel_ordinal(p_prefix text, p_year integer, p_month integer)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(max((regexp_match(code, '-(\d+)$'))[1]::int), 0) + 1
    from reels
   where code like upper(p_prefix) || '-' || right('0' || (p_year % 100)::text, 2)
                 || right('0' || p_month::text, 2) || '-%';
$$;

-------------------------------------------------------------------------------
-- RPCs (actor-explicit private functions + auth.uid() wrappers). Admins and
-- the RACI Responsible of script_writing (private._can_edit_script_lab, S2).
-------------------------------------------------------------------------------

-- New idea (p_id null) or edit of an idea still in the backlog or discarded.
-- Returns {code, id}; codes: ok, not_authorized, invalid_input, invalid_state.
create function private.upsert_idea(p_actor uuid, p_id uuid, p_page_id uuid, p_title text, p_spunto text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  i ideas%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_spunto text := nullif(btrim(coalesce(p_spunto, '')), '');
  v_id uuid;
begin
  if length(v_title) not between 1 and 200 or coalesce(length(v_spunto), 0) > 2000 then
    return jsonb_build_object('code', 'invalid_input');
  end if;
  if p_id is null then
    if p_page_id is null or not exists (select 1 from pages where id = p_page_id) then
      return jsonb_build_object('code', 'invalid_input');
    end if;
    if not private._can_edit_script_lab(p_actor, p_page_id) then
      return jsonb_build_object('code', 'not_authorized');
    end if;
    insert into ideas (page_id, title, spunto, source, status, created_by)
    values (p_page_id, v_title, v_spunto, 'manuale', 'backlog', p_actor)
    returning id into v_id;
    return jsonb_build_object('code', 'ok', 'id', v_id);
  end if;

  select * into i from ideas where id = p_id for update;
  if not found then return jsonb_build_object('code', 'invalid_input'); end if;
  if not private._can_edit_script_lab(p_actor, i.page_id) then
    return jsonb_build_object('code', 'not_authorized');
  end if;
  if i.status = 'scelta' then return jsonb_build_object('code', 'invalid_state'); end if;
  update ideas set title = v_title, spunto = v_spunto, updated_at = now() where id = i.id;
  return jsonb_build_object('code', 'ok', 'id', i.id);
end;
$$;

-- backlog ↔ scartata. A chosen idea never goes back (its reel exists).
create function private.set_idea_status(p_actor uuid, p_id uuid, p_status text)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  i ideas%rowtype;
begin
  if p_status is null or p_status not in ('backlog', 'scartata') then return 'invalid_input'; end if;
  select * into i from ideas where id = p_id for update;
  if not found then return 'invalid_input'; end if;
  if not private._can_edit_script_lab(p_actor, i.page_id) then return 'not_authorized'; end if;
  if i.status = 'scelta' then return 'invalid_state'; end if;
  update ideas
     set status = p_status,
         decided_at = case when p_status = 'scartata' then now() else null end,
         updated_at = now()
   where id = i.id;
  return 'ok';
end;
$$;

-- Turns backlog ideas into reels in `idea`, in the order given: a new batch
-- for (year, month), or more reels in an existing `ideas` batch of the page
-- (never an import batch: its doc ideas and the re-sync by ordinal would
-- break). Returns {code, batch_id}; codes: ok, not_authorized, invalid_input.
-- Nothing is written unless every idea is valid.
create function private.create_batch_from_ideas(
  p_actor uuid, p_page_id uuid, p_year integer, p_month integer, p_idea_ids uuid[], p_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  pg pages%rowtype;
  b batches%rowtype;
  v_year integer := p_year;
  v_month integer := p_month;
  v_next integer;
  v_reel uuid;
  v_idea record;
  v_months text[] := array['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio',
                           'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
begin
  -- The page row serialises numbering for the page.
  select * into pg from pages where id = p_page_id for update;
  if not found then return jsonb_build_object('code', 'invalid_input'); end if;
  if not private._can_edit_script_lab(p_actor, pg.id) then
    perform private._log(null, null, p_actor, 'create_batch_from_ideas', 'app', 'not_authorized', pg.id::text);
    return jsonb_build_object('code', 'not_authorized');
  end if;
  if p_idea_ids is null or cardinality(p_idea_ids) not between 1 and 50
     or cardinality(p_idea_ids) <> (select count(distinct x) from unnest(p_idea_ids) x) then
    return jsonb_build_object('code', 'invalid_input');
  end if;

  if p_batch_id is not null then
    select * into b from batches where id = p_batch_id for update;
    if not found or b.page_id <> pg.id or b.origin <> 'ideas' then
      return jsonb_build_object('code', 'invalid_input');
    end if;
    v_year := extract(year from b.period)::int;
    v_month := extract(month from b.period)::int;
  elsif v_year is null or v_month is null or v_year not between 2020 and 2099 or v_month not between 1 and 12 then
    return jsonb_build_object('code', 'invalid_input');
  end if;

  -- Every idea: of this page, in the backlog (locked).
  perform 1 from ideas where id = any (p_idea_ids) for update;
  if (select count(*) from ideas
       where id = any (p_idea_ids) and page_id = pg.id and status = 'backlog') <> cardinality(p_idea_ids) then
    return jsonb_build_object('code', 'invalid_input');
  end if;

  if p_batch_id is null then
    insert into batches (page_id, label, status, origin, period, created_by)
    values (pg.id, 'Batch ' || v_months[v_month], 'draft', 'ideas', make_date(v_year, v_month, 1), p_actor)
    returning * into b;
  end if;

  v_next := private._next_reel_ordinal(pg.code_prefix, v_year, v_month);
  for v_idea in
    select i.id, i.title, u.n
      from unnest(p_idea_ids) with ordinality as u(id, n)
      join ideas i on i.id = u.id
     order by u.n
  loop
    insert into reels (batch_id, page_id, code, ordinal, title, format, category)
    values (b.id, pg.id, private._reel_code(pg.code_prefix, v_year, v_month, v_next), v_next,
            v_idea.title, 'other', 'adapted')
    returning id into v_reel;
    update ideas
       set status = 'scelta', reel_id = v_reel, decided_at = now(), updated_at = now()
     where id = v_idea.id;
    v_next := v_next + 1;
  end loop;

  perform private._log(null, null, p_actor, 'create_batch_from_ideas', 'app', 'ok', b.id::text);
  return jsonb_build_object('code', 'ok', 'batch_id', b.id);
end;
$$;

create function public.upsert_idea(p_id uuid, p_page_id uuid, p_title text, p_spunto text)
returns jsonb language sql security definer set search_path = public, private as $$
  select private.upsert_idea(auth.uid(), p_id, p_page_id, p_title, p_spunto);
$$;
create function public.set_idea_status(p_id uuid, p_status text)
returns text language sql security definer set search_path = public, private as $$
  select private.set_idea_status(auth.uid(), p_id, p_status);
$$;
create function public.create_batch_from_ideas(
  p_page_id uuid, p_year integer, p_month integer, p_idea_ids uuid[], p_batch_id uuid default null
)
returns jsonb language sql security definer set search_path = public, private as $$
  select private.create_batch_from_ideas(auth.uid(), p_page_id, p_year, p_month, p_idea_ids, p_batch_id);
$$;

revoke execute on function public.upsert_idea(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.set_idea_status(uuid, text) from public, anon, authenticated;
revoke execute on function public.create_batch_from_ideas(uuid, integer, integer, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.upsert_idea(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.set_idea_status(uuid, text) to authenticated, service_role;
grant execute on function public.create_batch_from_ideas(uuid, integer, integer, uuid[], uuid) to authenticated, service_role;

-------------------------------------------------------------------------------
-- `doc` ideas (Q5): every reel imported from the Doc has its idea, already
-- chosen. The trigger covers new imports and re-sync inserts; the backfill
-- covers the reels of today.
-------------------------------------------------------------------------------

create function private.reels_doc_idea()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from batches where id = new.batch_id and origin = 'import') then
    insert into ideas (page_id, title, source, status, reel_id, created_by, decided_at)
    values (new.page_id, left(btrim(new.title), 200), 'doc', 'scelta', new.id, auth.uid(), now())
    on conflict (reel_id) do nothing;
  end if;
  return null;
end;
$$;

create trigger trg_reels_doc_idea
  after insert on reels
  for each row execute function private.reels_doc_idea();

insert into ideas (page_id, title, source, status, reel_id, decided_at, created_at)
select r.page_id, left(btrim(r.title), 200), 'doc', 'scelta', r.id, r.created_at, r.created_at
  from reels r
  join batches b on b.id = r.batch_id and b.origin = 'import'
 where length(btrim(r.title)) > 0
on conflict (reel_id) do nothing;

revoke execute on all functions in schema private from public, anon, authenticated;
