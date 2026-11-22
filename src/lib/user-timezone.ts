import { prisma } from "@/lib/prisma";
import { safeTimeZone } from "@/lib/task-dates";

/** The user's configured IANA timezone (UserSettings.timeZone), or UTC. */
export async function getUserTimeZone(userId: string): Promise<string> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  return safeTimeZone(settings?.timeZone);
}
