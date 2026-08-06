'use client';

import * as React from 'react';
import { CalendarDays, Columns3, EyeOff, Flag, Layers, List, Sparkles, User } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { IconTile } from '@/components/ui/icon-tile';
import { ViewTabs, type ViewTab } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  ToggleButton,
  ToggleGroup,
  Toolbar,
  ToolbarGroup,
  ToolbarLabel,
  ToolbarSpacer,
} from '@/components/ui/toolbar';
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

      {/* ---- Toolbar ----
          Every control here now takes its height, padding, radius and type from
          components/ui/control.ts, so the row is one straight line instead of
          four different heights. The Toolbar itself wraps rather than pushing
          the page sideways. */}
      <Toolbar aria-label="Task filters">
        {view === 'list' && (
          <ToolbarGroup>
            <ToolbarLabel>
              <Layers className="mr-1 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={2} />
              Group
            </ToolbarLabel>
            <ToggleGroup label="Group tasks by" options={GROUP_OPTIONS} value={groupBy} onChange={setGroupBy} />
          </ToolbarGroup>
        )}

        {/* Priority moved from five segments to a select. Five segments plus a
            caption is ~320px of a row that also has to hold three other
            controls — the single widest thing in the old toolbar. */}
        <ToolbarGroup>
          <ToolbarLabel>Priority</ToolbarLabel>
          <Select
            label="Filter by priority"
            icon={Flag}
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority | 'all')}
            options={[
              { value: 'all', label: 'Any priority' },
              ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] })),
            ]}
            className="w-[9.5rem]"
          />
        </ToolbarGroup>

        <ToolbarGroup>
          <ToolbarLabel>Assignee</ToolbarLabel>
          <Select
            label="Filter by assignee"
            icon={User}
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            options={[
              { value: 'all', label: 'Everyone' },
              ...assignees.map((name) => ({ value: name, label: name })),
            ]}
            className="w-[11rem]"
          />
        </ToolbarGroup>

        <ToggleButton pressed={!hideClosed} onChange={(next) => setHideClosed(!next)} icon={EyeOff}>
          {hideClosed ? 'Closed hidden' : 'Closed shown'}
        </ToggleButton>

        <ToolbarSpacer />

        {/* ---- Acting role — preview only, and visibly so ---- */}
        <ToolbarGroup>
          <ToolbarLabel>Preview as</ToolbarLabel>
          <Select
            label="Preview the board as a different role"
            value={actingRole}
            onChange={(event) => setActingRole(event.target.value as Role)}
            options={ROLES.map((role) => ({ value: role, label: ROLE_LABEL[role] }))}
            className="w-[10.5rem] border-border-gold bg-bg-gold-subtle"
            title="Preview control — shows how the board behaves for each role. Removed when real sessions land in Step 4."
          />
        </ToolbarGroup>
      </Toolbar>

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
