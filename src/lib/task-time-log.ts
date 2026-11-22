import { NextRequest } from "next/server";

/**
 * D16e: logging the last minutes completes the task. Completion goes through
 * the regular task update route, so recurring tasks roll over and sync /
 * block-push side effects stay in one place.
 */
export function completionRequest(
  request: NextRequest,
  taskId: string
): NextRequest {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new NextRequest(new URL(`/api/tasks/${taskId}`, request.url), {
    method: "PUT",
    headers,
    body: JSON.stringify({ status: "completed", remainingMinutes: 0 }),
  });
}

/** Positive whole minutes from a request body, or null. */
export function parseMinutes(value: unknown): number | null {
  const minutes = typeof value === "string" ? Number(value) : value;
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
    ? Math.round(minutes)
    : null;
}
