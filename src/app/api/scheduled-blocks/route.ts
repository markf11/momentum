import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const LOG_SOURCE = "scheduled-blocks-route";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;

    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");
    const blocks = await prisma.scheduledBlock.findMany({
      where: {
        userId: auth.userId,
        ...(start || end
          ? {
              AND: [
                ...(start ? [{ end: { gt: new Date(start) } }] : []),
                ...(end ? [{ start: { lt: new Date(end) } }] : []),
              ],
            }
          : {}),
      },
      orderBy: [{ start: "asc" }, { taskId: "asc" }, { chunkIndex: "asc" }],
    });
    return NextResponse.json(blocks);
  } catch (error) {
    logger.error(
      "Failed to fetch scheduled blocks",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to fetch scheduled blocks" },
      { status: 500 }
    );
  }
}
