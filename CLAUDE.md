# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

Sprint 0 → Sprint 9 are in place and deployed. Future sessions extend; do not re-scaffold.

- **Sprint 0**: Next.js 16 + Supabase auth + Italian i18n + shadcn/ui scaffolding.
- **Sprint 1**: Pages admin, bootstrap-admin flow, Drive service-account integration, script-doc parser, create-batch + re-sync.
- **Sprint 2**: reel detail page (Script / Voice / Files / Publish / Comments tabs), inline edit on each tab, generic comments thread (reel/batch/voice_brief targets) with post/edit/delete-own.
- **Sprint 3**: pipeline phases (`research_prescript` → `publication`), kanban board at `/pipeline` with page/batch filters and semaforo status, RACI editor on page detail, phase-advance request/approve/reject workflow, dashboard.
- **Sprint 4**: Voice Brief editor (admin, on page detail); @-mention autocomplete in comments (resolved profile IDs stored in `comments.mentions`).
- **Sprint 5A**: notifications core — Resend email + Telegram (HMAC-token account linking via `/api/telegram/webhook`), per-user channel × event matrix at `/settings`, mention dispatch.
- **Alert engine**: `buffer_low` + `phase_stuck` rules, deduped while open, auto-closed when resolved; manual close requires a *proposed solution* (BP §6.2). Inbox at `/alerts`.
- **Sprint 7**: per-reel magic-link invites for external collaborators; public `/invite/[token]` view (script, comments, Drive deliverable links, "lavoro pronto").
- **Sprint 8**: Definition of Done checklist (5 items) gating editing → publication.
- **Sprint 9**: daily async update (`/aggiornamenti` + dashboard card), daily reminder cron, Monday weekly digest.
- Post-sprint: top-nav UI redesign, "Reelificio" branding (one L in UI copy), `scripts/invite-users.ts` admin helper.

**Not yet built (PRD §8 MVP gaps)**: manual KPI entry + KPI threshold alerts; reel Activity tab and script versioning; Admin screen (users & roles, audit log); remaining alert rules (validation > 7 days, QC rejection rate); Sentry; PWA manifest.

There is no app test suite. Two kinds of check exist:
- `scripts/db-check/run.sh` applies every migration to a throwaway local Postgres, with a small shim for Supabase's `auth` and roles, so no Docker is needed. It then runs the RLS and permission checks in `scripts/db-check/checks/*.sql`. If `postgrest` is installed, it also runs `api-check.mjs`, which exercises the app's query shapes through a real PostgREST.
- The manual scripts in `scripts/`.

Run `scripts/db-check/run.sh` after every migration change, and add a check whenever a policy changes.

**Next direction — Reellificio Brain (decided 2026-10-01):** this app evolves into the "Brain", a 7-module app (Intelligence, Attualità, Character Lab, Script Lab, Produzione, Pubblicazione, Analytics) scaled to ~50 pages and ~10 internal users. Work proceeds in phases, starting with **Fase 0 (hardening)** on branch `fase-0-hardening`.
- `docs/brain-concept.md` — summary of the team's concept doc. The original Claude Doc lives in another org and is not readable by tools.
- `docs/brain-plan.md` — the decisions, architecture, phases, Fase 0 checklist and cost model. Read it before starting Brain work, and update its checklists as phases close.
- `docs/fase1-plan.md` — the approved execution plan for Fase 1 "Produzione 2.0" (approved 2026-10-02). Its decision log is `docs/fase1-decisioni.md`.
  - Follow the plan slice by slice.
  - Apply the inline fixes I1–I15 listed at the end of the plan.
  - Keep the file current if the plan changes.
  - S5 (Drive, release R2) runs ahead of R1 on branch `fase-1-s5-drive`, so the R1 tags never contain Drive. R1 fixes go on `fase-1-produzione` and are merged into it. The plan's S5 "Variazioni" explain the migration rename at the R1 cut.
- Where the Brain docs and the PRD disagree on scope, the Brain docs win for new work. One example: the pipeline moves from 6 linear phases to 8 states with parallel dubbing and animation.

- `docs/reellificio_BP.md` — the **business plan** (v2.0, April 2026). Authoritative description of the production model: phases, RACI, batch structure, KPIs, buffer rules, voice system, onboarding, scalability plan.
- `docs/PRD.md` — the **product requirements document** for the webapp being built to support that production model. Authoritative for product scope, domain model, workflows, stack, and locked-in decisions.

When in doubt, the PRD overrides the BP for *what the app does*; the BP overrides the PRD for *how the production process works*. If they conflict on process, surface it — the PRD is meant to encode the BP, not redefine it.

## Project goal

Build a webapp that orchestrates the monthly production of vertical Instagram reels across multiple pages — the operational layer between the monthly script Google Doc and the published reel. Replaces ad-hoc WhatsApp/Telegram/call coordination with a single source of truth for pipeline state, file references, comments, and notifications. Files themselves stay in Google Drive (linked/embedded); the app is **not** a Notion or Drive replacement.

## Locked-in technical decisions (from PRD §7, §9)

These are confirmed — do not re-litigate without explicit user approval:

- **Stack**: Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui; Supabase (Postgres + Auth + RLS + Storage); Vercel hosting
- **Hosting region**: EU (`fra1` / Supabase EU) for GDPR
- **UI language**: Italian only in v1, with i18n-ready code structure so EN can be added later without refactor
- **Background jobs**: Inngest or Vercel Cron + queue, for the alert engine and reminder dispatch
- **Email**: Resend (transactional)
- **Telegram**: Bot API (handle TBD)
- **WhatsApp**: Cloud API — **deferred to v1.1** (Meta Business not yet verified). MVP ships without it.
- **Google Drive**: **service account** (robot email; the Reellificio parent Drive folder is shared with the bot once → every batch doc inside becomes readable). Do not implement per-user OAuth.
- **Reel code format**: `PP-2606-01` (page-yymm-NN); each page has a 2-letter prefix
- **Domain**: temporary Vercel subdomain for now; custom domain later

## Domain vocabulary (Italian; do not translate in code or UI)

- **Doppiatore** — voice actor; **doppiaggio** — voice recording phase
- **Montatore / montaggio** — video editor / editing phase
- **SMM** — Social Media Manager
- **Batch** — monthly production unit (~25 scripts/page)
- **Voice Brief** — per-page voice identity spec (BP §4.1)
- **Semaforo** — phase status indicator (green/yellow/red) driven by time-in-phase thresholds (BP §3.1)
- **Buffer** — count of publish-ready reels waiting in the publish queue. Hard rule: alert when < 3
- **RACI** — Responsible / Approves / Consulted / Informed; per phase, per page (BP §2.2)
- Reel script blocks: **HOOK**, **CORPO**, **CHIUSURA**, **CTA**

## Monthly script doc parser (critical path)

Every batch is bootstrapped by parsing one Google Doc supplied by the user. PRD §5.1 specifies the workflow; the **reference structure** (validated 2026-05-05 against the May "Porcino & Papaya" batch) is:

- Document header identifies page name and batch (e.g. `PORCINO & PAPAYA` / `Batch Maggio`)
- Repeating per-script blocks: `SCRIPT N — TITLE`, then a format tag line (one of `PORCINO MONOLOGO`, `PAPAYA MONOLOGO`, `BOTTA E RISPOSTA`, `DUO`, with optional cameo notes), then sections `HOOK`, `CORPO`, `CHIUSURA`, `CTA`
- Inline writer notes appear between scripts (free prose; preserve as `notes`)

Parser must be **permissive**: if any section is missing, store the unparsed text in `rawContent` with a `parserWarning` flag — never drop content. Re-sync produces a diff users confirm before applying; existing comments and phase progress on already-imported reels are preserved.

## Memory

Project-specific memory lives at `~/.claude/projects/-Users-juicy-Documents-Reelificio-PM/memory/` (user role, project decisions, Drive references). Read it at session start; update it when decisions change.

## Build / lint / test

Package manager: **pnpm** (10.x via corepack). Node 20.

```bash
pnpm install                  # first time
pnpm dev                      # Next.js dev server on :3000 (Turbopack)
pnpm build                    # production build
pnpm lint                     # ESLint
pnpm typecheck                # tsc --noEmit
```

Local Supabase (Postgres + Auth + Storage + Mailpit):

```bash
supabase start                # boot the local stack (Docker required)
supabase stop                 # shut down
supabase db reset             # drop + re-apply all migrations (destructive, dev-only)
supabase migration new <name> # scaffold a new SQL migration
```

Useful local URLs while `supabase start` is running:
- API: `http://127.0.0.1:54321`
- Studio (DB UI): `http://127.0.0.1:54323`
- Mailpit (captures all auth emails in dev): `http://127.0.0.1:54324`

Environments (since 2026-10-01):
- **`.env.local` → STAGING**, the Supabase project `reelificio-pm-staging` (`zrzgxudzetuztleujfri`).
  - `pnpm dev` and every `scripts/*.ts` (which load `.env.local`) hit staging.
  - `SUPABASE_SECRET_KEY` there is the legacy `service_role` JWT, because the CLI returns the new secret key masked.
- **`.env.production.local` → PRODUCTION** (`rbcgtwohcsqjmyjzhlbx`). Next only loads it for `pnpm build` / `pnpm start`.
- **Supabase CLI link:** the CLI is linked to **staging**.
  1. To migrate prod, re-run `scripts/db-check/run.sh`.
  2. Dump prod (see the memory note on backups; the org is on the Free plan, so there are no automatic backups).
  3. Run `supabase link --project-ref rbcgtwohcsqjmyjzhlbx`, then `supabase db push --linked --dry-run`, then push.
  4. Re-link staging with `supabase link --project-ref zrzgxudzetuztleujfri`.
- Local `supabase start` is not used: the Mac lacks the disk space.

## Architecture notes

- **Next.js 16 conventions**: the framework deprecated `middleware.ts` → use `proxy.ts` exporting `proxy()` (see `src/proxy.ts`). The `cookies()` helper from `next/headers` is **async** — always `await cookies()`. When in doubt about Next.js 16 behavior, consult `node_modules/next/dist/docs/`; the `AGENTS.md` at repo root warns that this version has breaking changes vs. older training data.
- **Supabase clients**: four flavors live in `src/lib/supabase/`:
  - `client.ts` — browser (Client Components)
  - `server.ts` — server (Server Components, Server Actions, Route Handlers); always re-create per request
  - `middleware.ts` — the helper used by `src/proxy.ts` to refresh sessions on every request and protect routes
  - `admin.ts` — service-role client (`SUPABASE_SECRET_KEY`), **bypasses RLS**. Only for trusted server contexts: notification dispatch, cron handlers, the Telegram webhook, and invitee-side actions for magic-link users (who have no session, so RLS stays strict and the action validates the invite token instead). Never import from client code.
  Use the `getAll`/`setAll` cookie API only — the deprecated `get`/`set`/`remove` will be removed. `src/app/auth/callback/route.ts` builds its own client that writes cookies straight onto the redirect response, because Next.js 16 Route Handlers don't reliably carry `cookies()` writes onto a manually built `NextResponse.redirect()`.
- **Route protection**: `src/proxy.ts` redirects unauthenticated users to `/login` for any path not in `PUBLIC_PATHS`. Authenticated users hitting `/login` are bounced to `/dashboard`. Authenticated app routes live in the `src/app/(app)/` route group, whose layout double-checks auth via `getUser()` for defense-in-depth.
- **Cron jobs**: declared in `vercel.json`, handled under `src/app/api/cron/*`, and authenticated by `isAuthorizedCronRequest()` in `src/lib/auth/cron.ts`: `Authorization: Bearer ${CRON_SECRET}` header only. Never accept the secret as a query param, because it would leak into request logs. The project is on the Vercel **Hobby** plan, which only allows once-a-day crons: alerts run 09:00 UTC, daily reminders 16:00 UTC, weekly digest Monday 07:00 UTC. A sub-daily schedule fails deploy validation silently (pushes stop producing deployments). Fase 1 adds `task-sweep` (every 5 min) and `standup` routes: they go into `vercel.json` only once Vercel Pro is active (R1 step 6); until then `scripts/cron-loop.ts` calls them.
- **Admin scripts**: `scripts/*.ts` run with `pnpm exec tsx` and have their own `scripts/tsconfig.json`; they're excluded from the Next.js typecheck.
- **i18n**: single-locale (`it`) for now; messages in `src/messages/it.json`, request config in `src/i18n/request.ts`, plugin wired via `next.config.ts`. Adding EN later = add `en.json`, expose locale switching, optionally enable path prefixing — no other refactor needed.
- **Database**: schema in `supabase/migrations/*.sql`. Every table has RLS enabled. Baseline policies are intentionally permissive (admin-write, authenticated-read); tighten per-feature in later migrations rather than relaxing them later.
  Since Fase 0, user-writable columns are limited by column-level grants:
  - `profiles`: `full_name` and `daily_reminder_at` only;
  - `reels`: content columns only.

  Anything else goes through SECURITY DEFINER functions:
  - `decide_phase_advance()` is the only path that changes a reel's phase;
  - `claim_admin_if_first()` and `unlink_telegram()` cover the profile cases.

  Policies use the helpers `is_admin()`, `has_raci_role()` and `is_page_member()`. Supabase drops RLS-filtered updates silently, so server actions add `.select('id')` and map an empty result to `not_authorized`. A reel with `posted_url` set has `published_at` set and leaves the active set. For list counts, use `active_reel_counts()` and `batch_reel_counts()` instead of loading rows.
- **Reel codes**: format `PP-2606-01` (page prefix, yymm, ordinal). The 2-letter prefix is stored on `pages.code_prefix` and is unique across pages. Codes are generated by `src/lib/batches/codes.ts` using the *batch month* (extracted from the Italian batch label like "Batch Maggio") so re-syncs produce stable codes.
- **Drive integration**: server-side only. `src/lib/drive/client.ts` builds a JWT auth client from `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` (the private key is stored with literal `\n` escapes; decoded at runtime). `src/lib/drive/fetch.ts` exposes `fetchDocAsText(urlOrFileId)` which handles both Google Docs (`?export?mimeType=text/plain`) and uploaded `.docx` files (downloaded as bytes, extracted via `mammoth`). All errors thrown are typed `DriveFetchError` with discriminated `kind`.
- **Script-doc parser**: `src/lib/parser/parse.ts` splits the doc into reels using the `SCRIPT N — TITLE` header pattern, then buckets each chunk's lines into HOOK / CORPO / CHIUSURA / CTA. Format detection looks for `PORCINO MONOLOGO`, `PAPAYA MONOLOGO`, `BOTTA E RISPOSTA` (or check-mark prefix). Permissive: any chunk without a detectable HOOK or CORPO falls back to `rawContent` + `parserWarning` so content is never lost. Test against `tests/fixtures/porcino-papaya-may.txt` via `pnpm exec tsx scripts/test-parser.ts`.
- **Create-batch / re-sync**: `src/lib/batches/actions.ts`. Both flows fetch the doc, parse, and either insert the batch+reels or compute a diff against existing reels by ordinal. Re-sync **never deletes** reels (production work may be in flight); it only inserts new ordinals and updates content fields on changed ones, preserving phase, comments, and deliverables.
