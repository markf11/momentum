// Task due/start dates in the user's timezone.
//
// Due dates are instants. A date-only due date ("2026-12-01") means the END
// of that day (23:59:59.999) in the user's timezone, so a hard deadline on
// Dec 1 is not violated until Dec 1 is over where the user lives. A date-only
// start date means the START of that day in the user's timezone. Conversion
// happens at the API boundary (see resolveTaskDateFields); full ISO instants
// with a "Z" or offset are stored unchanged.
//
// Pure functions only (no prisma), so the client can share them.
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export type TaskDateKind = "due" | "start";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// Wall-clock date + time without an offset, interpreted in the user's zone.
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

const END_OF_DAY = "23:59:59.999";
const START_OF_DAY = "00:00:00.000";

export class InvalidTaskDateError extends Error {
  constructor(field: string, value: unknown) {
    super(`Invalid ${field}: ${String(value)}`);
    this.name = "InvalidTaskDateError";
  }
}

export function isValidTimeZone(timeZone: string | null | undefined): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(timeZone: string | null | undefined): string {
  return isValidTimeZone(timeZone) ? (timeZone as string) : "UTC";
}

/**
 * Turn an API value for a task date into the instant to store.
 * - undefined → undefined (field not being changed)
 * - null / "" → null (cleared)
 * - "YYYY-MM-DD" → end (due) or start (start) of that day in `timeZone`
 * - "YYYY-MM-DDTHH:mm[:ss[.SSS]]" (no offset) → that wall time in `timeZone`
 * - anything else parseable (ISO with Z/offset, epoch ms, Date) → unchanged
 */
export function resolveTaskDateInput(
  value: unknown,
  timeZone: string,
  kind: TaskDateKind,
  field: string = kind === "due" ? "dueDate" : "startDate"
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  let result: Date;
  if (value instanceof Date) {
    result = new Date(value.getTime());
  } else if (typeof value === "number") {
    result = new Date(value);
  } else if (typeof value === "string") {
    const text = value.trim();
    const zone = safeTimeZone(timeZone);
    if (DATE_ONLY.test(text)) {
      const time = kind === "due" ? END_OF_DAY : START_OF_DAY;
      result = fromZonedTime(`${text}T${time}`, zone);
      // Reject impossible calendar dates such as 2026-02-30.
      if (
        !isNaN(result.getTime()) &&
        formatInTimeZone(result, zone, "yyyy-MM-dd") !== text
      ) {
        throw new InvalidTaskDateError(field, value);
      }
    } else if (LOCAL_DATE_TIME.test(text)) {
      result = fromZonedTime(text, zone);
    } else {
      result = new Date(text);
    }
  } else {
    throw new InvalidTaskDateError(field, value);
  }

  if (isNaN(result.getTime())) {
    throw new InvalidTaskDateError(field, value);
  }
  return result;
}

/**
 * Resolve `dueDate` / `startDate` on a task payload in place-safe fashion
 * (returns a new object). Fields that are absent stay absent.
 */
export function resolveTaskDateFields<T extends Record<string, unknown>>(
  data: T,
  timeZone: string
): Omit<T, "dueDate" | "startDate"> & {
  dueDate?: Date | null;
  startDate?: Date | null;
} {
  const out: Record<string, unknown> = { ...data };
  if ("dueDate" in data) {
    out.dueDate = resolveTaskDateInput(data.dueDate, timeZone, "due");
  }
  if ("startDate" in data) {
    out.startDate = resolveTaskDateInput(data.startDate, timeZone, "start");
  }
  return out as Omit<T, "dueDate" | "startDate"> & {
    dueDate?: Date | null;
    startDate?: Date | null;
  };
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** True when the instant is 23:59:59.999 in the zone, i.e. a date-only due. */
export function isEndOfDayInTimeZone(
  value: Date | string | number,
  timeZone: string
): boolean {
  return (
    formatInTimeZone(toDate(value), safeTimeZone(timeZone), "HH:mm:ss.SSS") ===
    END_OF_DAY
  );
}

function isStartOfDayInTimeZone(date: Date, timeZone: string): boolean {
  return formatInTimeZone(date, timeZone, "HH:mm:ss.SSS") === START_OF_DAY;
}

/** "YYYY-MM-DD" of the instant in the zone. */
export function dateKeyInTimeZone(
  value: Date | string | number,
  timeZone: string
): string {
  return formatInTimeZone(toDate(value), safeTimeZone(timeZone), "yyyy-MM-dd");
}

/**
 * Split a stored due date into form values for the user's zone. `time` is ""
 * for a date-only (end-of-day) due date.
 */
export function dueDateFormParts(
  value: Date | string | number,
  timeZone: string
): { date: string; time: string } {
  const zone = safeTimeZone(timeZone);
  const date = toDate(value);
  return {
    date: formatInTimeZone(date, zone, "yyyy-MM-dd"),
    time: isEndOfDayInTimeZone(date, zone)
      ? ""
      : formatInTimeZone(date, zone, "HH:mm"),
  };
}

/**
 * The API payload value for a form due date: date-only ("YYYY-MM-DD") or a
 * wall time in the user's zone ("YYYY-MM-DDTHH:mm"). The API resolves both.
 */
export function dueDateFormValue(date: string, time: string): string | null {
  if (!date) return null;
  return time ? `${date}T${time}` : date;
}

/** A Date whose local Y/M/D equal the zone's calendar day (for day pickers). */
export function zonedDayAsLocalDate(
  value: Date | string | number,
  timeZone: string
): Date {
  const [y, m, d] = dateKeyInTimeZone(value, timeZone).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * Contextual label for a task date in the user's zone ("Today", "Tomorrow",
 * "Friday", "Dec 1", "Dec 1, 2027"), with the time appended when the date
 * carries one. Due dates past `now` are overdue.
 */
export function formatTaskDate(
  value: Date | string | number,
  timeZone: string,
  options: { kind?: TaskDateKind; now?: Date } = {}
): { text: string; isOverdue: boolean; isFuture: boolean } {
  const kind = options.kind ?? "due";
  const now = options.now ?? new Date();
  const zone = safeTimeZone(timeZone);
  const date = toDate(value);

  const diff =
    dayNumber(dateKeyInTimeZone(date, zone)) -
    dayNumber(dateKeyInTimeZone(now, zone));
  const sameYear =
    formatInTimeZone(date, zone, "yyyy") ===
    formatInTimeZone(now, zone, "yyyy");

  let text: string;
  if (diff === 0) text = "Today";
  else if (diff === 1) text = "Tomorrow";
  else if (diff > 1 && diff < 7) text = formatInTimeZone(date, zone, "EEEE");
  else if (sameYear) text = formatInTimeZone(date, zone, "MMM d");
  else text = formatInTimeZone(date, zone, "MMM d, yyyy");

  const dateOnly =
    kind === "due"
      ? isEndOfDayInTimeZone(date, zone)
      : isStartOfDayInTimeZone(date, zone);
  if (!dateOnly) {
    text = `${text}, ${formatInTimeZone(date, zone, "h:mm a")}`;
  }

  const isOverdue = kind === "due" && date.getTime() < now.getTime();
  if (isOverdue) text = `Overdue: ${text}`;

  return { text, isOverdue, isFuture: diff > 0 };
}

/** date-fns `format` pattern rendered in the zone (invalid zone → UTC). */
export function formatInZone(
  value: Date | string | number,
  timeZone: string,
  pattern: string
): string {
  return formatInTimeZone(toDate(value), safeTimeZone(timeZone), pattern);
}

/** Long due-date label in the user's zone: "December 1st, 2026[, 5:00 PM]". */
export function formatDueDateLong(
  value: Date | string | number,
  timeZone: string
): string {
  const zone = safeTimeZone(timeZone);
  const date = toDate(value);
  return formatInTimeZone(
    date,
    zone,
    isEndOfDayInTimeZone(date, zone) ? "PPP" : "PPP, p"
  );
}
