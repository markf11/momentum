import { BusyEventRow, toBusyEvents } from "../busy-events";

function row(overrides: Partial<BusyEventRow> = {}): BusyEventRow {
  return {
    id: "event",
    start: new Date("2027-03-08T15:00:00.000Z"),
    end: new Date("2027-03-08T16:00:00.000Z"),
    isRecurring: false,
    recurrenceRule: null,
    isMaster: false,
    masterEventId: null,
    status: null,
    ...overrides,
  };
}

describe("toBusyEvents", () => {
  it("passes a local recurring event's rule to the engine", () => {
    // Local events are saved with isRecurring but never as a master.
    expect(
      toBusyEvents([
        row({ isRecurring: true, recurrenceRule: "FREQ=WEEKLY;BYDAY=MO" }),
      ])
    ).toEqual([
      {
        id: "event",
        start: new Date("2027-03-08T15:00:00.000Z"),
        end: new Date("2027-03-08T16:00:00.000Z"),
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      },
    ]);
  });

  it("keeps one-off events as single rows", () => {
    expect(toBusyEvents([row()])[0].recurrenceRule).toBeNull();
  });

  it("uses stored instances instead of re-expanding their master", () => {
    const events = toBusyEvents([
      row({
        id: "master",
        isMaster: true,
        isRecurring: true,
        recurrenceRule: "RRULE:FREQ=DAILY",
      }),
      row({
        id: "moved",
        isRecurring: true,
        recurrenceRule: "RRULE:FREQ=DAILY",
        masterEventId: "master",
        start: new Date("2027-03-09T18:00:00.000Z"),
        end: new Date("2027-03-09T19:00:00.000Z"),
      }),
      row({
        id: "cancelled",
        masterEventId: "master",
        status: "cancelled",
      }),
    ]);

    expect(events).toEqual([
      {
        id: "moved",
        start: new Date("2027-03-09T18:00:00.000Z"),
        end: new Date("2027-03-09T19:00:00.000Z"),
        recurrenceRule: null,
      },
    ]);
  });

  it("expands a master whose instances were not stored", () => {
    const [event] = toBusyEvents([
      row({ isMaster: true, isRecurring: true, recurrenceRule: "FREQ=DAILY" }),
    ]);
    expect(event.recurrenceRule).toBe("FREQ=DAILY");
  });
});
