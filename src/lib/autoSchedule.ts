import { AutoScheduleSettings, TimeFormat } from "@/types/settings";

export function parseWorkDays(workDays: string): number[] {
  try {
    return JSON.parse(workDays);
  } catch {
    return [];
  }
}

export function parseSelectedCalendars(calendars: string): string[] {
  try {
    return JSON.parse(calendars);
  } catch {
    return [];
  }
}

export function stringifyWorkDays(workDays: number[]): string {
  return JSON.stringify(workDays);
}

export type WorkDayHours = { start: string; end: string } | null;

const DEFAULT_WORK_WEEK: WorkDayHours[] = [
  null,
  { start: "09:00", end: "17:00" },
  { start: "09:00", end: "17:00" },
  { start: "09:00", end: "17:00" },
  { start: "09:00", end: "17:00" },
  { start: "09:00", end: "17:00" },
  null,
];

/** Momentum work week: 7 entries, Sunday first, null = day off. */
export function parseWorkHours(workHours: string | undefined): WorkDayHours[] {
  try {
    const parsed = JSON.parse(workHours ?? "");
    if (Array.isArray(parsed) && parsed.length === 7) return parsed;
  } catch {
    // fall through to the default week
  }
  return DEFAULT_WORK_WEEK.map((day) => (day ? { ...day } : null));
}

/** "HH:mm" values from 00:00 to 24:00 in 15-minute steps. */
export const QUARTER_HOUR_TIMES: string[] = Array.from(
  { length: 97 },
  (_, i) =>
    `${Math.floor(i / 4)
      .toString()
      .padStart(2, "0")}:${((i % 4) * 15).toString().padStart(2, "0")}`
);

/** Label an "HH:mm" value honoring the 12h/24h preference. */
export function formatClockTime(
  value: string,
  timeFormat: TimeFormat = "24h"
): string {
  if (timeFormat === "24h") return value;
  const [hour, minute] = value.split(":").map(Number);
  const h = hour % 24;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${minute.toString().padStart(2, "0")} ${period}${hour === 24 ? " (+1)" : ""}`;
}

export function stringifySelectedCalendars(calendars: string[]): string {
  return JSON.stringify(calendars);
}

/**
 * Format a whole-hour value (0-23) for the Auto-Schedule time dropdowns,
 * honoring the user's 12h/24h preference from General settings (issue #129).
 * Defaults to 24-hour so callers without a preference keep the prior output.
 */
export function formatTime(
  hour: number,
  timeFormat: TimeFormat = "24h"
): string {
  if (timeFormat === "12h") {
    const period = hour >= 12 ? "PM" : "AM";
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${h12}:00 ${period}`;
  }

  return `${hour.toString().padStart(2, "0")}:00`;
}

export function getEnergyLevelForTime(
  hour: number,
  settings: AutoScheduleSettings
): "high" | "medium" | "low" | null {
  if (
    settings.highEnergyStart !== null &&
    settings.highEnergyEnd !== null &&
    hour >= settings.highEnergyStart &&
    hour < settings.highEnergyEnd
  ) {
    return "high";
  }

  if (
    settings.mediumEnergyStart !== null &&
    settings.mediumEnergyEnd !== null &&
    hour >= settings.mediumEnergyStart &&
    hour < settings.mediumEnergyEnd
  ) {
    return "medium";
  }

  if (
    settings.lowEnergyStart !== null &&
    settings.lowEnergyEnd !== null &&
    hour >= settings.lowEnergyStart &&
    hour < settings.lowEnergyEnd
  ) {
    return "low";
  }

  return null;
}

export function isWorkingHour(
  date: Date,
  settings: AutoScheduleSettings
): boolean {
  const hour = date.getHours();
  const day = date.getDay();
  const workDays = parseWorkDays(settings.workDays);

  return (
    workDays.includes(day) &&
    hour >= settings.workHourStart &&
    hour < settings.workHourEnd
  );
}
