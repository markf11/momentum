# Motion research — what we're cloning (Nov 2026)

Sources: Motion help center (`usemotion.com/help/...`, fetched 2026-11-15) and third-party pricing trackers (pikyai, blokit, temporal.day, Oct–Nov 2026).

## Price (the reason this project exists)

| Plan | Price |
|---|---|
| Solo "Pro AI" | **$49/mo** monthly, $29/mo annual. 7,500 AI credits/mo |
| Solo "Business AI" | $69/mo monthly, $39/mo annual |
| Team seats | from $19/seat/mo (annual) |
| Free plan | **None.** 7-day trial with a card ($1 hold) |

AI credits are metered on top of the plan. Most of what the price now pays for is AI: AI Chat, Notetaker, Docs, "AI Employees", and AI Agenda. **The core auto-scheduler is deterministic rules and needs no AI.** Motion's own docs describe it entirely as parameters and constraints.

## The core engine (what Motion's docs say it does)

**Task inputs:** title, duration, **priority (ASAP > High > Medium > Low)**, deadline with a **hard/soft** toggle, **start date** (never scheduled before it), **min chunk size** (long tasks get split into chunks at least that big), the **schedule** to use, recurrence, **blockers** (dependencies), and an auto-schedule on/off toggle.

**Schedules:** named weekly availability templates (e.g. "Work 9–5", "Personal 18–20", "Weekend"). Each task is assigned to one schedule.

**Placement rules:**
- Tasks go only inside their schedule's hours and avoid **busy** events. **Free** events can be scheduled over.
- Sooner deadlines and higher priority get earlier slots, weighed across all projects.
- **Hard deadline** may override the schedule (placing the task outside working hours) to make the deadline. Soft deadlines don't.
- Optional **breaks** (e.g. 15 min every 2 h) and **travel time** before/after events.
- No duration → not scheduled. No deadline *and* no priority → not scheduled. Future start date → waits.

**Re-planning:** everything reschedules automatically when events, tasks or priorities change. Tasks "keep moving" by design.

**Task states shown on the calendar:**
- **On time**
- **In progress**
- **Past due:** the deadline has passed, or the task is scheduled after its deadline. It's rolled into the next slot and flagged.
- **Can't fit:** no slot within a **rolling 31-day window** (92 for teams). Pinned at the top of the calendar.
- **Locked:** dragged manually, so it stays put. It's re-scheduled if it isn't completed within 60 min of its slot.
- **Ghost:** a later workflow stage that isn't active yet.

**ETA:** each task shows its projected finish time and warns when that's after the deadline.

**Reminders:** tasks of ≤4 min aren't placed on the calendar. They're pinned at the top instead.

**Recurring tasks:** flexible cadences, e.g. "once a week, any weekday" or "monthly, any day in week 2". A missed instance is moved to a new slot rather than duplicated. A daily task that can't fit becomes "could not fit" instead of rolling over.

## Calendar sync model

- **Events: bi-directional** (Google, Outlook, iCloud), with a 1–2 min lag.
- **Tasks: one-way** out to the main external calendar. A per-user setting picks one of: tasks hidden externally / shown as **free** / shown as free but **busy when at risk**. Changes made externally do not flow back.
- Events can be marked busy or free. Only busy events block tasks.

## Everything else Motion has (candidate out-of-scope)

Projects with stages, workflow templates and Gantt/Kanban/List views; booking links; team workspaces and capacity planning; dashboards; Siri/email-to-task; desktop and mobile apps. Plus all the AI: chat, notetaker, docs, AI employees, AI agenda.

## Existing open-source alternatives

| Repo | Stars | License | Activity | Notes |
|---|---|---|---|---|
| dotnetfactory/fluid-calendar | ~1,005 | **MIT** | last push 2026-09-21 | "Open-source alternative to Motion". Next.js 15, Prisma, FullCalendar, NextAuth. Google + CalDAV. README: "ACTIVE DEVELOPMENT VERY BUGGY". Has a SaaS waitlist. |
| Dayotter/dayotter | ~50 | AGPL-3.0 | active | AI-native scheduling/booking |
| ujjwalredd/horolog | ~7 | AGPL-3.0 | 2026-08 | self-hosted, LLM-based |

## The "cheaper Motion" market (prices from vendor pages and trackers, Sep–Nov 2026)

| Product | Solo price | Free tier | Notes |
|---|---|---|---|
| Motion | $29–49/mo | No | Reference point |
| Morgen | $15–30/mo | No (14-day trial) | |
| Reclaim.ai | $10–12/mo | Yes (1-week range) | Closest auto-scheduler |
| FlowSavvy | ~$10/mo yearly, $14 monthly | Yes | Rule-based auto-scheduling, 8-week window on Pro |
| TimeHero | $5/user/mo | Trial | |
| Temporal.day | $9/mo flat | — | Markets itself explicitly as "Motion without AI credits" |
| Deflective | £6/mo | Yes | |
| GoodPlans | $29.99/yr | — | iPhone only |
| FluidCalendar | Free (self-host, MIT) | — | Hosted SaaS on a waitlist |
| Clockwise | — | — | Acqui-hired by Salesforce; **shut down 2026-03-27** |

Takeaway: "Motion but cheaper and without AI" is already sold by at least 6 products at $5–15/mo, most with free tiers. Price alone isn't an opening. The open-source / self-hosted slot has one notable entry (FluidCalendar), and its own README calls it "very buggy".

Open-core precedent: Cal.com (AGPL core plus a hosted product) reached an estimated $11M ARR in Nov 2026 (Sacra), and has since moved some parts closed-source.

## Google OAuth implications

- Calendar scopes (`calendar`, `calendar.events`, …) are **sensitive**, not restricted. A public app therefore needs Google verification (privacy policy, verified domain, scope justification, demo video; up to ~10 days), but **no paid security assessment** (that's only for restricted scopes like Gmail).
- Unverified apps are capped at 100 users.
- Self-hosted open source avoids verification entirely: each self-hoster creates their own Google Cloud OAuth client, which is how FluidCalendar does it.

## FluidCalendar evaluation (code read of `b8f5dbe`, 2026-09-21; not booted yet)

**Stack:** Next.js 15, React 19, Prisma 6, NextAuth 4, FullCalendar, rrule. Google, Outlook (msal-node 3) and CalDAV (tsdav). About 49k lines of TS across 324 files. No `@ts-nocheck`. Roughly 3 commits a month, one maintainer. 43 open / 84 closed issues.

**Scheduler:** `src/services/scheduling/*`, about 1,000 lines. It is a **greedy** scheduler, the same family this review recommended:
1. Score every task's best slot.
2. Sort tasks by that score.
3. Place each task in its top-scoring slot.
4. Mark that slot busy and continue with the next task.

Slot score is a weighted average: deadline proximity 3.0, priority 1.8, energy 1.5, time preference 1.2, work hours 1.0, buffer 0.8, project grouping 0.5.

**What's good:** work hours are computed in the user's timezone. It has locked tasks, start dates, recurrence via rrule, a full re-plan on each run, pushing task blocks to Google, and the calendar UI and sync are already built.

**Gaps against Motion:**

| Motion feature | FluidCalendar |
|---|---|
| Chunking / min chunk size | **None.** A task is one contiguous block |
| Blockers / dependencies | **None** (not in the schema) |
| Hard vs soft deadline | **None.** The deadline is only a score weight, so a task can land after its due date with no flag |
| Can't fit / past due states | **None.** If no slot exists within **7 days** (the 14- and 30-day windows are commented out), the task is silently left unscheduled |
| 31-day scheduling window | 7 days |
| Multiple named schedules, lunch, breaks | One work-hours block, whole hours only. Buffers are computed but not enforced (TODO at `TimeSlotManager.ts:412`) |
| ETA per task | None |

**Bugs found by reading the code:**
- `filterByWorkHours` compares `endHour <= workHourEnd`. With an end of 17:00, a 16:30–17:30 slot passes, so tasks can run up to 59 min past the end of the workday.
- Candidate start times advance in steps of the task's duration (`TimeSlotManager.ts:282`). A 90-min task is only tried at 9:00, 10:30, 12:00 and so on, so it misses gaps that start between those times.
- Energy and time-of-day preference use `slot.start.getHours()`, which is server timezone.
- Server code reaches into a client zustand store as a fallback.
- **The scheduler has no tests.** `autoSchedule.test.ts` only tests `formatTime`.

**Verdict:** the app shell and sync are worth reusing, but the scheduler is the weakest part and isn't Motion-grade. It needs to be replaced, not copied.

## FluidCalendar live boot test (2026-11-21, commit b8f5dbe)

Run in scratch with userspace Postgres 18 (no Docker available on this host), `npm ci`, `prisma migrate deploy`, `next dev`.

- **37 migrations applied.** `tsc --noEmit` exits 0 with no errors.
- **Jest: 250 passed / 1 skipped, 33 of 38 suites green.** The 5 failing suites are all Google ones, and they fail only because this host runs Node 26: `buffer-equal-constant-time` reads `SlowBuffer`, which Node 26 removed, so `require('jsonwebtoken')` throws. Their Dockerfile pins `node:22`, and on Node 22.23.5 the same import works. Their `engines` says `>=22.11.0` with no upper bound, which is a real trap on newer Node.
- **Live API flow works:** `POST /api/setup` creates the first admin (public registration is off by default), credentials login, `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/auto-schedule-settings`, `POST /api/tasks/schedule-all` all return 200.
- **`POST /api/tasks` requires `status`** in the body, otherwise Prisma throws 500 (`Argument status is missing`). The UI always sends it, but the API doesn't default it.
- **Live scheduler output** (4 tasks, work hours 9–17 Mon–Fri, user tz America/New_York, run on a Saturday):

| Task | Duration | Priority | Due (local) | Scheduled (local) |
|---|---|---|---|---|
| Email replies | 15m | high | Sat 21 Nov 12:00 | **Mon 23 Nov 09:15 — 2 days late, unflagged** |
| Review PR | 30m | medium | Sun 22 Nov 12:00 | **Mon 23 Nov 09:30 — 1 day late, unflagged** |
| Write report | 90m | high | Mon 23 Nov 12:00 | Mon 23 Nov 12:30 (one contiguous block) |
| Plan sprint | 60m | low | Thu 26 Nov 12:00 | Thu 26 Nov 12:00 |

This confirms the code-read finding with real data: **tasks that miss their deadline are scheduled anyway with no warning.** That is the single biggest gap to fix in a fork.

Google OAuth and sync were not exercised: no Google Cloud credentials were configured. That remains the one unverified part of the "reuse the shell" argument.


## Mapping to this repo's spec (`.kiro/specs/motion-calendar/requirements.md`)

The spec is already a Motion clone in outline. Where it differs:

| Motion | This spec | Gap |
|---|---|---|
| ASAP/High/Med/Low + hard/soft deadline | Low/Med/High/Critical + hard/soft, with a fixed tier order (req 3.1) | Hierarchy differs; Motion balances priority against deadline proximity |
| Named schedules per task | One set of working hours + lunch | Missing |
| Start date, min chunk size, auto-schedule toggle | Not present (only "blocking" = no split) | Missing |
| Can't fit (31-day window), Past due, ETA | "Alert the user and suggest alternatives" | Underspecified |
| Locked (drag = pin) | "Manual move → re-optimize everything" (req 3.4) | **Contradicts Motion**: Motion pins dragged tasks |
| Recurring tasks with flexible cadences | Not present | Missing |
| Busy/free events; tasks one-way to external calendar | All external events are firm; bi-directional sync | Different sync model |
| Energy-level preferences | Req 11.3 | Not a Motion feature (in practice) |
