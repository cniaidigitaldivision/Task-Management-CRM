'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { EFFORT_POINTS, STATUS_META, TASK_STATUSES, type TaskStatus } from '@/lib/domain/constants';
import type { TaskView } from '@/lib/view/task-view';
import { cn } from '@/lib/utils';

import { TaskCard } from './task-card';

/* ============================================================================
 * TASK BOARD — Kanban, doc 10 §3
 * ----------------------------------------------------------------------------
 * Eight columns in status order, drag between them to change status.
 *
 * ── WHAT IS REAL HERE, AND WHAT IS NOT ────────────────────────────────────
 * Real: the columns, the counts, the effort totals, and the drag-and-drop
 *       itself, which moves cards between columns and updates the counts.
 *
 * Not yet: the move is **local state only** — nothing is persisted, because the
 *       query layer lands in Step 4. The banner in the toolbar says so.
 *
 * Not yet: the full transition table in doc 05 §2. A card can currently be
 *       dropped into any column. `canMove` is the seam that closes that: the
 *       workspace passes a predicate, and today it enforces the one rule that
 *       already exists in code — doc 03 §3's "only Coordinator+ may approve
 *       In Review → Done or → Revisions", checked through
 *       lib/domain/permissions.ts. The rest arrives with `status-machine.ts`
 *       in Phase 2 (doc 20 §3).
 *
 * Column headers show count and total effort points (doc 10 §3). Deliberately
 * effort points, not weighted load: load = effort × priority × status weight is
 * the workload engine's arithmetic (doc 06 §2), and doc 20 §1 forbids layer 4
 * from computing it. Summing a constant from the enum table is not that.
 * ========================================================================= */

export function TaskBoard({
  tasks,
  onMove,
  canMove,
  onOpen,
  selectedIds,
  onToggleSelect,
}: {
  tasks: readonly TaskView[];
  onMove: (taskId: string, to: TaskStatus) => void;
  /** Returns null when the move is allowed, or the reason it is refused. */
  canMove: (task: TaskView, to: TaskStatus) => string | null;
  /** Opens the detail drawer. A card is draggable AND clickable, so the click
   *  handler has to ignore the click the browser fires at the end of a drag. */
  onOpen?: (taskId: string) => void;
  /** Selection is optional: omit both and the board has no checkboxes at all. */
  selectedIds?: readonly string[];
  onToggleSelect?: (taskId: string) => void;
}) {
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = React.useState<TaskStatus | null>(null);

  const dragged = draggingId ? tasks.find((t) => t.id === draggingId) : undefined;

  const clearDrag = React.useCallback(() => {
    setDraggingId(null);
    setHoverColumn(null);
  }, []);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
      <div className="flex min-w-max gap-3">
        {TASK_STATUSES.map((status) => {
          const meta = STATUS_META[status];
          const columnTasks = tasks.filter((t) => t.status === status);
          const points = columnTasks.reduce((sum, t) => sum + EFFORT_POINTS[t.effort], 0);

          const refusal = dragged ? canMove(dragged, status) : null;
          const isSameColumn = dragged?.status === status;
          const isDropTarget = hoverColumn === status && !refusal && !isSameColumn;
          const isRefused = hoverColumn === status && !!refusal;

          return (
            <section
              key={status}
              aria-label={`${meta.label} — ${columnTasks.length} tasks`}
              onDragOver={(event) => {
                // preventDefault is what makes an element a valid drop target.
                // Withholding it on a refused column is the whole mechanism
                // behind doc 10 §3's "simply won't drop there".
                if (!dragged || refusal || isSameColumn) return;
                event.preventDefault();
                setHoverColumn(status);
              }}
              onDragEnter={() => dragged && setHoverColumn(status)}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingId && !refusal && !isSameColumn) onMove(draggingId, status);
                clearDrag();
              }}
              className={cn(
                'flex w-[286px] shrink-0 flex-col rounded-xl border transition-colors duration-[140ms]',
                isDropTarget
                  ? 'border-border-brand bg-bg-selected'
                  : isRefused
                    ? 'border-transparent bg-bg-subtle'
                    : 'border-border-subtle bg-bg-subtle',
              )}
              style={
                isRefused
                  ? {
                      borderColor:
                        'color-mix(in oklab, var(--feedback-error) 45%, transparent)',
                    }
                  : undefined
              }
              title={isRefused ? refusal : undefined}
            >
              {/* ---- Column header ---- */}
              <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--${meta.token})` }}
                />
                <h3 className="flex-1 truncate text-caption font-semibold text-text-primary">
                  {meta.label}
                </h3>
                <span className="tabular shrink-0 text-micro font-semibold text-text-tertiary">
                  {columnTasks.length}
                  {points > 0 && <span className="font-normal"> · {points}p</span>}
                </span>
              </header>

              {/* A hairline in the status colour, so a long board stays
                  navigable by colour as you scroll sideways. */}
              <span
                aria-hidden="true"
                className="mx-3 h-[2px] shrink-0 rounded-full"
                style={{
                  background: `linear-gradient(90deg, var(--${meta.token}), color-mix(in oklab, var(--${meta.token}) 20%, transparent))`,
                }}
              />

              {/* ---- Cards ---- */}
              <div className="flex-1 space-y-2 p-2.5">
                {columnTasks.map((task) => (
                  <div
                    key={task.id}
                    className="group/card relative"
                    draggable
                    onDragStart={(event) => {
                      setDraggingId(task.id);
                      event.dataTransfer.effectAllowed = 'move';
                      // Firefox refuses to start a drag without payload.
                      event.dataTransfer.setData('text/plain', task.id);
                    }}
                    onDragEnd={clearDrag}
                  >
                    {onToggleSelect && (
                      /* The checkbox stays hidden until the card is hovered or
                         something is already selected. A permanent checkbox on
                         every card turns a board into a spreadsheet. */
                      <label
                        className={`absolute left-1.5 top-1.5 z-10 cursor-pointer rounded-md border border-border-default bg-bg-surface p-1 shadow-xs transition-opacity ${
                          selectedIds?.includes(task.id)
                            ? 'opacity-100'
                            : 'opacity-0 group-hover/card:opacity-100 focus-within:opacity-100'
                        }`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="sr-only">Select {task.reference}</span>
                        <input
                          type="checkbox"
                          className="block h-3.5 w-3.5 cursor-pointer accent-[var(--accent-primary)]"
                          checked={selectedIds?.includes(task.id) ?? false}
                          onChange={() => onToggleSelect(task.id)}
                        />
                      </label>
                    )}
                    <TaskCard
                      task={task}
                      dragging={draggingId === task.id}
                      onOpen={onOpen}
                    />
                  </div>
                ))}

                {columnTasks.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border-default px-3 py-6 text-center text-micro text-text-tertiary">
                    {isRefused ? refusal : 'Nothing here'}
                  </p>
                )}

                {isRefused && columnTasks.length > 0 && (
                  <p
                    className="rounded-lg px-2.5 py-2 text-micro font-medium"
                    style={{
                      backgroundColor:
                        'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
                      color: 'color-mix(in oklab, var(--feedback-error) 74%, var(--text-primary))',
                    }}
                  >
                    {refusal}
                  </p>
                )}
              </div>

              {/* ---- Add ---- */}
              <footer className="p-2.5 pt-0">
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 text-micro font-semibold text-text-tertiary transition-colors duration-[140ms] hover:border-border-default hover:bg-bg-surface hover:text-text-primary focus-visible:outline-none"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                  Add task
                </button>
              </footer>
            </section>
          );
        })}
      </div>

      {/* Legend — the board is wide, and colour alone must never be the signal */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-micro font-semibold tracking-[0.07em] text-text-tertiary uppercase">
          Statuses
        </span>
        {TASK_STATUSES.map((status) => (
          <Badge key={status} token={STATUS_META[status].token} size="sm" variant="outline">
            {STATUS_META[status].label}
          </Badge>
        ))}
      </div>
    </div>
  );
}
