import {
  InvalidTaskDateError,
  dueDateFormParts,
  dueDateFormValue,
  formatDueDateLong,
  formatTaskDate,
  isEndOfDayInTimeZone,
  resolveTaskDateFields,
  resolveTaskDateInput,
  zonedDayAsLocalDate,
} from "@/lib/task-dates";

const iso = (d: Date | null | undefined) => d?.toISOString();

describe("resolveTaskDateInput: date-only due = end of day in user zone", () => {
  it("America/New_York (EST): 2026-12-01 → 2026-12-02T04:59:59.999Z", () => {
    expect(
      iso(resolveTaskDateInput("2026-12-01", "America/New_York", "due"))
    ).toBe("2026-12-02T04:59:59.999Z");
  });

  it("America/New_York (EDT, summer): 2026-07-15 → 2026-07-16T03:59:59.999Z", () => {
    expect(
      iso(resolveTaskDateInput("2026-07-15", "America/New_York", "due"))
    ).toBe("2026-07-16T03:59:59.999Z");
  });

  it("Asia/Tokyo (UTC+9): 2026-12-01 → 2026-12-01T14:59:59.999Z", () => {
    expect(iso(resolveTaskDateInput("2026-12-01", "Asia/Tokyo", "due"))).toBe(
      "2026-12-01T14:59:59.999Z"
    );
  });

  it("Asia/Kolkata (UTC+5:30, no DST)", () => {
    expect(iso(resolveTaskDateInput("2026-12-01", "Asia/Kolkata", "due"))).toBe(
      "2026-12-01T18:29:59.999Z"
    );
  });

  it("UTC", () => {
    expect(iso(resolveTaskDateInput("2026-12-01", "UTC", "due"))).toBe(
      "2026-12-01T23:59:59.999Z"
    );
  });

  describe("DST edges (America/New_York)", () => {
    it("day before spring-forward is still EST (-5)", () => {
      expect(
        iso(resolveTaskDateInput("2026-03-07", "America/New_York", "due"))
      ).toBe("2026-03-08T04:59:59.999Z");
    });

    it("spring-forward day (23h long) ends in EDT (-4)", () => {
      expect(
        iso(resolveTaskDateInput("2026-03-08", "America/New_York", "due"))
      ).toBe("2026-03-09T03:59:59.999Z");
    });

    it("fall-back day (25h long) ends in EST (-5)", () => {
      expect(
        iso(resolveTaskDateInput("2026-11-01", "America/New_York", "due"))
      ).toBe("2026-11-02T04:59:59.999Z");
    });

    it("start of the spring-forward day is still EST midnight", () => {
      expect(
        iso(resolveTaskDateInput("2026-03-08", "America/New_York", "start"))
      ).toBe("2026-03-08T05:00:00.000Z");
    });

    it("a wall time after the jump uses the new offset", () => {
      expect(
        iso(resolveTaskDateInput("2026-03-08T09:00", "America/New_York", "due"))
      ).toBe("2026-03-08T13:00:00.000Z");
    });
  });

  it("Europe/London DST edge (BST ends 2026-10-25)", () => {
    expect(
      iso(resolveTaskDateInput("2026-10-24", "Europe/London", "due"))
    ).toBe("2026-10-24T22:59:59.999Z");
    expect(
      iso(resolveTaskDateInput("2026-10-25", "Europe/London", "due"))
    ).toBe("2026-10-25T23:59:59.999Z");
  });

  it("date-only start date = start of that day in the user zone", () => {
    expect(
      iso(resolveTaskDateInput("2026-12-01", "America/New_York", "start"))
    ).toBe("2026-12-01T05:00:00.000Z");
    expect(iso(resolveTaskDateInput("2026-12-01", "Asia/Tokyo", "start"))).toBe(
      "2026-11-30T15:00:00.000Z"
    );
  });

  it("zone-less date + time is a wall time in the user zone", () => {
    expect(
      iso(resolveTaskDateInput("2026-12-01T17:00", "America/New_York", "due"))
    ).toBe("2026-12-01T22:00:00.000Z");
    expect(
      iso(resolveTaskDateInput("2026-12-01T09:30", "Asia/Tokyo", "due"))
    ).toBe("2026-12-01T00:30:00.000Z");
  });

  it("full ISO instants are accepted unchanged", () => {
    for (const value of [
      "2026-12-01T00:00:00.000Z",
      "2026-12-01T17:00:00-05:00",
      "2026-12-02T04:59:59.999Z",
    ]) {
      expect(resolveTaskDateInput(value, "Asia/Tokyo", "due")!.getTime()).toBe(
        new Date(value).getTime()
      );
    }
    const date = new Date("2026-12-01T12:34:56.000Z");
    expect(iso(resolveTaskDateInput(date, "America/New_York", "due"))).toBe(
      "2026-12-01T12:34:56.000Z"
    );
  });

  it("passes undefined through and clears null / empty", () => {
    expect(resolveTaskDateInput(undefined, "UTC", "due")).toBeUndefined();
    expect(resolveTaskDateInput(null, "UTC", "due")).toBeNull();
    expect(resolveTaskDateInput("", "UTC", "due")).toBeNull();
  });

  it("rejects garbage and impossible dates", () => {
    expect(() => resolveTaskDateInput("tomorrow", "UTC", "due")).toThrow(
      InvalidTaskDateError
    );
    expect(() =>
      resolveTaskDateInput("2026-02-30", "America/New_York", "due")
    ).toThrow(InvalidTaskDateError);
    expect(() => resolveTaskDateInput({}, "UTC", "due")).toThrow(
      InvalidTaskDateError
    );
  });

  it("falls back to UTC for an invalid zone", () => {
    expect(iso(resolveTaskDateInput("2026-12-01", "Not/AZone", "due"))).toBe(
      "2026-12-01T23:59:59.999Z"
    );
  });
});

describe("resolveTaskDateFields", () => {
  it("converts present date fields and leaves absent ones absent", () => {
    const out = resolveTaskDateFields(
      { title: "x", dueDate: "2026-12-01", startDate: "2026-11-28" },
      "America/New_York"
    );
    expect(out.title).toBe("x");
    expect(iso(out.dueDate)).toBe("2026-12-02T04:59:59.999Z");
    expect(iso(out.startDate)).toBe("2026-11-28T05:00:00.000Z");

    const partial = resolveTaskDateFields({ status: "todo" }, "UTC");
    expect("dueDate" in partial).toBe(false);
    expect("startDate" in partial).toBe(false);
  });
});

describe("form round trip", () => {
  it("date-only due dates come back with an empty time", () => {
    const stored = resolveTaskDateInput(
      "2026-12-01",
      "America/New_York",
      "due"
    )!;
    expect(isEndOfDayInTimeZone(stored, "America/New_York")).toBe(true);
    expect(dueDateFormParts(stored, "America/New_York")).toEqual({
      date: "2026-12-01",
      time: "",
    });
    expect(dueDateFormParts(stored.toISOString(), "Asia/Tokyo")).toEqual({
      date: "2026-12-02",
      time: "13:59",
    });
  });

  it("explicit times round trip", () => {
    const stored = resolveTaskDateInput(
      dueDateFormValue("2026-12-01", "17:00"),
      "Asia/Tokyo",
      "due"
    )!;
    expect(dueDateFormParts(stored, "Asia/Tokyo")).toEqual({
      date: "2026-12-01",
      time: "17:00",
    });
    expect(dueDateFormValue("", "17:00")).toBeNull();
    expect(dueDateFormValue("2026-12-01", "")).toBe("2026-12-01");
  });

  it("zonedDayAsLocalDate gives the zone's calendar day", () => {
    const day = zonedDayAsLocalDate(
      "2026-12-02T04:59:59.999Z",
      "America/New_York"
    );
    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([
      2026, 11, 1,
    ]);
  });
});

describe("formatTaskDate (display in the user's zone)", () => {
  const now = new Date("2026-11-30T15:00:00.000Z"); // Mon 10:00 in New York

  it("shows the NY due day, not the UTC day", () => {
    const due = "2026-12-02T04:59:59.999Z"; // end of Tue Dec 1 in NY
    expect(formatTaskDate(due, "America/New_York", { now }).text).toBe(
      "Tomorrow"
    );
    expect(formatTaskDate(due, "America/New_York", { now }).isOverdue).toBe(
      false
    );
    expect(formatDueDateLong(due, "America/New_York")).toBe(
      "December 1st, 2026"
    );
  });

  it("a date-only due today is not overdue until the day ends", () => {
    const due = "2026-12-01T04:59:59.999Z"; // end of Mon Nov 30 in NY
    const result = formatTaskDate(due, "America/New_York", { now });
    expect(result).toEqual({
      text: "Today",
      isOverdue: false,
      isFuture: false,
    });
    const later = new Date("2026-12-01T05:00:00.000Z");
    expect(formatTaskDate(due, "America/New_York", { now: later }).text).toBe(
      "Overdue: Nov 30"
    );
  });

  it("appends explicit times and weekday labels", () => {
    expect(
      formatTaskDate("2026-12-03T22:00:00.000Z", "America/New_York", { now })
        .text
    ).toBe("Thursday, 5:00 PM");
    expect(
      formatTaskDate("2027-01-15T04:59:59.999Z", "America/New_York", { now })
        .text
    ).toBe("Jan 14, 2027");
  });

  it("start dates use start-of-day and are never overdue", () => {
    const start = resolveTaskDateInput(
      "2026-11-20",
      "America/New_York",
      "start"
    )!;
    expect(
      formatTaskDate(start, "America/New_York", { now, kind: "start" })
    ).toEqual({ text: "Nov 20", isOverdue: false, isFuture: false });
  });
});
