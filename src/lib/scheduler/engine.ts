import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { RRule } from "rrule";

import {
  ScheduleStatus,
  SchedulerBlock,
  SchedulerInput,
  SchedulerIssue,
  SchedulerOutput,
  SchedulerPriority,
  SchedulerTask,
  TaskScheduleResult,
  WorkWeek,
} from "./types";

const MINUTE = 60_000;
const DEFAULT_MIN_CHUNK = 30;
const DEFAULT_AT_RISK_WINDOW = 24 * 60;
const PRIORITY_RANK: Record<SchedulerPriority, number> = {
  asap: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

type Interval = { start: number; end: number };

type Unit = {
  task: SchedulerTask;
  instanceStart: Date | null;
  earliest: number;
  dueDate: Date | null;
};

type DraftAllocation = {
  block: SchedulerBlock;
  interval: Interval;
};

function priority(task: SchedulerTask): SchedulerPriority {
  return task.priority && task.priority in PRIORITY_RANK
    ? task.priority
    : "none";
}

function ceilToMinute(value: number): number {
  return Math.ceil(value / MINUTE) * MINUTE;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${pad(result.getUTCMonth() + 1)}-${pad(result.getUTCDate())}`;
}

function zonedInstant(date: string, time: string, timeZone: string): number {
  if (time === "24:00") {
    return fromZonedTime(
      `${addCalendarDays(date, 1)}T00:00:00`,
      timeZone
    ).getTime();
  }
  return fromZonedTime(`${date}T${time}:00`, timeZone).getTime();
}

function floatingDate(date: Date, timeZone: string): Date {
  return new Date(
    `${formatInTimeZone(date, timeZone, "yyyy-MM-dd'T'HH:mm:ss")}Z`
  );
}

function floatingString(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function buildWorkWindows(
  now: Date,
  timeZone: string,
  horizonDays: number,
  workWeek: WorkWeek
): Interval[] {
  if (workWeek.length !== 7) {
    throw new Error("workWeek must contain seven entries, starting on Sunday");
  }
  if (!Number.isInteger(horizonDays) || horizonDays <= 0) {
    throw new Error("horizonDays must be a positive integer");
  }

  const firstDate = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const windows: Interval[] = [];
  for (let offset = 0; offset < horizonDays; offset += 1) {
    const localDate = addCalendarDays(firstDate, offset);
    const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay();
    const workDay = workWeek[weekday];
    if (!workDay) continue;
    const start = zonedInstant(localDate, workDay.start, timeZone);
    const end = zonedInstant(localDate, workDay.end, timeZone);
    if (end > start) windows.push({ start, end });
  }
  return windows;
}

function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .map((interval) => ({ ...interval }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

function subtractInterval(window: Interval, busy: Interval): Interval[] {
  if (busy.end <= window.start || busy.start >= window.end) return [window];
  const free: Interval[] = [];
  if (busy.start > window.start) {
    free.push({ start: window.start, end: Math.min(busy.start, window.end) });
  }
  if (busy.end < window.end) {
    free.push({ start: Math.max(busy.end, window.start), end: window.end });
  }
  return free.filter((interval) => interval.end > interval.start);
}

function freeIntervals(
  workWindows: readonly Interval[],
  occupied: readonly Interval[],
  earliest: number,
  horizonEnd: number
): Interval[] {
  const merged = mergeIntervals(occupied);
  const free: Interval[] = [];
  for (const window of workWindows) {
    let candidates = [
      {
        start: Math.max(window.start, earliest),
        end: Math.min(window.end, horizonEnd),
      },
    ].filter((interval) => interval.end > interval.start);
    for (const busy of merged) {
      if (busy.end <= window.start) continue;
      if (busy.start >= window.end) break;
      candidates = candidates.flatMap((candidate) =>
        subtractInterval(candidate, busy)
      );
      if (candidates.length === 0) break;
    }
    free.push(...candidates);
  }
  return free.sort((a, b) => a.start - b.start || a.end - b.end);
}

const TASK_FREQUENCIES: readonly number[] = [
  RRule.DAILY,
  RRule.WEEKLY,
  RRule.MONTHLY,
];
const EVENT_FREQUENCIES: readonly number[] = [
  RRule.DAILY,
  RRule.WEEKLY,
  RRule.MONTHLY,
  RRule.YEARLY,
];

function parseRule(
  rule: string,
  anchor: Date,
  timeZone: string,
  frequencies: readonly number[] = TASK_FREQUENCIES
): RRule {
  const normalized = rule.trim().replace(/^RRULE:/i, "");
  // parseString, unlike fromString, does not invent BYHOUR/BYMINUTE/BYSECOND
  // values from the wall clock when DTSTART is omitted.
  const options = RRule.parseString(normalized);
  if (options.freq === undefined || !frequencies.includes(options.freq)) {
    throw new Error(
      frequencies.includes(RRule.YEARLY)
        ? "Only daily, weekly, monthly, and yearly RRULEs are supported"
        : "Only daily, weekly, and monthly RRULEs are supported"
    );
  }
  return new RRule({
    ...options,
    dtstart: floatingDate(anchor, timeZone),
    until: options.until ? floatingDate(options.until, timeZone) : null,
  });
}

function expandOccurrences(
  rule: string,
  anchor: Date,
  timeZone: string,
  rangeStart: Date,
  rangeEnd: Date,
  frequencies: readonly number[] = TASK_FREQUENCIES
): Date[] {
  const parsed = parseRule(rule, anchor, timeZone, frequencies);
  return parsed
    .between(
      floatingDate(rangeStart, timeZone),
      floatingDate(rangeEnd, timeZone),
      true
    )
    .map((occurrence) => fromZonedTime(floatingString(occurrence), timeZone));
}

type RecurrenceSet = {
  rule: string;
  /** Excluded occurrence instants (ms). */
  exInstants: Set<number>;
  /** Excluded local dates (yyyy-MM-dd in the user's timezone). */
  exDates: Set<string>;
};

/**
 * Splits stored recurrence text into its RRULE and EXDATE parts. Accepts a
 * bare rule ("FREQ=WEEKLY;BYDAY=MO"), an "RRULE:" line, or RFC 5545 lines
 * (RRULE/EXDATE/DTSTART). DTSTART is ignored: the event start is the anchor.
 */
function parseRecurrenceSet(text: string, timeZone: string): RecurrenceSet {
  const lines = text
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const set: RecurrenceSet = {
    rule: "",
    exInstants: new Set(),
    exDates: new Set(),
  };
  for (const line of lines) {
    const colon = line.indexOf(":");
    const head = colon >= 0 ? line.slice(0, colon) : "";
    const name = head.split(";")[0].toUpperCase();
    if (name === "EXDATE") {
      const params = head.split(";").slice(1);
      const tzid = params
        .find((param) => param.toUpperCase().startsWith("TZID="))
        ?.slice(5);
      for (const value of line.slice(colon + 1).split(",")) {
        const match = value
          .trim()
          .match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
        if (!match) continue;
        const [, year, month, day, hour, minute, second, utc] = match;
        const date = `${year}-${month}-${day}`;
        if (hour === undefined) {
          set.exDates.add(date);
        } else if (utc) {
          set.exInstants.add(
            Date.UTC(+year, +month - 1, +day, +hour, +minute, +second)
          );
        } else {
          set.exInstants.add(
            fromZonedTime(
              `${date}T${hour}:${minute}:${second}`,
              tzid || timeZone
            ).getTime()
          );
        }
      }
    } else if (name === "RRULE") {
      set.rule = line.slice(colon + 1);
    } else if (name === "" && /FREQ=/i.test(line)) {
      set.rule = line;
    }
    // DTSTART is anchored on the event start; RDATE is not supported.
  }
  if (!set.rule) throw new Error("Recurrence text has no RRULE");
  return set;
}

function expandTask(task: SchedulerTask, input: SchedulerInput): Unit[] {
  const nowMs = ceilToMinute(input.now.getTime());
  const horizonEnd = new Date(
    zonedInstant(
      addCalendarDays(
        formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd"),
        input.horizonDays ?? 31
      ),
      "00:00",
      input.timeZone
    )
  );
  const base = task.startDate ?? task.dueDate ?? input.now;
  const dueOffset = task.dueDate ? task.dueDate.getTime() - base.getTime() : 0;

  if (!task.recurrenceRule) {
    return [
      {
        task,
        instanceStart: null,
        earliest: Math.max(nowMs, task.startDate?.getTime() ?? nowMs),
        dueDate: task.dueDate ?? null,
      },
    ];
  }

  const occurrences = expandOccurrences(
    task.recurrenceRule,
    base,
    input.timeZone,
    input.now,
    horizonEnd
  );
  return occurrences
    .filter((occurrence) => occurrence.getTime() >= nowMs)
    .map((occurrence) => ({
      task,
      instanceStart: occurrence,
      earliest: Math.max(nowMs, task.startDate ? occurrence.getTime() : nowMs),
      dueDate: task.dueDate ? new Date(occurrence.getTime() + dueOffset) : null,
    }));
}

function compareUnits(a: Unit, b: Unit): number {
  const aAsap = priority(a.task) === "asap";
  const bAsap = priority(b.task) === "asap";
  if (aAsap !== bAsap) return aAsap ? -1 : 1;

  if (a.dueDate && b.dueDate) {
    const deadlineDifference = a.dueDate.getTime() - b.dueDate.getTime();
    if (deadlineDifference !== 0) return deadlineDifference;
  } else if (a.dueDate || b.dueDate) {
    return a.dueDate ? -1 : 1;
  }

  const priorityDifference =
    PRIORITY_RANK[priority(a.task)] - PRIORITY_RANK[priority(b.task)];
  if (priorityDifference !== 0) return priorityDifference;

  const instanceDifference =
    (a.instanceStart?.getTime() ?? 0) - (b.instanceStart?.getTime() ?? 0);
  if (instanceDifference !== 0) return instanceDifference;
  return a.task.id.localeCompare(b.task.id);
}

function lockedBlocks(task: SchedulerTask): SchedulerBlock[] {
  if (task.lockedBlocks?.length) {
    return task.lockedBlocks.map((block) => ({
      ...block,
      start: new Date(block.start),
      end: new Date(block.end),
      locked: true,
      status: "locked",
    }));
  }
  if (task.scheduledStart && task.scheduledEnd) {
    return [
      {
        taskId: task.id,
        start: new Date(task.scheduledStart),
        end: new Date(task.scheduledEnd),
        chunkIndex: 0,
        instanceStart: null,
        locked: true,
        status: "locked",
      },
    ];
  }
  return [];
}

function lockedResult(
  task: SchedulerTask,
  blocks: SchedulerBlock[]
): TaskScheduleResult {
  const sorted = [...blocks].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
  return {
    taskId: task.id,
    instanceStart: sorted[0]?.instanceStart ?? null,
    status: "locked",
    issue: null,
    eta: sorted.length ? sorted[sorted.length - 1].end : null,
    blocks: sorted.map((block, chunkIndex) => ({ ...block, chunkIndex })),
  };
}

function statusFor(
  unit: Unit,
  eta: Date,
  atRiskWindowMinutes: number
): { status: ScheduleStatus; issue: string | null } {
  const deadline = unit.dueDate;
  if (!deadline) return { status: "on_time", issue: null };
  if (unit.task.hardDeadline && eta > deadline) {
    return {
      status: "past_due",
      issue: `Hard deadline ${deadline.toISOString()} is before the projected finish ${eta.toISOString()}`,
    };
  }
  if (!unit.task.hardDeadline && eta > deadline) {
    return {
      status: "at_risk",
      issue: `Projected finish ${eta.toISOString()} is after soft deadline ${deadline.toISOString()}`,
    };
  }
  if (eta.getTime() >= deadline.getTime() - atRiskWindowMinutes * MINUTE) {
    return {
      status: "at_risk",
      issue: `Projected finish ${eta.toISOString()} is within ${
        atRiskWindowMinutes % 60 === 0
          ? `${atRiskWindowMinutes / 60}h`
          : `${atRiskWindowMinutes} minutes`
      } of the deadline ${deadline.toISOString()}`,
    };
  }
  return { status: "on_time", issue: null };
}

function shortenPreviousChunks(
  allocations: DraftAllocation[],
  shortageMinutes: number,
  minChunk: number
): boolean {
  let shortage = shortageMinutes * MINUTE;
  for (
    let index = allocations.length - 1;
    index >= 0 && shortage > 0;
    index -= 1
  ) {
    const allocation = allocations[index];
    const length = allocation.interval.end - allocation.interval.start;
    const available = Math.max(0, length - minChunk * MINUTE);
    const reduction = Math.min(available, shortage);
    allocation.interval.end -= reduction;
    allocation.block.end = new Date(allocation.interval.end);
    shortage -= reduction;
  }
  return shortage === 0;
}

/**
 * Task time already in the run that [start, end] would join: work chained to
 * it, in either direction, by gaps shorter than one break. A gap of at least
 * one break length (a meeting, the end of the day) counts as the break.
 */
function joinedRun(
  start: number,
  end: number,
  work: readonly Interval[],
  breakMs: number
): number {
  let low = start;
  let high = end;
  let total = 0;
  const joined = new Set<number>();
  for (let changed = true; changed; ) {
    changed = false;
    for (let index = 0; index < work.length; index += 1) {
      if (joined.has(index)) continue;
      const interval = work[index];
      if (interval.end > low - breakMs && interval.start < high + breakMs) {
        joined.add(index);
        total += interval.end - interval.start;
        if (interval.start < low) low = interval.start;
        if (interval.end > high) high = interval.end;
        changed = true;
      }
    }
  }
  return total;
}

/**
 * Longest piece starting at `start` (at most `room`) whose run, including
 * work before and after it, stays within `limit`. Run length grows
 * monotonically with the piece, so whole minutes are binary-searched.
 */
function longestWithinBreakLimit(
  start: number,
  room: number,
  work: readonly Interval[],
  breakMs: number,
  limit: number
): number {
  const fits = (length: number) =>
    length + joinedRun(start, start + length, work, breakMs) <= limit;
  if (room <= 0) return 0;
  if (fits(room)) return room;
  let low = 0;
  let high = Math.floor(room / MINUTE);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle * MINUTE)) low = middle;
    else high = middle - 1;
  }
  return low * MINUTE;
}

/**
 * Break rule (D12), as an invariant over the final schedule: wherever a piece
 * goes, no run of task blocks may exceed the limit, counting work already
 * placed before *and* after it (later placements can fill earlier gaps).
 * Locked blocks count but never move. Tries the free interval's start, then
 * the start after a break from the preceding run.
 */
function breakPlacement(
  interval: Interval,
  needed: number,
  remaining: number,
  work: readonly Interval[],
  breakMs: number,
  limit: number
): { start: number; cap: number } | null {
  const starts = [interval.start];
  let previousEnd = -Infinity;
  for (const item of work) {
    if (
      item.end <= interval.start &&
      item.end > interval.start - breakMs &&
      item.end > previousEnd
    ) {
      previousEnd = item.end;
    }
  }
  if (previousEnd > -Infinity) starts.push(previousEnd + breakMs);
  for (const start of starts) {
    if (start >= interval.end) continue;
    const room = Math.min(interval.end - start, remaining, limit);
    const cap = longestWithinBreakLimit(start, room, work, breakMs, limit);
    if (cap >= needed) return { start, cap };
  }
  return null;
}

function planUnit(
  unit: Unit,
  workWindows: readonly Interval[],
  occupied: readonly Interval[],
  horizonEnd: number,
  minChunk: number,
  breakRule: { afterMinutes: number; durationMinutes: number } | null,
  taskWork: readonly Interval[]
): {
  allocations: DraftAllocation[];
  occupied: Interval[];
  work: Interval[];
} | null {
  const duration = unit.task.remainingMinutes ?? unit.task.durationMinutes;
  if (!duration || duration <= 0) return null;

  const breakOn =
    breakRule !== null &&
    breakRule.afterMinutes > 0 &&
    breakRule.durationMinutes > 0;
  const breakAfter = breakOn ? breakRule.afterMinutes * MINUTE : Infinity;
  const breakLength = breakOn ? breakRule.durationMinutes * MINUTE : 0;

  let remaining = duration * MINUTE;
  let searchAfter = unit.earliest;
  const draftOccupied: Interval[] = [];
  const draftWork: Interval[] = [];
  const allocations: DraftAllocation[] = [];
  let guard = 0;

  while (remaining > 0 && guard < 10_000) {
    guard += 1;
    const combined = [...occupied, ...draftOccupied];

    const candidates = freeIntervals(
      workWindows,
      combined,
      searchAfter,
      horizonEnd
    );
    const interval = candidates.find((candidate) => {
      const capacity = candidate.end - candidate.start;
      if (remaining <= capacity) {
        return (
          allocations.length === 0 ||
          remaining >= minChunk * MINUTE ||
          (capacity >= minChunk * MINUTE &&
            shortenPreviousChunks(
              allocations.map((allocation) => ({
                block: {
                  ...allocation.block,
                  start: new Date(allocation.block.start),
                  end: new Date(allocation.block.end),
                },
                interval: { ...allocation.interval },
              })),
              minChunk - remaining / MINUTE,
              minChunk
            ))
        );
      }
      return capacity >= minChunk * MINUTE;
    });

    if (!interval) return null;

    let start = interval.start;
    let breakSlot: Interval | null = null;
    let cap = Infinity;
    if (breakOn) {
      const needed =
        allocations.length > 0 && remaining < minChunk * MINUTE
          ? minChunk * MINUTE
          : Math.min(remaining, minChunk * MINUTE);
      const placement = breakPlacement(
        interval,
        needed,
        // A sub-minimum tail grows to the minimum by shortening earlier chunks.
        Math.max(remaining, needed),
        [...taskWork, ...draftWork],
        breakLength,
        breakAfter
      );
      if (!placement) {
        searchAfter = interval.end;
        continue;
      }
      start = placement.start;
      cap = placement.cap;
      if (start > interval.start)
        breakSlot = { start: interval.start, end: start };
    }
    const capacity = Math.min(interval.end - start, cap);

    if (remaining < minChunk * MINUTE && allocations.length > 0) {
      const shortage = minChunk - remaining / MINUTE;
      if (!shortenPreviousChunks(allocations, shortage, minChunk)) {
        return null;
      }
      // Minutes removed from earlier chunks become part of this final chunk.
      remaining += shortage * MINUTE;
    }
    const length = Math.min(remaining, capacity);
    if (
      remaining < minChunk * MINUTE &&
      allocations.length > 0 &&
      capacity < minChunk * MINUTE
    ) {
      searchAfter = interval.end;
      continue;
    }
    if (remaining > capacity && capacity < minChunk * MINUTE) {
      searchAfter = interval.end;
      continue;
    }

    if (breakSlot) draftOccupied.push(breakSlot);
    const allocated: Interval = {
      start,
      end: start + length,
    };
    const block: SchedulerBlock = {
      taskId: unit.task.id,
      start: new Date(allocated.start),
      end: new Date(allocated.end),
      chunkIndex: allocations.length,
      instanceStart: unit.instanceStart,
      locked: false,
      status: "on_time",
    };
    allocations.push({ block, interval: allocated });
    draftOccupied.push(allocated);
    draftWork.push(allocated);
    remaining -= length;
    searchAfter = allocated.end;
  }

  if (remaining !== 0) return null;
  return { allocations, occupied: draftOccupied, work: draftWork };
}

/**
 * Busy intervals inside [now, horizonEnd). A recurring event blocks every
 * occurrence: the RRULE is expanded as floating wall-clock time in the user's
 * timezone (so a 10:00 meeting stays at 10:00 across DST), each occurrence
 * keeps the event's duration, and EXDATEs (in the rule text or `exdates`)
 * leave their occurrence free.
 */
function expandBusyEvents(input: SchedulerInput, horizonEnd: Date): Interval[] {
  const intervals: Interval[] = [];
  for (const event of input.busyEvents ?? []) {
    if (event.busy === false) continue;
    const add = (start: Date, end: Date) => {
      if (end > input.now && start < horizonEnd && end > start) {
        intervals.push({ start: start.getTime(), end: end.getTime() });
      }
    };
    if (!event.recurrenceRule) {
      add(event.start, event.end);
      continue;
    }
    try {
      const set = parseRecurrenceSet(event.recurrenceRule, input.timeZone);
      for (const exdate of event.exdates ?? []) {
        set.exInstants.add(new Date(exdate).getTime());
      }
      const duration = event.end.getTime() - event.start.getTime();
      for (const occurrence of expandOccurrences(
        set.rule,
        event.start,
        input.timeZone,
        new Date(input.now.getTime() - duration),
        horizonEnd,
        EVENT_FREQUENCIES
      )) {
        if (set.exInstants.has(occurrence.getTime())) continue;
        if (
          set.exDates.size > 0 &&
          set.exDates.has(
            formatInTimeZone(occurrence, input.timeZone, "yyyy-MM-dd")
          )
        ) {
          continue;
        }
        add(occurrence, new Date(occurrence.getTime() + duration));
      }
    } catch {
      // An unsupported recurring event still blocks its explicitly stored row.
      add(event.start, event.end);
    }
  }
  return intervals;
}

/**
 * Schedules tasks in one deterministic pass. Task RRULEs (daily/weekly/
 * monthly) and busy-event RRULEs (also yearly, with EXDATE) are expanded as
 * floating wall-clock occurrences in the user's IANA timezone; RDATE and other
 * frequencies are intentionally not supported.
 */
export function scheduleTasks(input: SchedulerInput): SchedulerOutput {
  const horizonDays = input.horizonDays ?? 31;
  const workWindows = buildWorkWindows(
    input.now,
    input.timeZone,
    horizonDays,
    input.settings.workWeek
  );
  const firstDate = formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd");
  const horizonEndMs = zonedInstant(
    addCalendarDays(firstDate, horizonDays),
    "00:00",
    input.timeZone
  );
  const horizonEnd = new Date(horizonEndMs);
  const nowMs = ceilToMinute(input.now.getTime());
  const minChunkDefault =
    input.settings.defaultMinChunkMinutes ?? DEFAULT_MIN_CHUNK;
  const atRiskWindow =
    input.settings.atRiskWindowMinutes ?? DEFAULT_AT_RISK_WINDOW;

  const results: TaskScheduleResult[] = [];
  const issues: SchedulerIssue[] = [];
  const occupied = expandBusyEvents(input, horizonEnd);
  const unlockedUnits: Unit[] = [];

  for (const task of input.tasks) {
    if (task.autoSchedule === false) {
      results.push({
        taskId: task.id,
        instanceStart: null,
        status: "unscheduled",
        issue: "Auto-scheduling is off",
        eta: null,
        blocks: [],
      });
      continue;
    }

    const locks = task.locked ? lockedBlocks(task) : [];
    const activeLocks = locks.filter((block) => block.end.getTime() > nowMs);
    if (task.locked && activeLocks.length > 0) {
      const result = lockedResult(task, activeLocks);
      results.push(result);
      occupied.push(
        ...activeLocks.map((block) => ({
          start: block.start.getTime(),
          end: block.end.getTime(),
        }))
      );
      continue;
    }

    const duration = task.remainingMinutes ?? task.durationMinutes;
    if (!duration || duration <= 0) {
      const result = {
        taskId: task.id,
        instanceStart: null,
        status: "unscheduled" as const,
        issue: "A positive duration is required",
        eta: null,
        blocks: [],
      };
      results.push(result);
      issues.push({ ...result, message: result.issue });
      continue;
    }

    try {
      unlockedUnits.push(...expandTask(task, input));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = {
        taskId: task.id,
        instanceStart: null,
        status: "unscheduled" as const,
        issue: message,
        eta: null,
        blocks: [],
      };
      results.push(result);
      issues.push({ ...result, message });
    }
  }

  unlockedUnits.sort(compareUnits);
  // All placed task time (locked and planned), for the break rule.
  const taskWork: Interval[] = results.flatMap((result) =>
    result.blocks.map((block) => ({
      start: block.start.getTime(),
      end: block.end.getTime(),
    }))
  );
  for (const unit of unlockedUnits) {
    const minChunk = Math.max(1, unit.task.minChunkMinutes ?? minChunkDefault);
    const plan = planUnit(
      unit,
      workWindows,
      occupied,
      horizonEndMs,
      minChunk,
      input.settings.breakRule ?? null,
      taskWork
    );

    if (!plan) {
      const issue = `The full ${unit.task.remainingMinutes ?? unit.task.durationMinutes} minutes cannot fit in the ${horizonDays}-day window`;
      const result: TaskScheduleResult = {
        taskId: unit.task.id,
        instanceStart: unit.instanceStart,
        status: "cant_fit",
        issue,
        eta: null,
        blocks: [],
      };
      results.push(result);
      issues.push({
        taskId: unit.task.id,
        instanceStart: unit.instanceStart,
        status: "cant_fit",
        message: issue,
      });
      continue;
    }

    const blocks = plan.allocations.map((allocation) => allocation.block);
    const eta = blocks[blocks.length - 1].end;
    const state = statusFor(unit, eta, atRiskWindow);
    for (const block of blocks) block.status = state.status;
    occupied.push(...plan.occupied);
    taskWork.push(...plan.work);
    results.push({
      taskId: unit.task.id,
      instanceStart: unit.instanceStart,
      status: state.status,
      issue: state.issue,
      eta,
      blocks,
    });
    if (state.issue) {
      issues.push({
        taskId: unit.task.id,
        instanceStart: unit.instanceStart,
        status: state.status as SchedulerIssue["status"],
        message: state.issue,
      });
    }
  }

  results.sort(
    (a, b) =>
      a.taskId.localeCompare(b.taskId) ||
      (a.instanceStart?.getTime() ?? 0) - (b.instanceStart?.getTime() ?? 0)
  );
  const blocks = results
    .flatMap((result) => result.blocks)
    .sort(
      (a, b) =>
        a.start.getTime() - b.start.getTime() ||
        a.taskId.localeCompare(b.taskId) ||
        a.chunkIndex - b.chunkIndex
    );
  issues.sort(
    (a, b) =>
      a.taskId.localeCompare(b.taskId) ||
      (a.instanceStart?.getTime() ?? 0) - (b.instanceStart?.getTime() ?? 0)
  );
  return { blocks, tasks: results, issues };
}
