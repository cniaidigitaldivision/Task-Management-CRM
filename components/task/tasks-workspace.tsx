'use client';

import * as React from 'react';
import { CalendarDays, Columns3, EyeOff, Flag, Layers, List, Sparkles, User } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { IconTile } from '@/components/ui/icon-tile';
import { ViewTabs, type ViewTab } from '@/components/ui/page-header';
import {
  EFFORT_POINTS,
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  ROLE_LABEL,
  ROLES,
  STATUS_META,
  type Priority,
  type Role,
  type TaskStatus,
} from '@/lib/domain/constants';
import { can, type Actor } from '@/lib/domain/permissions';
import type { PreviewTask } from '@/lib/preview-data';
import { cn } from '@/lib/utils';

import { TaskBoard } from './task-board';
import { TaskList, groupTasks, type GroupBy } from './task-list';

/* ============================================================================
 * TASKS WORKSPACE — the interactive shell around both views
 * ----------------------------------------------------------------------------
 * doc 10 §3. Holds the view mode, the filters and the board's local task order.
 *
 * What is genuinely interactive: the List/Board switch, group-by, the priority
 * and assignee filters, hiding closed work, collapsing list groups, and drag-
 * and-drop on the board.
 *
 * What is not: nothing persists. The query layer lands in Step 4, and the
 * banner says so rather than letting anyone assume a move was saved.
 * ========================================================================= */

const VIEW_TABS: readonly ViewTab[] = [
  { key: 'list', label: 'List', icon: List },
  { key: 'board', label: 'Board', icon: Columns3 },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays, disabled: true },
];

const GROUP_OPTIONS: ReadonlyArray<{ key: GroupBy; label: string }> = [
  { key: 'status', label: 'Status' },
  { key: 'project', label: 'Project' },
  { key: 'assignee', label: 'Assignee' },
];

/* ---- Small segmented control ------------------------------------------- */

function Segmented<T extends string>({
  label,
  icon: Icon,
  options,
  value,
  onChange,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  options: ReadonlyArray<{ key: T; label: string; token?: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1.5 text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
        {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
        {label}
      </span>
      <div
        role="group"
        aria-label={label}
        className="flex items-center gap-0.5 rounded-lg border border-border-default bg-bg-surface p-0.5 shadow-xs"
      >
        {options.map((option) => {
          const isActive = option.key === value;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => onChange(option.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-micro font-semibold',
                'transition-colors duration-[140ms] focus-visible:outline-none',
                isActive
                  ? 'bg-bg-active text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              {option.token && (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: `var(--${option.token})` }}
                />
              )}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Workspace --------------------------------------------------------- */

export function TasksWorkspace({
  initialTasks,
  currentUser,
  currentRole,
}: {
  initialTasks: readonly PreviewTask[];
  currentUser: string;
  currentRole: Role;
}) {
  const [tasks, setTasks] = React.useState<readonly PreviewTask[]>(initialTasks);
  const [view, setView] = React.useState<'list' | 'board'>('list');
  const [groupBy, setGroupBy] = React.useState<GroupBy>('status');
  const [priority, setPriority] = React.useState<Priority | 'all'>('all');
  const [assignee, setAssignee] = React.useState<string>('all');
  const [hideClosed, setHideClosed] = React.useState(true);
  // Preview-only. Lets the interface be reviewed from each role's point of view
  // before real sessions exist (Step 4). Removed when getCurrentUser() lands.
  const [actingRole, setActingRole] = React.useState<Role>(currentRole);

  const assignees = React.useMemo(
    () => [...new Set(initialTasks.map((t) => t.assignee))].sort((a, b) => a.localeCompare(b)),
    [initialTasks],
  );

  const visible = React.useMemo(
    () =>
      tasks.filter((t) => {
        if (priority !== 'all' && t.priority !== priority) return false;
        if (assignee !== 'all' && t.assignee !== assignee) return false;
        if (hideClosed) {
          const category = STATUS_META[t.status].category;
          if (category === 'done' || category === 'cancelled') return false;
        }
        return true;
      }),
    [tasks, priority, assignee, hideClosed],
  );

  const points = visible.reduce((sum, t) => sum + EFFORT_POINTS[t.effort], 0);
  const groups = React.useMemo(() => groupTasks(visible, groupBy), [visible, groupBy]);

  const move = React.useCallback((taskId: string, to: TaskStatus) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: to } : t)));
  }, []);

  /* ---- Drop legality ----------------------------------------------------
   * Layer 4 asking layer 2 a question and rendering the answer. This component
   * holds no rules of its own — every decision below is `can()` reading the
   * matrix in lib/domain/permissions.ts, which is the transcription of
   * doc 03 §3 that the test suite checks against the document.
   *
   * Three questions, in the order they matter:
   *   1. may this actor change this task's status at all?
   *   2. if this is an approval, may they approve it — and is it their own
   *      work? (BR-002)
   *   3. if this is a cancellation, is it theirs to cancel?
   *
   * Still absent: the rest of doc 05 §2's transition table (Backlog → To Do
   * needs an estimate, Done → In Progress is Admin-only, and so on). That
   * belongs in lib/domain/status-machine.ts, which doc 20 §3 schedules for
   * Phase 2. It plugs in here beside these calls — no component rewrite. */
  const canMove = React.useCallback(
    (task: PreviewTask, to: TaskStatus): string | null => {
      const actor: Actor = { id: currentUser, role: actingRole };
      const context = { assigneeId: task.assignee, createdById: task.createdBy };
      const isOwn = task.assignee === currentUser;
      const roleLabel = ROLE_LABEL[actingRole];

      if (!can(actor, isOwn ? 'task.change_status_own' : 'task.change_status_any', context)) {
        return `A ${roleLabel} can only change the status of their own tasks.`;
      }

      if (task.status === 'in_review' && (to === 'done' || to === 'revisions')) {
        const action = to === 'done' ? 'task.approve_review' : 'task.request_revisions';
        if (!can(actor, action, context)) {
          return isOwn
            ? 'Nobody approves their own work — this one escalates a level up (BR-002).'
            : `A ${roleLabel} cannot approve or send back work in review.`;
        }
      }

      if (to === 'cancelled' && !can(actor, 'task.cancel', context)) {
        return `A ${roleLabel} can only cancel tasks they created themselves.`;
      }

      return null;
    },
    [actingRole, currentUser],
  );

  return (
    <div className="space-y-4">
      {/* ---- Preview notice ---- */}
      <div
        className="flex items-start gap-3 rounded-xl border px-4 py-3"
        style={{
          borderColor: 'color-mix(in oklab, var(--accent-gold) 35%, transparent)',
          backgroundColor: 'var(--bg-gold-subtle)',
        }}
      >
        <IconTile icon={Sparkles} token="accent-gold" size="sm" />
        <p className="text-caption text-text-secondary">
          <span className="font-semibold text-text-primary">Interface preview.</span> Filters,
          grouping and drag-and-drop all work, but{' '}
          <span className="font-semibold text-text-primary">nothing is saved</span> — the query
          layer lands in Step 4. Drop legality is real, though: it comes from{' '}
          <span className="font-mono text-micro">lib/domain/permissions.ts</span>, the doc 03 §3
          matrix. Change <span className="font-semibold text-text-primary">Preview as</span> to see
          the board behave as each role. The rest of the transition table (doc 05 §2) arrives with
          the status machine in Phase 2.
        </p>
      </div>

      {/* ---- View tabs ---- */}
      <ViewTabs
        // Both live views show the same count — how many tasks you are looking
        // at. Showing group count on List instead would read as a task count
        // and be wrong.
        tabs={VIEW_TABS.map((tab) =>
          tab.disabled ? tab : { ...tab, count: visible.length },
        )}
        activeKey={view}
        onSelect={(key) => setView(key as 'list' | 'board')}
      />

      {/* ---- Toolbar ---- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        {view === 'list' && (
          <Segmented
            label="Group"
            icon={Layers}
            options={GROUP_OPTIONS}
            value={groupBy}
            onChange={setGroupBy}
          />
        )}

        <Segmented
          label="Priority"
          icon={Flag}
          options={[
            { key: 'all' as const, label: 'All' },
            ...PRIORITIES.map((p) => ({
              key: p,
              label: PRIORITY_LABEL[p],
              token: PRIORITY_TOKEN[p],
            })),
          ]}
          value={priority}
          onChange={setPriority}
        />

        {/* Assignee — a select rather than a segmented control, because six
            people already overflows a row and the team will only grow. */}
        <label className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
            <User className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Assignee
          </span>
          <select
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            className="h-8 rounded-lg border border-border-default bg-bg-surface px-2 text-micro font-semibold text-text-primary shadow-xs transition-colors duration-[140ms] hover:border-border-strong focus-visible:outline-none"
          >
            <option value="all">Everyone</option>
            {assignees.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          aria-pressed={hideClosed}
          onClick={() => setHideClosed((prev) => !prev)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-micro font-semibold shadow-xs',
            'transition-colors duration-[140ms] focus-visible:outline-none',
            hideClosed
              ? 'border-border-default bg-bg-surface text-text-secondary hover:bg-bg-hover'
              : 'border-border-brand bg-bg-selected text-text-brand',
          )}
        >
          <EyeOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          {hideClosed ? 'Closed hidden' : 'Closed shown'}
        </button>

        {/* ---- Acting role — preview only ---- */}
        <label className="ml-auto flex items-center gap-1.5">
          <span className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
            Preview as
          </span>
          <select
            value={actingRole}
            onChange={(event) => setActingRole(event.target.value as Role)}
            className="h-8 rounded-lg border border-border-gold bg-bg-gold-subtle px-2 text-micro font-semibold text-text-primary shadow-xs focus-visible:outline-none"
            title="Preview control — shows how the board behaves for each role. Removed when real sessions land in Step 4."
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* ---- Result summary ---- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-caption text-text-secondary">
          <span className="tabular font-semibold text-text-primary">{visible.length}</span> of{' '}
          <span className="tabular">{tasks.length}</span> tasks
          {points > 0 && (
            <>
              {' · '}
              <span className="tabular font-semibold text-text-primary">{points}</span> effort points
            </>
          )}
        </span>
        {priority !== 'all' && (
          <Badge token={PRIORITY_TOKEN[priority]} size="sm">
            {PRIORITY_LABEL[priority]} only
          </Badge>
        )}
        {assignee !== 'all' && (
          <Badge token="accent-primary" size="sm" dot={false}>
            {assignee}
          </Badge>
        )}
      </div>

      {/* ---- The view ---- */}
      {view === 'list' ? (
        <TaskList groups={groups} />
      ) : (
        <TaskBoard tasks={visible} onMove={move} canMove={canMove} />
      )}
    </div>
  );
}
