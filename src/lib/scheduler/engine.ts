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

function parseRule(rule: string, anchor: Date, timeZone: string): RRule {
  const normalized = rule.replace(/^RRULE:/, "");
  // parseString, unlike fromString, does not invent BYHOUR/BYMINUTE/BYSECOND
  // values from the wall clock when DTSTART is omitted.
  const options = RRule.parseString(normalized);
  if (
    options.freq !== RRule.DAILY &&
    options.freq !== RRule.WEEKLY &&
    options.freq !== RRule.MONTHLY
  ) {
    throw new Error("Only daily, weekly, and monthly RRULEs are supported");
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
  rangeEnd: Date
): Date[] {
  const parsed = parseRule(rule, anchor, timeZone);
  return parsed
    .between(
      floatingDate(rangeStart, timeZone),
      floatingDate(rangeEnd, timeZone),
      true
    )
    .map((occurrence) => fromZonedTime(floatingString(occurrence), timeZone));
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
 * Task time worked back-to-back ending at `at`. A gap of at least one break
 * length (a meeting, the end of the day) counts as the break and ends the run.
 */
function contiguousRunBefore(
  at: number,
  work: readonly Interval[],
  breakMs: number
): number {
  let cursor = at;
  let total = 0;
  for (;;) {
    let previous: Interval | null = null;
    for (const interval of work) {
      if (
        interval.end <= cursor &&
        interval.end > cursor - breakMs &&
        interval.start < cursor &&
        (!previous || interval.end > previous.end)
      ) {
        previous = interval;
      }
    }
    if (!previous) return total;
    total += previous.end - previous.start;
    cursor = previous.start;
  }
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

    // Break rule (D12): after `afterMinutes` of back-to-back task time, the
    // next piece of work starts after a break; no piece runs past the limit.
    let start = interval.start;
    let breakSlot: Interval | null = null;
    let cap = Infinity;
    if (breakOn) {
      const run = contiguousRunBefore(
        start,
        [...taskWork, ...draftWork],
        breakLength
      );
      const needed = Math.min(remaining, minChunk * MINUTE);
      if (run > 0 && run + needed > breakAfter) {
        breakSlot = { start, end: start + breakLength };
        start = breakSlot.end;
        cap = breakAfter;
      } else {
        cap = breakAfter - run;
      }
      if (interval.end - start < Math.min(needed, cap)) {
        searchAfter = interval.end;
        continue;
      }
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
      const duration = event.end.getTime() - event.start.getTime();
      for (const occurrence of expandOccurrences(
        event.recurrenceRule,
        event.start,
        input.timeZone,
        new Date(input.now.getTime() - duration),
        horizonEnd
      )) {
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
 * Schedules tasks in one deterministic pass. Daily/weekly/monthly RRULEs are
 * expanded as floating wall-clock occurrences in the user's IANA timezone;
 * EXDATE/RDATE sets and other frequencies are intentionally not supported.
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
