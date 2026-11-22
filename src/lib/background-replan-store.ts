import { prisma } from "@/lib/prisma";

import { TaskStatus } from "@/types/task";

import type { BackgroundStore } from "./background-replan";

/** Prisma-backed store for the background re-plan tick. */
export const prismaBackgroundStore: BackgroundStore = {
  async findLockedTasks() {
    const tasks = await prisma.task.findMany({
      where: {
        scheduleLocked: true,
        status: { not: TaskStatus.COMPLETED },
        userId: { not: null },
      },
      select: {
        id: true,
        userId: true,
        scheduledEnd: true,
        scheduledBlocks: { where: { locked: true }, select: { end: true } },
      },
    });
    return tasks.map((task) => ({
      taskId: task.id,
      userId: task.userId as string,
      scheduledEnd: task.scheduledEnd,
      lockedBlockEnds: task.scheduledBlocks.map((block) => block.end),
    }));
  },

  async unlockTasks(taskIds) {
    if (!taskIds.length) return;
    await prisma.$transaction([
      prisma.scheduledBlock.deleteMany({
        where: { taskId: { in: taskIds }, locked: true },
      }),
      prisma.task.updateMany({
        where: { id: { in: taskIds } },
        data: { scheduleLocked: false },
      }),
    ]);
  },

  async findUsersNeedingReplan(now) {
    const [elapsedBlocks, overdueOnTime] = await Promise.all([
      prisma.scheduledBlock.findMany({
        where: {
          locked: false,
          end: { lte: now },
          task: { status: { not: TaskStatus.COMPLETED } },
        },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.task.findMany({
        where: {
          userId: { not: null },
          isAutoScheduled: true,
          status: { not: TaskStatus.COMPLETED },
          dueDate: { lte: now },
          scheduleStatus: "on_time",
        },
        select: { userId: true },
        distinct: ["userId"],
      }),
    ]);
    return [
      ...new Set([
        ...elapsedBlocks.map((block) => block.userId),
        ...overdueOnTime.map((task) => task.userId as string),
      ]),
    ];
  },

  async listUsers() {
    const users = await prisma.user.findMany({
      select: { id: true, userSettings: { select: { timeZone: true } } },
    });
    return users.map((user) => ({
      userId: user.id,
      timeZone: user.userSettings?.timeZone ?? null,
    }));
  },
};
