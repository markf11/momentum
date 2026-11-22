export type SchedulerPriority = "asap" | "high" | "medium" | "low" | "none";

export type ScheduleStatus =
  | "on_time"
  | "at_risk"
  | "past_due"
  | "cant_fit"
  | "locked"
  | "unscheduled";

export interface WorkDay {
  /** Local wall-clock time in HH:mm, in 15-minute steps. */
  start: string;
  end: string;
}

/** Sunday is index 0, matching JavaScript and FullCalendar. */
export type WorkWeek = readonly (WorkDay | null)[];

export interface SchedulerTask {
  id: string;
  title?: string;
  durationMinutes: number | null;
  /** Remaining work; defaults to durationMinutes. */
  remainingMinutes?: number | null;
  priority?: SchedulerPriority | null;
  dueDate?: Date | null;
  /** A hard due date produces past_due instead of a silently late task. */
  hardDeadline?: boolean;
  startDate?: Date | null;
  minChunkMinutes?: number | null;
  autoSchedule?: boolean;
  locked?: boolean;
  /** Legacy single-block lock, used when lockedBlocks is not supplied. */
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  recurrenceRule?: string | null;
  /** Existing immutable blocks for a locked task. */
  lockedBlocks?: readonly SchedulerBlock[];
}

export interface BusyEvent {
  id?: string;
  start: Date;
  end: Date;
  /** Free events do not consume scheduling capacity. */
  busy?: boolean;
  /**
   * RRULE, bare ("FREQ=WEEKLY;BYDAY=MO") or as RFC 5545 lines that may
   * include EXDATE. Occurrences are expanded from `start` in the user's
   * timezone and last `end - start`.
   */
  recurrenceRule?: string | null;
  /** Occurrence starts (absolute instants) excluded from the series. */
  exdates?: readonly Date[];
}

export interface BreakRule {
  /**
   * No contiguous run of task blocks (gaps shorter than the break count as
   * contiguous) holds more than this much task time.
   */
  afterMinutes: number;
  durationMinutes: number;
}

export interface SchedulerSettings {
  workWeek: WorkWeek;
  defaultMinChunkMinutes?: number;
  breakRule?: BreakRule | null;
  /** A task finishing this close to its due date is at risk. Defaults to 24h. */
  atRiskWindowMinutes?: number;
}

export interface SchedulerInput {
  tasks: readonly SchedulerTask[];
  busyEvents?: readonly BusyEvent[];
  settings: SchedulerSettings;
  now: Date;
  timeZone: string;
  horizonDays?: number;
}

export interface SchedulerBlock {
  taskId: string;
  start: Date;
  end: Date;
  chunkIndex: number;
  /** Nominal recurrence occurrence start, stored as an absolute instant. */
  instanceStart?: Date | null;
  locked: boolean;
  status: ScheduleStatus;
}

export interface TaskScheduleResult {
  taskId: string;
  instanceStart?: Date | null;
  status: ScheduleStatus;
  issue: string | null;
  eta: Date | null;
  blocks: SchedulerBlock[];
}

export interface SchedulerIssue {
  taskId: string;
  instanceStart?: Date | null;
  status: Exclude<ScheduleStatus, "on_time" | "locked">;
  message: string;
}

export interface SchedulerOutput {
  blocks: SchedulerBlock[];
  tasks: TaskScheduleResult[];
  issues: SchedulerIssue[];
}
