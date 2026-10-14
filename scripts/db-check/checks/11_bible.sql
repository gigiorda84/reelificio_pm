-- Fase 2 S2 — page bible (docs/fase2-plan.md §4 AC1–4, §7.2).
-- Users from seed.sql: a admin · b Responsible script_writing · c internal
-- without a role · d RACI approver · e external dubber.

-- Helpers: act as a user; a full, valid bible; a voice section.
create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_id, false);
$$;
create function pg_temp.bible(p_tone text default 'Ironico, mai volgare') returns jsonb language sql as $$
  select jsonb_build_object(
    'tone', p_tone,
    'characters', 'Porcino: scettico. Papaya: entusiasta.',
    'themes', jsonb_build_array('cucina', ' scienza ', ''),
    'keywords', jsonb_build_array('funghi'),
    'allowed_ctas', jsonb_build_array('Salva il reel', 'Seguici'),
    'duration_min_s', 30, 'duration_max_s', 45, 'words_per_second', 2.5,
    'example_scripts', jsonb_build_array(jsonb_build_object(
      'title', 'Il porcino non si lava', 'hook', 'Lo sapevi?', 'corpo', 'Assorbe acqua.',
      'chiusura', 'Ciao', 'cta', 'Salva il reel')),
    'default_models', jsonb_build_array('anthropic/claude-sonnet'));
$$;
create function pg_temp.voice(p_banned text default 'schifo') returns jsonb language sql as $$
  select jsonb_build_object(
    'adjectives', jsonb_build_array('caldo', 'ironico'),
    'banned_words', jsonb_build_array(p_banned),
    'reference_audio_urls', jsonb_build_array('https://example.test/a.wav'),
    'allowed_liberties', 'Piccole interiezioni',
    'anomaly_procedure', null);
$$;
create function pg_temp.page() returns uuid language sql immutable as $$
  select '10000000-0000-0000-0000-000000000001'::uuid;
$$;

-- External fixture (as in 07_externals.sql): e holds a dubbing task on reel 1.
insert into tasks (id, reel_id, kind, status, assignee_id, started_at, accepted_at) values
  ('50000000-0000-0000-0000-000000000b01', '30000000-0000-0000-0000-000000000001', 'dubbing',
   'in_progress', '00000000-0000-0000-0000-00000000000e', now(), now());
update reels set state = 'doppiaggio' where id = '30000000-0000-0000-0000-000000000001';

-- Backfill and trigger: the page inserted by seed.sql got an empty bible.
do $$ begin
  if (select count(*) from page_bibles where page_id = pg_temp.page()) <> 1
     or (select version from page_bibles where page_id = pg_temp.page()) <> 1 then
    raise exception 'FAIL: the seeded page has no empty bible at version 1';
  end if;
  if exists (select 1 from pages p where not exists (select 1 from page_bibles b where b.page_id = p.id)) then
    raise exception 'FAIL: a page without a bible row';
  end if;
  if (select script_lab_enabled from pages where id = pg_temp.page()) then
    raise exception 'FAIL: script_lab_enabled is on by default';
  end if;
end $$;

set role authenticated;

-- AC3: Responsible (not admin) and admin save; the others are refused.
do $$ declare v text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  v := public.save_bible(pg_temp.page(), pg_temp.bible(), pg_temp.voice(), 1);
  if v <> 'ok' then raise exception 'FAIL: Responsible save_bible = %', v; end if;

  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  v := public.save_bible(pg_temp.page(), pg_temp.bible('Admin'), pg_temp.voice(), 2);
  if v <> 'ok' then raise exception 'FAIL: admin save_bible = %', v; end if;

  -- Internal without a role, RACI approver, external: not_authorized, nothing changes.
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
  if public.save_bible(pg_temp.page(), pg_temp.bible('c'), pg_temp.voice('c'), 3) <> 'not_authorized' then
    raise exception 'FAIL: internal without a role saved the bible';
  end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
  if public.save_bible(pg_temp.page(), pg_temp.bible('d'), pg_temp.voice('d'), 3) <> 'not_authorized' then
    raise exception 'FAIL: the RACI approver saved the bible';
  end if;
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
  if public.save_bible(pg_temp.page(), pg_temp.bible('e'), pg_temp.voice('e'), 3) <> 'not_authorized' then
    raise exception 'FAIL: the external saved the bible';
  end if;

  -- Stale version.
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  if public.save_bible(pg_temp.page(), pg_temp.bible('old'), null, 2) <> 'stale' then
    raise exception 'FAIL: an old version was not refused as stale';
  end if;
end $$;

reset role;
do $$ declare b page_bibles%rowtype; v voice_briefs%rowtype; begin
  select * into b from page_bibles where page_id = pg_temp.page();
  select * into v from voice_briefs where page_id = pg_temp.page();
  if b.version <> 3 or b.tone <> 'Admin' or b.updated_by <> '00000000-0000-0000-0000-00000000000a' then
    raise exception 'FAIL: bible after the saves: version %, tone %', b.version, b.tone;
  end if;
  if b.themes <> '{cucina,scienza}' or b.duration_min_s <> 30 or b.default_models <> '{anthropic/claude-sonnet}'
     or jsonb_array_length(b.example_scripts) <> 1 then
    raise exception 'FAIL: bible fields not stored as sent (themes %)', b.themes;
  end if;
  -- Voce: created by the first save, unchanged by the identical second one.
  if v.banned_words <> '{schifo}' or v.adjectives <> '{caldo,ironico}' or v.version <> 1
     or v.anomaly_procedure is not null then
    raise exception 'FAIL: voice section: banned % version %', v.banned_words, v.version;
  end if;
  if (select count(*) from task_events where op = 'save_bible' and code = 'not_authorized') <> 3
     or (select count(*) from task_events where op = 'save_bible' and code = 'stale') <> 1 then
    raise exception 'FAIL: refusals not logged in task_events';
  end if;
end $$;

-- A changed Voce bumps its own version; p_voice null leaves it alone.
set role authenticated;
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  if public.save_bible(pg_temp.page(), pg_temp.bible(), pg_temp.voice('cavolo'), 3) <> 'ok'
     or public.save_bible(pg_temp.page(), pg_temp.bible(), null, 4) <> 'ok' then
    raise exception 'FAIL: saves with a changed and a missing voice section';
  end if;
end $$;
reset role;
do $$ begin
  if (select version from voice_briefs where page_id = pg_temp.page()) <> 2
     or (select banned_words from voice_briefs where page_id = pg_temp.page()) <> '{cavolo}' then
    raise exception 'FAIL: voice version or banned words after the change';
  end if;
end $$;

-- Invalid input: limits and shapes; nothing changes.
set role authenticated;
do $$ declare v_case jsonb; v_bad text; begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  for v_case in select * from jsonb_array_elements(jsonb_build_array(
      pg_temp.bible() || '{"duration_min_s": 3, "duration_max_s": 45}',
      pg_temp.bible() || '{"duration_min_s": 30, "duration_max_s": 200}',
      pg_temp.bible() || '{"duration_min_s": 50, "duration_max_s": 45}',
      pg_temp.bible() || '{"duration_min_s": 30, "duration_max_s": null}',
      pg_temp.bible() || '{"duration_min_s": "trenta"}',
      pg_temp.bible() || '{"words_per_second": 5}',
      pg_temp.bible() || '{"default_models": ["a/1", "a/2", "a/3", "a/4"]}',
      pg_temp.bible() || '{"default_models": ["a/1", "a/1"]}',
      pg_temp.bible() || '{"themes": "cucina"}',
      pg_temp.bible() || '{"themes": [1, 2]}',
      pg_temp.bible() || jsonb_build_object('tone', repeat('x', 4001)),
      pg_temp.bible() || '{"example_scripts": [{"title": "x", "extra": "y"}]}',
      pg_temp.bible() || '{"example_scripts": [{},{},{},{},{},{}]}'))
  loop
    if public.save_bible(pg_temp.page(), v_case, null, 5) <> 'invalid_input' then
      v_bad := coalesce(v_bad || ' | ', '') || left(v_case::text, 120);
    end if;
  end loop;
  if v_bad is not null then raise exception 'FAIL: accepted invalid bibles: %', v_bad; end if;

  if public.save_bible(pg_temp.page(), pg_temp.bible(),
                       pg_temp.voice() || '{"reference_audio_urls": ["ftp://x"]}', 5) <> 'invalid_input'
     or public.save_bible(pg_temp.page(), pg_temp.bible(),
                          pg_temp.voice() || jsonb_build_object('allowed_liberties', repeat('x', 5001)), 5) <> 'invalid_input'
     or public.save_bible(pg_temp.page(), '[]', null, 5) <> 'invalid_input'
     or public.save_bible('10000000-0000-0000-0000-0000000000ff', pg_temp.bible(), null, 1) <> 'invalid_input' then
    raise exception 'FAIL: accepted an invalid voice section, a non-object bible or an unknown page';
  end if;
end $$;
reset role;
do $$ begin
  if (select version from page_bibles where page_id = pg_temp.page()) <> 5 then
    raise exception 'FAIL: an invalid save changed the bible';
  end if;
end $$;

-- Catalog (from S6): with app_config.ai_models set, unknown ids are refused.
insert into app_config (key, value) values ('ai_models', '[{"id": "anthropic/claude-sonnet"}]');
set role authenticated;
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  if public.save_bible(pg_temp.page(), pg_temp.bible() || '{"default_models": ["x/unknown"]}', null, 5) <> 'invalid_input' then
    raise exception 'FAIL: a model outside the catalog was accepted';
  end if;
  if public.save_bible(pg_temp.page(), pg_temp.bible(), null, 5) <> 'ok' then
    raise exception 'FAIL: a catalog model was refused';
  end if;
end $$;

-- No direct writes on page_bibles, not even for an admin.
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  begin
    update page_bibles set tone = 'diretto';
    raise exception 'FAIL: direct update on page_bibles';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into page_bibles (page_id) values ('10000000-0000-0000-0000-000000000001');
    raise exception 'FAIL: direct insert on page_bibles';
  exception when insufficient_privilege then null;
  end;
end $$;

-- AC4: the external reads the Voce (banned words included), never the bible.
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
  if (select count(*) from page_bibles) <> 0 then
    raise exception 'FAIL: the external reads page_bibles';
  end if;
  if (select count(*) from voice_briefs) <> 1
     or (select banned_words from voice_briefs) <> '{cavolo}' then
    raise exception 'FAIL: the external does not read the voice section with its banned words';
  end if;
  -- Internals read the bible.
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
  if (select count(*) from page_bibles) <> 1 then
    raise exception 'FAIL: an internal without a role cannot read the bible';
  end if;
end $$;

-- The switch: only admins (pages_admin_write).
do $$ begin
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
  update pages set script_lab_enabled = true where id = pg_temp.page();
  perform pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
  if (select script_lab_enabled from pages where id = pg_temp.page()) then
    raise exception 'FAIL: a non-admin turned the Script Lab on';
  end if;
  update pages set script_lab_enabled = true where id = pg_temp.page();
  if not (select script_lab_enabled from pages where id = pg_temp.page()) then
    raise exception 'FAIL: the admin could not turn the Script Lab on';
  end if;
end $$;
reset role;

rollback;
