-- Fase 2 S4 — script versions (docs/fase2-plan.md D-E option V1c, AC16–19).
--
-- One writer: the trigger reels_record_version() records a version for every
-- real change of the script text (script_rev moved), whatever the path. The
-- Fase 2 RPCs declare the source in the transaction-local setting
-- reelificio.script_source (+ reelificio.script_meta); an accepted text
-- proposal is recognised from its pending row; anything else is `manuale`.
-- The RPCs are SECURITY INVOKER, so RLS (reels_update_member), the column
-- grants and reels_script_lock keep being the only rules on reels.

-------------------------------------------------------------------------------
-- Table
-------------------------------------------------------------------------------

create table script_versions (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references reels(id) on delete cascade,
  source text not null
    check (source in ('ai', 'mix', 'manuale', 'resync', 'ripristino', 'proposta', 'import')),
  -- AI alternatives (S6): model id, run and generation (FKs added in S6).
  model text,
  ai_run_id uuid,
  generation_id uuid,
  author_id uuid references profiles(id) on delete set null,
  -- mix: the base version and, per block, the version it came from.
  base_version_id uuid references script_versions(id) on delete set null,
  block_sources jsonb,
  restored_from_id uuid references script_versions(id) on delete set null,
  proposal_id uuid references text_change_proposals(id) on delete set null,
  hook text,
  corpo text,
  chiusura text,
  cta text,
  notes text,
  raw_content text,
  parser_warning text,
  -- The reel's script_rev this version produced; null for alternatives that
  -- were never applied.
  script_rev integer,
  -- Wall-clock time, so versions written in one transaction keep their order.
  created_at timestamptz not null default clock_timestamp()
);
create index script_versions_reel_idx on script_versions (reel_id, created_at desc);

comment on table script_versions is
  'Fase 2 script history and AI alternatives (internals only). Written by reels_record_version() and, from S6, the AI drain.';

alter table script_versions enable row level security;
revoke all on script_versions from anon, authenticated;
grant select on script_versions to authenticated;
grant all on script_versions to service_role;

-- Internals only (Q7): externals see neither alternatives nor history.
create policy script_versions_read on script_versions
  for select to authenticated
  using ((select public.is_internal()));

-------------------------------------------------------------------------------
-- The version trigger (the only SECURITY DEFINER object of the slice: users
-- have no write grant on script_versions).
-------------------------------------------------------------------------------

create function private.reels_record_version()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_source text := nullif(current_setting('reelificio.script_source', true), '');
  v_meta jsonb := coalesce(nullif(current_setting('reelificio.script_meta', true), '')::jsonb, '{}');
  v_field text;
  v_proposal uuid;
begin
  if tg_op = 'INSERT' then
    -- A reel born with text (Doc import, re-sync of a new ordinal): `import`.
    if coalesce(new.hook, new.corpo, new.chiusura, new.cta, new.notes, new.raw_content) is null then
      return null;
    end if;
    v_source := coalesce(v_source, 'import');
  else
    -- Only a real change of the text (reels_sync_state moved script_rev).
    if new.script_rev = old.script_rev then return null; end if;
    if v_source is null then
      -- An accepted proposal: exactly one block changed, notes and raw text
      -- untouched, and a pending proposal on that block from this revision
      -- with exactly the new text (decide_text_proposal updates the reel
      -- before it marks the proposal accepted).
      select f into v_field from (values
        ('hook', old.hook is distinct from new.hook),
        ('corpo', old.corpo is distinct from new.corpo),
        ('chiusura', old.chiusura is distinct from new.chiusura),
        ('cta', old.cta is distinct from new.cta)) as c(f, changed)
       where changed;
      if (select count(*) from (values
            (old.hook is distinct from new.hook), (old.corpo is distinct from new.corpo),
            (old.chiusura is distinct from new.chiusura), (old.cta is distinct from new.cta)) c(changed)
          where changed) = 1
         and (old.notes, old.raw_content) is not distinct from (new.notes, new.raw_content) then
        select p.id into v_proposal
          from text_change_proposals p
         where p.reel_id = new.id and p.status = 'pending' and p.field = v_field
           and p.base_rev = old.script_rev
           and p.proposed_text is not distinct from
               (case v_field when 'hook' then new.hook when 'corpo' then new.corpo
                             when 'chiusura' then new.chiusura else new.cta end)
         order by p.created_at desc
         limit 1;
      end if;
      v_source := case when v_proposal is not null then 'proposta' else 'manuale' end;
    end if;
  end if;

  insert into script_versions (
    reel_id, source, author_id, base_version_id, block_sources, restored_from_id, proposal_id,
    hook, corpo, chiusura, cta, notes, raw_content, parser_warning, script_rev)
  values (
    new.id, v_source, auth.uid(),
    (v_meta->>'base_version_id')::uuid,
    v_meta->'block_sources',
    (v_meta->>'restored_from_id')::uuid,
    v_proposal,
    new.hook, new.corpo, new.chiusura, new.cta, new.notes, new.raw_content, new.parser_warning,
    new.script_rev);
  return null;
end;
$$;

create trigger trg_reels_record_version
  after insert or update of hook, corpo, chiusura, cta, notes, raw_content on reels
  for each row execute function private.reels_record_version();

-- Backfill: the text every reel has today, as one `import` version.
insert into script_versions (reel_id, source, hook, corpo, chiusura, cta, notes, raw_content,
                             parser_warning, script_rev, created_at)
select id, 'import', hook, corpo, chiusura, cta, notes, raw_content, parser_warning, script_rev, now()
  from reels
 where coalesce(hook, corpo, chiusura, cta, notes, raw_content) is not null;

-------------------------------------------------------------------------------
-- RPCs, SECURITY INVOKER (D-E): they run as the caller.
-------------------------------------------------------------------------------

-- The script form and the Doc re-sync. p_fields: any of title, format,
-- category, hook, corpo, chiusura, cta, notes, raw_content, parser_warning
-- (a missing key keeps its value). p_source: manuale, or resync (admins).
-- Codes: ok, stale, not_authorized, invalid_input.
create function public.save_reel_script(
  p_reel_id uuid, p_fields jsonb, p_expected_rev integer, p_source text default 'manuale'
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  r reels;
begin
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_expected_rev is null
     or p_source is null or p_source not in ('manuale', 'resync')
     or (p_source = 'resync' and not public.is_admin())
     or exists (select 1 from jsonb_object_keys(p_fields) k
                 where k not in ('title', 'format', 'category', 'hook', 'corpo', 'chiusura', 'cta',
                                 'notes', 'raw_content', 'parser_warning')) then
    return 'invalid_input';
  end if;

  -- Lock the reel through the caller's update policy (RLS).
  select * into r from reels where id = p_reel_id for update;
  if not found then
    return case when exists (select 1 from reels where id = p_reel_id) then 'not_authorized' else 'invalid_input' end;
  end if;
  if r.script_rev <> p_expected_rev then return 'stale'; end if;

  perform set_config('reelificio.script_source', p_source, true);
  perform set_config('reelificio.script_meta', '', true);
  begin
    update reels set
      title = case when p_fields ? 'title' then p_fields->>'title' else title end,
      format = case when p_fields ? 'format' then (p_fields->>'format')::reel_format else format end,
      category = case when p_fields ? 'category' then (p_fields->>'category')::reel_category else category end,
      hook = case when p_fields ? 'hook' then p_fields->>'hook' else hook end,
      corpo = case when p_fields ? 'corpo' then p_fields->>'corpo' else corpo end,
      chiusura = case when p_fields ? 'chiusura' then p_fields->>'chiusura' else chiusura end,
      cta = case when p_fields ? 'cta' then p_fields->>'cta' else cta end,
      notes = case when p_fields ? 'notes' then p_fields->>'notes' else notes end,
      raw_content = case when p_fields ? 'raw_content' then p_fields->>'raw_content' else raw_content end,
      parser_warning = case when p_fields ? 'parser_warning' then p_fields->>'parser_warning' else parser_warning end
    where id = r.id;
  exception
    -- reels_script_lock (from revisione) and the column grants.
    when insufficient_privilege then
      perform set_config('reelificio.script_source', '', true);
      return 'not_authorized';
    when invalid_text_representation or not_null_violation then
      perform set_config('reelificio.script_source', '', true);
      return 'invalid_input';
  end;
  perform set_config('reelificio.script_source', '', true);
  return 'ok';
end;
$$;

-- Mix (AC16): the blocks of p_base, with any of hook/corpo/chiusura/cta
-- taken from another version of the same reel (p_blocks: {block: version
-- id}). Notes come from the base. Only in bozza.
-- Codes: ok, stale, invalid_state, not_authorized, invalid_input.
create function public.apply_script_version(
  p_reel_id uuid, p_base uuid, p_blocks jsonb, p_expected_rev integer
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  r reels;
  b script_versions;
  v_sources jsonb;
  v_block text;
  v_text jsonb := '{}';
  v_from script_versions;
begin
  if p_base is null or p_expected_rev is null
     or (p_blocks is not null and jsonb_typeof(p_blocks) <> 'object')
     or exists (select 1 from jsonb_object_keys(coalesce(p_blocks, '{}')) k
                 where k not in ('hook', 'corpo', 'chiusura', 'cta')) then
    return 'invalid_input';
  end if;
  -- Lock the reel through the caller's update policy (RLS).
  select * into r from reels where id = p_reel_id for update;
  if not found then
    return case when exists (select 1 from reels where id = p_reel_id) then 'not_authorized' else 'invalid_input' end;
  end if;
  if r.state <> 'bozza' then return 'invalid_state'; end if;
  if r.script_rev <> p_expected_rev then return 'stale'; end if;
  -- Beyond the update policy: admins, the RACI Responsible of script_writing,
  -- the holder of the open task (in bozza, the writing task).
  if not (public.is_admin()
          or public.has_raci_role(r.page_id, 'script_writing', 'responsible')
          or public.holds_open_task(r.id)) then
    return 'not_authorized';
  end if;

  select * into b from script_versions where id = p_base and reel_id = r.id;
  if not found then return 'invalid_input'; end if;

  v_sources := jsonb_build_object('hook', b.id, 'corpo', b.id, 'chiusura', b.id, 'cta', b.id);
  v_text := jsonb_build_object('hook', b.hook, 'corpo', b.corpo, 'chiusura', b.chiusura, 'cta', b.cta);
  for v_block in select k from jsonb_object_keys(coalesce(p_blocks, '{}')) k loop
    begin
      select * into v_from from script_versions
       where id = (p_blocks->>v_block)::uuid and reel_id = r.id;
    exception when invalid_text_representation then
      return 'invalid_input';
    end;
    if not found then return 'invalid_input'; end if;
    v_sources := v_sources || jsonb_build_object(v_block, v_from.id);
    v_text := v_text || jsonb_build_object(v_block, case v_block
      when 'hook' then v_from.hook when 'corpo' then v_from.corpo
      when 'chiusura' then v_from.chiusura else v_from.cta end);
  end loop;

  perform set_config('reelificio.script_source', 'mix', true);
  perform set_config('reelificio.script_meta',
    jsonb_build_object('base_version_id', b.id, 'block_sources', v_sources)::text, true);
  begin
    update reels set
      hook = v_text->>'hook',
      corpo = v_text->>'corpo',
      chiusura = v_text->>'chiusura',
      cta = v_text->>'cta',
      notes = b.notes
    where id = r.id;
  exception when insufficient_privilege then
    perform set_config('reelificio.script_source', '', true);
    perform set_config('reelificio.script_meta', '', true);
    return 'not_authorized';
  end;
  perform set_config('reelificio.script_source', '', true);
  perform set_config('reelificio.script_meta', '', true);
  return 'ok';
end;
$$;

-- Restore (AC17): the whole text of a version of the same reel. Only in
-- bozza. Codes as apply_script_version.
create function public.restore_script_version(p_reel_id uuid, p_version_id uuid, p_expected_rev integer)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  r reels;
  v script_versions;
begin
  if p_version_id is null or p_expected_rev is null then return 'invalid_input'; end if;
  -- Lock the reel through the caller's update policy (RLS).
  select * into r from reels where id = p_reel_id for update;
  if not found then
    return case when exists (select 1 from reels where id = p_reel_id) then 'not_authorized' else 'invalid_input' end;
  end if;
  if r.state <> 'bozza' then return 'invalid_state'; end if;
  if r.script_rev <> p_expected_rev then return 'stale'; end if;
  -- Beyond the update policy: admins, the RACI Responsible of script_writing,
  -- the holder of the open task (in bozza, the writing task).
  if not (public.is_admin()
          or public.has_raci_role(r.page_id, 'script_writing', 'responsible')
          or public.holds_open_task(r.id)) then
    return 'not_authorized';
  end if;

  select * into v from script_versions where id = p_version_id and reel_id = r.id;
  if not found then return 'invalid_input'; end if;

  perform set_config('reelificio.script_source', 'ripristino', true);
  perform set_config('reelificio.script_meta', jsonb_build_object('restored_from_id', v.id)::text, true);
  begin
    update reels set
      hook = v.hook, corpo = v.corpo, chiusura = v.chiusura, cta = v.cta,
      notes = v.notes, raw_content = v.raw_content, parser_warning = v.parser_warning
    where id = r.id;
  exception when insufficient_privilege then
    perform set_config('reelificio.script_source', '', true);
    perform set_config('reelificio.script_meta', '', true);
    return 'not_authorized';
  end;
  perform set_config('reelificio.script_source', '', true);
  perform set_config('reelificio.script_meta', '', true);
  return 'ok';
end;
$$;

-- Provenance (AC18) of the text at the last delivery of the writing task
-- (or now, if never delivered): the model of the mix base, per block the
-- model it came from or `manuale` when it was edited after the mix, and
-- whether anything was edited by hand after the mix. Null base without mix.
create function public.reel_script_provenance(p_reel_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_at timestamptz;
  v_mix script_versions;
  v_last script_versions;
  v_blocks jsonb := '{}';
  v_block text;
  v_src script_versions;
begin
  if not exists (select 1 from reels where id = p_reel_id) then return null; end if;
  select max(closed_at) into v_at from tasks
   where reel_id = p_reel_id and kind = 'writing' and status = 'delivered';
  v_at := coalesce(v_at, 'infinity');

  select * into v_last from script_versions
   where reel_id = p_reel_id and script_rev is not null and created_at <= v_at
   order by created_at desc, script_rev desc limit 1;
  select * into v_mix from script_versions
   where reel_id = p_reel_id and source = 'mix' and created_at <= v_at
   order by created_at desc limit 1;
  if v_mix.id is null then
    return jsonb_build_object('base_model', null, 'blocks', null,
      'edited_after_mix', false, 'last_source', v_last.source);
  end if;

  foreach v_block in array array['hook', 'corpo', 'chiusura', 'cta'] loop
    select * into v_src from script_versions where id = (v_mix.block_sources->>v_block)::uuid;
    if (case v_block when 'hook' then v_last.hook when 'corpo' then v_last.corpo
                     when 'chiusura' then v_last.chiusura else v_last.cta end)
       is distinct from
       (case v_block when 'hook' then v_mix.hook when 'corpo' then v_mix.corpo
                     when 'chiusura' then v_mix.chiusura else v_mix.cta end) then
      v_blocks := v_blocks || jsonb_build_object(v_block, 'manuale');
    else
      v_blocks := v_blocks || jsonb_build_object(v_block, coalesce(v_src.model, 'manuale'));
    end if;
  end loop;

  return jsonb_build_object(
    'base_model', (select model from script_versions where id = v_mix.base_version_id),
    'blocks', v_blocks,
    'edited_after_mix', v_last.id <> v_mix.id,
    'last_source', v_last.source);
end;
$$;

revoke execute on function public.save_reel_script(uuid, jsonb, integer, text) from public, anon, authenticated;
revoke execute on function public.apply_script_version(uuid, uuid, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.restore_script_version(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.reel_script_provenance(uuid) from public, anon, authenticated;
grant execute on function public.save_reel_script(uuid, jsonb, integer, text) to authenticated, service_role;
grant execute on function public.apply_script_version(uuid, uuid, jsonb, integer) to authenticated, service_role;
grant execute on function public.restore_script_version(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.reel_script_provenance(uuid) to authenticated, service_role;

revoke execute on all functions in schema private from public, anon, authenticated;
