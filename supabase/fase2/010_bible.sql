-- Fase 2 S2 — the page bible (docs/fase2-plan.md D-D, AC1–4).
--
-- One card for the user, two tables underneath (option B1):
-- - page_bibles: the creative fields, internals only (RLS);
-- - voice_briefs: the Voce section (adjectives, banned words, reference
--   audio, liberties, anomaly procedure), unchanged and still readable by the
--   externals of the page, so dubbers keep seeing the banned words.
-- save_bible() writes both in one transaction; users have no write grant on
-- page_bibles, and the old admin policy on voice_briefs stays (no contract).

-------------------------------------------------------------------------------
-- Table
-------------------------------------------------------------------------------

create table page_bibles (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null unique references pages(id) on delete cascade,
  tone text,
  characters text,
  themes text[] not null default '{}',
  keywords text[] not null default '{}',
  allowed_ctas text[] not null default '{}',
  duration_min_s integer,
  duration_max_s integer,
  words_per_second numeric(3, 1) not null default 2.5,
  -- At most 5 approved scripts: [{title, hook, corpo, chiusura, cta}].
  example_scripts jsonb not null default '[]',
  -- OpenRouter model ids preselected in "Avvia stesura" (S6), at most 3.
  default_models text[] not null default '{}',
  version integer not null default 1,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_bibles_duration_chk check (
    (duration_min_s is null and duration_max_s is null)
    or (duration_min_s >= 5 and duration_max_s <= 180 and duration_min_s <= duration_max_s)),
  constraint page_bibles_wps_chk check (words_per_second between 1.5 and 4),
  constraint page_bibles_examples_chk check (
    jsonb_typeof(example_scripts) = 'array' and jsonb_array_length(example_scripts) <= 5),
  constraint page_bibles_models_chk check (cardinality(default_models) <= 3),
  constraint page_bibles_text_chk check (
    coalesce(length(tone), 0) <= 4000 and coalesce(length(characters), 0) <= 8000)
);

comment on table page_bibles is
  'Fase 2 page bible, creative fields (internals only). The Voce section is voice_briefs.';

alter table page_bibles enable row level security;
revoke all on page_bibles from anon, authenticated;
grant select on page_bibles to authenticated;
grant all on page_bibles to service_role;

create policy page_bibles_read on page_bibles
  for select to authenticated
  using ((select public.is_internal()));

-- One (empty) bible per page: the existing pages now, new ones by trigger.
insert into page_bibles (page_id) select id from pages on conflict (page_id) do nothing;

create function private.pages_add_bible()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into page_bibles (page_id) values (new.id) on conflict (page_id) do nothing;
  return new;
end;
$$;

create trigger trg_pages_add_bible
  after insert on pages
  for each row execute function private.pages_add_bible();

-- Script Lab switch per page (admins, under pages_admin_write). Off: "Avvia
-- stesura" stays the Fase 1 one.
alter table pages add column script_lab_enabled boolean not null default false;

-------------------------------------------------------------------------------
-- Who edits the Script Lab of a page: admins and the internal RACI
-- Responsible of script_writing (fase1_core.sql has_raci_role_uid).
-------------------------------------------------------------------------------

create function private._can_edit_script_lab(p_actor uuid, p_page_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select coalesce(
    private.is_admin_uid(p_actor)
    or (private.is_internal_uid(p_actor)
        and private.has_raci_role_uid(p_page_id, 'script_writing', 'responsible', p_actor)),
    false);
$$;

-- A jsonb array of strings as text[]: trimmed, empty items dropped, null if
-- it is not an array of strings within the limits (the caller answers
-- invalid_input). A missing value is an empty list.
create function private._text_list(p jsonb, p_max_items integer, p_max_len integer)
returns text[]
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_out text[] := '{}';
  v_item jsonb;
  v_text text;
begin
  if p is null or p = 'null'::jsonb then return v_out; end if;
  if jsonb_typeof(p) <> 'array' then return null; end if;
  for v_item in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(v_item) <> 'string' then return null; end if;
    v_text := btrim(v_item #>> '{}');
    continue when v_text = '';
    if length(v_text) > p_max_len then return null; end if;
    v_out := v_out || v_text;
  end loop;
  if cardinality(v_out) > p_max_items then return null; end if;
  return v_out;
end;
$$;

-- Optional text: trimmed, empty = null; false when too long or not a string.
create function private._text_ok(p jsonb, p_max_len integer)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p is null or p = 'null'::jsonb
      or (jsonb_typeof(p) = 'string' and length(btrim(p #>> '{}')) <= p_max_len);
$$;

create function private._text_val(p jsonb)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(btrim(case when jsonb_typeof(p) = 'string' then p #>> '{}' end), '');
$$;

-------------------------------------------------------------------------------
-- save_bible: the creative fields and the Voce section in one call.
--   p_bible: {tone, characters, themes[], keywords[], allowed_ctas[],
--             duration_min_s, duration_max_s, words_per_second,
--             example_scripts[], default_models[]}
--   p_voice: {adjectives[], banned_words[], reference_audio_urls[],
--             allowed_liberties, anomaly_procedure}, or null to leave it.
--   p_expected_version: page_bibles.version the editor loaded (stale if not).
-- Every call replaces the whole bible: a missing field becomes empty.
-- Codes: ok, not_authorized, invalid_input, stale. Refusals go to
-- task_events (op save_bible, note = page id).
-------------------------------------------------------------------------------

create function private.save_bible(
  p_actor uuid, p_page_id uuid, p_bible jsonb, p_voice jsonb, p_expected_version integer
)
returns text
language plpgsql
security definer
set search_path = public, private
as $$
declare
  b page_bibles%rowtype;
  v voice_briefs%rowtype;
  v_themes text[];
  v_keywords text[];
  v_ctas text[];
  v_models text[];
  v_min integer;
  v_max integer;
  v_wps numeric;
  v_examples jsonb := '[]';
  v_ex jsonb;
  v_catalog jsonb;
  v_adjectives text[];
  v_banned text[];
  v_audio text[];
begin
  if p_page_id is null or not exists (select 1 from pages where id = p_page_id) then
    return 'invalid_input';
  end if;
  if not private._can_edit_script_lab(p_actor, p_page_id) then
    perform private._log(null, null, p_actor, 'save_bible', 'app', 'not_authorized', p_page_id::text);
    return 'not_authorized';
  end if;

  -- Shape and limits.
  if p_bible is null or jsonb_typeof(p_bible) <> 'object'
     or (p_voice is not null and jsonb_typeof(p_voice) <> 'object')
     or p_expected_version is null then
    return 'invalid_input';
  end if;
  v_themes := private._text_list(p_bible->'themes', 40, 120);
  v_keywords := private._text_list(p_bible->'keywords', 80, 60);
  v_ctas := private._text_list(p_bible->'allowed_ctas', 20, 300);
  v_models := private._text_list(p_bible->'default_models', 3, 120);
  if v_themes is null or v_keywords is null or v_ctas is null or v_models is null
     or not private._text_ok(p_bible->'tone', 4000)
     or not private._text_ok(p_bible->'characters', 8000) then
    return 'invalid_input';
  end if;
  if cardinality(v_models) <> (select count(distinct m) from unnest(v_models) m) then
    return 'invalid_input';
  end if;
  -- From S6 the model catalog lives in app_config.ai_models: ids outside it
  -- are refused. Before it exists, any well-formed id is kept.
  select value into v_catalog from app_config where key = 'ai_models';
  if v_catalog is not null and exists (
       select 1 from unnest(v_models) m
        where not exists (select 1 from jsonb_array_elements(v_catalog) c where c->>'id' = m)) then
    return 'invalid_input';
  end if;

  begin
    v_min := (p_bible->>'duration_min_s')::integer;
    v_max := (p_bible->>'duration_max_s')::integer;
    v_wps := coalesce((p_bible->>'words_per_second')::numeric, 2.5);
  exception when others then
    return 'invalid_input';
  end;
  if (v_min is null) <> (v_max is null)
     or (v_min is not null and not (v_min >= 5 and v_max <= 180 and v_min <= v_max))
     or v_wps < 1.5 or v_wps > 4 then
    return 'invalid_input';
  end if;

  if p_bible ? 'example_scripts' and p_bible->'example_scripts' <> 'null'::jsonb then
    if jsonb_typeof(p_bible->'example_scripts') <> 'array'
       or jsonb_array_length(p_bible->'example_scripts') > 5 then
      return 'invalid_input';
    end if;
    for v_ex in select value from jsonb_array_elements(p_bible->'example_scripts') loop
      if jsonb_typeof(v_ex) <> 'object'
         or exists (select 1 from jsonb_object_keys(v_ex) k
                     where k not in ('title', 'hook', 'corpo', 'chiusura', 'cta'))
         or not private._text_ok(v_ex->'title', 200)
         or not private._text_ok(v_ex->'hook', 2000)
         or not private._text_ok(v_ex->'corpo', 4000)
         or not private._text_ok(v_ex->'chiusura', 2000)
         or not private._text_ok(v_ex->'cta', 1000) then
        return 'invalid_input';
      end if;
      v_examples := v_examples || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'title', private._text_val(v_ex->'title'),
        'hook', private._text_val(v_ex->'hook'),
        'corpo', private._text_val(v_ex->'corpo'),
        'chiusura', private._text_val(v_ex->'chiusura'),
        'cta', private._text_val(v_ex->'cta'))));
    end loop;
  end if;

  if p_voice is not null then
    v_adjectives := private._text_list(p_voice->'adjectives', 40, 60);
    v_banned := private._text_list(p_voice->'banned_words', 80, 60);
    v_audio := private._text_list(p_voice->'reference_audio_urls', 40, 1000);
    if v_adjectives is null or v_banned is null or v_audio is null
       or exists (select 1 from unnest(v_audio) u where u !~* '^https?://\S+$')
       or not private._text_ok(p_voice->'allowed_liberties', 5000)
       or not private._text_ok(p_voice->'anomaly_procedure', 5000) then
      return 'invalid_input';
    end if;
  end if;

  -- The bible row is the lock for both tables.
  insert into page_bibles (page_id) values (p_page_id) on conflict (page_id) do nothing;
  select * into b from page_bibles where page_id = p_page_id for update;
  if b.version <> p_expected_version then
    perform private._log(null, null, p_actor, 'save_bible', 'app', 'stale', p_page_id::text);
    return 'stale';
  end if;

  update page_bibles set
    tone = private._text_val(p_bible->'tone'),
    characters = private._text_val(p_bible->'characters'),
    themes = v_themes,
    keywords = v_keywords,
    allowed_ctas = v_ctas,
    duration_min_s = v_min,
    duration_max_s = v_max,
    words_per_second = v_wps,
    example_scripts = v_examples,
    default_models = v_models,
    version = version + 1,
    updated_by = p_actor,
    updated_at = now()
  where id = b.id;

  -- Voce: its own version goes up only when something changed.
  if p_voice is not null then
    select * into v from voice_briefs where page_id = p_page_id for update;
    if not found then
      insert into voice_briefs (page_id, adjectives, banned_words, reference_audio_urls,
                                allowed_liberties, anomaly_procedure, updated_by)
      values (p_page_id, v_adjectives, v_banned, v_audio,
              private._text_val(p_voice->'allowed_liberties'),
              private._text_val(p_voice->'anomaly_procedure'), p_actor);
    elsif (v.adjectives, v.banned_words, v.reference_audio_urls, v.allowed_liberties, v.anomaly_procedure)
          is distinct from (v_adjectives, v_banned, v_audio,
                            private._text_val(p_voice->'allowed_liberties'),
                            private._text_val(p_voice->'anomaly_procedure')) then
      update voice_briefs set
        adjectives = v_adjectives,
        banned_words = v_banned,
        reference_audio_urls = v_audio,
        allowed_liberties = private._text_val(p_voice->'allowed_liberties'),
        anomaly_procedure = private._text_val(p_voice->'anomaly_procedure'),
        version = version + 1,
        updated_by = p_actor
      where id = v.id;
    end if;
  end if;

  return 'ok';
end;
$$;

create function public.save_bible(
  p_page_id uuid, p_bible jsonb, p_voice jsonb, p_expected_version integer
)
returns text language sql security definer set search_path = public, private as $$
  select private.save_bible(auth.uid(), p_page_id, p_bible, p_voice, p_expected_version);
$$;

revoke execute on function public.save_bible(uuid, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_bible(uuid, jsonb, jsonb, integer) to authenticated, service_role;

revoke execute on all functions in schema private from public, anon, authenticated;
