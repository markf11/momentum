/**
 * "Calendars to consider" (AutoScheduleSettings.selectedCalendars): only
 * events from the selected calendars block scheduling time. When nothing is
 * selected, or the selection names only calendars that no longer exist, every
 * calendar counts.
 */
export function parseCalendarSelection(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string" && !!id)
      : [];
  } catch {
    return [];
  }
}

export function filterEventsBySelectedCalendars<T extends { feedId: string }>(
  events: readonly T[],
  selectedCalendars: string | null | undefined,
  existingFeedIds?: Iterable<string>
): T[] {
  let selected = parseCalendarSelection(selectedCalendars);
  if (existingFeedIds) {
    const existing = new Set(existingFeedIds);
    selected = selected.filter((id) => existing.has(id));
  }
  if (!selected.length) return [...events];
  const allowed = new Set(selected);
  return events.filter((event) => allowed.has(event.feedId));
}
