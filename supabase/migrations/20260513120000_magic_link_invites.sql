-- Sprint 7 — magic-link invite ergonomics.
--
-- Adds invite metadata + external-author display on comments. The existing
-- admin-only RLS on magic_link_invites (initial schema) is unchanged.
-- Invitee writes go through the service-role client (no anon policies).

-------------------------------------------------------------------------------
-- 1. magic_link_invites: human label + free-form note
-------------------------------------------------------------------------------

alter table magic_link_invites
  add column if not exists external_label text,
  add column if not exists notes text;

-- Default scope is 'reel' for the MVP cut. Existing rows (none in prod yet)
-- are coerced for safety.
update magic_link_invites set scope = 'reel' where scope is null or scope = '';
alter table magic_link_invites alter column scope set default 'reel';

create unique index if not exists magic_link_invites_token_idx
  on magic_link_invites(token);

-- RLS: the initial schema already provides magic_link_invites_admin_all
-- (admin-only select + write). Invitee reads happen via the service-role
-- client in /invite/[token] — no anon policy needed.

-------------------------------------------------------------------------------
-- 2. comments: attribute external authors via invite_id + author_label.
-------------------------------------------------------------------------------

alter table comments
  add column if not exists invite_id uuid references magic_link_invites(id) on delete set null,
  add column if not exists author_label text;

create index if not exists comments_invite_idx on comments(invite_id);

-- Ensure each comment has some attribution (either author_id or invite_id).
alter table comments drop constraint if exists comments_author_or_invite_chk;
alter table comments add constraint comments_author_or_invite_chk
  check (author_id is not null or invite_id is not null);
