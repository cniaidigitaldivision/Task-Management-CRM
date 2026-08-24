'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Badge, PriorityFlag } from '@/components/ui/badge';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { ProgressBar } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import {
  EFFORT_POINTS,
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  PROJECT_TYPE_META,
  STATUS_META,
  TASK_STATUSES,
  type TaskStatus,
} from '@/lib/domain/constants';
import type { TaskView } from '@/lib/view/task-view';
import { cn } from '@/lib/utils';

import { formatDuration } from './task-card';

/* ============================================================================
 * TASK LIST — doc 10 §3 "List" view, FR-081
 * ----------------------------------------------------------------------------
 * The board shows shape; the list shows detail. Same data, different question:
 * the board answers "where is everything?", the list answers "what exactly is
 * on my plate, in order?".
 *
 * Grouped rather than flat. A flat list of eighteen rows is a wall — grouped by
 * status, project or assignee, the same rows answer a question. Groups collapse
 * so a long list stays navigable.
 *
 * Columns are hidden progressively on narrow screens rather than allowed to
 * squash: reference and title always survive, and the time column is the first
 * to go, since the board and task detail both carry it too.
 * ========================================================================= */

export type GroupBy = 'status' | 'project' | 'assignee';

export interface TaskGroup {
  key: string;
  label: string;
  token?: string;
  tasks: readonly TaskView[];
}

export function groupTasks(tasks: readonly TaskView[], groupBy: GroupBy): TaskGroup[] {
  if (groupBy === 'status') {
    // Status order comes from the enum table, not from the data, so an empty
    // status still sits in the right place when it later fills up.
    const seen = new Map<string, TaskView[]>();
    tasks.forEach((t) => {
      const list = seen.get(t.status) ?? [];
      list.push(t);
      seen.set(t.status, list);
    });
    return [...seen.entries()]
      .sort(
        ([a], [b]) =>
          STATUS_META[a as TaskView['status']].sortOrder -
          STATUS_META[b as TaskView['status']].sortOrder,
      )
      .map(([status, list]) => ({
        key: status,
        label: STATUS_META[status as TaskView['status']].label,
        token: STATUS_META[status as TaskView['status']].token,
        tasks: list,
      }));
  }

  const keyOf = (t: TaskView) => (groupBy === 'project' ? t.projectName : t.assignee);
  const tokenOf = (t: TaskView) =>
    groupBy === 'project' ? PROJECT_TYPE_META[t.projectType].token : undefined;

  const seen = new Map<string, TaskView[]>();
  tasks.forEach((t) => {
    const list = seen.get(keyOf(t)) ?? [];
    list.push(t);
    seen.set(keyOf(t), list);
  });

  return [...seen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, list]) => ({
      key: label,
      label,
      token: tokenOf(list[0]),
      tasks: list,
    }));
}

/* ---- Row ---------------------------------------------------------------- */

function TaskRow({
  task,
  onOpen,
  selected = false,
  onSelect,
  onChangeStatus,
}: {
  task: TaskView;
  onOpen?: (id: string) => void;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onChangeStatus?: (taskId: string, to: TaskStatus) => void;
}) {
  const status = STATUS_META[task.status];
  const project = PROJECT_TYPE_META[task.projectType];
  const isClosed = status.category === 'done' || status.category === 'cancelled';
  const timePct =
    task.timeLimitMinutes > 0
      ? Math.round((task.timeSpentMinutes / task.timeLimitMinutes) * 100)
      : 0;
  const overLimit = timePct > 100;

  return (
    <tr
      onClick={() => onOpen?.(task.id)}
      /* A row is a button in disguise. tabIndex plus the Enter/Space handler is
         what keeps it reachable from the keyboard, which a bare onClick on a
         <tr> would not be. */
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onOpen) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(task.id);
        }
      }}
      aria-label={onOpen ? `Open ${task.reference}` : undefined}
      className={cn(
        'group border-b border-border-subtle transition-colors duration-[140ms] last:border-0 hover:bg-bg-hover',
        onOpen && 'cursor-pointer focus-visible:outline-none focus-visible:bg-bg-hover',
        selected && 'bg-bg-selected',
      )}
    >
      {/* ── ⚠️ SELECTION — AND `stopPropagation` IS LOAD-BEARING ─────────────
          The whole row opens the task. Without stopping the event here, ticking
          the box would also open the drawer over the list you are selecting in,
          which makes multi-select impossible rather than merely annoying. */}
      <td className="py-2.5 pr-0 pl-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect?.(task.id)}
          aria-label={`Select ${task.reference}`}
          className="size-4 cursor-pointer accent-[var(--accent-primary)]"
        />
      </td>

      {/* Task */}
      <td className="py-2.5 pr-3 pl-1">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden="true"
            className="mt-1 h-3.5 w-[3px] shrink-0 rounded-full"
            style={{
              backgroundColor: task.overdue
                ? 'var(--feedback-error)'
                : `var(--${PRIORITY_TOKEN[task.priority]})`,
            }}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-micro font-semibold text-text-brand">
                {task.reference}
              </span>
              <span
                className={cn(
                  'text-body-sm font-medium text-text-primary',
                  isClosed && 'line-through decoration-text-disabled',
                )}
              >
                {task.title}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge token={project.token} size="sm" variant="outline">
                {task.projectName}
              </Badge>
              {task.blockedReason && (
                <span
                  className="truncate text-micro"
                  style={{ color: 'var(--status-blocked)' }}
                  title={task.blockedReason}
                >
                  {task.blockedReason}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* ── ⚠️ STATUS IS CHANGED HERE, NOT BY OPENING THE TASK ───────────────
          Owner, 2026-08-23: *"we should show a dropdown where I can see or
          update any one status in the table… if I change that status it will
          hide silently from there and show on that status."*

          It was a read-only chip, so moving a task meant opening the drawer,
          changing it, closing the drawer — three interactions to do the one
          thing this table is read for. The board could do it by dragging; the
          list could not do it at all.

          `onChangeStatus` routes to the SAME handler the board drag uses, so an
          illegal move raises the same reason prompt and an optimistic change
          lands the row in its new group — which is the "hide from there, show on
          that status" the owner describes. Grouping by status makes that
          movement visible rather than surprising.

          Read-only when no handler is passed: the list is also rendered where
          nothing is editable. */}
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        {onChangeStatus ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: `var(--${status.token})` }}
            />
            <Select
              size="sm"
              label={`Status of ${task.reference}`}
              value={task.status}
              onChange={(event) => onChangeStatus(task.id, event.target.value as TaskStatus)}
              options={TASK_STATUSES.map((value) => ({
                value,
                label: STATUS_META[value].label,
              }))}
              className="w-[8.25rem]"
            />
          </span>
        ) : (
          <Badge token={status.token} size="sm">
            {status.label}
          </Badge>
        )}
      </td>

      {/* Priority */}
      <td className="hidden px-3 py-2.5 md:table-cell">
        <PriorityFlag token={PRIORITY_TOKEN[task.priority]} label={PRIORITY_LABEL[task.priority]} />
      </td>

      {/* Effort */}
      <td className="hidden px-3 py-2.5 lg:table-cell">
        <span className="tabular rounded-[4px] bg-bg-active px-1.5 py-px text-micro font-semibold text-text-secondary">
          {task.effort} · {EFFORT_POINTS[task.effort]}p
        </span>
      </td>

      {/* Assignee */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Avatar name={task.assignee} src={task.assigneeAvatarUrl} size="xs" />
          <span className="hidden truncate text-caption text-text-secondary xl:inline">
            {task.assignee.split(' ')[0]}
          </span>
        </div>
      </td>

      {/* Time */}
      <td className="hidden px-3 py-2.5 xl:table-cell">
        {task.timeSpentMinutes > 0 ? (
          <div className="flex w-28 flex-col items-end gap-1">
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
            <ProgressBar
              value={timePct}
              token={overLimit ? 'load-over' : 'status-progress'}
              size="sm"
              label={`${task.reference}: ${timePct}% of time limit`}
            />
          </div>
        ) : (
          <span className="text-micro text-text-disabled">Not started</span>
        )}
      </td>

      {/* Due */}
      <td className="px-4 py-2.5 text-right">
        <span
          className="text-caption font-medium whitespace-nowrap"
          style={{
            color: task.overdue ? 'var(--feedback-error)' : 'var(--text-secondary)',
          }}
        >
          {task.dueLabel}
        </span>
      </td>
    </tr>
  );
}

/* ---- List --------------------------------------------------------------- */

/* ⚠️ The first heading is deliberately blank — it labels the selection column,
   and a visible word above a column of checkboxes reads as data. The header
   checkbox carries its own aria-label instead. */
const HEADINGS = [
  { label: '', className: 'w-9 pl-3 pr-0 text-left' },
  { label: 'Task', className: 'pl-1 pr-3 text-left' },
  { label: 'Status', className: 'px-3 text-left' },
  { label: 'Priority', className: 'hidden px-3 text-left md:table-cell' },
  { label: 'Effort', className: 'hidden px-3 text-left lg:table-cell' },
  { label: 'Assignee', className: 'px-3 text-left' },
  { label: 'Time used', className: 'hidden px-3 text-right xl:table-cell' },
  { label: 'Due', className: 'px-4 text-right' },
];

export function TaskList({
  groups,
  onOpen,
  selectedIds,
  onSelect,
  onSelectAll,
  onChangeStatus,
}: {
  groups: readonly TaskGroup[];
  onOpen?: (taskId: string) => void;
  /* ── ⚠️ SELECTION CAME LATE, AND THE LIST HAD NONE ────────────────────────
     Owner, 2026-08-23: *"when I can select multiple checkboxes for multiple
     tasks, a bar should appear at the bottom."*

     The bulk bar has existed since Session 20 — but only on the BOARD, because
     only the board had checkboxes. So the list, which is the view somebody
     actually reads a project's work in, could not select anything at all and
     the bar could never appear over it. Optional props rather than required
     ones: the list is also rendered read-only elsewhere. */
  selectedIds?: ReadonlySet<string>;
  onSelect?: (taskId: string) => void;
  /** Ticks or clears every task currently rendered, across all groups. */
  onSelectAll?: (taskIds: readonly string[], select: boolean) => void;
  /** Makes the status column editable. Routed to the same handler the board's
   *  drag uses, so both paths get the same legality check and reason prompt. */
  onChangeStatus?: (taskId: string, to: TaskStatus) => void;
}) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());

  /* Every task currently rendered, across all groups — what select-all acts on.
     Deliberately the FILTERED set, not the whole project: ticking the box at the
     top of a filtered list and silently selecting rows that are not on screen is
     how somebody deletes work they never saw. */
  const everyId = React.useMemo(
    () => groups.flatMap((group) => group.tasks.map((task) => task.id)),
    [groups],
  );
  const selectedCount = everyId.filter((id) => selectedIds?.has(id)).length;
  const allSelected = everyId.length > 0 && selectedCount === everyId.length;
  const someSelected = selectedCount > 0;

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (groups.length === 0) {
    return (
      <div className="dot-grid rounded-xl border border-dashed border-border-default bg-bg-surface px-6 py-14 text-center">
        <p className="text-body-sm font-semibold text-text-primary">No tasks match these filters</p>
        <p className="mt-1 text-caption text-text-secondary">
          Clear a filter, or press N to create a task.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-border-default bg-bg-surface-sunken">
              {HEADINGS.map((h, index) => (
                <th
                  key={h.label || `col-${index}`}
                  scope="col"
                  className={cn(
                    'py-2 text-micro font-semibold tracking-[0.07em] text-text-tertiary uppercase',
                    h.className,
                  )}
                >
                  {/* The blank first heading carries select-all instead of a
                      word. `indeterminate` is set through a ref because it is a
                      DOM property with no HTML attribute — React will not render
                      it from JSX, and without it a partial selection shows an
                      empty box that looks like nothing is selected. */}
                  {index === 0 && onSelectAll ? (
                    <input
                      type="checkbox"
                      aria-label={allSelected ? 'Clear the selection' : 'Select every task shown'}
                      checked={allSelected}
                      ref={(node) => {
                        if (node) node.indeterminate = someSelected && !allSelected;
                      }}
                      onChange={() => onSelectAll(everyId, !allSelected)}
                      className="size-4 cursor-pointer accent-[var(--accent-primary)]"
                    />
                  ) : (
                    h.label
                  )}
                </th>
              ))}
            </tr>
          </thead>

          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            const points = group.tasks.reduce((sum, t) => sum + EFFORT_POINTS[t.effort], 0);

            return (
              <tbody key={group.key}>
                <tr>
                  <th
                    colSpan={HEADINGS.length}
                    scope="colgroup"
                    className="border-y border-border-subtle bg-bg-subtle px-4 py-1.5 text-left"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(group.key)}
                      aria-expanded={!isCollapsed}
                      className="flex w-full items-center gap-2 focus-visible:outline-none"
                    >
                      {isCollapsed ? (
                        <ChevronRight
                          className="h-3.5 w-3.5 shrink-0 text-text-tertiary"
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronDown
                          className="h-3.5 w-3.5 shrink-0 text-text-tertiary"
                          strokeWidth={2.5}
                          aria-hidden="true"
                        />
                      )}
                      {group.token && (
                        <span
                          aria-hidden="true"
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: `var(--${group.token})` }}
                        />
                      )}
                      <span className="truncate text-caption font-semibold text-text-primary">
                        {group.label}
                      </span>
                      <span className="tabular text-micro font-semibold text-text-tertiary">
                        {group.tasks.length}
                        {points > 0 && <span className="font-normal"> · {points}p</span>}
                      </span>
                    </button>
                  </th>
                </tr>

                {!isCollapsed && (
                  <GroupRows
                    group={group}
                    onOpen={onOpen}
                    selectedIds={selectedIds}
                    onSelect={onSelect}
                    onChangeStatus={onChangeStatus}
                  />
                )}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * ONE GROUP'S ROWS, PAGED
 * ----------------------------------------------------------------------------
 * This is a separate component for one reason: the pager is per-group, and a
 * hook cannot be called inside `groups.map`. Extracting the rows gives each
 * group its own `usePagination` instance legitimately.
 *
 * ── WHY PER-GROUP AND NOT ONE PAGER FOR THE TABLE ────────────────────────────
 * A single pager over the flattened list would cut groups in half — page 2 of
 * "Blocked" would open with rows whose heading is on page 1. Paging the GROUPS
 * instead would hide whole statuses. Neither is what the owner asked for
 * (CHANGE-PLAN 4.3, "after every 12 or 13 rows"), and both break grouping,
 * which is the point of this view.
 *
 * ── MOST GROUPS WILL NEVER SHOW A PAGER ──────────────────────────────────────
 * That is correct, not dead code: `Pagination` returns null at one page, and
 * with 38 tasks over six statuses no group is near twelve today. It appears the
 * moment one is — which is the whole reason to wire it before it is needed.
 *
 * The group heading keeps showing `group.tasks.length`, the total for the
 * group, not the page — a heading that counted the page would contradict the
 * "1–12 of 30" directly beneath it.
 *
 * Collapsing a group unmounts this and so resets it to page 1. Deliberate:
 * re-opening a group you left on page 3 should not hide its first rows.
 * ------------------------------------------------------------------------- */
function GroupRows({
  group,
  onOpen,
  selectedIds,
  onSelect,
  onChangeStatus,
}: {
  group: TaskGroup;
  onOpen?: (id: string) => void;
  selectedIds?: ReadonlySet<string>;
  onSelect?: (id: string) => void;
  onChangeStatus?: (taskId: string, to: TaskStatus) => void;
}) {
  const pager = usePagination(group.tasks);

  return (
    <>
      {pager.visible.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          onOpen={onOpen}
          selected={selectedIds?.has(task.id) ?? false}
          onSelect={onSelect}
          onChangeStatus={onChangeStatus}
        />
      ))}

      {pager.pageCount > 1 && (
        <tr>
          <td colSpan={HEADINGS.length} className="px-4 pb-3">
            <Pagination
              page={pager.page}
              pageCount={pager.pageCount}
              onPage={pager.setPage}
              from={pager.from}
              to={pager.to}
              total={pager.total}
              label="tasks"
            />
          </td>
        </tr>
      )}
    </>
  );
}
