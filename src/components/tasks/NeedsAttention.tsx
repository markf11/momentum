import { HiExclamationCircle } from "react-icons/hi";

import { Button } from "@/components/ui/button";

import { format, newDate } from "@/lib/date-utils";
import {
  attentionRank,
  formatScheduleIssue,
  scheduleStatusBadge,
} from "@/lib/schedule-status";
import { cn } from "@/lib/utils";

import { useSettingsStore } from "@/store/settings";

import { Task, TaskStatus } from "@/types/task";

interface NeedsAttentionProps {
  tasks: Task[];
  onEdit: (task: Task) => void;
}

const FIX_HINT: Record<string, string> = {
  past_due:
    "Fix: push the deadline, shorten the task, or clear time before it.",
  cant_fit: "Fix: shorten the task, lower its minimum chunk, or clear time.",
  at_risk: "Fix: push the deadline, raise the priority, or clear time.",
};

/** D13: problem tasks surfaced at the top of the task list. */
export function NeedsAttention({ tasks, onEdit }: NeedsAttentionProps) {
  const timeZone = useSettingsStore((state) => state.user.timeZone);
  const flagged = tasks
    .filter(
      (task) =>
        task.status !== TaskStatus.COMPLETED &&
        scheduleStatusBadge(task.scheduleStatus) !== null
    )
    .sort(
      (a, b) =>
        attentionRank(a.scheduleStatus) - attentionRank(b.scheduleStatus) ||
        a.title.localeCompare(b.title)
    );

  if (flagged.length === 0) return null;

  return (
    <section
      data-testid="needs-attention"
      className="mb-4 rounded-lg border border-red-500/30 bg-background"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <HiExclamationCircle className="h-4 w-4 text-red-600" />
        <h2 className="text-sm font-semibold">Needs attention</h2>
        <span className="text-xs text-muted-foreground">{flagged.length}</span>
      </header>
      <ul className="divide-y divide-border">
        {flagged.map((task) => {
          const badge = scheduleStatusBadge(task.scheduleStatus)!;
          return (
            <li
              key={task.id}
              className="flex items-start gap-3 px-3 py-2"
              data-status={task.scheduleStatus}
            >
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                  badge.tone === "red"
                    ? "bg-red-500/15 text-red-700 dark:text-red-400"
                    : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                )}
              >
                {badge.label}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{task.title}</div>
                <div
                  className={cn(
                    "text-xs",
                    badge.tone === "red"
                      ? "text-red-700 dark:text-red-400"
                      : "text-amber-700 dark:text-amber-400"
                  )}
                >
                  {formatScheduleIssue(task.scheduleIssue, timeZone)}
                  {task.scheduledEnd && (
                    <span className="ml-1 text-muted-foreground">
                      (ETA {format(newDate(task.scheduledEnd), "MMM d, p")})
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {FIX_HINT[task.scheduleStatus ?? ""]}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0"
                onClick={() => onEdit(task)}
              >
                Edit
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
