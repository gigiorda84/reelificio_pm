# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

Sprint 0 foundation is in place: Next.js 16 app with Supabase auth, Italian i18n, shadcn/ui, and the initial database schema. Future sessions extend this; do not re-scaffold.

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

Env file: `.env.local` (see `.env.example`). The keys are emitted by `supabase start`; copy them in if they ever change.

## Architecture notes

- **Next.js 16 conventions**: the framework deprecated `middleware.ts` → use `proxy.ts` exporting `proxy()` (see `src/proxy.ts`). The `cookies()` helper from `next/headers` is **async** — always `await cookies()`. When in doubt about Next.js 16 behavior, consult `node_modules/next/dist/docs/`; the `AGENTS.md` at repo root warns that this version has breaking changes vs. older training data.
- **Supabase clients**: three flavors live in `src/lib/supabase/`:
  - `client.ts` — browser (Client Components)
  - `server.ts` — server (Server Components, Server Actions, Route Handlers); always re-create per request
  - `middleware.ts` — the helper used by `src/proxy.ts` to refresh sessions on every request and protect routes
  Use the `getAll`/`setAll` cookie API only — the deprecated `get`/`set`/`remove` will be removed.
- **Route protection**: `src/proxy.ts` redirects unauthenticated users to `/login` for any path not in `PUBLIC_PATHS`. Authenticated users hitting `/login` are bounced to `/dashboard`. The protected layout (`src/app/dashboard/layout.tsx`) double-checks auth via `getUser()` for defense-in-depth.
- **i18n**: single-locale (`it`) for now; messages in `src/messages/it.json`, request config in `src/i18n/request.ts`, plugin wired via `next.config.ts`. Adding EN later = add `en.json`, expose locale switching, optionally enable path prefixing — no other refactor needed.
- **Database**: schema in `supabase/migrations/*.sql`. Every table has RLS enabled. Baseline policies are intentionally permissive (admin-write, authenticated-read); tighten per-feature in later migrations rather than relaxing them later.
- **Reel codes**: format `PP-2606-01` (page prefix, yymm, ordinal). The 2-letter prefix is stored on `pages.code_prefix` and is unique across pages.
