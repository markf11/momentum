-- D16e partial completion: persisted remaining work per task.
ALTER TABLE "Task" ADD COLUMN "remainingMinutes" INTEGER;

-- Existing tasks have done no tracked work yet: remaining = duration.
UPDATE "Task" SET "remainingMinutes" = "duration" WHERE "duration" IS NOT NULL;
