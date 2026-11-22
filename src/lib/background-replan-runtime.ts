import { logger } from "@/lib/logger";
import { replanNow } from "@/lib/replan-coordinator";

import {
  BackgroundLogger,
  nightlyHour,
  startBackgroundReplans,
  tickIntervalMs,
} from "./background-replan";
import { prismaBackgroundStore } from "./background-replan-store";

const LOG_SOURCE = "BackgroundReplans";

// The DB logger defaults to level "none", so also print to stdout: the tick
// is otherwise invisible to someone self-hosting.
const backgroundLogger: BackgroundLogger = {
  info(message, meta) {
    console.info(
      `[momentum-background] ${message}`,
      JSON.stringify(meta ?? {})
    );
    void logger.info(
      message,
      { detail: JSON.stringify(meta ?? {}) },
      LOG_SOURCE
    );
  },
  error(message, meta) {
    console.error(
      `[momentum-background] ${message}`,
      JSON.stringify(meta ?? {})
    );
    void logger.error(
      message,
      { detail: JSON.stringify(meta ?? {}) },
      LOG_SOURCE
    );
  },
};

/** Wire the tick to Prisma and the shared re-plan coordinator. */
export function startBackgroundReplansRuntime(): void {
  const intervalMs = tickIntervalMs();
  const hour = nightlyHour();
  const { started } = startBackgroundReplans({
    store: prismaBackgroundStore,
    replan: (userId) => replanNow(userId),
    logger: backgroundLogger,
    intervalMs,
    nightlyHour: hour,
  });
  if (started) {
    backgroundLogger.info("Background re-plans started", {
      intervalMs,
      nightlyHour: hour,
      pid: process.pid,
    });
  }
}
