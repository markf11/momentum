"use client";

import { useDraggable } from "@dnd-kit/core";
import { HiClock, HiLockClosed, HiPencil, HiTrash } from "react-icons/hi";

import { format, newDate } from "@/lib/date-utils";
import { formatTaskDate } from "@/lib/task-dates";
import { cn } from "@/lib/utils";

import { useSettingsStore } from "@/store/settings";

import { Task, TimePreference } from "@/types/task";

interface BoardTaskProps {
  task: Task;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
}

const energyLevelColors = {
  high: "bg-red-500/20 text-red-700 dark:text-red-400",
  medium: "bg-orange-500/20 text-orange-700 dark:text-orange-400",
  low: "bg-green-500/20 text-green-700 dark:text-green-400",
};

const timePreferenceColors = {
  [TimePreference.MORNING]: "bg-sky-500/20 text-sky-700 dark:text-sky-400",
  [TimePreference.AFTERNOON]:
    "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  [TimePreference.EVENING]:
    "bg-indigo-500/20 text-indigo-700 dark:text-indigo-400",
};

// Helper function to format enum values for display
const formatEnumValue = (value: string) => {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

export function BoardTask({ task, onEdit, onDelete }: BoardTaskProps) {
  const timeZone = useSettingsStore((state) => state.user.timeZone);
  const due = task.dueDate ? formatTaskDate(task.dueDate, timeZone) : null;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: task.id,
      data: {
        type: "task",
        task,
      },
    });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div className="group relative">
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        style={style}
        className={cn(
          "cursor-grab rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
          isDragging && "opacity-50"
        )}
      >
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <div className="flex items-center gap-2">
              {task.isAutoScheduled && (
                <div
                  className="flex items-center gap-1 text-primary"
                  title="Auto-scheduled"
                >
                  <HiClock className="h-4 w-4" />
                  {task.scheduleLocked && (
                    <HiLockClosed className="h-3 w-3" title="Schedule locked" />
                  )}
                </div>
              )}
              <h3 className="task-title text-sm font-medium">{task.title}</h3>
            </div>
          </div>

          {task.description && (
            <p className="task-description line-clamp-2 text-xs text-muted-foreground">
              {task.description}
            </p>
          )}

          {task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-xs"
                  style={{
                    backgroundColor: `${tag.color}20` || "var(--muted)",
                    color: tag.color || "var(--muted-foreground)",
                  }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {task.energyLevel && (
              <span
                className={cn(
                  "rounded-full px-2 py-1",
                  energyLevelColors[task.energyLevel]
                )}
              >
                {formatEnumValue(task.energyLevel)}
              </span>
            )}

            {task.preferredTime && (
              <span
                className={cn(
                  "rounded-full px-2 py-1",
                  timePreferenceColors[task.preferredTime]
                )}
              >
                {formatEnumValue(task.preferredTime)}
              </span>
            )}

            {task.duration && (
              <span className="text-muted-foreground">{task.duration}m</span>
            )}

            {due && (
              <span
                className={cn(
                  due.isOverdue ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {due.text}
              </span>
            )}

            {task.project && (
              <div className="flex items-center gap-1">
                <div
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: task.project.color || "var(--muted)",
                  }}
                />
                <span className="text-muted-foreground">
                  {task.project.name}
                </span>
              </div>
            )}

            {task.isAutoScheduled &&
              task.scheduledStart &&
              task.scheduledEnd && (
                <span className="text-primary">
                  {format(newDate(task.scheduledStart), "p")} -{" "}
                  {format(newDate(task.scheduledEnd), "p")}
                  {task.scheduleScore && (
                    <span className="ml-1 text-primary/70">
                      ({Math.round(task.scheduleScore * 100)}%)
                    </span>
                  )}
                </span>
              )}
          </div>
        </div>
      </div>
      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onEdit(task)}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-primary"
          title="Edit task"
        >
          <HiPencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
          title="Delete task"
        >
          <HiTrash className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
