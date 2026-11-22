import { format } from "@/lib/date-utils";
import { formatInZone } from "@/lib/task-dates";

export type AttentionTone = "red" | "amber";

/**
 * D13: red = past due (hard deadline missed) or can't fit; amber = at risk.
 * Any other status gets no badge.
 */
export function scheduleStatusBadge(
  status: string | null | undefined
): { tone: AttentionTone; label: string } | null {
  switch (status) {
    case "past_due":
      return { tone: "red", label: "Past due" };
    case "cant_fit":
      return { tone: "red", label: "Can't fit" };
    case "at_risk":
      return { tone: "amber", label: "At risk" };
    default:
      return null;
  }
}

/** Severity for ordering the Needs attention list (most urgent first). */
export function attentionRank(status: string | null | undefined): number {
  switch (status) {
    case "past_due":
      return 0;
    case "cant_fit":
      return 1;
    case "at_risk":
      return 2;
    default:
      return 3;
  }
}

const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/**
 * The engine reports instants as ISO strings; show them in the user's
 * timezone when given, else local time.
 */
export function formatScheduleIssue(
  issue: string | null | undefined,
  timeZone?: string
): string {
  if (!issue) return "";
  return issue.replace(ISO_INSTANT, (iso) =>
    timeZone
      ? formatInZone(iso, timeZone, "EEE MMM d, p")
      : format(new Date(iso), "EEE MMM d, p")
  );
}
