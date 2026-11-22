import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { formatMinutes, remainingOf } from "@/lib/remaining-time";
import {
  ScheduleFixKind,
  fitMinutes,
  fixUpdates,
  scheduleFixes,
} from "@/lib/schedule-fixes";
import { cn } from "@/lib/utils";

import { useSettingsStore } from "@/store/settings";
import { useTaskStore } from "@/store/task";

import { Task } from "@/types/task";

interface MinutesPromptProps {
  label: string;
  submitLabel: string;
  onSubmit: (minutes: number) => void;
  testId?: string;
  defaultValue?: number;
  max?: number;
  className?: string;
}

/** A small button that expands into an inline "N minutes" field. */
export function MinutesPrompt({
  label,
  submitLabel,
  onSubmit,
  testId,
  defaultValue,
  max,
  className,
}: MinutesPromptProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue?.toString() ?? "");
  const minutes = parseInt(value, 10);
  const valid = minutes > 0 && (max === undefined || minutes <= max);

  if (!open) {
    return (
      <Button
        size="sm"
        variant="outline"
        className={cn("h-7 px-2 text-xs text-foreground", className)}
        data-testid={testId}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {label}
      </Button>
    );
  }

  const submit = () => {
    if (!valid) return;
    onSubmit(minutes);
    setOpen(false);
  };

  return (
    <span
      className="inline-flex items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      <Input
        type="number"
        min={1}
        max={max}
        autoFocus
        value={value}
        placeholder="min"
        aria-label={`${label} (minutes)`}
        data-testid={testId ? `${testId}-input` : undefined}
        className="h-7 w-20 px-2 text-xs"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={!valid}
        data-testid={testId ? `${testId}-submit` : undefined}
        onClick={submit}
      >
        {submitLabel}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
    </span>
  );
}

/** D13: one-click fixes for a past due, at risk or can't fit task. */
export function ScheduleFixes({
  task,
  className,
}: {
  task: Task;
  className?: string;
}) {
  const defaultMinChunk = useSettingsStore(
    (state) => state.autoSchedule.defaultMinChunkMinutes ?? 30
  );
  const fixes = scheduleFixes(task, defaultMinChunk);
  if (fixes.length === 0) return null;

  const apply = (kind: ScheduleFixKind, minutes?: number) => {
    const updates = fixUpdates(task, kind, minutes, defaultMinChunk);
    if (!updates) return;
    void useTaskStore
      .getState()
      .applyTaskFix(
        task.id,
        updates,
        kind === "auto_schedule_off"
          ? { scheduleStatus: "unscheduled", scheduleIssue: null }
          : {}
      )
      .catch(() => undefined);
  };

  const fit = fitMinutes(task, defaultMinChunk);
  const remaining = remainingOf(task);
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      data-testid="schedule-fixes"
    >
      {fixes.map((fix) =>
        fix.needsMinutes ? (
          <MinutesPrompt
            key={fix.kind}
            label={fix.label}
            submitLabel="Shorten"
            testId={`fix-${fix.kind}`}
            max={Math.max(1, remaining - 1)}
            onSubmit={(minutes) => apply(fix.kind, minutes)}
          />
        ) : (
          <Button
            key={fix.kind}
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs text-foreground"
            data-testid={`fix-${fix.kind}`}
            title={
              fix.kind === "shorten_to_fit" && fit !== null
                ? `Set the remaining time to ${formatMinutes(fit)} (was ${formatMinutes(remaining)})`
                : undefined
            }
            onClick={(e) => {
              e.stopPropagation();
              apply(fix.kind);
            }}
          >
            {fix.kind === "shorten_to_fit" && fit !== null
              ? `${fix.label} (${formatMinutes(fit)})`
              : fix.label}
          </Button>
        )
      )}
    </div>
  );
}

/** D16e: subtract N worked minutes from the task. */
export function LogTimeControl({
  task,
  className,
}: {
  task: Task;
  className?: string;
}) {
  const remaining = remainingOf(task);
  if (!task.duration || remaining <= 0) return null;
  return (
    <MinutesPrompt
      label="Log time"
      submitLabel="Log"
      testId="log-time"
      max={remaining}
      className={className}
      onSubmit={(minutes) =>
        void useTaskStore
          .getState()
          .logTaskTime(task.id, minutes)
          .catch(() => undefined)
      }
    />
  );
}
