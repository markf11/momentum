import { ChangeType } from "@/lib/task-sync/task-change-tracker";

import { Project } from "./project";

export enum TaskStatus {
  TODO = "todo",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
}

export enum EnergyLevel {
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
}

export enum Priority {
  ASAP = "asap",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  NONE = "none",
}

export enum TimePreference {
  MORNING = "morning",
  AFTERNOON = "afternoon",
  EVENING = "evening",
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  dueDate?: Date | null;
  startDate?: Date | null;
  duration?: number | null;
  /** D16e: work still to do; null = the full duration. */
  remainingMinutes?: number | null;
  priority?: Priority | null;
  energyLevel?: EnergyLevel | null;
  preferredTime?: TimePreference | null;
  tags: Tag[];
  projectId?: string | null;
  project?: Project | null;
  createdAt: Date;
  updatedAt: Date;
  recurrenceRule?: string | null;
  lastCompletedDate?: Date | null;
  completedAt?: Date | null;
  isRecurring: boolean;
  // Auto-scheduling fields
  isAutoScheduled: boolean;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  scheduleScore?: number | null;
  lastScheduled?: Date | null;
  scheduleLocked: boolean;
  postponedUntil?: Date | null;
  // Momentum scheduling fields
  minChunkMinutes?: number | null;
  hardDeadline?: boolean;
  scheduleStatus?: ScheduleStatus | null;
  scheduleIssue?: string | null;
  /** Minutes of the remaining work the last plan fits before the due date. */
  scheduleFitMinutes?: number | null;
  // External sync fields
  externalTaskId?: string | null;
  source?: string | null;
  externalListId?: string | null;
  lastSyncedAt?: Date | null;
}

export type ScheduleStatus =
  | "on_time"
  | "at_risk"
  | "past_due"
  | "cant_fit"
  | "locked"
  | "unscheduled";

/** One persisted chunk of a task, as returned by /api/scheduled-blocks. */
export interface ScheduledBlock {
  id: string;
  taskId: string;
  start: string | Date;
  end: string | Date;
  chunkIndex: number;
  instanceStart?: string | Date | null;
  locked: boolean;
  status: ScheduleStatus;
}

export interface NewTask
  extends Omit<Task, "id" | "createdAt" | "updatedAt" | "tags" | "project"> {
  tagIds?: string[];
  isAutoScheduled: boolean;
  scheduleLocked: boolean;
}

export interface UpdateTask
  extends Partial<
    Omit<Task, "id" | "createdAt" | "updatedAt" | "tags" | "project">
  > {
  tagIds?: string[];
}

export type NewTag = Omit<Tag, "id">;

export interface TaskFilters {
  status?: TaskStatus[];
  tagIds?: string[];
  dateRange?: {
    start: Date;
    end: Date;
  };
  startDate?: Date | null;
  hideUpcomingTasks?: boolean;
  priority?: Priority[];
  energyLevel?: EnergyLevel[];
  timePreference?: TimePreference[];
  search?: string;
  projectId?: string;
}

/**
 * Task with its related entities
 */
export interface TaskWithRelations extends Task {
  tags: Tag[];
  project: Project | null;
}

export interface TaskChange {
  id: string;
  taskId: string;
  changeType: ChangeType;
  changeData: Record<string, unknown>;
}
