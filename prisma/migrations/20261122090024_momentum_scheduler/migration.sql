-- AlterTable
ALTER TABLE "AutoScheduleSettings" ADD COLUMN     "breakAfterMinutes" INTEGER,
ADD COLUMN     "breakDurationMinutes" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "defaultMinChunkMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "workHours" TEXT NOT NULL DEFAULT '[null,{"start":"09:00","end":"17:00"},{"start":"09:00","end":"17:00"},{"start":"09:00","end":"17:00"},{"start":"09:00","end":"17:00"},{"start":"09:00","end":"17:00"},null]';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "hardDeadline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minChunkMinutes" INTEGER,
ADD COLUMN     "scheduleIssue" TEXT,
ADD COLUMN     "scheduleStatus" TEXT;

-- CreateTable
CREATE TABLE "ScheduledBlock" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "instanceStart" TIMESTAMP(3),
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledBlock_taskId_idx" ON "ScheduledBlock"("taskId");

-- CreateIndex
CREATE INDEX "ScheduledBlock_userId_start_end_idx" ON "ScheduledBlock"("userId", "start", "end");

-- CreateIndex
CREATE INDEX "ScheduledBlock_userId_locked_idx" ON "ScheduledBlock"("userId", "locked");

-- AddForeignKey
ALTER TABLE "ScheduledBlock" ADD CONSTRAINT "ScheduledBlock_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledBlock" ADD CONSTRAINT "ScheduledBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
