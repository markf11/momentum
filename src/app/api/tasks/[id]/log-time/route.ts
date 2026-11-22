import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { logMinutes } from "@/lib/remaining-time";
import { requestReplan } from "@/lib/replan-coordinator";
import { completionRequest, parseMinutes } from "@/lib/task-time-log";

import { TaskStatus } from "@/types/task";

import { PUT as updateTask } from "../route";

const LOG_SOURCE = "task-log-time-route";

/** D16e: subtract worked minutes from the task's remaining time. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as {
      minutes?: unknown;
    };
    const minutes = parseMinutes(body.minutes);
    if (minutes === null) {
      return NextResponse.json(
        { error: "minutes must be a positive number" },
        { status: 400 }
      );
    }

    const task = await prisma.task.findFirst({
      where: { id, userId: auth.userId },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.status === TaskStatus.COMPLETED) {
      return NextResponse.json(
        { error: "Task is already completed" },
        { status: 409 }
      );
    }

    const { remainingMinutes, completed } = logMinutes(task, minutes);
    if (completed) {
      return updateTask(completionRequest(request, id), { params });
    }

    const updated = await prisma.task.update({
      where: { id },
      data: { remainingMinutes },
      include: { tags: true, project: true },
    });
    requestReplan(auth.userId);
    return NextResponse.json(updated);
  } catch (error) {
    logger.error(
      "Failed to log task time",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to log task time" },
      { status: 500 }
    );
  }
}
