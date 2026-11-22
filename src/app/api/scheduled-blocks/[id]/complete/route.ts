import { NextRequest, NextResponse } from "next/server";

import { PUT as updateTask } from "@/app/api/tasks/[id]/route";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { logMinutes } from "@/lib/remaining-time";
import { requestReplan } from "@/lib/replan-coordinator";
import { completionRequest } from "@/lib/task-time-log";

import { TaskStatus } from "@/types/task";

const LOG_SOURCE = "scheduled-block-complete-route";

/**
 * D16e "Done with this chunk": the chunk's minutes come off the task's
 * remaining time, the chunk is removed, and the rest re-plans.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const { id } = await params;

    const block = await prisma.scheduledBlock.findFirst({
      where: { id, userId: auth.userId },
      include: { task: true },
    });
    if (!block) {
      return NextResponse.json({ error: "Block not found" }, { status: 404 });
    }
    const { task } = block;
    if (task.status === TaskStatus.COMPLETED) {
      return NextResponse.json(
        { error: "Task is already completed" },
        { status: 409 }
      );
    }

    const minutes = Math.round(
      (block.end.getTime() - block.start.getTime()) / 60_000
    );
    const { remainingMinutes, completed } = logMinutes(task, minutes);

    if (completed) {
      await prisma.scheduledBlock.delete({ where: { id } });
      return updateTask(completionRequest(request, task.id), {
        params: Promise.resolve({ id: task.id }),
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.scheduledBlock.delete({ where: { id } });
      const rest = await tx.scheduledBlock.findMany({
        where: { taskId: task.id },
        orderBy: { start: "asc" },
      });
      // A locked task keeps its other locked chunks; with none left it
      // returns to auto-scheduling rather than re-locking the old slot.
      const lockedLeft = rest.some((b) => b.locked);
      return tx.task.update({
        where: { id: task.id },
        data: {
          remainingMinutes,
          scheduledStart: rest[0]?.start ?? null,
          scheduledEnd: rest[rest.length - 1]?.end ?? null,
          ...(task.scheduleLocked && !lockedLeft
            ? { scheduleLocked: false }
            : {}),
        },
        include: { tags: true, project: true },
      });
    });

    requestReplan(auth.userId);
    return NextResponse.json(updated);
  } catch (error) {
    logger.error(
      "Failed to complete scheduled block",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to complete scheduled block" },
      { status: 500 }
    );
  }
}
