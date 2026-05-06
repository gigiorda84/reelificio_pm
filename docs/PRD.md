# Reellificio PM — Product Requirements Document

**Version** 0.2 · **Owner** Gabriele Concas · **Date** 2026-05-06
**Status** Draft for review · **Source** `reellificio_BP.md` v2.0 (April 2026)

**Changelog**
- 2026-05-06 — Pipeline phases overhauled to match production RACI: QC removed (absorbed into Montaggio + Sottotitoli); `scientific_validation` added as a discrete phase; `script_validation` renamed `script_writing` (Scrittura script finale + Valutazione viralità); `publish_queue` renamed `publication`. New canonical order: **research_prescript → scientific_validation → script_writing → dubbing → editing → publication**. RACI table refreshed (§3.1).

---

## 1. Summary

A lightweight web app that orchestrates the monthly production of vertical Instagram reels across multiple pages. It replaces the ad-hoc mix of WhatsApp / Telegram / call coordination with a single source of truth for **pipeline state, file references, comments, and notifications**, while leaving creative assets in Google Drive and strategic docs wherever they currently live.

The app is **not** a replacement for Notion-style wiki, video editing tools, or social schedulers. It is the operational layer between the monthly script doc and the published reel.

## 2. Goals

1. Turn each monthly **script Google Doc** into a structured batch of reel cards automatically.
2. Move every reel through the production pipeline (ricerca & pre-script → validazione scientifica → scrittura script → doppiaggio → montaggio + sottotitoli → pubblicazione & caption) with explicit phase ownership (RACI) and visible state.
3. Let team members **complete tasks, comment on each reel, @-mention, and receive notifications** via email + WhatsApp + Telegram.
4. Surface buffer / KPI alerts the moment thresholds are crossed (BP §3.1, §6).
5. Onboard external collaborators (doppiatori, montatori, scientific validators) with **per-task magic links** — no account setup friction.

### Non-goals (v1)

- Replacing Notion / Drive for documents.
- Hosting media files (audio WAV, video MP4) — stays in Drive, embedded.
- Native social publishing — the app stops at "ready in publish queue"; the SMM publishes from their existing tool.
- Timecode-level comments on audio/video.
- Automated KPI ingestion from Instagram Graph API in v1 (manual entry first; integration in v2).

## 3. Users & roles

### 3.1 RACI per phase (default, configurable per page)

| Phase | R (Responsible) | A (Approves) | C (Consulted) | I (Informed) |
| --- | --- | --- | --- | --- |
| `research_prescript` (Ricerca & pre-script) | Gabriele / Giuse | Teo | — | Matteo |
| `scientific_validation` (Validazione scientifica) | Partner esterno (Daniel Giunti) | Gabriele / Giuse | — | tutti |
| `script_writing` (Scrittura script finale + valutazione viralità) | Team Scrittura | Teo | NAM | — |
| `dubbing` (Doppiaggio) | Doppiatore | Gabriele, Giuse | Team Script | tutti |
| `editing` (Montaggio + sottotitoli) | Team Montaggio | Matteo | Gabriele | Gabriele |
| `publication` (Pubblicazione & caption) | SMM | Gabriele | Matteo | tutti |

The RACI table is **per-page** (not global). The defaults above match the initial Reellificio config; admins edit them on the page detail. R/A/C/I each accept multiple users (e.g. R = "Gabriele OR Giuse" — either can claim the work and request advancement).

| Role | Type | Capabilities |
| --- | --- | --- |
| **Admin** (Head of Ops) | Full account | All permissions; manages pages, users, roles, voice briefs, settings. Can promote others to Admin. |
| **Core team** (Art Director, Strategy, AI/Sys Dev) | Full account | View/edit any reel; assigned as R/A/C/I per RACI; can create batches, KPIs. |
| **Producer** (Team Script, Team Scrittura) | Full account | Edit reels in script phases; cannot promote phases past their RACI scope. |
| **Editor** (Montaggio) | Full account | Edit reels in editing phase; upload deliverable links. |
| **SMM** | Full account | Captions, scheduling info, KPI entry. |
| **External collaborator** (doppiatore, validator, freelance editor) | Magic-link, per-task | Sees only assigned reel(s); can comment, upload deliverable link, mark done. No batch-wide visibility. |
| **Viewer** | Full account | Read-only across all pages. |

Permissions are scoped by **page** (a user can be Editor on Page A and Viewer on Page B) and by **phase** (RACI table per page, configurable).

## 4. Domain model

```
Page (e.g. "Porcino & Papaya")
 ├── VoiceBrief (1)              — adjectives, ref audio links, banned words, rules
 ├── RaciConfig (1)              — phase → R/A/C/I user IDs
 ├── Members (n)                 — role per page
 └── Batch (n, monthly)
      ├── sourceDocUrl           — Google Doc link
      ├── sourceDocSyncedAt      — last parse
      ├── status                 — draft / active / closed
      └── Reel (typically 25)
           ├── code              — e.g. "PP-2605-01" (page-yymm-NN)
           ├── title             — "INFARTO"
           ├── format            — PORCINO_MONO / PAPAYA_MONO / BOTTA_E_RISPOSTA / DUO
           ├── category          — safe / adapted / test (BP §3.2)
           ├── hook / corpo / chiusura / cta — markdown blocks
           ├── notes             — inline writer notes from the doc
           ├── phase             — research_prescript, scientific_validation, script_writing, dubbing, editing, publication
           ├── phaseStatus       — green / yellow / red (semaforo)
           ├── phaseEnteredAt    — for stuck-detection
           ├── assignees         — { phase: userId } (R role)
           ├── deliverables      — [{ kind: audio|video|caption, driveUrl, uploadedBy }]
           ├── comments (n)
           └── activityLog
```

Other entities: `Comment`, `Notification`, `MagicLinkInvite`, `KpiRecord`, `BufferAlert`, `User`, `NotificationPreference`.

## 5. Core workflows

### 5.1 Monthly batch ingestion

1. Admin pastes the Google Doc URL into "New batch" for a page.
2. Backend uses Google Drive API to fetch the doc as natural-language text.
3. **Parser** splits on `SCRIPT N — TITLE`, then extracts blocks `HOOK`, `CORPO`, `CHIUSURA`, `CTA`, plus the format tag line (e.g. `✅ PORCINO MONOLOGO (Papaya cameo)`) and any inline notes.
4. Each script becomes a reel card in phase `research_prescript` (or `script_writing` if marked safe and pre-validated).
5. Category (safe/adapted/test) defaults to `adapted`; admin can bulk-edit.
6. **Re-sync button** on the batch: re-fetches doc, shows a diff (new/changed/removed scripts), admin confirms which changes to apply. Comments and phase progress on existing reels are preserved.

> Parser fallback: if a section can't be detected, the reel is created with raw text in a `rawContent` field and a `parserWarning` flag — never lose data.

### 5.2 Pipeline board (per batch)

Kanban view: columns = pipeline phases. Each card shows:
- code, title, format badge, category badge
- semaforo color (green/yellow/red based on time-in-phase vs BP §3.1 thresholds)
- assignee avatar (R from RACI)
- comment count, attachment count

Filters: by page, by category, by assignee, by status.
Bulk actions: assign, advance phase (admin only).

### 5.3 Reel detail page

Tabs:
1. **Script** — hook/corpo/chiusura/cta blocks, editable, with versioning (last 10 versions). Format & category editable.
2. **Voice** — Voice Brief snapshot (read-only from page), audio deliverable link (Drive), recording notes.
3. **Editing** — link to montaggio Drive folder, video preview embed, technical notes.
4. **Publish** — caption, scheduled date, hashtags, post URL once published.
5. **Comments** — threaded, @-mentions, file attachments via Drive link.
6. **Activity** — auto log of every state change.

> QC is no longer a discrete phase. The Definition of Done (BP §10: script validated + audio + edit + subs + QC review) is enforced as a checklist *inside* the editing phase: a reel cannot be advanced from editing → publication until all checklist items are confirmed by the A (Matteo).

### 5.4 RACI-driven phase advancement

- Only the **R** for the current phase sees the "Mark phase complete" button.
- On completion, the **A** receives a notification with an inline approve/reject. Reject = back one phase with required note.
- **C** is auto-tagged in a comment; **I** receives a passive notification (no action required).
- Admins can override RACI when needed (logged).

### 5.5 Daily async update

Per-user dashboard widget with three fields (BP §5.1): *Completato oggi*, *Blocco attivo*, *Consegno domani*. Auto-prompts at user-configured local time (default 18:00). Each user sets their own time in profile. Aggregated weekly digest goes to Head of Ops on Monday morning.

### 5.6 Buffer & KPI alerts (the alert engine)

A scheduled job (every 15 min) evaluates rules:

| Rule | Trigger | Action |
| --- | --- | --- |
| Buffer < 3 reels publish-ready | per page | Email + WhatsApp + Telegram to Gabriele + in-app banner |
| Phase stuck > 24h with no comment | per reel | Notify R + A |
| Script in validation > 7 days | per reel | Notify Gabriele |
| Reel rejection rate at QC > 20% | weekly aggregate | Notify Matteo |
| KPI in red zone (BP §6) | when manual KPI record entered | Notify owner of that KPI |

Every alert opens an in-app "Alert" item with a required *Proposed solution* field before it can be closed (BP §6.2 procedure).

### 5.7 Notifications

Three independent channels, per-user opt-in: **email**, **WhatsApp**, **Telegram**. User chooses, per event type, which channels deliver:
- @mentions
- assignment to a reel
- phase-advance approval requests
- buffer/KPI alerts
- daily-update reminder
- weekly digest

**WhatsApp**: WhatsApp Cloud API (Meta) with templated messages.
**Telegram**: Bot API; user starts a chat with @ReellificioBot, app gives them a one-time code to bind chat_id.
**Email**: transactional via Resend (or similar).

### 5.8 External collaborator magic links

Admin clicks "Invite to reel" → enters email or phone → selects scope (single reel, full batch read-only, single phase). System generates a signed, expiring URL. The recipient lands on a stripped-down view of just what they were invited to, can comment, upload deliverable links, and mark their work done. No account, no password. Re-issuable; revocable.

### 5.9 Voice Brief management

Per page: editable form matching BP §4.1 (3 adjectives, 2 reference audio Drive links, banned-words list, allowed liberties, anomaly procedure). Doppiatori see this read-only on every reel they're assigned to. Versioned — old versions stay accessible for reels in flight.

## 6. Pages & screens (MVP)

1. **Login / Magic-link landing**
2. **Dashboard** — my tasks, my mentions, alerts, daily update widget
3. **Page list** → **Page detail** (members, voice brief, RACI config, KPI dashboard)
4. **Batch list** → **Batch board (kanban)**
5. **Reel detail** (tabs as 5.3)
6. **Alerts inbox**
7. **Settings** — profile, notification preferences (channels × events × time), connected accounts (Google, WhatsApp, Telegram)
8. **Admin** — users & roles, magic-link invites, audit log

## 7. Tech stack (proposed)

- **Frontend**: Next.js 15 (App Router) + React + TypeScript + Tailwind + shadcn/ui
- **Backend**: Next.js Route Handlers + Server Actions; background jobs via **Inngest** (or Vercel Cron + a queue) for the alert engine and reminders
- **DB & auth**: **Supabase** (Postgres + Auth + Row-Level Security + Storage for the few things that don't live in Drive)
- **Hosting**: Vercel
- **Integrations**:
  - Google Drive API via **service account** (robot email; the Reellificio Drive folder is shared with it once, all batch docs inside become readable)
  - WhatsApp Cloud API (Meta Business) — **deferred to v1.1**, Meta Business not yet verified
  - Telegram Bot API — bot handle to be registered closer to launch
  - Resend (email)
- **Observability**: Sentry + Vercel Analytics
- **Hosting region**: **EU** (Vercel `fra1` / Supabase EU region) for GDPR
- **UI language**: **Italian only** in v1 (i18n-ready code structure so we can add EN later without refactor)

Rationale: fastest path from zero to production-grade with auth, RLS, and realtime baked in. All billed on usage; sub-€50/mo at pilot scale.

## 8. MVP scope (target: usable for **June batch**)

**In**:
- Pages, batches, reels, voice briefs
- Google Doc parser + re-sync
- Pipeline kanban + reel detail with all tabs
- Comments + @-mentions
- RACI per phase + phase advancement with approval
- Email notifications + Telegram (WhatsApp confirmed deferred to v1.1 — Meta Business not yet verified)
- Daily async update + weekly digest
- Buffer alert + stuck-phase alert (the two highest-leverage from BP)
- Magic-link invites
- Manual KPI entry + threshold-based alerts

**Deferred to v1.1 / v2**:
- WhatsApp channel (pending Meta Business verification)
- Instagram Graph API auto-KPI ingestion
- Timecode comments on media
- Mobile native app (PWA in MVP)
- Analytics dashboards beyond the BP KPI table
- Notion-style docs

## 9. Decisions log

Resolved 2026-05-05:
- ✅ **Stack**: Next.js + Supabase + Vercel
- ✅ **Reel code format**: `PP-2606-01` (page-yymm-NN); each page gets a 2-letter prefix at creation
- ✅ **Drive auth**: service account; the Reellificio Drive folder is shared with the bot email once
- ✅ **UI language**: Italian only (i18n-ready scaffolding)
- ✅ **Hosting region**: EU
- ✅ **Domain**: temporary (e.g. `reellificio-pm.vercel.app`); custom domain later
- ⏳ **WhatsApp**: deferred to v1.1 — Meta Business verification not yet started. Telegram + email cover MVP.
- ⏳ **Telegram bot handle**: to be registered closer to launch

Still to confirm before/during build:
1. Page list at launch (which Instagram pages get pages-in-the-app on day 1) and their 2-letter code prefixes
2. Initial RACI per page (start from BP §2.2 default; per-page overrides allowed)
3. Default daily-update reminder time (user-overridable)
4. Buffer threshold per page if different from BP default of 3

## 10. Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Script doc format drifts month to month, parser breaks | Med | Parser is permissive (raw fallback per script); diff UI on re-sync; one shared template |
| Meta WhatsApp approval delays MVP | High | Ship MVP without WhatsApp (Telegram + email cover the gap), add later |
| Notification fatigue | Med | Per-user channel matrix from day one; daily digest by default, instant only for alerts |
| External collabs lose magic link | Med | Re-issuable; also email re-send button; magic links bind to reel not session |
| Google Drive rate limits during big batch parses | Low | Backoff + cache parsed content per `revisionId` |
| Scope creep into Notion-replacement | High | Explicit non-goal; reject doc-features in MVP |

## 11. Success criteria (pilot, 4 weeks post-launch)

- 100% of June-batch reels created from Drive doc with zero manual entry of script content
- ≥ 90% of phase transitions captured in-app (vs. on WhatsApp)
- Daily-update completion rate ≥ 80% across core team
- Zero reels published without all 5 Definition-of-Done items checked
- Buffer alerts firing accurately (no false negatives on buffer < 3)
