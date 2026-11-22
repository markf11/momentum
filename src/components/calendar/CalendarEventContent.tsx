import { memo } from "react";

import type { EventContentArg } from "@fullcalendar/core";
import {
  IoCheckmarkCircle,
  IoLockClosed,
  IoRepeat,
  IoTimeOutline,
} from "react-icons/io5";

import { getMonthEventDisplay } from "@/lib/calendar-event-display";
import { scheduleStatusBadge } from "@/lib/schedule-status";
import { isTaskOverdue } from "@/lib/task-utils";
import { cn } from "@/lib/utils";

import { useSettingsStore } from "@/store/settings";

import { Priority, TaskStatus } from "@/types/task";

const DEFAULT_EVENT_COLOR = "#3b82f6";

interface CalendarEventContentProps {
  eventInfo: EventContentArg;
}

const priorityColors = {
  [Priority.ASAP]: "border-purple-600",
  [Priority.HIGH]: "border-red-500",
  [Priority.MEDIUM]: "border-orange-500",
  [Priority.LOW]: "border-blue-500",
  [Priority.NONE]: "border-gray-500",
};

export const CalendarEventContent = memo(function CalendarEventContent({
  eventInfo,
}: CalendarEventContentProps) {
  const { user: userSettings } = useSettingsStore();
  const isTask = eventInfo.event.extendedProps.isTask;
  const isRecurring = eventInfo.event.extendedProps.isRecurring;
  const status = eventInfo.event.extendedProps.status;
  const priority = eventInfo.event.extendedProps.priority;
  const location = eventInfo.event.extendedProps.location;
  const calendarName = eventInfo.event.extendedProps.calendarName;
  const dueDate = eventInfo.event.extendedProps?.extendedProps?.dueDate;
  const scheduleStatus =
    eventInfo.event.extendedProps?.extendedProps?.scheduleStatus;
  const scheduleIssue =
    eventInfo.event.extendedProps?.extendedProps?.scheduleIssue;
  const scheduleLocked =
    eventInfo.event.extendedProps?.extendedProps?.scheduleLocked;
  const badge = isTask ? scheduleStatusBadge(scheduleStatus) : null;
  const title = eventInfo.event.title;
  const endTime = eventInfo.event.end?.getTime() ?? 0;
  const startTime = eventInfo.event.start?.getTime() ?? 0;
  const duration = endTime - startTime;

  const isOverdue = isTask && isTaskOverdue({ dueDate, status });

  // Issue #95: surface the start time and calendar color for timed events in
  // month/multi-month views so they read as clearly as the colored all-day
  // events. Time-grid (day/week) views are unaffected.
  // Format the chip in the same time zone FullCalendar renders with (its
  // `local` sentinel today) so the chip time always matches the calendar's own
  // display, even if the browser's local zone differs from the configured one.
  const calendarTimeZone =
    (eventInfo.view.calendar.getOption("timeZone") as string | undefined) ??
    "local";
  const { isDayGridTimed, showTimeChip, timeText } = getMonthEventDisplay({
    viewType: eventInfo.view.type,
    allDay: eventInfo.event.allDay,
    isTask: !!isTask,
    start: eventInfo.event.start,
    isStart: eventInfo.isStart,
    timeFormat: userSettings.timeFormat,
    timeZone: calendarTimeZone,
  });
  const eventColor =
    eventInfo.event.backgroundColor ||
    eventInfo.event.borderColor ||
    DEFAULT_EVENT_COLOR;

  return (
    <div
      data-testid={isTask ? "calendar-task" : "calendar-event"}
      className={cn(
        "flex h-full flex-col justify-start gap-1 overflow-hidden text-[11px]",
        isTask && "border-l-4",
        isTask && "text-gray-700",
        isTask && priority && priorityColors[priority as Priority],
        isTask &&
          !priority && {
            "border-green-500": status === TaskStatus.COMPLETED,
            "border-yellow-500": status === TaskStatus.IN_PROGRESS,
            "border-gray-500": status === TaskStatus.TODO,
          },
        isOverdue && "border-red-500 font-medium text-red-600",
        badge?.tone === "red" && "border-red-500",
        badge?.tone === "amber" && "border-amber-500",
        status === TaskStatus.COMPLETED && "text-gray-500 line-through"
      )}
      title={
        badge && scheduleIssue ? `${badge.label}: ${scheduleIssue}` : undefined
      }
    >
      <div className="flex w-full items-center gap-1.5">
        {isTask ? (
          <IoCheckmarkCircle className="h-3.5 w-3.5 flex-shrink-0 text-current opacity-75" />
        ) : showTimeChip ? (
          isRecurring ? (
            <IoRepeat
              className="h-3.5 w-3.5 flex-shrink-0"
              style={{ color: eventColor }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="h-2 w-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: eventColor }}
            />
          )
        ) : isRecurring ? (
          <IoRepeat className="h-3.5 w-3.5 flex-shrink-0 text-current opacity-75" />
        ) : (
          <IoTimeOutline className="h-3.5 w-3.5 flex-shrink-0 text-current opacity-75" />
        )}
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "calendar-event-title font-medium leading-snug",
              duration <= 1800000 ? "truncate" : "line-clamp-2 break-words"
            )}
          >
            {isDayGridTimed && calendarName && (
              <span className="sr-only">{calendarName}, </span>
            )}
            {showTimeChip && timeText && (
              <span className="mr-1 font-normal tabular-nums opacity-75">
                {timeText}
              </span>
            )}
            {title}
          </div>
        </div>
        {isTask && scheduleLocked && (
          <IoLockClosed
            className="h-3 w-3 flex-shrink-0 opacity-75"
            aria-label="Locked"
          />
        )}
        {badge && (
          <span
            data-testid="schedule-badge"
            className={cn(
              "flex-shrink-0 rounded px-1 text-[9px] font-semibold uppercase leading-4 text-white",
              badge.tone === "red" ? "bg-red-600" : "bg-amber-500"
            )}
          >
            {badge.label}
          </span>
        )}
      </div>
      {location && duration > 1800000 && (
        <div className="event-location truncate pl-5 text-[10px] leading-snug opacity-80">
          {location}
        </div>
      )}
    </div>
  );
});
