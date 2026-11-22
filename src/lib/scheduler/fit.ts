/**
 * Derived from engine output, outside the engine core: how many minutes of a
 * task's planned blocks land before its due date. The engine places a task's
 * work greedily in deadline order, so shortening the task to this amount
 * keeps exactly the work that already fits before the deadline.
 */
export function minutesBeforeDeadline(
  blocks: readonly { start: Date; end: Date }[],
  deadline: Date | null | undefined
): number | null {
  if (!deadline) return null;
  const limit = deadline.getTime();
  let total = 0;
  for (const block of blocks) {
    const start = block.start.getTime();
    const end = Math.min(block.end.getTime(), limit);
    if (end > start) total += end - start;
  }
  return Math.floor(total / 60_000);
}
