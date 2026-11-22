import { remainingOf, shortenRemaining } from "@/lib/remaining-time";

import { Task, UpdateTask } from "@/types/task";

/** D13 one-click fixes offered for a flagged task. */
export type ScheduleFixKind =
  | "push_deadline"
  | "make_soft"
  | "shorten_to_fit"
  | "shorten"
  | "auto_schedule_off";

export interface ScheduleFix {
  kind: ScheduleFixKind;
  label: string;
  /** `shorten` asks for minutes first. */
  needsMinutes?: boolean;
}

type FixTask = Pick<
  Task,
  | "scheduleStatus"
  | "dueDate"
  | "hardDeadline"
  | "duration"
  | "remainingMinutes"
  | "minChunkMinutes"
  | "scheduleFitMinutes"
  | "isAutoScheduled"
>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The fits-before-deadline minutes, when shortening to them is a real fix. */
export function fitMinutes(task: FixTask, defaultMinChunk = 30): number | null {
  const fit = task.scheduleFitMinutes;
  if (fit === null || fit === undefined) return null;
  const minChunk = task.minChunkMinutes ?? defaultMinChunk;
  return fit >= minChunk && fit < remainingOf(task) ? fit : null;
}

export function scheduleFixes(
  task: FixTask,
  defaultMinChunk = 30
): ScheduleFix[] {
  switch (task.scheduleStatus) {
    case "past_due":
    case "at_risk": {
      const fixes: ScheduleFix[] = [];
      if (task.dueDate) {
        fixes.push({ kind: "push_deadline", label: "Push deadline +1 day" });
      }
      if (task.hardDeadline) {
        fixes.push({ kind: "make_soft", label: "Make deadline soft" });
      }
      if (fitMinutes(task, defaultMinChunk) !== null) {
        fixes.push({ kind: "shorten_to_fit", label: "Shorten to fit" });
      }
      return fixes;
    }
    case "cant_fit":
      return [
        { kind: "shorten", label: "Shorten…", needsMinutes: true },
        { kind: "auto_schedule_off", label: "Turn off auto-schedule" },
      ];
    default:
      return [];
  }
}

/** The task update a fix sends; null when it does not apply. */
export function fixUpdates(
  task: FixTask,
  kind: ScheduleFixKind,
  minutes?: number,
  defaultMinChunk = 30
): UpdateTask | null {
  switch (kind) {
    case "push_deadline":
      return task.dueDate
        ? { dueDate: new Date(new Date(task.dueDate).getTime() + DAY_MS) }
        : null;
    case "make_soft":
      return task.hardDeadline ? { hardDeadline: false } : null;
    case "shorten_to_fit": {
      const fit = fitMinutes(task, defaultMinChunk);
      return fit === null ? null : shortenRemaining(task, fit);
    }
    case "shorten":
      return minutes && minutes > 0 && minutes < remainingOf(task)
        ? shortenRemaining(task, minutes)
        : null;
    case "auto_schedule_off":
      return { isAutoScheduled: false };
  }
}
