import { scheduleAllTasksForUser } from "@/services/scheduling/TaskSchedulingService";

type Waiter = { resolve: () => void; reject: (error: unknown) => void };
type Entry = {
  timer: ReturnType<typeof setTimeout> | null;
  runPromise: Promise<void> | null;
  dirty: boolean;
  waiters: Waiter[];
};

export type ReplanRunner = (userId: string) => Promise<unknown>;

/** Per-user debounce and dirty-flag coordination, with no external queue. */
export class ReplanCoordinator {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly runner: ReplanRunner,
    private readonly debounceMs = 2_000
  ) {}

  private entry(userId: string): Entry {
    let entry = this.entries.get(userId);
    if (!entry) {
      entry = { timer: null, runPromise: null, dirty: false, waiters: [] };
      this.entries.set(userId, entry);
    }
    return entry;
  }

  request(userId: string): void {
    const entry = this.entry(userId);
    entry.dirty = true;
    if (entry.runPromise) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.run(userId).catch(() => undefined);
    }, this.debounceMs);
  }

  async wait(userId: string): Promise<void> {
    const entry = this.entry(userId);
    const completion = new Promise<void>((resolve, reject) => {
      entry.waiters.push({ resolve, reject });
    });
    this.request(userId);
    return completion;
  }

  async now(userId: string): Promise<void> {
    const entry = this.entry(userId);
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.dirty = true;
    return this.run(userId);
  }

  private async run(userId: string): Promise<void> {
    const entry = this.entry(userId);
    if (entry.runPromise) return entry.runPromise;

    entry.runPromise = (async () => {
      try {
        do {
          entry.dirty = false;
          await this.runner(userId);
        } while (entry.dirty);
        const waiters = entry.waiters.splice(0);
        waiters.forEach((waiter) => waiter.resolve());
      } catch (error) {
        // Do not force a retry: a persistent failure would otherwise loop
        // every debounce interval. A change arriving mid-run still re-runs.
        const waiters = entry.waiters.splice(0);
        waiters.forEach((waiter) => waiter.reject(error));
        throw error;
      } finally {
        entry.runPromise = null;
        if (entry.dirty && !entry.timer) this.request(userId);
      }
    })();
    return entry.runPromise;
  }
}

const globalReplan = globalThis as typeof globalThis & {
  momentumReplanCoordinator?: ReplanCoordinator;
};

export const replanCoordinator =
  globalReplan.momentumReplanCoordinator ??
  new ReplanCoordinator(scheduleAllTasksForUser);
globalReplan.momentumReplanCoordinator = replanCoordinator;

export function requestReplan(userId: string): void {
  replanCoordinator.request(userId);
}

export function replanAndWait(userId: string): Promise<void> {
  return replanCoordinator.wait(userId);
}

export function replanNow(userId: string): Promise<void> {
  return replanCoordinator.now(userId);
}
