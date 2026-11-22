import { NextRequest, NextResponse } from "next/server";

import { Task } from "@prisma/client";
import { RRule } from "rrule";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { newDate } from "@/lib/date-utils";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { remainingOf, resolveRemainingUpdate } from "@/lib/remaining-time";
import { requestReplan } from "@/lib/replan-coordinator";
import {
  deleteTaskBlockEvent,
  schedulePushTaskBlock,
} from "@/lib/task-block-push";
import { InvalidTaskDateError, resolveTaskDateFields } from "@/lib/task-dates";
import {
  ChangeType,
  TaskChangeTracker,
} from "@/lib/task-sync/task-change-tracker";
import { getUserTimeZone } from "@/lib/user-timezone";
import { normalizeRecurrenceRule } from "@/lib/utils/normalize-recurrence-rules";

import { TaskStatus } from "@/types/task";

const LOG_SOURCE = "task-route";
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const { id } = await params;
    const task = await prisma.task.findUnique({
      where: {
        id,
        // Ensure the task belongs to the current user
        userId,
      },
      include: {
        tags: true,
        project: true,
      },
    });

    if (!task) {
      return new NextResponse("Task not found", { status: 404 });
    }

    return NextResponse.json(task);
  } catch (error) {
    logger.error(
      "Error fetching task:",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const { id } = await params;
    logger.info(`Updating task ${id}`, { userId }, LOG_SOURCE);

    const task = await prisma.task.findUnique({
      where: {
        id,
        // Ensure the task belongs to the current user
        userId,
      },
      include: {
        tags: true,
      },
    });

    if (!task) {
      logger.warn(`Task not found: ${id}`, { userId }, LOG_SOURCE);
      return new NextResponse("Task not found", { status: 404 });
    }

    const json = await request.json();
    logger.info(`Update payload for task ${id}`, { payload: json }, LOG_SOURCE);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tagIds, project, projectId, userId: _, ...rawUpdates } = json;

    // Date-only due dates mean end of that day in the user's timezone.
    let updates: typeof rawUpdates;
    try {
      updates = resolveTaskDateFields(
        rawUpdates,
        await getUserTimeZone(userId)
      );
    } catch (error) {
      if (error instanceof InvalidTaskDateError) {
        return new NextResponse(error.message, { status: 400 });
      }
      throw error;
    }

    // D16e remaining time: a duration edit keeps the worked minutes, and a
    // task with nothing left is done. Reopening a finished task restores it.
    const reopening =
      task.status === TaskStatus.COMPLETED &&
      updates.status !== undefined &&
      updates.status !== TaskStatus.COMPLETED;
    const remaining = resolveRemainingUpdate(task, updates);
    if (reopening && (remaining ?? remainingOf(task)) === 0) {
      updates.remainingMinutes = updates.duration ?? task.duration;
    } else if (remaining !== undefined) {
      updates.remainingMinutes = remaining;
      if (
        remaining === 0 &&
        (updates.duration ?? task.duration ?? 0) > 0 &&
        task.status !== TaskStatus.COMPLETED
      ) {
        updates.status = TaskStatus.COMPLETED;
      }
    }

    // Set completedAt when task is marked as completed
    if (
      updates.status === TaskStatus.COMPLETED &&
      task.status !== TaskStatus.COMPLETED
    ) {
      updates.completedAt = newDate();
    }

    // Handle recurring task completion
    if (
      task.isRecurring &&
      updates.status === TaskStatus.COMPLETED &&
      task.recurrenceRule
    ) {
      try {
        // Normalize the recurrence rule to ensure compatibility with RRule
        const standardRecurrenceRule = normalizeRecurrenceRule(
          task.recurrenceRule
        );

        const rrule = RRule.fromString(standardRecurrenceRule!);

        // For tasks, we only care about the date part
        const baseDate = newDate(task.dueDate || newDate());
        // Set to start of day in UTC
        baseDate.setUTCHours(0, 0, 0, 0);

        // Add one day to the base date to ensure we get the next occurrence
        const searchDate = newDate(baseDate);
        searchDate.setDate(searchDate.getDate() + 1);

        // Get next occurrence and ensure it's just a date
        const nextOccurrence = rrule.after(searchDate);
        if (nextOccurrence) {
          nextOccurrence.setUTCHours(0, 0, 0, 0);
        }

        if (nextOccurrence) {
          // Calculate the time delta between start date and due date (if both exist)
          let nextStartDate = undefined;
          if (task.startDate && task.dueDate) {
            // Calculate the number of days between the original start and due dates
            const startToDueDelta = Math.round(
              (task.dueDate.getTime() - task.startDate.getTime()) /
                (1000 * 60 * 60 * 24)
            );

            // Apply the same delta to the new due date to get the new start date
            const newStartDate = new Date(nextOccurrence);
            newStartDate.setDate(newStartDate.getDate() - startToDueDelta);
            nextStartDate = newStartDate;

            logger.info(
              "Calculated new start date for recurring task",
              {
                taskId: task.id,
                originalStartDate: task.startDate?.toISOString(),
                originalDueDate: task.dueDate?.toISOString(),
                deltaInDays: startToDueDelta,
                newDueDate: nextOccurrence.toISOString(),
                newStartDate: nextStartDate.toISOString(),
              },
              LOG_SOURCE
            );
          }

          // Create a completed instance as a separate task
          await prisma.task.create({
            data: {
              title: task.title,
              description: task.description,
              status: TaskStatus.COMPLETED,
              dueDate: baseDate, // Use the original due date for the completed instance
              startDate: task.startDate, // Use the original start date for the completed instance
              duration: task.duration,
              priority: task.priority,
              energyLevel: task.energyLevel,
              preferredTime: task.preferredTime,
              projectId: task.projectId,
              isRecurring: false,
              completedAt: newDate(), // Set completedAt for the completed instance
              // Associate the task with the current user
              userId,
              tags: {
                connect: task.tags.map((tag) => ({ id: tag.id })),
              },
            },
          });

          // Update the recurring task with new due date and reset status
          updates.dueDate = nextOccurrence;
          updates.startDate = nextStartDate; // Update the start date if calculated
          updates.status = TaskStatus.TODO;
          updates.remainingMinutes = updates.duration ?? task.duration;
          updates.lastCompletedDate = newDate();
        }
      } catch (error) {
        logger.error(
          "Error handling task completion:",
          {
            error: error instanceof Error ? error.message : String(error),
          },
          LOG_SOURCE
        );
        return new NextResponse("Error handling task completion", {
          status: 500,
        });
      }
    }

    // Normalize recurrence rule if it exists in updates
    if (updates.recurrenceRule) {
      updates.recurrenceRule = normalizeRecurrenceRule(updates.recurrenceRule);
    }

    // Find the project's task mapping if it exists
    let mappingId = null;
    const targetProjectId = projectId || task.projectId;

    if (targetProjectId) {
      const mapping = await prisma.taskListMapping.findFirst({
        where: {
          projectId: targetProjectId,
        },
      });
      if (mapping) {
        mappingId = mapping.id;
      }
    }

    // Save the old task for change tracking
    const oldTask = { ...task };

    const updatedTask = await prisma.task.update({
      where: {
        id: id,
        // Ensure the task belongs to the current user
        userId,
      },
      data: {
        ...updates,
        ...(tagIds && {
          tags: {
            set: [], // First disconnect all tags
            connect: tagIds.map((id: string) => ({ id })), // Then connect new ones
          },
        }),
        project:
          projectId === null
            ? { disconnect: true }
            : projectId
              ? { connect: { id: projectId } }
              : undefined,
      },
      include: {
        tags: true,
        project: true,
      },
    });

    // Track the update for sync purposes if the task is in a mapped project
    if (mappingId) {
      const changeTracker = new TaskChangeTracker();
      const changes = changeTracker.compareTaskObjects(
        oldTask,
        updatedTask as Partial<Task>
      );

      await changeTracker.trackChange(
        task.id,
        "UPDATE" as ChangeType,
        userId,
        changes,
        undefined, // providerId will be set during sync
        mappingId
      );

      logger.info(
        `Tracked UPDATE change for task ${task.id} in mapping ${mappingId}`,
        {
          taskId: task.id,
          mappingId,
          changes: Object.keys(changes),
        },
        LOG_SOURCE
      );
    }

    // Full-object saves (inline edits) echo the current scheduled times back,
    // so only a real change of times counts as a manual move.
    const movedTo =
      updates.scheduledStart && updates.scheduledEnd
        ? {
            start: new Date(updates.scheduledStart),
            end: new Date(updates.scheduledEnd),
          }
        : null;
    const timesChanged =
      movedTo !== null &&
      (movedTo.start.getTime() !== task.scheduledStart?.getTime() ||
        movedTo.end.getTime() !== task.scheduledEnd?.getTime());
    if (
      movedTo &&
      timesChanged &&
      updatedTask.scheduleLocked &&
      movedTo.end.getTime() > movedTo.start.getTime()
    ) {
      // A manual move pins the whole task to the new slot (D7): replace any
      // engine-placed chunks with one locked block, so the next re-plan
      // keeps it here instead of restoring the old chunk times.
      await prisma.$transaction([
        prisma.scheduledBlock.deleteMany({ where: { taskId: id, userId } }),
        prisma.scheduledBlock.create({
          data: {
            taskId: id,
            userId,
            start: movedTo.start,
            end: movedTo.end,
            chunkIndex: 0,
            locked: true,
            status: "locked",
          },
        }),
      ]);
    } else if (updates.scheduleLocked !== undefined) {
      await prisma.scheduledBlock.updateMany({
        where: { taskId: id, userId },
        data: {
          locked: updates.scheduleLocked,
          ...(updates.scheduleLocked ? { status: "locked" } : {}),
        },
      });
    }

    // Schedule calendar block push for any changes to scheduled times or status
    schedulePushTaskBlock(userId, id);
    requestReplan(userId);

    return NextResponse.json(updatedTask);
  } catch (error) {
    logger.error(
      "Error updating task:",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }

    const userId = auth.userId;

    const { id } = await params;
    const task = await prisma.task.findUnique({
      where: {
        id,
        // Ensure the task belongs to the current user
        userId,
      },
      include: {
        project: true,
      },
    });

    if (!task) {
      return new NextResponse("Task not found", { status: 404 });
    }

    // Check if the task belongs to a mapped project
    let mappingId = null;
    if (task.projectId) {
      const mapping = await prisma.taskListMapping.findFirst({
        where: {
          projectId: task.projectId,
        },
      });
      if (mapping) {
        mappingId = mapping.id;
      }
    }

    // Track the deletion for sync purposes if the task was in a mapped project
    // and had an external ID BEFORE actually deleting the task
    if (mappingId && task.externalTaskId && task.source) {
      const changeTracker = new TaskChangeTracker();
      await changeTracker.trackChange(
        id,
        "DELETE" as ChangeType,
        userId,
        {
          externalTaskId: task.externalTaskId,
          source: task.source,
          externalListId: task.externalListId,
          projectId: task.projectId,
          title: task.title,
        },
        undefined, // providerId will be set during sync
        mappingId
      );

      logger.info(
        `Tracked DELETE change for task ${id} in mapping ${mappingId}`,
        {
          taskId: id,
          mappingId,
          externalTaskId: task.externalTaskId,
          title: task.title,
        },
        LOG_SOURCE
      );
    }

    // Delete the calendar event if it exists BEFORE deleting the task
    if (task.blockEventId && task.blockFeedId) {
      await deleteTaskBlockEvent(userId, task.blockEventId, task.blockFeedId);
    }

    // Now delete the task AFTER tracking the change and deleting calendar event
    await prisma.task.delete({
      where: {
        id,
        // Ensure the task belongs to the current user
        userId,
      },
    });

    requestReplan(userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logger.error(
      "Error deleting task:",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
