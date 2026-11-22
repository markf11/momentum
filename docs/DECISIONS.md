# Decisions log

Grill session started 2026-11-15. Each entry is RESOLVED, OPEN, or ADOPTED (a recommendation accepted by default, reversible).

## D1 — Product definition — RESOLVED (2026-11-15)

Momentum is a **Motion-style auto-scheduler**. The user enters tasks (duration, deadline, priority, etc.) and the app places them into free calendar time, then re-plans automatically when things change.

- **No AI/LLM features.** Scheduling is a deterministic rules engine. The "AI" label in the spec and docs refers to nothing real and should be dropped from the product language.
- **Motivation:** Motion costs $49/mo solo ($29 annual), has no free plan, and meters AI credits. The core scheduler doesn't need AI.
- Reference behaviour: `docs/MOTION-RESEARCH.md`.

## D2 — Model and licence — ADOPTED (2026-11-15, waved through, reversible)

- **Open source, self-hosted, AGPL-3.0**, with the user as the first user.
- A **paid hosted version stays possible later** but is not built now (no billing, no multi-tenant work, no Google app verification needed: each self-hoster supplies their own OAuth client).
- Keep FluidCalendar's MIT copyright notice in the fork (MIT permits sublicensing under AGPL).

## D3 — Build vs fork — ADOPTED (2026-11-15, waved through, reversible)

- **Fork FluidCalendar and replace its scheduler** with a standalone, tested, Motion-style engine.
- Justification, measured: this repo's scheduler crashes on every call and its UI never calls the backend; FluidCalendar compiles clean, passes 250 tests, and its auth/task/schedule APIs work live. Only its scheduler is below Motion grade.
- Boot test done (`MOTION-RESEARCH.md`). **Not yet verified: Google OAuth + sync** (needs the user's Google Cloud credentials).

## D4 — v1 scope — RESOLVED (2026-11-21, user picked option 1)

**In:** Google Calendar sync; tasks with duration, deadline, priority, start date; auto-scheduling with **chunking** and **hard deadlines**; drag-to-lock; **past-due** and **can't-fit** warnings.

**Out for now:** Outlook/CalDAV, projects and Kanban, tags, booking pages, energy levels, Google Tasks sync, admin/multi-user.

**Left open by this answer:** recurring tasks (FluidCalendar already has rrule-based recurrence; Motion uses flexible cadences). Asked next.

## D5 — Recurring tasks — RESOLVED (2026-11-21, user: "1 for now, later 2")

- **v1: simple RRULE recurrence** (daily/weekly/monthly on fixed days), reusing FluidCalendar's existing `rrule` support. Instances are expanded and scheduled like normal tasks.
- **Later: Motion-style flexible cadences** ("3× a week, any days", "once a month in week 2"), where the engine also picks which days. Noted as a post-v1 feature, not started now.

## D6 — Priority model — RESOLVED (2026-11-21, user picked option 1)

- **Levels: ASAP, High, Medium, Low** (Motion's four). FluidCalendar's existing High/Medium/Low/None migrates as None → Low; ASAP is added.
- **Ordering: ASAP first, then earliest deadline, then priority** as tiebreak. Deadline-driven, not FluidCalendar's weighted score and not this repo's strict tiers (req 3.1, now superseded).
- **Hard deadline = a real constraint.** If the engine can't finish a task by its hard deadline, it must surface a warning rather than schedule it late silently. Soft deadlines only influence placement.
- Rationale: deterministic, explainable in the UI, and rules out the silent-late behaviour measured in the FluidCalendar boot test (2 of 4 probe tasks scheduled past their due date with no flag).

## D7 — Manual drag — RESOLVED (2026-11-21, user picked option 1)

- **Drag = lock.** The task stays where the user dropped it; everything else re-plans around it. An unlock control returns it to auto-scheduling. Uses FluidCalendar's existing `scheduleLocked` flag.
- **Expired lock:** if the locked slot passes without the task being completed, it returns to the auto-schedule queue instead of staying in the past.
- **Locks override the rules:** a locked task may sit outside work hours or overlap a meeting. The engine allows it and shows a small conflict hint rather than refusing. Supersedes this repo's spec req 3.4 (re-optimize everything on manual move).

## D8 — Sync model — RESOLVED (2026-11-21, user picked option 1)

The Motion model:
- **Events: two-way** with Google Calendar. Busy events block scheduling, free events don't.
- **Tasks: one-way, out to Google** as event blocks. The app owns the task; moving the block in Google does not move the task.
- Task blocks are **free by default**, with an option to show them busy so others can't book over focus time. (Default confirmed in D9.)
- Reuses FluidCalendar's existing one-way task-block push. Two-way task sync is explicitly rejected for v1 (duplicate/ping-pong risk).

## D9 — Task-block visibility — RESOLVED (2026-11-21, user picked option 1)

- Task blocks pushed to Google are **free by default**.
- A per-user **"mark busy when at risk"** toggle flips at-risk tasks to busy so the time is protected. Toggle ships **off**.
- If the calendar is personal and never booked against, this has no effect; it's cheap to keep.

## D10 — Scheduling window — RESOLVED (2026-11-21, user picked option 1)

- **Rolling 31-day window**, matching Motion. Replaces FluidCalendar's 7 days.
- **Can't fit** = no room for the task anywhere in the window → the task is flagged and surfaced, never silently dropped.
- A **hard deadline** that can't be met inside the window is also flagged (per D6).
- No far-future suppression: a task due in two months is still placed in the earliest sensible slot inside the window. If that turns out to clutter the calendar, revisit with a "don't schedule before X" rule.

## D11 — Chunking — RESOLVED (2026-11-21, user picked option 1)

- **Split only when needed.** One block if a gap fits; otherwise split across gaps and days.
- **Minimum chunk: 30 minutes**, adjustable per task.
- Chunks must always sum to the task's full remaining duration, and the UI shows progress ("2 of 3 chunks scheduled"). This directly addresses the old solver's silent 41%-of-minutes loss.
- No forced maximum block length; focus protection belongs to the breaks setting, not to splitting.

## D12 — Breaks and lunch — RESOLVED (2026-11-21, user picked option 1)

- **One optional break rule**, off by default: "after 2 hours of scheduled task time, insert a 15-minute break". Both numbers editable.
- **No dedicated lunch feature.** A recurring busy event named Lunch already blocks the scheduler, in the app or in Google.
- **Per-event travel time is out for v1.**
- FluidCalendar's `bufferMinutes` is not enforced upstream and is not preserved as-is; the break rule replaces it.

## D13 — Problem UX — RESOLVED (2026-11-21, user picked option 1)

- **"Needs attention" section** at the top of the task list, plus coloured badges on calendar blocks.
- **Red** = past due (hard deadline missed or unmissable) and can't fit; **amber** = at risk.
- Clicking explains why and offers fixes: push the deadline, shorten the task, clear time.
- **No email or push notifications in v1.**

## D14 — Timezone and DST — RESOLVED (2026-11-21, user picked option 1)

- **One IANA timezone per user**, auto-detected and editable. Work hours and day boundaries are computed in it; slots are stored as absolute UTC instants.
- **On timezone change:** unlocked tasks re-plan against the new local hours; **locked tasks keep their absolute instant**.
- DST follows the same rule.
- Engineering requirement: scheduler tests must run with the server on **UTC** and across a **DST-change week**, so this can't regress silently. (The old repo failed exactly this: tasks landed at 04:00 local for a New York user.)

## D15 — Re-planning and runtime — RESOLVED (2026-11-21, user picked option 1)

- **Re-plan on every change** (task added/edited, event synced, task dragged), **debounced ~2s**.
- Runs **inside the Next.js app** — no Redis, no separate worker. Self-hosting stays one app + Postgres.
- **15-minute tick** for expired locks and newly at-risk tasks; **nightly full re-plan**.
- **Target: full 31-day re-plan of 100 tasks in <1s**, optimistic UI. Changes arriving mid-run set a dirty flag and trigger one more run (no dropped updates, unlike the old repo's queue).

## D16 — Small defaults — RESOLVED (2026-11-21, user accepted the whole bundle)

- **a) Duration required**, pre-filled 30 min. Tasks without a duration aren't scheduled.
- **b) No deadline** → scheduled after all deadline tasks, ordered by priority. ASAP still first.
- **c) Per-task auto-schedule toggle**: off = stays in the task list unscheduled.
- **d) ETA shown per task** = end of its last scheduled chunk.
- **e) Partial completion**: completing a chunk reduces remaining time; the rest re-plans.
- **f) Work hours**: one schedule, start/end per weekday, 15-minute steps. No multiple named schedules in v1.
- **g) Platforms**: responsive web only. No desktop or mobile apps in v1.
- **h) The AI-Calendar repo is archived.** The three docs written during this review (REVIEW-2026-11, MOTION-RESEARCH, DECISIONS) move to the fork.

## D17 — Name, hosting, and external integrations — RESOLVED (2026-11-21)

- **Name: Momentum.**
- **No Google integration in the first build.** The calendar works entirely inside the web app: local events and tasks, no external accounts. D8's sync model (events two-way, tasks one-way out) is **deferred, not cancelled** — external sync comes later, and the schema should not preclude it.
- **Nothing is pushed to GitHub yet.** The user has not given push permission; work happens locally. `markf11` is the GitHub account when that changes.
- Consequence for D3: the "verify Google OAuth before relying on the fork" check is no longer a blocker, because v1 doesn't use it. FluidCalendar's Google code paths stay in the tree but unused.

## Build order (agreed)

1. Local `momentum` repo from FluidCalendar, docs moved over.
2. New scheduler as a standalone tested module implementing D6–D16.
3. Wire it into the app: local events + tasks, chunk blocks on the calendar, Needs attention section.
4. Verify by booting and driving the API/UI. No external integrations.

## v1 gaps closed (2026-11-22)

Built by four parallel agents on separate branches, merged into `momentum-v1`, then verified together (tsc clean, 383 tests passing / 1 skipped across 49 suites, lint clean, `next build` OK, live API run).

- **Due dates (fixes D6 in practice):** a date-only due date means 23:59:59.999 in the user's timezone (New York `2026-11-23` → `2026-11-24T04:59:59.999Z`). The task form has an optional due time. Date-only start dates mean 00:00 local. Existing UTC-midnight rows are not migrated.
- **Branding:** FluidCalendar sponsor box and product name removed from the app UI; attribution kept in README/LICENSE.
- **One-click fixes (D13):** push deadline +1 day, make deadline soft, shorten to fit (uses the new `Task.scheduleFitMinutes`), shorten…, turn off auto-schedule.
- **Partial completion (D16e):** new `Task.remainingMinutes`; "Done with this chunk" and "Log time"; task completes at 0; editing duration keeps worked minutes.
- **Background re-plans (D15):** in-process loop via `src/instrumentation.ts`, every 15 min (`MOMENTUM_TICK_MS`), nightly full re-plan at 03:00 local (`MOMENTUM_NIGHTLY_HOUR`). Expired locks are unlocked and rescheduled (D7). Off during build/tests or with `MOMENTUM_DISABLE_BACKGROUND=1`.
- **Repeating busy events:** every occurrence in the 31-day window blocks time, DST-safe, with EXDATE support.
- **Break rule (D12):** now a final-schedule invariant; enforced by a 200-workload randomised property test.
- **Settings:** energy levels and project grouping removed from the UI (D4); "Calendars to consider" now filters busy events.

Still open: old UTC-midnight due dates aren't migrated; synced (Google/Outlook/CalDAV) date handling untouched; the Needs-attention ETA uses the browser's timezone; the nightly re-plan is unit-tested only.

