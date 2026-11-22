import { formatInTimeZone } from "date-fns-tz";

/**
 * Background re-plans (D15): a periodic tick for expired locks (D7) and
 * time-driven status changes, plus a nightly full re-plan around 03:00 in
 * each user's time zone. Runs in-process; no Redis or worker.
 *
 * This module holds the pure tick logic. Database access is injected through
 * `BackgroundStore` (see background-replan-store.ts) and the clock through
 * `now`, so the logic is unit-testable without Postgres or real timers.
 */

export const DEFAULT_TICK_MS = 15 * 60 * 1000;
export const DEFAULT_NIGHTLY_HOUR = 3;

export interface LockedTaskSnapshot {
  taskId: string;
  userId: string;
  /** Legacy single-block lock, used when the task has no locked blocks. */
  scheduledEnd: Date | null;
  lockedBlockEnds: Date[];
}

export interface BackgroundUser {
  userId: string;
  timeZone: string | null;
}

export interface BackgroundStore {
  /** Incomplete tasks with scheduleLocked = true, with their locked blocks. */
  findLockedTasks(): Promise<LockedTaskSnapshot[]>;
  /** Unlock the tasks and drop their (expired) locked blocks. */
  unlockTasks(taskIds: string[]): Promise<void>;
  /**
   * Users whose plan or status may have changed with the passage of time:
   * an unlocked block of an incomplete task has fully elapsed (work slipped),
   * or an auto-scheduled task's due date passed while it was still on time.
   */
  findUsersNeedingReplan(now: Date): Promise<string[]>;
  listUsers(): Promise<BackgroundUser[]>;
}

export type ReplanReason = "expired_lock" | "time_passed" | "nightly";

export interface BackgroundLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface BackgroundReplannerOptions {
  store: BackgroundStore;
  replan: (userId: string, reason: ReplanReason) => Promise<unknown>;
  now?: () => Date;
  logger?: BackgroundLogger;
  /** Local hour (0-23) of the nightly full re-plan. */
  nightlyHour?: number;
  /** Tick period; the nightly window is at least two ticks wide. */
  tickMs?: number;
}

export interface TickResult {
  skipped: boolean;
  unlockedTaskIds: string[];
  replanned: { userId: string; reasons: ReplanReason[] }[];
  failed: { userId: string; error: string }[];
}

/** A locked task whose locked time has entirely passed (D7). */
export function isLockExpired(task: LockedTaskSnapshot, now: Date): boolean {
  const ends = task.lockedBlockEnds.length
    ? task.lockedBlockEnds
    : task.scheduledEnd
      ? [task.scheduledEnd]
      : [];
  // A lock with no time at all is left to the regular planner.
  if (!ends.length) return false;
  return ends.every((end) => end.getTime() <= now.getTime());
}

function localParts(now: Date, timeZone: string) {
  let zone = timeZone;
  try {
    formatInTimeZone(now, zone, "yyyy");
  } catch {
    zone = "UTC";
  }
  const date = formatInTimeZone(now, zone, "yyyy-MM-dd");
  const [hours, minutes] = formatInTimeZone(now, zone, "HH:mm")
    .split(":")
    .map(Number);
  return { date, minutes: hours * 60 + minutes };
}

export class BackgroundReplanner {
  private readonly store: BackgroundStore;
  private readonly replan: BackgroundReplannerOptions["replan"];
  private readonly now: () => Date;
  private readonly logger?: BackgroundLogger;
  private readonly nightlyStartMinutes: number;
  private readonly nightlyWindowMinutes: number;
  /** userId -> local date (yyyy-MM-dd) of the last nightly re-plan. */
  readonly lastNightly = new Map<string, string>();
  private running = false;

  constructor(options: BackgroundReplannerOptions) {
    this.store = options.store;
    this.replan = options.replan;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger;
    const hour = options.nightlyHour ?? DEFAULT_NIGHTLY_HOUR;
    this.nightlyStartMinutes = hour * 60;
    const tickMinutes = Math.ceil((options.tickMs ?? DEFAULT_TICK_MS) / 60_000);
    this.nightlyWindowMinutes = Math.max(60, tickMinutes * 2);
  }

  /** True when the user's local clock is in the nightly window and today's run is pending. */
  nightlyDue(user: BackgroundUser, now: Date): string | null {
    const { date, minutes } = localParts(now, user.timeZone || "UTC");
    const sinceStart = minutes - this.nightlyStartMinutes;
    if (sinceStart < 0 || sinceStart >= this.nightlyWindowMinutes) return null;
    if (this.lastNightly.get(user.userId) === date) return null;
    return date;
  }

  async tick(): Promise<TickResult> {
    const result: TickResult = {
      skipped: false,
      unlockedTaskIds: [],
      replanned: [],
      failed: [],
    };
    // A slow tick must not overlap the next one.
    if (this.running) return { ...result, skipped: true };
    this.running = true;
    try {
      const now = this.now();
      const reasons = new Map<string, Set<ReplanReason>>();
      const add = (userId: string, reason: ReplanReason) => {
        const set = reasons.get(userId) ?? new Set<ReplanReason>();
        set.add(reason);
        reasons.set(userId, set);
      };

      // 1. Expired locks go back to the queue before anything re-plans.
      const expired = (await this.store.findLockedTasks()).filter((task) =>
        isLockExpired(task, now)
      );
      if (expired.length) {
        await this.store.unlockTasks(expired.map((task) => task.taskId));
        result.unlockedTaskIds = expired.map((task) => task.taskId);
        expired.forEach((task) => add(task.userId, "expired_lock"));
        this.logger?.info("Unlocked expired locks", {
          taskIds: result.unlockedTaskIds,
        });
      }

      // 2. Plans that time has overtaken (status may now be at risk).
      for (const userId of await this.store.findUsersNeedingReplan(now)) {
        add(userId, "time_passed");
      }

      // 3. Nightly full re-plan, once per local day.
      const nightly = new Map<string, string>();
      for (const user of await this.store.listUsers()) {
        const date = this.nightlyDue(user, now);
        if (date) {
          nightly.set(user.userId, date);
          add(user.userId, "nightly");
        }
      }

      for (const [userId, set] of reasons) {
        const userReasons = [...set];
        try {
          await this.replan(userId, userReasons[0]);
          result.replanned.push({ userId, reasons: userReasons });
          const date = nightly.get(userId);
          if (date) this.lastNightly.set(userId, date);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          result.failed.push({ userId, error: message });
          this.logger?.error("Background re-plan failed", {
            userId,
            error: message,
          });
        }
      }
      if (result.replanned.length) {
        this.logger?.info("Background re-plan tick", {
          replanned: result.replanned,
        });
      }
      return result;
    } finally {
      this.running = false;
    }
  }
}

type Env = Record<string, string | undefined>;

/** Never during `next build`, jest, or when explicitly disabled. */
export function backgroundReplansEnabled(env: Env = process.env): boolean {
  if (env.MOMENTUM_DISABLE_BACKGROUND === "1") return false;
  if (env.NEXT_PHASE === "phase-production-build") return false;
  if (env.JEST_WORKER_ID !== undefined || env.NODE_ENV === "test") return false;
  return true;
}

function positiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function tickIntervalMs(env: Env = process.env): number {
  return positiveInt(env.MOMENTUM_TICK_MS) ?? DEFAULT_TICK_MS;
}

export function nightlyHour(env: Env = process.env): number {
  const raw = env.MOMENTUM_NIGHTLY_HOUR;
  if (raw === undefined || raw === "") return DEFAULT_NIGHTLY_HOUR;
  const parsed = Number.parseInt(raw, 10);
  return parsed >= 0 && parsed <= 23 ? parsed : DEFAULT_NIGHTLY_HOUR;
}

interface BackgroundHandle {
  replanner: BackgroundReplanner;
  timer: ReturnType<typeof setInterval>;
  intervalMs: number;
}

const globalBackground = globalThis as typeof globalThis & {
  momentumBackgroundReplans?: BackgroundHandle;
};

/**
 * Start the tick loop once per process. The handle lives on globalThis so dev
 * HMR re-evaluating this module does not start a second loop.
 */
export function startBackgroundReplans(
  options: Omit<BackgroundReplannerOptions, "tickMs"> & { intervalMs: number }
): { started: boolean; handle: BackgroundHandle } {
  const existing = globalBackground.momentumBackgroundReplans;
  if (existing) return { started: false, handle: existing };

  const replanner = new BackgroundReplanner({
    ...options,
    tickMs: options.intervalMs,
  });
  const run = () => {
    void replanner.tick().catch((error) => {
      options.logger?.error("Background tick crashed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
  const timer = setInterval(run, options.intervalMs);
  // First tick soon after boot, so locks that expired while the app was down
  // are released without waiting a full interval.
  const firstTick = setTimeout(run, Math.min(options.intervalMs, 30_000));
  // Do not keep the process alive just for the tick.
  timer.unref?.();
  firstTick.unref?.();
  const handle = { replanner, timer, intervalMs: options.intervalMs };
  globalBackground.momentumBackgroundReplans = handle;
  return { started: true, handle };
}

/** Test/shutdown helper. */
export function stopBackgroundReplans(): void {
  const existing = globalBackground.momentumBackgroundReplans;
  if (!existing) return;
  clearInterval(existing.timer);
  delete globalBackground.momentumBackgroundReplans;
}
