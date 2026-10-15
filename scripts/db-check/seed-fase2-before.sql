-- upgrade.sh, right before Fase 2 (docs/fase2-plan.md §6, AC2): a voice brief
-- on a legacy page, then the row count and checksum of voice_briefs, so
-- checks-upgrade/06_fase2.sql can prove that Fase 2 moved no Voce data.
insert into voice_briefs (page_id, adjectives, banned_words, reference_audio_urls, allowed_liberties, version)
values ('b0000000-0000-0000-0000-000000000001', '{caldo,ironico}', '{schifo}',
        '{https://example.test/voce.wav}', 'Piccole interiezioni', 3);

create schema if not exists db_check;
create table db_check.voice_briefs_before as
  select count(*) as n,
         md5(coalesce(string_agg(row_to_json(v)::text, '|' order by v.id), '')) as h
  from voice_briefs v;

-- A reel imported from a Doc header without a title (`SCRIPT 13 — `): the
-- doc ideas backfill gives its idea the reel code.
insert into reels (id, batch_id, page_id, code, ordinal, title)
values ('d0000000-0000-0000-0000-000000000013', 'c0000000-0000-0000-0000-000000000001',
        'b0000000-0000-0000-0000-000000000001', 'LG-2609-13', 13, '');

-- "Batch Gennaio" imported on 10 December 2026: createBatch codes it with
-- that year (LG-2601-01), and the backfill must still say January 2027.
insert into batches (id, page_id, label, created_at)
values ('c0000000-0000-0000-0000-000000000013', 'b0000000-0000-0000-0000-000000000001', 'Batch Gennaio',
        '2026-12-10 10:00+00');
insert into reels (id, batch_id, page_id, code, ordinal, title)
values ('d0000000-0000-0000-0000-000000000014', 'c0000000-0000-0000-0000-000000000013',
        'b0000000-0000-0000-0000-000000000001', 'LG-2601-01', 1, 'Capodanno');
