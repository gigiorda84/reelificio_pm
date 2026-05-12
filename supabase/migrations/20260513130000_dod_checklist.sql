-- Sprint 8 — Definition of Done checklist (BP §10).
--
-- A reel cannot advance from `editing` to `publication` until all 5 DoD items
-- are checked. Items are intentionally modelled as rows in a small table
-- (absence = unchecked) so we get a free audit trail of who-checked-what-when.

create type dod_item_key as enum (
  'script_validated',
  'audio_recorded',
  'editing_done',
  'subtitles',
  'qc_approved'
);

create table reel_dod_items (
  reel_id uuid not null references reels(id) on delete cascade,
  key dod_item_key not null,
  checked_by uuid references profiles(id) on delete set null,
  checked_at timestamptz not null default now(),
  note text,
  primary key (reel_id, key)
);

create index reel_dod_items_reel_idx on reel_dod_items(reel_id);

alter table reel_dod_items enable row level security;

-- Anyone authenticated can read DoD state (visible on the reel detail page).
create policy reel_dod_items_read_auth on reel_dod_items
  for select to authenticated using (true);

-- Write access for admins or R/A of the editing phase. RLS keeps writes
-- safe; server actions add the additional phase check (only meaningful
-- while the reel is in `editing`).
create policy reel_dod_items_write_raci on reel_dod_items
  for all to authenticated
  using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
    or exists (
      select 1 from raci_configs rc
      join reels r on r.id = reel_dod_items.reel_id
      where rc.page_id = r.page_id
        and rc.phase = 'editing'
        and (auth.uid() = any (rc.responsible) or auth.uid() = any (rc.approver))
    )
  )
  with check (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
    or exists (
      select 1 from raci_configs rc
      join reels r on r.id = reel_dod_items.reel_id
      where rc.page_id = r.page_id
        and rc.phase = 'editing'
        and (auth.uid() = any (rc.responsible) or auth.uid() = any (rc.approver))
    )
  );
