# Momentum

A self-hosted, open-source auto-scheduler in the style of [Motion](https://www.usemotion.com/), with no AI. You add tasks with a duration, deadline and priority; Momentum places them into your free time and re-plans automatically when anything changes.

> **Work in progress.** Not ready for real use yet. The new scheduler is being built; external calendar sync is not part of the first milestone.

## Why

Motion's core scheduler is a set of deterministic rules, yet it costs $29–49/month with no free plan, and most of that price now pays for AI features. Momentum keeps the scheduler and drops the rest.

## How scheduling works

- **Order:** ASAP tasks first, then earliest deadline, then priority (High → Medium → Low). Tasks without a deadline come last.
- **Hard deadlines are real constraints.** If a task can't be finished in time, it's flagged — never silently scheduled late.
- **Chunking:** a task goes in one block if a gap fits it; otherwise it's split across gaps and days (30-minute minimum chunk). Chunks always add up to the full duration.
- **Rolling 31-day window.** A task with no room anywhere in it is flagged *can't fit*.
- **Drag = lock.** A task you move by hand stays put; everything else re-plans around it.
- **Re-plans on every change**, debounced, inside the app — no extra services.
- Work hours per weekday, an optional break rule, one timezone per user (DST-safe), simple recurring tasks.

The full set of design decisions is in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Roadmap

- **Now:** standalone calendar inside the web app — local events and tasks, new scheduler, "Needs attention" view.
- **Later:** Google Calendar sync (events two-way, tasks one-way out as blocks), flexible recurring cadences ("3× a week, any days"), other providers.

## Running locally

Requires **Node 22** (newer Node versions break a dependency) and PostgreSQL.

```bash
npm ci
cp .env.example .env        # set DATABASE_URL and NEXTAUTH_SECRET
npx prisma migrate deploy
npm run dev
```

Open http://localhost:3000 and complete the first-run setup to create your account.

## Credits and licence

Momentum is a fork of [FluidCalendar](https://github.com/dotnetfactory/fluid-calendar) by Emad Ibrahim, which provides the app shell, calendar UI and data model. FluidCalendar's code is used under the MIT licence; its notice is kept in [`LICENSE.FluidCalendar-MIT`](LICENSE.FluidCalendar-MIT) and its original README in [`docs/FLUIDCALENDAR-README.md`](docs/FLUIDCALENDAR-README.md).

Momentum as a whole is licensed under the **GNU AGPL v3.0** — see [`LICENSE`](LICENSE).
