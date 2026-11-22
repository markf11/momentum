import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { remainingAfterDurationChange } from "@/lib/remaining-time";
import { requestReplan } from "@/lib/replan-coordinator";

const LOG_SOURCE = "scheduled-block-route";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const { id } = await params;
    const existing = await prisma.scheduledBlock.findFirst({
      where: { id, userId: auth.userId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Block not found" }, { status: 404 });
    }

    const body = (await request.json()) as {
      start?: string;
      end?: string;
      resize?: boolean;
    };
    const start = body.start ? new Date(body.start) : existing.start;
    const end = body.end ? new Date(body.end) : existing.end;
    if (
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime()) ||
      end <= start
    ) {
      return NextResponse.json(
        { error: "A valid start and end are required" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.scheduledBlock.update({
        where: { id },
        data: { start, end, locked: true, status: "locked" },
      });
      await tx.scheduledBlock.updateMany({
        where: { taskId: existing.taskId, id: { not: id } },
        data: { locked: true, status: "locked" },
      });
      const blocks = await tx.scheduledBlock.findMany({
        where: { taskId: existing.taskId },
        orderBy: { start: "asc" },
      });
      const duration = body.resize
        ? Math.round(
            blocks.reduce(
              (sum, block) => sum + block.end.getTime() - block.start.getTime(),
              0
            ) / 60_000
          )
        : undefined;
      const stored =
        duration !== undefined
          ? await tx.task.findUnique({ where: { id: existing.taskId } })
          : null;
      const task = await tx.task.update({
        where: { id: existing.taskId },
        data: {
          scheduledStart: blocks[0].start,
          scheduledEnd: blocks[blocks.length - 1].end,
          scheduleLocked: true,
          isAutoScheduled: true,
          scheduleStatus: "locked",
          scheduleIssue: null,
          ...(duration !== undefined
            ? {
                duration,
                remainingMinutes: stored
                  ? remainingAfterDurationChange(stored, duration)
                  : duration,
              }
            : {}),
        },
      });
      return { blocks, task };
    });

    requestReplan(auth.userId);
    return NextResponse.json(result);
  } catch (error) {
    logger.error(
      "Failed to move scheduled block",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to move scheduled block" },
      { status: 500 }
    );
  }
}
