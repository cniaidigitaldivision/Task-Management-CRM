import * as React from 'react';
import { MessageSquare, Paperclip, ListChecks, Lock } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Badge, PriorityFlag } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress';
import {
  EFFORT_POINTS,
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  PROJECT_TYPE_META,
  STATUS_META,
} from '@/lib/domain/constants';
import type { TaskView } from '@/lib/view/task-view';
import { cn } from '@/lib/utils';

/* ============================================================================
 * TASK CARD — the board unit
 * ----------------------------------------------------------------------------
 * doc 10 §3. A board card has to answer five things without being opened:
 * what it is, whose it is, how urgent, how big, and whether it is in trouble.
 *
 *   · reference + title      what
 *   · avatar                 whose
 *   · priority flag + stripe how urgent
 *   · effort chip            how big
 *   · due label, time bar,   in trouble?
 *     blocked reason
 *
 * The left stripe colour-codes by priority, and an overdue task overrides it
 * with the error colour (doc 10 §3). The stripe never carries meaning alone —
 * the priority flag states it in words right beside it (FR-208, NFR-008).
 * ========================================================================= */

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function TaskCard({
  task,
  dragging = false,
  immovable = false,
  className,
  onOpen,
}: {
  task: TaskView;
  dragging?: boolean;
  /** Rendered as not-draggable, with a reason on hover. */
  immovable?: boolean;
  className?: string;
  onOpen?: (taskId: string) => void;
}) {
  const pointerStart = React.useRef<{ x: number; y: number } | null>(null);
  const project = PROJECT_TYPE_META[task.projectType];
  const status = STATUS_META[task.status];
  const stripe = task.overdue ? 'feedback-error' : PRIORITY_TOKEN[task.priority];

  const timePct =
    task.timeLimitMinutes > 0
      ? Math.round((task.timeSpentMinutes / task.timeLimitMinutes) * 100)
      : 0;
  const overLimit = timePct > 100;
  const isClosed = status.category === 'done' || status.category === 'cancelled';

  return (
    <article
      /* ── A card is both draggable and clickable ────────────────────────────
         The browser fires a click at the end of a drag, so a naive onClick opens
         the detail drawer every time somebody moves a card — which is maddening.
         `dragging` is false again by the time that click lands, so the guard is
         the pointer travel: a click that moved more than a few pixels since
         mousedown was a drag, not a click. 5px absorbs ordinary hand tremor
         without swallowing a real click. */
      onPointerDown={(event) => {
        pointerStart.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        if (!onOpen) return;
        const start = pointerStart.current;
        if (start) {
          const travel = Math.hypot(event.clientX - start.x, event.clientY - start.y);
          if (travel > 5) return;
        }
        onOpen(task.id);
      }}
      onKeyDown={(event) => {
        if (!onOpen) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(task.id);
        }
      }}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `${task.reference} — ${task.title}` : undefined}
      className={cn(
        'group relative overflow-hidden rounded-lg border border-border-default bg-bg-surface',
        'shadow-xs transition-[border-color,box-shadow,transform,opacity] duration-[140ms]',
        'focus-visible:border-border-brand focus-visible:outline-none',
        immovable
          ? 'cursor-not-allowed'
          : 'cursor-grab hover:-translate-y-px hover:border-border-strong hover:shadow-md active:cursor-grabbing',
        dragging && 'rotate-[0.6deg] opacity-45 shadow-lg',
        isClosed && 'opacity-75',
        className,
      )}
    >
      {/* Priority stripe — error colour when overdue */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: `var(--${stripe})` }}
      />

      <div className="space-y-2.5 py-2.5 pr-2.5 pl-3.5">
        {/* ---- Reference + title ---- */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-micro font-semibold text-text-brand">
              {task.reference}
            </span>
            {immovable ? (
              <Lock
                className="h-3 w-3 shrink-0 text-text-disabled"
                strokeWidth={2.25}
                aria-hidden="true"
              />
            ) : (
              <Avatar name={task.assignee} size="xs" />
            )}
          </div>
          <p
            className={cn(
              'mt-1 text-body-sm leading-snug font-medium text-text-primary',
              isClosed && 'line-through decoration-text-disabled',
            )}
          >
            {task.title}
          </p>
        </div>

        {/* ---- Project ---- */}
        <Badge token={project.token} size="sm" variant="outline">
          {task.projectName}
        </Badge>

        {/* ---- Blocked reason — mandatory when blocked (FR-043) ---- */}
        {task.blockedReason && (
          <p
            className="rounded-md px-2 py-1.5 text-micro leading-snug"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--status-blocked) var(--tint-soft), var(--bg-surface))',
              color: 'color-mix(in oklab, var(--status-blocked) 72%, var(--text-primary))',
            }}
          >
            {task.blockedReason}
          </p>
        )}

        {/* ---- Time against limit ---- */}
        {task.timeSpentMinutes > 0 && (
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="tabular text-micro font-semibold"
                style={{ color: overLimit ? 'var(--load-over)' : 'var(--text-secondary)' }}
              >
                {formatDuration(task.timeSpentMinutes)}
                <span className="font-normal text-text-tertiary">
                  {' '}
                  / {formatDuration(task.timeLimitMinutes)}
                </span>
              </span>
              <span
                className="tabular text-micro font-semibold"
                style={{ color: overLimit ? 'var(--load-over)' : 'var(--text-tertiary)' }}
              >
                {timePct}%
              </span>
            </div>
            <ProgressBar
              value={timePct}
              token={overLimit ? 'load-over' : 'status-progress'}
              size="sm"
              label={`${task.reference}: ${timePct}% of time limit`}
            />
          </div>
        )}

        {/* ---- Footer meta ---- */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <PriorityFlag token={PRIORITY_TOKEN[task.priority]} label={PRIORITY_LABEL[task.priority]} />

          <span className="tabular rounded-[4px] bg-bg-active px-1.5 py-px text-micro font-semibold text-text-secondary">
            {task.effort} · {EFFORT_POINTS[task.effort]}p
          </span>

          <span
            className="text-micro font-semibold"
            style={{
              color: task.overdue ? 'var(--feedback-error)' : 'var(--text-tertiary)',
            }}
          >
            {task.dueLabel}
          </span>

          <span className="ml-auto flex items-center gap-2 text-text-tertiary">
            {task.checklist && (
              <span className="tabular inline-flex items-center gap-1 text-micro" title="Checklist">
                <ListChecks className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                {task.checklist.done}/{task.checklist.total}
              </span>
            )}
            {task.commentCount ? (
              <span className="tabular inline-flex items-center gap-1 text-micro" title="Comments">
                <MessageSquare className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                {task.commentCount}
              </span>
            ) : null}
            {task.attachmentCount ? (
              <span
                className="tabular inline-flex items-center gap-1 text-micro"
                title="Attachments"
              >
                <Paperclip className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
                {task.attachmentCount}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </article>
  );
}
