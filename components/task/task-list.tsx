'use client';

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

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
import type { PreviewTask } from '@/lib/preview-data';
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
  tasks: readonly PreviewTask[];
}

export function groupTasks(tasks: readonly PreviewTask[], groupBy: GroupBy): TaskGroup[] {
  if (groupBy === 'status') {
    // Status order comes from the enum table, not from the data, so an empty
    // status still sits in the right place when it later fills up.
    const seen = new Map<string, PreviewTask[]>();
    tasks.forEach((t) => {
      const list = seen.get(t.status) ?? [];
      list.push(t);
      seen.set(t.status, list);
    });
    return [...seen.entries()]
      .sort(
        ([a], [b]) =>
          STATUS_META[a as PreviewTask['status']].sortOrder -
          STATUS_META[b as PreviewTask['status']].sortOrder,
      )
      .map(([status, list]) => ({
        key: status,
        label: STATUS_META[status as PreviewTask['status']].label,
        token: STATUS_META[status as PreviewTask['status']].token,
        tasks: list,
      }));
  }

  const keyOf = (t: PreviewTask) => (groupBy === 'project' ? t.projectName : t.assignee);
  const tokenOf = (t: PreviewTask) =>
    groupBy === 'project' ? PROJECT_TYPE_META[t.projectType].token : undefined;

  const seen = new Map<string, PreviewTask[]>();
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

function TaskRow({ task }: { task: PreviewTask }) {
  const status = STATUS_META[task.status];
  const project = PROJECT_TYPE_META[task.projectType];
  const isClosed = status.category === 'done' || status.category === 'cancelled';
  const timePct =
    task.timeLimitMinutes > 0
      ? Math.round((task.timeSpentMinutes / task.timeLimitMinutes) * 100)
      : 0;
  const overLimit = timePct > 100;

  return (
    <tr className="group border-b border-border-subtle transition-colors duration-[140ms] last:border-0 hover:bg-bg-hover">
      {/* Task */}
      <td className="py-2.5 pr-3 pl-4">
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

      {/* Status */}
      <td className="px-3 py-2.5">
        <Badge token={status.token} size="sm">
          {status.label}
        </Badge>
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
          <Avatar name={task.assignee} size="xs" />
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

const HEADINGS = [
  { label: 'Task', className: 'pl-4 pr-3 text-left' },
  { label: 'Status', className: 'px-3 text-left' },
  { label: 'Priority', className: 'hidden px-3 text-left md:table-cell' },
  { label: 'Effort', className: 'hidden px-3 text-left lg:table-cell' },
  { label: 'Assignee', className: 'px-3 text-left' },
  { label: 'Time used', className: 'hidden px-3 text-right xl:table-cell' },
  { label: 'Due', className: 'px-4 text-right' },
];

export function TaskList({
  groups,
}: {
  groups: readonly TaskGroup[];
}) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-6 py-14 text-center">
        <p className="text-body-sm font-semibold text-text-primary">No tasks match these filters</p>
        <p className="mt-1 text-caption text-text-secondary">
          Clear a filter, or create a task to get started.
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
              {HEADINGS.map((h) => (
                <th
                  key={h.label}
                  scope="col"
                  className={cn(
                    'py-2 text-micro font-semibold tracking-[0.07em] text-text-tertiary uppercase',
                    h.className,
                  )}
                >
                  {h.label}
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

                {!isCollapsed && group.tasks.map((task) => <TaskRow key={task.id} task={task} />)}
              </tbody>
            );
          })}
        </table>
      </div>
    </div>
  );
}
