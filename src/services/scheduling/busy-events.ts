import type { CalendarEvent } from "@prisma/client";

import type { BusyEvent } from "@/lib/scheduler";

export type BusyEventRow = Pick<
  CalendarEvent,
  | "id"
  | "start"
  | "end"
  | "isRecurring"
  | "recurrenceRule"
  | "isMaster"
  | "masterEventId"
  | "status"
>;

function isCancelled(row: BusyEventRow): boolean {
  return row.status?.toLowerCase() === "cancelled";
}

function isSeries(row: BusyEventRow): boolean {
  return Boolean(row.recurrenceRule) && (row.isRecurring || row.isMaster);
}

/**
 * Maps stored calendar rows to engine busy events.
 *
 * - A recurring series row (local events are stored as one row with
 *   `isRecurring` + `recurrenceRule`, not as a master) passes its rule to the
 *   engine, which blocks every occurrence in the window. EXDATE lines in the
 *   stored rule are honoured by the engine.
 * - If a provider sync stored the series' instances (rows whose
 *   `masterEventId` points at it), those rows are the authoritative expansion
 *   — moved, cancelled and edited occurrences included — so the master is
 *   not expanded again.
 * - Cancelled rows never block.
 */
export function toBusyEvents(rows: readonly BusyEventRow[]): BusyEvent[] {
  const expandedMasters = new Set(
    rows.flatMap((row) => (row.masterEventId ? [row.masterEventId] : []))
  );
  const events: BusyEvent[] = [];
  for (const row of rows) {
    if (isCancelled(row)) continue;
    const series = isSeries(row) && !row.masterEventId;
    if (series && expandedMasters.has(row.id)) continue;
    events.push({
      id: row.id,
      start: row.start,
      end: row.end,
      recurrenceRule: series ? row.recurrenceRule : null,
    });
  }
  return events;
}
