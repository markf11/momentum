import {
  attentionRank,
  formatScheduleIssue,
  scheduleStatusBadge,
} from "@/lib/schedule-status";

describe("schedule status badges (D13)", () => {
  it("is red for past due and can't fit, amber for at risk", () => {
    expect(scheduleStatusBadge("past_due")?.tone).toBe("red");
    expect(scheduleStatusBadge("cant_fit")?.tone).toBe("red");
    expect(scheduleStatusBadge("at_risk")?.tone).toBe("amber");
    expect(scheduleStatusBadge("on_time")).toBeNull();
    expect(scheduleStatusBadge("locked")).toBeNull();
    expect(scheduleStatusBadge(null)).toBeNull();
  });

  it("orders past due, then can't fit, then at risk", () => {
    const statuses = ["at_risk", "cant_fit", "on_time", "past_due"];
    expect(
      [...statuses].sort((a, b) => attentionRank(a) - attentionRank(b))
    ).toEqual(["past_due", "cant_fit", "at_risk", "on_time"]);
  });

  it("renders engine ISO instants as readable local times", () => {
    const text = formatScheduleIssue(
      "Hard deadline 2026-11-23T12:00:00.000Z is before the projected finish 2026-11-24T10:00:00.000Z"
    );
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text).toContain("Hard deadline");
  });
});
