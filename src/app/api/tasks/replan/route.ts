import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { replanAndWait } from "@/lib/replan-coordinator";

const LOG_SOURCE = "task-replan-route";

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    await replanAndWait(auth.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(
      "Error re-planning tasks:",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to re-plan tasks" },
      { status: 500 }
    );
  }
}
