import {
  formatMinutes,
  formatRemaining,
  logMinutes,
  remainingAfterDurationChange,
  remainingOf,
  resolveRemainingUpdate,
  shortenRemaining,
  workedOf,
} from "@/lib/remaining-time";

describe("remaining time (D16e)", () => {
  it("defaults remaining to the duration and clamps it", () => {
    expect(remainingOf({ duration: 240, remainingMinutes: null })).toBe(240);
    expect(remainingOf({ duration: 240 })).toBe(240);
    expect(remainingOf({ duration: 240, remainingMinutes: 300 })).toBe(240);
    expect(remainingOf({ duration: 240, remainingMinutes: -5 })).toBe(0);
    expect(remainingOf({ duration: null, remainingMinutes: null })).toBe(0);
    expect(workedOf({ duration: 240, remainingMinutes: 90 })).toBe(150);
  });

  it("logs time and completes at zero", () => {
    expect(logMinutes({ duration: 240, remainingMinutes: 240 }, 90)).toEqual({
      remainingMinutes: 150,
      completed: false,
    });
    expect(logMinutes({ duration: 240, remainingMinutes: 60 }, 60)).toEqual({
      remainingMinutes: 0,
      completed: true,
    });
    // Logging more than is left never goes negative.
    expect(logMinutes({ duration: 240, remainingMinutes: 30 }, 90)).toEqual({
      remainingMinutes: 0,
      completed: true,
    });
  });

  it("keeps worked minutes when the duration is edited", () => {
    const task = { duration: 240, remainingMinutes: 90 }; // 150 worked
    expect(remainingAfterDurationChange(task, 300)).toBe(150);
    expect(remainingAfterDurationChange(task, 180)).toBe(30);
    expect(remainingAfterDurationChange(task, 120)).toBe(0);
    expect(remainingAfterDurationChange({ duration: 60 }, 90)).toBe(90);
  });

  it("resolves remaining for task updates", () => {
    const stored = { duration: 240, remainingMinutes: 90 };
    // Duration edit with the stored remaining echoed back (inline save).
    expect(
      resolveRemainingUpdate(stored, { duration: 300, remainingMinutes: 90 })
    ).toBe(150);
    expect(resolveRemainingUpdate(stored, { duration: 300 })).toBe(150);
    // Explicit remaining wins, clamped to the new duration.
    expect(
      resolveRemainingUpdate(stored, { duration: 200, remainingMinutes: 50 })
    ).toBe(50);
    expect(resolveRemainingUpdate(stored, { remainingMinutes: 500 })).toBe(240);
    // Nothing time-related changed.
    expect(resolveRemainingUpdate(stored, {})).toBeUndefined();
    expect(
      resolveRemainingUpdate(stored, { duration: 240, remainingMinutes: 90 })
    ).toBeUndefined();
  });

  it("shortens without counting the cut as work", () => {
    expect(
      shortenRemaining({ duration: 240, remainingMinutes: 180 }, 120)
    ).toEqual({ duration: 180, remainingMinutes: 120 });
    // Cannot lengthen through shorten.
    expect(
      shortenRemaining({ duration: 60, remainingMinutes: 60 }, 90)
    ).toEqual({
      duration: 60,
      remainingMinutes: 60,
    });
  });

  it("formats remaining as 'Xh Ym left of Zh'", () => {
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(240)).toBe("4h");
    expect(formatRemaining({ duration: 240, remainingMinutes: 90 })).toBe(
      "1h 30m left of 4h"
    );
    expect(
      formatRemaining({ duration: 240, remainingMinutes: 240 })
    ).toBeNull();
    expect(
      formatRemaining({ duration: 240, remainingMinutes: null })
    ).toBeNull();
  });
});
