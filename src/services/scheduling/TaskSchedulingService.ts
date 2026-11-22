import { Prisma } from "@prisma/client";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { remainingOf } from "@/lib/remaining-time";
import {
  ScheduleStatus,
  SchedulerBlock,
  SchedulerPriority,
  SchedulerTask,
  TaskScheduleResult,
  WorkWeek,
  scheduleTasks,
} from "@/lib/scheduler";
import { minutesBeforeDeadline } from "@/lib/scheduler/fit";

import { ProjectStatus } from "@/types/project";
import {
  EnergyLevel,
  Priority,
  TaskStatus,
  TaskWithRelations,
  TimePreference,
} from "@/types/task";

import { toBusyEvents } from "./busy-events";
import { filterEventsBySelectedCalendars } from "./calendar-selection";

const LOG_SOURCE = "TaskSchedulingService";
const STATUS_SEVERITY: Record<ScheduleStatus, number> = {
  unscheduled: 0,
  on_time: 1,
  locked: 2,
  at_risk: 3,
  past_due: 4,
  cant_fit: 5,
};

type DbTask = Prisma.TaskGetPayload<{
  include: { tags: true; project: true };
}>;
type DbSettings = Prisma.AutoScheduleSettingsGetPayload<object>;

function convertDbTask(task: DbTask): TaskWithRelations {
  return {
    ...task,
    status: task.status as TaskStatus,
    priority: task.priority as Priority | null,
    scheduleStatus: task.scheduleStatus as TaskWithRelations["scheduleStatus"],
    energyLevel: task.energyLevel as EnergyLevel | null,
    preferredTime: task.preferredTime as TimePreference | null,
    tags: task.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      color: tag.color || undefined,
    })),
    project: task.project
      ? { ...task.project, status: task.project.status as ProjectStatus }
      : null,
  };
}

function parseWorkWeek(settings: DbSettings): WorkWeek {
  try {
    const parsed = JSON.parse(settings.workHours) as WorkWeek;
    if (parsed.length === 7) return parsed;
  } catch {
    // Fall through to the legacy whole-hour settings.
  }

  let workDays: number[] = [];
  try {
    workDays = JSON.parse(settings.workDays) as number[];
  } catch {
    workDays = [];
  }
  const start = `${settings.workHourStart.toString().padStart(2, "0")}:00`;
  const end = `${settings.workHourEnd.toString().padStart(2, "0")}:00`;
  return Array.from({ length: 7 }, (_, day) =>
    workDays.includes(day) ? { start, end } : null
  );
}

function schedulerPriority(value: string | null): SchedulerPriority {
  return value === "asap" ||
    value === "high" ||
    value === "medium" ||
    value === "low"
    ? value
    : "none";
}

function aggregateStatus(results: TaskScheduleResult[]): ScheduleStatus {
  return results.reduce<ScheduleStatus>(
    (status, result) =>
      STATUS_SEVERITY[result.status] > STATUS_SEVERITY[status]
        ? result.status
        : status,
    "unscheduled"
  );
}

/** Load once, plan once, and persist the complete plan in one transaction. */
export async function scheduleAllTasksForUser(
  userId: string
): Promise<TaskWithRelations[]> {
  try {
    const now = new Date();
    const settings = await prisma.autoScheduleSettings.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        workDays: JSON.stringify([1, 2, 3, 4, 5]),
        workHourStart: 9,
        workHourEnd: 17,
      },
    });

    const [userSettings, tasks, existingBlocks, candidateEvents, feeds] =
      await Promise.all([
        prisma.userSettings.findUnique({ where: { userId } }),
        prisma.task.findMany({
          where: { userId, status: { not: TaskStatus.COMPLETED } },
          include: { tags: true, project: true },
        }),
        prisma.scheduledBlock.findMany({ where: { userId } }),
        prisma.calendarEvent.findMany({
          where: { feed: { userId, type: "LOCAL" } },
        }),
        prisma.calendarFeed.findMany({
          where: { userId },
          select: { id: true },
        }),
      ]);
    // "Calendars to consider": filtered here, before the engine sees them.
    const busyEvents = filterEventsBySelectedCalendars(
      candidateEvents,
      settings.selectedCalendars,
      feeds.map((feed) => feed.id)
    );

    const blocksByTask = new Map<string, typeof existingBlocks>();
    for (const block of existingBlocks) {
      const blocks = blocksByTask.get(block.taskId) ?? [];
      blocks.push(block);
      blocksByTask.set(block.taskId, blocks);
    }

    const engineTasks: SchedulerTask[] = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      durationMinutes: task.duration,
      remainingMinutes: task.duration === null ? null : remainingOf(task),
      priority: schedulerPriority(task.priority),
      dueDate: task.dueDate,
      hardDeadline: task.hardDeadline,
      startDate: task.startDate,
      minChunkMinutes: task.minChunkMinutes,
      autoSchedule: task.isAutoScheduled,
      locked: task.scheduleLocked,
      scheduledStart: task.scheduledStart,
      scheduledEnd: task.scheduledEnd,
      recurrenceRule: task.isRecurring ? task.recurrenceRule : null,
      lockedBlocks: (blocksByTask.get(task.id) ?? []).map((block) => ({
        taskId: block.taskId,
        start: block.start,
        end: block.end,
        chunkIndex: block.chunkIndex,
        instanceStart: block.instanceStart,
        locked: block.locked,
        status: block.status as ScheduleStatus,
      })),
    }));

    const output = scheduleTasks({
      tasks: engineTasks,
      busyEvents: toBusyEvents(busyEvents),
      settings: {
        workWeek: parseWorkWeek(settings),
        defaultMinChunkMinutes: settings.defaultMinChunkMinutes,
        breakRule: settings.breakAfterMinutes
          ? {
              afterMinutes: settings.breakAfterMinutes,
              durationMinutes: settings.breakDurationMinutes,
            }
          : null,
      },
      now,
      timeZone: userSettings?.timeZone || "UTC",
      horizonDays: 31,
    });

    const resultsByTask = new Map<string, TaskScheduleResult[]>();
    const blocksByTaskResult = new Map<string, SchedulerBlock[]>();
    for (const result of output.tasks) {
      const results = resultsByTask.get(result.taskId) ?? [];
      results.push(result);
      resultsByTask.set(result.taskId, results);
    }
    for (const block of output.blocks) {
      const blocks = blocksByTaskResult.get(block.taskId) ?? [];
      blocks.push(block);
      blocksByTaskResult.set(block.taskId, blocks);
    }

    // Existing future locks are already in the database and must not be
    // deleted or inserted twice. Legacy/synthetic locks are inserted below.
    // Only tasks the engine kept locked: it rounds "now" up to the minute, so a
    // lock ending within the current minute has already expired there and
    // must not be preserved here either.
    const engineLockedTaskIds = new Set(
      output.tasks
        .filter((result) => result.status === "locked")
        .map((result) => result.taskId)
    );
    const preservedLockedTaskIds = new Set(
      tasks
        .filter(
          (task) =>
            task.scheduleLocked &&
            engineLockedTaskIds.has(task.id) &&
            (blocksByTask.get(task.id) ?? []).some(
              (block) => block.locked && block.end.getTime() > now.getTime()
            )
        )
        .map((task) => task.id)
    );
    const preservedIds = [...preservedLockedTaskIds];
    const blocksToInsert = output.blocks.filter(
      (block) => !block.locked || !preservedLockedTaskIds.has(block.taskId)
    );

    await prisma.$transaction(
      async (tx) => {
        await tx.scheduledBlock.deleteMany({
          where: {
            userId,
            ...(preservedIds.length
              ? {
                  OR: [{ locked: false }, { taskId: { notIn: preservedIds } }],
                }
              : {}),
          },
        });
        if (blocksToInsert.length) {
          await tx.scheduledBlock.createMany({
            data: blocksToInsert.map((block) => ({
              taskId: block.taskId,
              userId,
              start: block.start,
              end: block.end,
              chunkIndex: block.chunkIndex,
              instanceStart: block.instanceStart,
              locked: block.locked,
              status: block.status,
            })),
          });
        }

        await Promise.all(
          tasks.map((task) => {
            const results = resultsByTask.get(task.id) ?? [];
            const blocks = (blocksByTaskResult.get(task.id) ?? []).sort(
              (a, b) => a.start.getTime() - b.start.getTime()
            );
            const aggregatedStatus = results.length
              ? aggregateStatus(results)
              : null;
            const expiredLock =
              task.scheduleLocked &&
              !output.tasks.some(
                (result) =>
                  result.taskId === task.id && result.status === "locked"
              );
            return tx.task.update({
              where: { id: task.id },
              data: {
                scheduledStart: blocks[0]?.start ?? null,
                scheduledEnd: blocks[blocks.length - 1]?.end ?? null,
                scheduleStatus: aggregatedStatus,
                scheduleIssue:
                  results.find((result) => result.issue)?.issue ?? null,
                // Recurring tasks have per-occurrence deadlines; skip them.
                scheduleFitMinutes:
                  !task.isRecurring &&
                  (aggregatedStatus === "past_due" ||
                    aggregatedStatus === "at_risk")
                    ? minutesBeforeDeadline(blocks, task.dueDate)
                    : null,
                scheduleScore: null,
                scheduleLocked: expiredLock ? false : task.scheduleLocked,
                lastScheduled: now,
                blockDirty: task.blockEventId ? true : task.blockDirty,
              },
            });
          })
        );
      },
      { timeout: 15_000 }
    );

    const updatedTasks = await prisma.task.findMany({
      where: { userId },
      include: { tags: true, project: true },
    });
    logger.info(
      "Momentum scheduling completed",
      {
        userId,
        tasks: tasks.length,
        blocks: output.blocks.length,
        issues: output.issues.length,
      },
      LOG_SOURCE
    );
    return updatedTasks.map(convertDbTask);
  } catch (error) {
    logger.error(
      "Error scheduling tasks",
      {
        error: error instanceof Error ? error.message : String(error),
        userId,
      },
      LOG_SOURCE
    );
    throw error;
  }
}
