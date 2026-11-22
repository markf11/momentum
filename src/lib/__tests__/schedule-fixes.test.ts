import { fitMinutes, fixUpdates, scheduleFixes } from "@/lib/schedule-fixes";
import { minutesBeforeDeadline } from "@/lib/scheduler/fit";

import { Task } from "@/types/task";

const due = new Date("2026-11-24T17:00:00Z");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Report",
    status: "todo",
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    isRecurring: false,
    isAutoScheduled: true,
    scheduleLocked: false,
    duration: 240,
    remainingMinutes: 240,
    dueDate: due,
    hardDeadline: true,
    scheduleStatus: "past_due",
    scheduleFitMinutes: 120,
    ...overrides,
  } as Task;
}

const kinds = (t: Task) => scheduleFixes(t).map((fix) => fix.kind);

describe("minutesBeforeDeadline", () => {
  it("sums the planned minutes before the due date, clipping a straddler", () => {
    const blocks = [
      {
        start: new Date("2026-11-24T14:00:00Z"),
        end: new Date("2026-11-24T16:00:00Z"),
      },
      {
        start: new Date("2026-11-24T16:30:00Z"),
        end: new Date("2026-11-24T18:00:00Z"),
      },
      {
        start: new Date("2026-11-25T14:00:00Z"),
        end: new Date("2026-11-25T15:00:00Z"),
      },
    ];
    expect(minutesBeforeDeadline(blocks, due)).toBe(150);
    expect(minutesBeforeDeadline(blocks, null)).toBeNull();
    expect(minutesBeforeDeadline([], due)).toBe(0);
  });
});

describe("schedule fixes (D13)", () => {
  it("offers push, soften and shorten-to-fit for a hard past-due task", () => {
    expect(kinds(task())).toEqual([
      "push_deadline",
      "make_soft",
      "shorten_to_fit",
    ]);
  });

  it("only offers shorten-to-fit when the fit is >= the min chunk and < remaining", () => {
    expect(kinds(task({ scheduleFitMinutes: 20 }))).not.toContain(
      "shorten_to_fit"
    );
    expect(
      kinds(task({ scheduleFitMinutes: 20, minChunkMinutes: 15 }))
    ).toContain("shorten_to_fit");
    expect(kinds(task({ scheduleFitMinutes: 240 }))).not.toContain(
      "shorten_to_fit"
    );
    expect(kinds(task({ scheduleFitMinutes: null }))).not.toContain(
      "shorten_to_fit"
    );
    expect(fitMinutes(task({ scheduleFitMinutes: 45 }), 60)).toBeNull();
  });

  it("does not offer make-soft for a soft at-risk task", () => {
    expect(
      kinds(task({ scheduleStatus: "at_risk", hardDeadline: false }))
    ).toEqual(["push_deadline", "shorten_to_fit"]);
  });

  it("offers shorten and auto-schedule off for can't fit", () => {
    expect(kinds(task({ scheduleStatus: "cant_fit" }))).toEqual([
      "shorten",
      "auto_schedule_off",
    ]);
    expect(kinds(task({ scheduleStatus: "on_time" }))).toEqual([]);
  });

  it("builds the PATCH body for each fix", () => {
    const t = task({ duration: 240, remainingMinutes: 180 }); // 60 worked
    expect(fixUpdates(t, "push_deadline")).toEqual({
      dueDate: new Date("2026-11-25T17:00:00Z"),
    });
    expect(fixUpdates(t, "make_soft")).toEqual({ hardDeadline: false });
    expect(fixUpdates(t, "shorten_to_fit")).toEqual({
      duration: 180,
      remainingMinutes: 120,
    });
    expect(fixUpdates(t, "shorten", 90)).toEqual({
      duration: 150,
      remainingMinutes: 90,
    });
    expect(fixUpdates(t, "shorten", 0)).toBeNull();
    expect(fixUpdates(t, "auto_schedule_off")).toEqual({
      isAutoScheduled: false,
    });
  });
});
