import {
  BackgroundReplanner,
  BackgroundStore,
  BackgroundUser,
  LockedTaskSnapshot,
  backgroundReplansEnabled,
  isLockExpired,
  nightlyHour,
  startBackgroundReplans,
  stopBackgroundReplans,
  tickIntervalMs,
} from "../background-replan";

class FakeStore implements BackgroundStore {
  locked: LockedTaskSnapshot[] = [];
  stale: string[] = [];
  users: BackgroundUser[] = [];
  unlocked: string[][] = [];
  findUsersNeedingReplan = jest.fn(async (now: Date) => {
    void now;
    return this.stale;
  });

  async findLockedTasks() {
    return this.locked;
  }

  async unlockTasks(taskIds: string[]) {
    this.unlocked.push(taskIds);
    this.locked = this.locked.filter((task) => !taskIds.includes(task.taskId));
  }

  async listUsers() {
    return this.users;
  }
}

function setup(start: string, options: { tickMs?: number } = {}) {
  let now = new Date(start);
  const store = new FakeStore();
  const replan = jest.fn().mockResolvedValue(undefined);
  const replanner = new BackgroundReplanner({
    store,
    replan,
    now: () => now,
    tickMs: options.tickMs ?? 15 * 60 * 1000,
  });
  return {
    store,
    replan,
    replanner,
    setNow: (iso: string) => {
      now = new Date(iso);
    },
  };
}

const lock = (
  taskId: string,
  userId: string,
  ends: string[],
  scheduledEnd: string | null = null
): LockedTaskSnapshot => ({
  taskId,
  userId,
  scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
  lockedBlockEnds: ends.map((end) => new Date(end)),
});

describe("isLockExpired", () => {
  const now = new Date("2026-11-22T15:00:00Z");

  it("expires only when every locked block has ended", () => {
    expect(isLockExpired(lock("t", "u", ["2026-11-22T14:00:00Z"]), now)).toBe(
      true
    );
    expect(isLockExpired(lock("t", "u", ["2026-11-22T15:00:00Z"]), now)).toBe(
      true
    );
    expect(
      isLockExpired(
        lock("t", "u", ["2026-11-22T14:00:00Z", "2026-11-22T16:00:00Z"]),
        now
      )
    ).toBe(false);
  });

  it("falls back to the legacy scheduledEnd and ignores timeless locks", () => {
    expect(isLockExpired(lock("t", "u", [], "2026-11-22T14:59:00Z"), now)).toBe(
      true
    );
    expect(isLockExpired(lock("t", "u", [], "2026-11-22T15:01:00Z"), now)).toBe(
      false
    );
    expect(isLockExpired(lock("t", "u", []), now)).toBe(false);
  });
});

describe("BackgroundReplanner.tick", () => {
  it("unlocks expired locks and re-plans their owners", async () => {
    const { store, replan, replanner } = setup("2026-11-22T15:00:00Z");
    store.locked = [
      lock("expired", "u1", ["2026-11-22T14:30:00Z"]),
      lock("future", "u2", ["2026-11-22T16:00:00Z"]),
    ];

    const result = await replanner.tick();

    expect(store.unlocked).toEqual([["expired"]]);
    expect(result.unlockedTaskIds).toEqual(["expired"]);
    expect(replan).toHaveBeenCalledTimes(1);
    expect(replan).toHaveBeenCalledWith("u1", "expired_lock");
    expect(result.replanned).toEqual([
      { userId: "u1", reasons: ["expired_lock"] },
    ]);
  });

  it("does nothing while the locked block is still running", async () => {
    const { store, replan, replanner, setNow } = setup("2026-11-22T14:00:00Z");
    store.locked = [lock("t1", "u1", ["2026-11-22T14:30:00Z"])];

    await replanner.tick();
    expect(store.unlocked).toEqual([]);
    expect(replan).not.toHaveBeenCalled();

    setNow("2026-11-22T14:45:00Z");
    await replanner.tick();
    expect(store.unlocked).toEqual([["t1"]]);
    expect(replan).toHaveBeenCalledWith("u1", "expired_lock");
  });

  it("re-plans users whose plan time has overtaken, once per user", async () => {
    const { store, replan, replanner } = setup("2026-11-22T15:00:00Z");
    store.locked = [lock("t1", "u1", ["2026-11-22T14:00:00Z"])];
    store.stale = ["u1", "u2"];

    const result = await replanner.tick();

    expect(store.findUsersNeedingReplan).toHaveBeenCalledWith(
      new Date("2026-11-22T15:00:00Z")
    );
    expect(replan).toHaveBeenCalledTimes(2);
    expect(result.replanned).toEqual([
      { userId: "u1", reasons: ["expired_lock", "time_passed"] },
      { userId: "u2", reasons: ["time_passed"] },
    ]);
  });

  it("runs the nightly re-plan once per local day around 03:00", async () => {
    const { store, replan, replanner, setNow } = setup(
      // 02:45 in New York (UTC-5), 07:45 UTC.
      "2026-11-22T07:45:00Z"
    );
    store.users = [
      { userId: "ny", timeZone: "America/New_York" },
      { userId: "utc", timeZone: null },
    ];

    await replanner.tick();
    expect(replan).not.toHaveBeenCalled();

    // 03:00 New York.
    setNow("2026-11-22T08:00:00Z");
    await replanner.tick();
    expect(replan).toHaveBeenCalledTimes(1);
    expect(replan).toHaveBeenCalledWith("ny", "nightly");

    // Later ticks in the window do not repeat it.
    setNow("2026-11-22T08:15:00Z");
    await replanner.tick();
    setNow("2026-11-22T08:45:00Z");
    await replanner.tick();
    expect(replan).toHaveBeenCalledTimes(1);

    // The next local night runs again.
    setNow("2026-11-23T08:05:00Z");
    await replanner.tick();
    expect(replan).toHaveBeenCalledTimes(2);
    expect(replanner.lastNightly.get("ny")).toBe("2026-11-23");
  });

  it("uses UTC for users without a time zone and skips outside the window", async () => {
    const { store, replan, replanner, setNow } = setup("2026-11-22T03:10:00Z");
    store.users = [{ userId: "utc", timeZone: null }];

    await replanner.tick();
    expect(replan).toHaveBeenCalledWith("utc", "nightly");

    setNow("2026-11-23T04:30:00Z"); // window (60 min) missed
    await replanner.tick();
    expect(replan).toHaveBeenCalledTimes(1);
  });

  it("retries the nightly run on the next tick when it fails", async () => {
    const { store, replan, replanner, setNow } = setup("2026-11-22T03:00:00Z");
    store.users = [{ userId: "utc", timeZone: "UTC" }];
    replan.mockRejectedValueOnce(new Error("db down"));

    const failed = await replanner.tick();
    expect(failed.failed).toEqual([{ userId: "utc", error: "db down" }]);
    expect(replanner.lastNightly.has("utc")).toBe(false);

    setNow("2026-11-22T03:15:00Z");
    const ok = await replanner.tick();
    expect(ok.replanned).toEqual([{ userId: "utc", reasons: ["nightly"] }]);
    expect(replanner.lastNightly.get("utc")).toBe("2026-11-22");
  });

  it("skips a tick while the previous one is still running", async () => {
    const { store, replan, replanner } = setup("2026-11-22T15:00:00Z");
    store.stale = ["u1"];
    let release: () => void = () => undefined;
    replan.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve))
    );

    const first = replanner.tick();
    await new Promise((resolve) => setImmediate(resolve));
    const second = await replanner.tick();
    expect(second.skipped).toBe(true);

    release();
    expect((await first).replanned).toHaveLength(1);
    expect(replan).toHaveBeenCalledTimes(1);
  });

  it("widens the nightly window for long tick intervals", async () => {
    const { store, replan, replanner } = setup("2026-11-22T04:30:00Z", {
      tickMs: 60 * 60 * 1000,
    });
    store.users = [{ userId: "utc", timeZone: "UTC" }];
    await replanner.tick();
    expect(replan).toHaveBeenCalledWith("utc", "nightly");
  });
});

describe("background configuration", () => {
  it("is disabled for build, jest and the opt-out flag", () => {
    expect(backgroundReplansEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(backgroundReplansEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(
      backgroundReplansEnabled({ NEXT_PHASE: "phase-production-build" })
    ).toBe(false);
    expect(backgroundReplansEnabled({ JEST_WORKER_ID: "1" })).toBe(false);
    expect(backgroundReplansEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(backgroundReplansEnabled({ MOMENTUM_DISABLE_BACKGROUND: "1" })).toBe(
      false
    );
    // And the real jest environment.
    expect(backgroundReplansEnabled()).toBe(false);
  });

  it("reads the tick interval and nightly hour from env", () => {
    expect(tickIntervalMs({})).toBe(15 * 60 * 1000);
    expect(tickIntervalMs({ MOMENTUM_TICK_MS: "10000" })).toBe(10_000);
    expect(tickIntervalMs({ MOMENTUM_TICK_MS: "nope" })).toBe(15 * 60 * 1000);
    expect(nightlyHour({})).toBe(3);
    expect(nightlyHour({ MOMENTUM_NIGHTLY_HOUR: "0" })).toBe(0);
    expect(nightlyHour({ MOMENTUM_NIGHTLY_HOUR: "25" })).toBe(3);
  });
});

describe("startBackgroundReplans", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    stopBackgroundReplans();
    jest.useRealTimers();
  });

  it("starts one loop per process and ticks on the interval", async () => {
    const store = new FakeStore();
    store.stale = ["u1"];
    const replan = jest.fn().mockResolvedValue(undefined);
    const options = {
      store,
      replan,
      now: () => new Date("2026-11-22T15:00:00Z"),
      intervalMs: 60_000,
    };

    expect(startBackgroundReplans(options).started).toBe(true);
    // A second register() (dev HMR) reuses the existing loop.
    expect(startBackgroundReplans(options).started).toBe(false);

    await jest.advanceTimersByTimeAsync(30_000); // first tick after boot
    expect(replan).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30_000); // interval tick
    expect(replan).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(replan).toHaveBeenCalledTimes(3);
  });
});
