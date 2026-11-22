import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { replanNow } from "@/lib/replan-coordinator";

const LOG_SOURCE = "task-schedule-route";

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;

    await replanNow(auth.userId);
    const tasks = await prisma.task.findMany({
      where: { userId: auth.userId },
      include: { tags: true, project: true },
    });
    return NextResponse.json(tasks);
  } catch (error) {
    logger.error(
      "Error scheduling tasks:",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to schedule tasks" },
      { status: 500 }
    );
  }
}
