import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

import { scheduleTasks } from "../engine";
import {
  BreakRule,
  BusyEvent,
  SchedulerBlock,
  SchedulerInput,
  SchedulerPriority,
  SchedulerTask,
  WorkDay,
  WorkWeek,
} from "../types";

/**
 * Property-style check of the engine over seeded random workloads. The busy
 * oracle expands recurring events by wall-clock arithmetic, independently of
 * the engine's RRULE path. Jest runs with TZ=UTC; user timezones vary.
 */

const MINUTE = 60_000;
const SEEDS_PER_SCENARIO = 40;

const SCENARIOS: { name: string; timeZone: string; now: string }[] = [
  { name: "UTC", timeZone: "UTC", now: "2027-06-07T08:20:00.000Z" },
  {
    // Friday before the 2027-03-14 spring-forward.
    name: "New York DST week",
    timeZone: "America/New_York",
    now: "2027-03-12T13:07:00.000Z",
  },
  {
    // A week before the 2027-11-07 fall-back.
    name: "New York fall-back",
    timeZone: "America/New_York",
    now: "2027-10-31T12:45:00.000Z",
  },
  {
    name: "Berlin DST week",
    timeZone: "Europe/Berlin",
    now: "2027-03-26T07:00:00.000Z",
  },
  {
    name: "Kolkata",
    timeZone: "Asia/Kolkata",
    now: "2027-01-05T03:30:00.000Z",
  },
];

/** mulberry32: small, fast, deterministic. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

function hhmm(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function zoned(date: string, time: string, timeZone: string): number {
  if (time === "24:00") {
    return fromZonedTime(`${addDays(date, 1)}T00:00:00`, timeZone).getTime();
  }
  return fromZonedTime(`${date}T${time}:00`, timeZone).getTime();
}

type Interval = { start: number; end: number };

type Workload = {
  input: SchedulerInput;
  /** Every busy occurrence, expanded by the oracle. */
  busy: Interval[];
};

function generate(seed: number, timeZone: string, nowIso: string): Workload {
  const random = prng(seed);
  const int = (min: number, max: number) =>
    min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];
  const chance = (p: number) => random() < p;

  const now = new Date(new Date(nowIso).getTime() + int(0, 48 * 60) * MINUTE);
  const horizonDays = pick([7, 14, 31]);
  const today = formatInTimeZone(now, timeZone, "yyyy-MM-dd");

  const workWeek: WorkWeek = Array.from({ length: 7 }, (): WorkDay | null => {
    if (chance(0.2)) return null;
    const start = int(28, 42) * 15; // 07:00-10:30
    const end = Math.min(start + int(16, 40) * 15, 24 * 60); // +4h..+10h
    return { start: hhmm(start), end: hhmm(end) };
  });

  const busyEvents: BusyEvent[] = [];
  const busy: Interval[] = [];
  for (let index = int(0, 14); index > 0; index -= 1) {
    const date = addDays(today, int(-3, horizonDays - 1));
    const time = hhmm(int(32, 71) * 15); // 08:00-17:45
    const duration = int(1, 8) * 15 * MINUTE;
    const start = zoned(date, time, timeZone);
    const free = chance(0.1);
    if (chance(0.4)) {
      const daily = chance(0.5);
      const interval = int(1, 2);
      const count = int(2, 8);
      const step = (daily ? 1 : 7) * interval;
      const excluded = chance(0.5) ? int(0, count - 1) : -1;
      let rule = `RRULE:FREQ=${daily ? "DAILY" : "WEEKLY"};INTERVAL=${interval};COUNT=${count}`;
      if (excluded >= 0) {
        const exDate = addDays(date, excluded * step).replace(/-/g, "");
        rule += `\nEXDATE;TZID=${timeZone}:${exDate}T${time.replace(":", "")}00`;
      }
      busyEvents.push({
        start: new Date(start),
        end: new Date(start + duration),
        busy: !free,
        recurrenceRule: rule,
      });
      if (!free) {
        for (let k = 0; k < count; k += 1) {
          if (k === excluded) continue;
          const occurrence = zoned(addDays(date, k * step), time, timeZone);
          busy.push({ start: occurrence, end: occurrence + duration });
        }
      }
    } else {
      busyEvents.push({
        start: new Date(start),
        end: new Date(start + duration),
        busy: !free,
      });
      if (!free) busy.push({ start, end: start + duration });
    }
  }

  const priorities: SchedulerPriority[] = [
    "asap",
    "high",
    "medium",
    "low",
    "none",
  ];
  const tasks: SchedulerTask[] = [];
  const locks: Interval[] = [];
  for (let index = 0, count = int(1, 35); index < count; index += 1) {
    const durationMinutes = chance(0.15) ? int(5, 25) : int(1, 20) * 15;
    const item: SchedulerTask = {
      id: `t-${seed}-${pad(index)}`,
      durationMinutes,
      priority: pick(priorities),
      minChunkMinutes: chance(0.5) ? null : pick([15, 30, 45, 60]),
    };
    if (chance(0.1)) {
      item.remainingMinutes = Math.max(5, durationMinutes - int(1, 6) * 15);
    }
    if (chance(0.4)) {
      item.dueDate = new Date(
        now.getTime() + int(1, horizonDays * 24 * 4) * 15 * MINUTE
      );
      item.hardDeadline = chance(0.3);
    }
    if (chance(0.25)) {
      item.startDate = new Date(
        now.getTime() +
          int(0, horizonDays * 24 * 2) * 30 * MINUTE +
          int(0, 59) * MINUTE
      );
    }
    if (chance(0.07)) {
      item.startDate = new Date(now.getTime() + int(0, 48) * 30 * MINUTE);
      item.recurrenceRule = `FREQ=DAILY;COUNT=${int(2, 4)}`;
      item.dueDate = null;
    }
    if (chance(0.06)) item.autoSchedule = false;
    if (chance(0.1)) {
      const blocks: SchedulerBlock[] = [];
      for (let lock = int(1, 2); lock > 0; lock -= 1) {
        const start = zoned(
          addDays(today, int(0, horizonDays - 1)),
          hhmm(int(28, 72) * 15),
          timeZone
        );
        const candidate = { start, end: start + int(1, 12) * 15 * MINUTE };
        if (
          locks.some(
            (other) =>
              candidate.start < other.end && candidate.end > other.start
          )
        ) {
          continue;
        }
        locks.push(candidate);
        blocks.push({
          taskId: item.id,
          start: new Date(candidate.start),
          end: new Date(candidate.end),
          chunkIndex: blocks.length,
          locked: true,
          status: "locked",
        });
      }
      if (blocks.length) {
        item.locked = true;
        item.lockedBlocks = blocks;
      }
    }
    tasks.push(item);
  }

  const breakRule: BreakRule | null = chance(0.65)
    ? {
        afterMinutes: pick([30, 45, 60, 90, 120, 180]),
        durationMinutes: pick([5, 10, 15, 30]),
      }
    : null;

  return {
    input: {
      tasks,
      busyEvents,
      settings: {
        workWeek,
        breakRule,
        defaultMinChunkMinutes: pick([15, 30, 60]),
      },
      now,
      timeZone,
      horizonDays,
    },
    busy,
  };
}

function violations({ input, busy }: Workload): string[] {
  const output = scheduleTasks(input);
  const problems: string[] = [];
  const fail = (message: string) => {
    if (problems.length < 10) problems.push(message);
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  const nowMs = Math.ceil(input.now.getTime() / MINUTE) * MINUTE;
  const today = formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd");
  const horizonEnd = zoned(
    addDays(today, input.horizonDays!),
    "00:00",
    input.timeZone
  );
  const byId = new Map(input.tasks.map((item) => [item.id, item]));

  // Determinism.
  if (JSON.stringify(scheduleTasks(input)) !== JSON.stringify(output)) {
    fail("two runs over the same input differ");
  }

  // No two task blocks overlap.
  const sorted = [...output.blocks].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].start < sorted[index - 1].end) {
      fail(
        `overlap ${sorted[index - 1].taskId} and ${sorted[index].taskId} at ${sorted[index].start.toISOString()}`
      );
    }
  }

  for (const block of output.blocks) {
    if (block.locked) continue;
    const start = block.start.getTime();
    const end = block.end.getTime();
    const label = `${block.taskId} ${iso(start)}-${iso(end)}`;
    if (end <= start) fail(`empty block ${label}`);
    if (start < nowMs || end > horizonEnd) fail(`outside the window ${label}`);
    for (const event of busy) {
      if (start < event.end && end > event.start) {
        fail(`${label} overlaps busy ${iso(event.start)}-${iso(event.end)}`);
      }
    }
    const date = formatInTimeZone(block.start, input.timeZone, "yyyy-MM-dd");
    const day =
      input.settings.workWeek[new Date(`${date}T00:00:00Z`).getUTCDay()];
    if (
      !day ||
      start < zoned(date, day.start, input.timeZone) ||
      end > zoned(date, day.end, input.timeZone)
    ) {
      fail(`outside work hours ${label}`);
    }
  }

  // Chunks sum to the remaining minutes, respect the minimum, or the task
  // is flagged with no partial blocks.
  for (const result of output.tasks) {
    const item = byId.get(result.taskId)!;
    const remaining = item.remainingMinutes ?? item.durationMinutes ?? 0;
    const minChunk = Math.max(
      1,
      item.minChunkMinutes ?? input.settings.defaultMinChunkMinutes ?? 30
    );
    const total = result.blocks.reduce(
      (sum, block) => sum + (block.end.getTime() - block.start.getTime()),
      0
    );
    if (result.status === "cant_fit" || result.status === "unscheduled") {
      if (result.blocks.length)
        fail(`${result.taskId} ${result.status} has blocks`);
      continue;
    }
    if (result.status === "locked") {
      if (result.blocks.some((block) => !block.locked)) {
        fail(`${result.taskId} locked result has auto blocks`);
      }
      continue;
    }
    if (total !== remaining * MINUTE) {
      fail(
        `${result.taskId} chunks sum ${total / MINUTE}, expected ${remaining}`
      );
    }
    for (const block of result.blocks) {
      const length = block.end.getTime() - block.start.getTime();
      if (length < Math.min(minChunk, remaining) * MINUTE) {
        fail(`${result.taskId} chunk ${length / MINUTE} < min ${minChunk}`);
      }
    }
  }
  for (const item of input.tasks) {
    if (
      !item.recurrenceRule &&
      !output.tasks.some((r) => r.taskId === item.id)
    ) {
      fail(`${item.id} missing from results`);
    }
  }

  // Break rule: runs joined by gaps shorter than the break never exceed the
  // limit, unless made only of locked blocks.
  const rule = input.settings.breakRule;
  if (rule) {
    const breakMs = rule.durationMinutes * MINUTE;
    let runEnd = -Infinity;
    let run = { total: 0, auto: false, start: 0 };
    const check = () => {
      if (run.auto && run.total > rule.afterMinutes * MINUTE) {
        fail(
          `run of ${run.total / MINUTE} min from ${iso(run.start)} exceeds ${rule.afterMinutes}`
        );
      }
    };
    for (const block of sorted) {
      const start = block.start.getTime();
      if (start - runEnd >= breakMs) {
        check();
        run = { total: 0, auto: false, start };
      }
      run.total += block.end.getTime() - start;
      run.auto ||= !block.locked;
      runEnd = Math.max(runEnd, block.end.getTime());
    }
    check();
  }

  return problems;
}

describe("scheduleTasks properties over seeded random workloads", () => {
  const totals = { blocks: 0, cantFit: 0, breakRuns: 0 };

  it.each(SCENARIOS)("holds every invariant: $name", ({ timeZone, now }) => {
    for (let seed = 1; seed <= SEEDS_PER_SCENARIO; seed += 1) {
      const workload = generate(seed * 7919 + timeZone.length, timeZone, now);
      expect({ seed, timeZone, problems: violations(workload) }).toEqual({
        seed,
        timeZone,
        problems: [],
      });
      const output = scheduleTasks(workload.input);
      totals.blocks += output.blocks.length;
      totals.cantFit += output.tasks.filter(
        (t) => t.status === "cant_fit"
      ).length;
      if (workload.input.settings.breakRule) totals.breakRuns += 1;
    }
  });

  it("exercised real workloads", () => {
    expect(totals.blocks).toBeGreaterThan(1_000);
    expect(totals.cantFit).toBeGreaterThan(0);
    expect(totals.breakRuns).toBeGreaterThan(50);
  });
});
