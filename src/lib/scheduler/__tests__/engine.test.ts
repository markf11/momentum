import { formatInTimeZone } from "date-fns-tz";
import { performance } from "node:perf_hooks";

import { scheduleTasks } from "../engine";
import {
  SchedulerBlock,
  SchedulerInput,
  SchedulerTask,
  WorkWeek,
} from "../types";

const NOW = new Date("2027-03-08T14:00:00.000Z"); // Monday 09:00 in New York
const WEEKDAYS: WorkWeek = [
  null,
  { start: "09:00", end: "17:00" },
  { start: "09:00", end: "17:00" },
  { start: "09:00", end: "17:00" },
  { start: "09:00", end: "17:00" },
  { start: "09:00", end: "17:00" },
  null,
];
const EVERY_DAY: WorkWeek = Array.from({ length: 7 }, () => ({
  start: "09:00",
  end: "17:00",
}));

function task(overrides: Partial<SchedulerTask> = {}): SchedulerTask {
  return {
    id: "task-1",
    title: "Task",
    durationMinutes: 60,
    priority: "medium",
    ...overrides,
  };
}

function input(overrides: Partial<SchedulerInput> = {}): SchedulerInput {
  return {
    tasks: [],
    busyEvents: [],
    settings: { workWeek: WEEKDAYS },
    now: NOW,
    timeZone: "America/New_York",
    horizonDays: 31,
    ...overrides,
  };
}

function minutes(block: SchedulerBlock): number {
  return (block.end.getTime() - block.start.getTime()) / 60_000;
}

function expectNoOverlaps(blocks: SchedulerBlock[]): void {
  const sorted = [...blocks].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
  for (let index = 1; index < sorted.length; index += 1) {
    expect(sorted[index].start.getTime()).toBeGreaterThanOrEqual(
      sorted[index - 1].end.getTime()
    );
  }
}

describe("scheduleTasks", () => {
  it("places a task at the earliest feasible work-hours slot", () => {
    const result = scheduleTasks(input({ tasks: [task()] }));

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].start.toISOString()).toBe(
      "2027-03-08T14:00:00.000Z"
    );
    expect(result.blocks[0].end.toISOString()).toBe("2027-03-08T15:00:00.000Z");
    expect(result.tasks[0]).toMatchObject({ status: "on_time", issue: null });
  });

  it("orders ASAP first, then earliest deadline, then priority", () => {
    const sameDeadline = new Date("2027-03-10T16:00:00.000Z");
    const result = scheduleTasks(
      input({
        tasks: [
          task({ id: "no-deadline", dueDate: null, priority: "high" }),
          task({
            id: "later-low",
            dueDate: new Date("2027-03-11T16:00:00.000Z"),
            priority: "low",
          }),
          task({ id: "same-low", dueDate: sameDeadline, priority: "low" }),
          task({ id: "asap", dueDate: null, priority: "asap" }),
          task({ id: "same-high", dueDate: sameDeadline, priority: "high" }),
          task({
            id: "early-low",
            dueDate: new Date("2027-03-09T16:00:00.000Z"),
            priority: "low",
          }),
        ],
      })
    );

    expect(result.blocks.map((block) => block.taskId)).toEqual([
      "asap",
      "early-low",
      "same-high",
      "same-low",
      "later-low",
      "no-deadline",
    ]);
  });

  it("flags a hard deadline it cannot meet instead of hiding a late finish", () => {
    const result = scheduleTasks(
      input({
        tasks: [
          task({
            durationMinutes: 120,
            dueDate: new Date("2027-03-08T15:00:00.000Z"),
            hardDeadline: true,
          }),
        ],
      })
    );

    expect(result.tasks[0].status).toBe("past_due");
    expect(result.tasks[0].issue).toContain("Hard deadline");
    expect(result.tasks[0].eta?.toISOString()).toBe("2027-03-08T16:00:00.000Z");
    expect(result.blocks).toHaveLength(1);
    expect(result.issues[0].status).toBe("past_due");
  });

  it("marks a finish after a soft deadline at risk", () => {
    const result = scheduleTasks(
      input({
        tasks: [
          task({
            durationMinutes: 120,
            dueDate: new Date("2027-03-08T15:00:00.000Z"),
            hardDeadline: false,
          }),
        ],
      })
    );

    expect(result.tasks[0].status).toBe("at_risk");
    expect(result.tasks[0].issue).toContain("soft deadline");
  });

  it("conserves duration across chunks, respects minimums, and avoids busy events", () => {
    const busyEvents = [
      {
        id: "morning-meeting",
        start: new Date("2027-03-08T15:00:00.000Z"),
        end: new Date("2027-03-08T17:00:00.000Z"),
      },
      {
        id: "afternoon-meeting",
        start: new Date("2027-03-08T19:00:00.000Z"),
        end: new Date("2027-03-08T20:00:00.000Z"),
      },
    ];
    const result = scheduleTasks(
      input({ tasks: [task({ durationMinutes: 240 })], busyEvents })
    );

    expect(result.tasks[0].status).not.toBe("cant_fit");
    expect(result.blocks.map(minutes)).toEqual([60, 120, 60]);
    expect(result.blocks.reduce((sum, block) => sum + minutes(block), 0)).toBe(
      240
    );
    expect(result.blocks.every((block) => minutes(block) >= 30)).toBe(true);
    expect(result.tasks[0].eta?.toISOString()).toBe("2027-03-08T21:00:00.000Z");
    expectNoOverlaps(result.blocks);

    for (const block of result.blocks) {
      expect(
        busyEvents.every(
          (event) => block.end <= event.start || block.start >= event.end
        )
      ).toBe(true);
      const localStart = formatInTimeZone(
        block.start,
        "America/New_York",
        "HH:mm"
      );
      const localEnd = formatInTimeZone(block.end, "America/New_York", "HH:mm");
      expect(localStart >= "09:00").toBe(true);
      expect(localEnd <= "17:00").toBe(true);
    }
  });

  it("rebalances earlier chunks instead of leaving a sub-minimum tail", () => {
    const result = scheduleTasks(
      input({
        tasks: [task({ durationMinutes: 100 })],
        settings: {
          workWeek: [
            null,
            { start: "09:00", end: "12:00" },
            null,
            null,
            null,
            null,
            null,
          ],
        },
        busyEvents: [
          {
            start: new Date("2027-03-08T14:40:00.000Z"),
            end: new Date("2027-03-08T15:00:00.000Z"),
          },
          {
            start: new Date("2027-03-08T15:40:00.000Z"),
            end: new Date("2027-03-08T16:00:00.000Z"),
          },
          {
            start: new Date("2027-03-08T16:40:00.000Z"),
            end: new Date("2027-03-08T17:00:00.000Z"),
          },
        ],
      })
    );

    expect(result.tasks[0].status).not.toBe("cant_fit");
    expect(result.blocks.reduce((sum, block) => sum + minutes(block), 0)).toBe(
      100
    );
    expect(result.blocks.every((block) => minutes(block) >= 30)).toBe(true);
  });

  it("keeps locked blocks exactly in place and schedules around them", () => {
    const lockedStart = new Date("2027-03-08T14:00:00.000Z");
    const lockedEnd = new Date("2027-03-08T15:00:00.000Z");
    const result = scheduleTasks(
      input({
        tasks: [
          task({ id: "unlocked" }),
          task({
            id: "locked",
            locked: true,
            scheduledStart: lockedStart,
            scheduledEnd: lockedEnd,
          }),
        ],
      })
    );

    const locked = result.blocks.find((block) => block.taskId === "locked");
    const unlocked = result.blocks.find((block) => block.taskId === "unlocked");
    expect(locked).toMatchObject({
      start: lockedStart,
      end: lockedEnd,
      locked: true,
      status: "locked",
    });
    expect(unlocked?.start.toISOString()).toBe("2027-03-08T15:00:00.000Z");
    expect(result.tasks.find((item) => item.taskId === "locked")?.status).toBe(
      "locked"
    );
  });

  it("flags can't-fit work and emits no partial blocks", () => {
    const result = scheduleTasks(
      input({
        tasks: [task({ id: "impossible", durationMinutes: 500 })],
        settings: { workWeek: Array(7).fill(null) },
      })
    );

    expect(result.blocks).toEqual([]);
    expect(result.tasks[0]).toMatchObject({
      taskId: "impossible",
      status: "cant_fit",
      eta: null,
    });
    expect(result.tasks[0].issue).toContain("full 500 minutes");
  });

  it("inserts the optional break after the configured task time", () => {
    const result = scheduleTasks(
      input({
        tasks: [
          task({ id: "a", durationMinutes: 120 }),
          task({ id: "b", durationMinutes: 120 }),
        ],
        settings: {
          workWeek: WEEKDAYS,
          breakRule: { afterMinutes: 120, durationMinutes: 15 },
        },
      })
    );

    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].end.toISOString()).toBe("2027-03-08T16:00:00.000Z");
    expect(result.blocks[1].start.toISOString()).toBe(
      "2027-03-08T16:15:00.000Z"
    );
    expect(result.blocks[1].end.toISOString()).toBe("2027-03-08T18:15:00.000Z");
    expect(result.blocks.reduce((sum, block) => sum + minutes(block), 0)).toBe(
      240
    );
  });

  it("splits one long task at the break threshold", () => {
    const result = scheduleTasks(
      input({
        tasks: [task({ id: "a", durationMinutes: 240 })],
        settings: {
          workWeek: WEEKDAYS,
          breakRule: { afterMinutes: 120, durationMinutes: 15 },
        },
      })
    );

    expect(
      result.blocks.map((block) => [
        block.start.toISOString(),
        block.end.toISOString(),
      ])
    ).toEqual([
      ["2027-03-08T14:00:00.000Z", "2027-03-08T16:00:00.000Z"],
      ["2027-03-08T16:15:00.000Z", "2027-03-08T18:15:00.000Z"],
    ]);
  });

  it("treats a meeting gap as the break instead of adding another", () => {
    const result = scheduleTasks(
      input({
        tasks: [
          task({ id: "a", durationMinutes: 120, priority: "high" }),
          task({ id: "b", durationMinutes: 60, priority: "low" }),
        ],
        busyEvents: [
          {
            start: new Date("2027-03-08T16:00:00.000Z"),
            end: new Date("2027-03-08T17:00:00.000Z"),
          },
        ],
        settings: {
          workWeek: WEEKDAYS,
          breakRule: { afterMinutes: 120, durationMinutes: 15 },
        },
      })
    );

    const b = result.blocks.find((block) => block.taskId === "b")!;
    expect(b.start.toISOString()).toBe("2027-03-08T17:00:00.000Z");
  });

  it("leaves auto-schedule-off tasks unscheduled", () => {
    const result = scheduleTasks(
      input({ tasks: [task({ autoSchedule: false })] })
    );
    expect(result.blocks).toEqual([]);
    expect(result.tasks[0].status).toBe("unscheduled");
  });

  it("expands daily recurring tasks and stores each instance start", () => {
    const result = scheduleTasks(
      input({
        settings: { workWeek: EVERY_DAY },
        now: new Date("2027-03-08T13:00:00.000Z"),
        tasks: [
          task({
            startDate: new Date("2027-03-08T14:00:00.000Z"),
            dueDate: new Date("2027-03-08T22:00:00.000Z"),
            recurrenceRule: "RRULE:FREQ=DAILY;COUNT=3",
          }),
        ],
      })
    );

    expect(result.blocks).toHaveLength(3);
    expect(result.tasks).toHaveLength(3);
    expect(result.blocks.map((block) => block.start.toISOString())).toEqual([
      "2027-03-08T14:00:00.000Z",
      "2027-03-09T14:00:00.000Z",
      "2027-03-10T14:00:00.000Z",
    ]);
    expect(
      result.blocks.map((block) => block.instanceStart?.toISOString())
    ).toEqual([
      "2027-03-08T14:00:00.000Z",
      "2027-03-09T14:00:00.000Z",
      "2027-03-10T14:00:00.000Z",
    ]);
  });

  it("keeps 09:00 wall time across the 2027 New York DST transition", () => {
    const result = scheduleTasks(
      input({
        settings: { workWeek: EVERY_DAY },
        now: new Date("2027-03-12T13:00:00.000Z"),
        tasks: [
          task({
            startDate: new Date("2027-03-12T14:00:00.000Z"),
            recurrenceRule: "FREQ=DAILY;COUNT=3",
          }),
        ],
      })
    );

    expect(result.blocks.map((block) => block.start.toISOString())).toEqual([
      "2027-03-12T14:00:00.000Z",
      "2027-03-13T14:00:00.000Z",
      "2027-03-14T13:00:00.000Z",
    ]);
    expect(
      result.blocks.map((block) =>
        formatInTimeZone(block.start, "America/New_York", "HH:mm")
      )
    ).toEqual(["09:00", "09:00", "09:00"]);
  });

  it("schedules 100 tasks over 31 days in under one second", () => {
    const tasks = Array.from({ length: 100 }, (_, index) =>
      task({ id: `task-${index.toString().padStart(3, "0")}` })
    );
    const started = performance.now();
    const result = scheduleTasks(
      input({ tasks, settings: { workWeek: EVERY_DAY } })
    );
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(1_000);
    expect(result.blocks).toHaveLength(100);
    expect(result.tasks.every((item) => item.status === "on_time")).toBe(true);
    expectNoOverlaps(result.blocks);
  });

  it("stays under one second for 100 tasks with the break rule on", () => {
    const tasks = Array.from({ length: 100 }, (_, index) =>
      task({ id: `task-${index.toString().padStart(3, "0")}` })
    );
    const started = performance.now();
    const result = scheduleTasks(
      input({
        tasks,
        settings: {
          workWeek: EVERY_DAY,
          breakRule: { afterMinutes: 120, durationMinutes: 15 },
        },
      })
    );
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(1_000);
    expect(result.tasks.every((item) => item.status === "on_time")).toBe(true);
    expect(result.blocks.reduce((sum, block) => sum + minutes(block), 0)).toBe(
      6_000
    );
    expectNoOverlaps(result.blocks);
  });
});
