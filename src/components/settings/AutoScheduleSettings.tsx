import { useEffect } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import {
  QUARTER_HOUR_TIMES,
  WorkDayHours,
  formatClockTime,
  formatTime,
  parseSelectedCalendars,
  parseWorkHours,
  stringifySelectedCalendars,
  stringifyWorkDays,
} from "@/lib/autoSchedule";
import { cn } from "@/lib/utils";

import { useCalendarStore } from "@/store/calendar";
import { useSettingsStore } from "@/store/settings";

import { SettingRow, SettingsSection } from "./SettingsSection";

export function AutoScheduleSettings() {
  const { autoSchedule, updateAutoScheduleSettings, user } = useSettingsStore();
  const { feeds, loadFromDatabase } = useCalendarStore();

  // Load calendar feeds when component mounts
  useEffect(() => {
    loadFromDatabase();
  }, [loadFromDatabase]);

  const workingDays = [
    { value: 0, label: "Sunday" },
    { value: 1, label: "Monday" },
    { value: 2, label: "Tuesday" },
    { value: 3, label: "Wednesday" },
    { value: 4, label: "Thursday" },
    { value: 5, label: "Friday" },
    { value: 6, label: "Saturday" },
  ];

  const timeOptions = Array.from({ length: 24 }, (_, i) => ({
    value: i,
    label: formatTime(i, user.timeFormat),
  }));

  const selectedCalendars = parseSelectedCalendars(
    autoSchedule.selectedCalendars
  );
  const workHours = parseWorkHours(autoSchedule.workHours);
  const breakEnabled = Boolean(autoSchedule.breakAfterMinutes);

  const saveWorkHours = (day: number, hours: WorkDayHours) => {
    const next = workHours.map((current, index) =>
      index === day ? hours : current
    );
    updateAutoScheduleSettings({
      workHours: JSON.stringify(next),
      // Keep the legacy day list in step for older readers.
      workDays: stringifyWorkDays(
        next.flatMap((value, index) => (value ? [index] : []))
      ),
    });
  };

  return (
    <SettingsSection
      title="Auto-Schedule Settings"
      description="Configure how tasks are automatically scheduled in your calendar."
    >
      <SettingRow
        label="Calendars to Consider"
        description="Select which calendars to check for conflicts when auto-scheduling"
      >
        <div className="space-y-2">
          {feeds.map((feed) => (
            <div key={feed.id} className="flex items-center space-x-2">
              <Switch
                checked={selectedCalendars.includes(feed.id)}
                onCheckedChange={(checked) => {
                  const calendars = checked
                    ? [...selectedCalendars, feed.id]
                    : selectedCalendars.filter((id) => id !== feed.id);
                  updateAutoScheduleSettings({
                    selectedCalendars: stringifySelectedCalendars(calendars),
                  });
                }}
              />
              <Label className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: feed.color || "var(--muted)" }}
                />
                {feed.name}
              </Label>
            </div>
          ))}
          {feeds.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No calendars found. Please add calendars in the Calendar Settings.
            </div>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label="Working Hours"
        description="Tasks are only auto-scheduled inside these hours (15-minute steps)"
      >
        <div className="space-y-2">
          {workingDays.map((day) => {
            const hours = workHours[day.value];
            return (
              <div
                key={day.value}
                className="grid grid-cols-[auto_6rem_1fr_1fr] items-center gap-3"
                data-testid={`workday-${day.value}`}
              >
                <Switch
                  checked={hours !== null}
                  onCheckedChange={(checked) =>
                    saveWorkHours(
                      day.value,
                      checked ? { start: "09:00", end: "17:00" } : null
                    )
                  }
                />
                <Label className="text-sm">{day.label}</Label>
                {hours ? (
                  <>
                    <Select
                      value={hours.start}
                      onValueChange={(value) =>
                        saveWorkHours(day.value, { ...hours, start: value })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUARTER_HOUR_TIMES.slice(0, -1).map((time) => (
                          <SelectItem key={time} value={time}>
                            {formatClockTime(time, user.timeFormat)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={hours.end}
                      onValueChange={(value) =>
                        saveWorkHours(day.value, { ...hours, end: value })
                      }
                    >
                      <SelectTrigger
                        className={cn(
                          "h-8",
                          hours.end <= hours.start && "border-destructive"
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {QUARTER_HOUR_TIMES.slice(1).map((time) => (
                          <SelectItem key={time} value={time}>
                            {formatClockTime(time, user.timeFormat)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <span className="col-span-2 text-sm text-muted-foreground">
                    Day off
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </SettingRow>

      <SettingRow
        label="Minimum Chunk"
        description="Tasks are split across gaps only when needed; no piece is shorter than this (per-task override in the task form)"
      >
        <Select
          value={String(autoSchedule.defaultMinChunkMinutes ?? 30)}
          onValueChange={(value) =>
            updateAutoScheduleSettings({
              defaultMinChunkMinutes: parseInt(value, 10),
            })
          }
        >
          <SelectTrigger className="w-40" data-testid="default-min-chunk">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[15, 30, 45, 60, 90, 120].map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {minutes} minutes
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow
        label="Energy Level Time Preferences"
        description="Map your energy levels to specific time ranges"
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <Label>High Energy Hours</Label>
            <div className="grid grid-cols-2 gap-4">
              <Select
                value={autoSchedule.highEnergyStart?.toString() || "none"}
                onValueChange={(value) =>
                  updateAutoScheduleSettings({
                    highEnergyStart: value === "none" ? null : parseInt(value),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not Set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not Set</SelectItem>
                  {timeOptions.map((time) => (
                    <SelectItem key={time.value} value={time.value.toString()}>
                      {time.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={autoSchedule.highEnergyEnd?.toString() || "none"}
                onValueChange={(value) =>
                  updateAutoScheduleSettings({
                    highEnergyEnd: value === "none" ? null : parseInt(value),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not Set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not Set</SelectItem>
                  {timeOptions.map((time) => (
                    <SelectItem key={time.value} value={time.value.toString()}>
                      {time.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Medium Energy Hours</Label>
            <div className="grid grid-cols-2 gap-4">
              <Select
                value={autoSchedule.mediumEnergyStart?.toString() || "none"}
                onValueChange={(value) =>
                  updateAutoScheduleSettings({
                    mediumEnergyStart:
                      value === "none" ? null : parseInt(value),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not Set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not Set</SelectItem>
                  {timeOptions.map((time) => (
                    <SelectItem key={time.value} value={time.value.toString()}>
                      {time.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={autoSchedule.mediumEnergyEnd?.toString() || "none"}
                onValueChange={(value) =>
                  updateAutoScheduleSettings({
                    mediumEnergyEnd: value === "none" ? null : parseInt(value),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not Set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not Set</SelectItem>
                  {timeOptions.map((time) => (
                    <SelectItem key={time.value} value={time.value.toString()}>
                      {time.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Low Energy Hours</Label>
            <div className="grid grid-cols-2 gap-4">
              <Select
                value={autoSchedule.lowEnergyStart?.toString() || "none"}
                onValueChange={(value) =>
                  updateAutoScheduleSettings({
                    lowEnergyStart: value === "none" ? null : parseInt(value),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not Set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not Set</SelectItem>
                  {timeOptions.map((time) => (
                    <SelectItem key={time.value} value={time.value.toString()}>
                      {time.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={autoSchedule.lowEnergyEnd?.toString() || "none"}
                onValueChange={(value) =>
                  updateAutoScheduleSettings({
                    lowEnergyEnd: value === "none" ? null : parseInt(value),
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not Set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not Set</SelectItem>
                  {timeOptions.map((time) => (
                    <SelectItem key={time.value} value={time.value.toString()}>
                      {time.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </SettingRow>

      <SettingRow
        label="Breaks"
        description="Optionally insert a break after a stretch of scheduled task time"
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Switch
              data-testid="break-rule-toggle"
              checked={breakEnabled}
              onCheckedChange={(checked) =>
                updateAutoScheduleSettings({
                  breakAfterMinutes: checked ? 120 : null,
                })
              }
            />
            <Label className="text-sm">
              {breakEnabled ? "On" : "Off"}
            </Label>
          </div>
          {breakEnabled && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>After</span>
              <Input
                type="number"
                min={15}
                step={15}
                className="h-8 w-20"
                value={autoSchedule.breakAfterMinutes ?? 120}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  if (value > 0)
                    updateAutoScheduleSettings({ breakAfterMinutes: value });
                }}
              />
              <span>minutes of task time, take a</span>
              <Input
                type="number"
                min={5}
                step={5}
                className="h-8 w-20"
                value={autoSchedule.breakDurationMinutes ?? 15}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  if (value > 0)
                    updateAutoScheduleSettings({
                      breakDurationMinutes: value,
                    });
                }}
              />
              <span>minute break.</span>
            </div>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label="Project Grouping"
        description="Try to schedule tasks from the same project together"
      >
        <Switch
          checked={autoSchedule.groupByProject}
          onCheckedChange={(checked) =>
            updateAutoScheduleSettings({ groupByProject: checked })
          }
        />
      </SettingRow>

      <SettingRow
        label="Push Scheduled Tasks to Calendar"
        description="Automatically create calendar events for scheduled task blocks"
      >
        <div className="space-y-4">
          <Switch
            checked={autoSchedule.pushTasksToCalendar || false}
            onCheckedChange={(checked) =>
              updateAutoScheduleSettings({
                pushTasksToCalendar: checked,
                // Preserve feed selection when toggling; user can re-enable without reconfiguring
              })
            }
          />

          {autoSchedule.pushTasksToCalendar && (
            <div>
              <Label>Target Calendar</Label>
              <Select
                value={autoSchedule.pushTasksFeedId || ""}
                onValueChange={(value) =>
                  updateAutoScheduleSettings({
                    pushTasksFeedId: value || null,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a calendar" />
                </SelectTrigger>
                <SelectContent>
                  {feeds
                    .filter((feed) => feed.type === "GOOGLE")
                    .map((feed) => (
                      <SelectItem key={feed.id} value={feed.id}>
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: feed.color || "var(--muted)" }}
                          />
                          {feed.name}
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {feeds.filter((feed) => feed.type === "GOOGLE").length === 0 && (
                <div className="text-sm text-muted-foreground mt-2">
                  No Google calendars found. Please connect a Google account in Calendar Settings.
                </div>
              )}
            </div>
          )}
        </div>
      </SettingRow>
    </SettingsSection>
  );
}
