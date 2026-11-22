/**
 * D16e partial completion. A task's `remainingMinutes` is the work still to
 * do; `null` means nothing has been logged yet (remaining = duration).
 * Worked time is never stored: it is always `duration - remaining`.
 */
export interface RemainingFields {
  duration?: number | null;
  remainingMinutes?: number | null;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** Work still to do, clamped to [0, duration]. */
export function remainingOf(task: RemainingFields): number {
  const duration = nonNegative(task.duration ?? 0);
  if (task.remainingMinutes === null || task.remainingMinutes === undefined) {
    return duration;
  }
  return Math.min(duration, nonNegative(task.remainingMinutes));
}

/** Minutes already worked (logged time and completed chunks). */
export function workedOf(task: RemainingFields): number {
  return nonNegative((task.duration ?? 0) - remainingOf(task));
}

/** Editing the duration keeps the worked time: max(0, new − worked). */
export function remainingAfterDurationChange(
  task: RemainingFields,
  newDuration: number
): number {
  return nonNegative(nonNegative(newDuration) - workedOf(task));
}

/** Subtract logged minutes; `completed` once nothing is left. */
export function logMinutes(
  task: RemainingFields,
  minutes: number
): { remainingMinutes: number; completed: boolean } {
  const remainingMinutes = nonNegative(
    remainingOf(task) - nonNegative(minutes)
  );
  return { remainingMinutes, completed: remainingMinutes === 0 };
}

/**
 * Shorten the remaining work to `newRemaining` without counting the cut as
 * work done: the duration shrinks by the same amount, so worked is unchanged.
 */
export function shortenRemaining(
  task: RemainingFields,
  newRemaining: number
): { duration: number; remainingMinutes: number } {
  const target = Math.min(remainingOf(task), nonNegative(newRemaining));
  return {
    duration: workedOf(task) + target,
    remainingMinutes: target,
  };
}

/**
 * Resolve `remainingMinutes` for a task update. Full-object saves echo the
 * stored remaining back, so only a value that differs counts as explicit;
 * otherwise a duration change keeps the worked time.
 */
export function resolveRemainingUpdate(
  stored: RemainingFields,
  updates: RemainingFields
): number | undefined {
  const durationChanged =
    updates.duration !== undefined &&
    updates.duration !== null &&
    updates.duration !== stored.duration;
  const remainingExplicit =
    updates.remainingMinutes !== undefined &&
    updates.remainingMinutes !== stored.remainingMinutes;
  const newDuration = durationChanged
    ? (updates.duration as number)
    : (stored.duration ?? 0);

  if (remainingExplicit) {
    if (updates.remainingMinutes === null) return newDuration;
    return Math.min(
      nonNegative(newDuration),
      nonNegative(updates.remainingMinutes as number)
    );
  }
  if (durationChanged) {
    return remainingAfterDurationChange(stored, newDuration);
  }
  return undefined;
}

/** "1h 30m", "45m", "4h". */
export function formatMinutes(minutes: number): string {
  const total = nonNegative(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "1h 30m left of 4h", or null when no work has been logged. */
export function formatRemaining(task: RemainingFields): string | null {
  const duration = task.duration ?? 0;
  if (duration <= 0 || workedOf(task) === 0) return null;
  return `${formatMinutes(remainingOf(task))} left of ${formatMinutes(duration)}`;
}
