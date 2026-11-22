import {
  filterEventsBySelectedCalendars,
  parseCalendarSelection,
} from "../calendar-selection";

const events = [
  { id: "work-1", feedId: "work" },
  { id: "home-1", feedId: "home" },
  { id: "work-2", feedId: "work" },
];

describe("filterEventsBySelectedCalendars", () => {
  it("counts every calendar when nothing is selected", () => {
    expect(filterEventsBySelectedCalendars(events, "[]")).toEqual(events);
    expect(filterEventsBySelectedCalendars(events, "")).toEqual(events);
    expect(filterEventsBySelectedCalendars(events, null)).toEqual(events);
  });

  it("keeps only events from the selected calendars", () => {
    expect(
      filterEventsBySelectedCalendars(events, JSON.stringify(["work"])).map(
        (event) => event.id
      )
    ).toEqual(["work-1", "work-2"]);
    expect(
      filterEventsBySelectedCalendars(events, JSON.stringify(["work", "home"]))
    ).toHaveLength(3);
  });

  it("ignores selections of deleted calendars", () => {
    expect(
      filterEventsBySelectedCalendars(events, JSON.stringify(["gone"]), [
        "work",
        "home",
      ])
    ).toEqual(events);
    expect(
      filterEventsBySelectedCalendars(
        events,
        JSON.stringify(["gone", "home"]),
        ["work", "home"]
      ).map((event) => event.id)
    ).toEqual(["home-1"]);
  });

  it("selecting only a calendar with no events leaves nothing busy", () => {
    expect(
      filterEventsBySelectedCalendars(events, JSON.stringify(["google"]), [
        "work",
        "home",
        "google",
      ])
    ).toEqual([]);
  });

  it("treats malformed settings as no selection", () => {
    expect(parseCalendarSelection("not json")).toEqual([]);
    expect(parseCalendarSelection('{"a":1}')).toEqual([]);
    expect(parseCalendarSelection('["a", 3, ""]')).toEqual(["a"]);
    expect(filterEventsBySelectedCalendars(events, "not json")).toEqual(events);
  });
});
