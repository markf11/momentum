/**
 * Next.js instrumentation hook: runs once when a server process starts.
 * Starts Momentum's in-process background re-plans (D15) on the Node.js
 * runtime only, never during `next build`, jest, or when
 * MOMENTUM_DISABLE_BACKGROUND=1.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { backgroundReplansEnabled } = await import("./lib/background-replan");
  if (!backgroundReplansEnabled()) return;

  const { startBackgroundReplansRuntime } = await import(
    "./lib/background-replan-runtime"
  );
  startBackgroundReplansRuntime();
}
