'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Columns3,
  EyeOff,
  Flag,
  Layers,
  List,
  Loader2,
  RotateCw,
  User,
} from 'lucide-react';

import { changeStatusAction, type ActionResult } from '@/app/actions/tasks';
import type { ShellPerson, ShellProject } from '@/components/layout/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
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
  PRIORITIES,
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  STATUS_META,
  type Priority,
  type Role,
  type TaskStatus,
} from '@/lib/domain/constants';
import { evaluateTransition, transitionNeedsReason } from '@/lib/domain/task-machine';
import type { TaskView } from '@/lib/view/task-view';
import { cn } from '@/lib/utils';

import { BulkBar } from './bulk-bar';
import { TaskDialog } from './task-dialog';
import { TaskBoard } from './task-board';
import { TaskDetail } from './task-detail';
import { TaskList, groupTasks, type GroupBy } from './task-list';

/* ============================================================================
 * TASKS WORKSPACE — the interactive shell around both views
 * ----------------------------------------------------------------------------
 * doc 10 §3. Holds the view mode, the filters, and the optimistic task order.
 *
 * ── EVERY MOVE IS REAL NOW, AND THAT CHANGED THE DESIGN ──────────────────────
 * When drag-and-drop was local state, an illegal drop could simply be refused.
 * Now a drop writes to the database, and three things follow from that:
 *
 * 1. THE MOVE IS OPTIMISTIC, THEN RECONCILED. A card that waits for a round trip
 *    before it moves feels broken; a card that moves and then silently reverts is
 *    worse. So it moves immediately, and on refusal it snaps back *with the
 *    server's reason shown* — the refusal is the feature (BR-002 exists to be
 *    seen), not an error to hide.
 *
 * 2. SOME MOVES STOP AND ASK. Blocked, Cancelled and Revisions all require a
 *    written reason (FR-043, doc 05 §2), so those drops open a prompt instead of
 *    committing. Asking afterwards would mean writing a row that violates its own
 *    check constraint.
 *
 * 3. LEGALITY IS CHECKED TWICE, ON PURPOSE. `evaluateTransition` runs here so an
 *    impossible drop is refused before the network, and it runs again in the
 *    server action because the client's copy of the rules is a convenience, never
 *    the authority. Same function, same table, one implementation.
 * ========================================================================= */

/* The Calendar tab was `disabled: true` — a control that could never be clicked
   (owner instruction, Session 20). It now navigates to the calendar screen,
   which already exists and is already role-scoped by RLS. The month-and-week
   view lands with Batch 7 of CHANGE-PLAN.md; until then this is a real
   destination rather than a dead tab. */
const VIEW_TABS: readonly ViewTab[] = [
  { key: 'list', label: 'List', icon: List },
  { key: 'board', label: 'Board', icon: Columns3 },
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
];

const GROUP_OPTIONS: ReadonlyArray<{ key: GroupBy; label: string }> = [
  { key: 'status', label: 'Status' },
  { key: 'project', label: 'Project' },
  { key: 'assignee', label: 'Assignee' },
];

export function TasksWorkspace({
  initialTasks,
  currentUser,
  people,
  projects,
  initialSearch = '',
  initialOpenTaskId = null,
  initialAssignee = null,
}: {
  initialTasks: readonly TaskView[];
  currentUser: { id: string; name: string; role: Role };
  people: readonly ShellPerson[];
  projects: readonly ShellProject[];
  initialSearch?: string;
  /** Opens straight into this task — see the drawer state below. */
  initialOpenTaskId?: string | null;
  /** From `?assignee=…`, set when arriving from somebody's row on Team. */
  initialAssignee?: string | null;
}) {
  const router = useRouter();

  const [tasks, setTasks] = React.useState<readonly TaskView[]>(initialTasks);
  const [view, setView] = React.useState<'list' | 'board'>('board');
  const [groupBy, setGroupBy] = React.useState<GroupBy>('status');
  const [priority, setPriority] = React.useState<Priority | 'all'>('all');
  /* Seeded from `?assignee=…`. The server already filtered the rows, so leaving
     this at "all" meant the toolbar said "Everyone" while showing one person's
     work — the filter was invisible and could not be cleared. */
  const [assignee, setAssignee] = React.useState<string>(initialAssignee ?? 'all');
  /* Only for the create dialog's default. `assignee` is a FILTER and the person
     may change it; this remembers who you arrived here for. */
  const [arrivedFor] = React.useState<string | null>(initialAssignee);
  const [hideClosed, setHideClosed] = React.useState(true);
  const [search, setSearch] = React.useState(initialSearch);
  const [pending, setPending] = React.useState(false);
  const [flash, setFlash] = React.useState<{ tone: 'error' | 'warn' | 'ok'; text: string } | null>(null);
  /* Seeded from `?task=…` so a notification, an email or the Admin's extension
     queue can link straight to the task rather than to a list the person then
     has to search. */
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(initialOpenTaskId);
  /* Bulk selection. Board only — a list row is already a click target for
     opening the task, and putting a second one inside it makes both worse. */
  const [selectedIds, setSelectedIds] = React.useState<readonly string[]>([]);

  /* A reason-requiring move parks here until the person writes one. */
  const [reasonFor, setReasonFor] = React.useState<{ task: TaskView; to: TaskStatus } | null>(null);
  const [reasonText, setReasonText] = React.useState('');

  /* ── Creating from a board column ──────────────────────────────────────────
     Owner report, Session 20: *"there is a button called Add — when I click it,
     it does not show the form."* It did nothing at all: the button in each board
     column had a class and no handler. It opens the create form now, with that
     column's status already chosen.

     This dialog is separate from the one the top bar's "New task" opens, which
     lives in the app shell. They are mutually exclusive and each carries its own
     defaults; hoisting one shared dialog up to the shell would mean threading
     board state through the layout for no gain. */
  const [addToStatus, setAddToStatus] = React.useState<TaskStatus | null>(null);

  /* ── Refresh, and dropping the assignee filter with it ─────────────────────
     Owner instruction: *"there should be a refresh button… it should remove the
     assignee variable from the URL and then refresh the task page."* The filter
     lived only in the URL, so it survived every reload and quietly kept the page
     narrowed to one person long after that was wanted. */
  const [refreshing, setRefreshing] = React.useState(false);

  const refreshAll = React.useCallback(() => {
    setRefreshing(true);
    setAssignee('all');

    /* ⚠️ `replace` and `refresh` must not both fire. Calling them together left
       the URL untouched — measured: the filter reset to Everyone while
       `?assignee=…` was still in the address bar. `refresh()` re-fetches the
       CURRENT route, so it raced the navigation and won.
       Navigating to a different query string already re-fetches from the
       server, so `replace` alone is both the clear and the refresh. */
    if (window.location.search) {
      router.replace('/tasks', { scroll: false });
    } else {
      router.refresh();
    }

    /* The spinner only shows the click registered; the navigation has no
       completion callback to hang it on. */
    setTimeout(() => setRefreshing(false), 600);
  }, [router]);

  /* ── Adopting fresher server data, WITHOUT an effect ────────────────────────
     The server is the source of truth. When a revalidation delivers a new list,
     the optimistic copy has to be replaced — otherwise a move made a moment ago
     would keep overwriting somebody else's newer change.

     This is React's "adjust state when props change" pattern rather than an
     effect: setting state during render re-renders immediately, before anything
     is painted. An effect would paint the stale list first and then replace it,
     which is a visible flicker — and the compiler lint rejects it for exactly
     that reason.

     The previous value is held in state, not a ref: a ref read during render is
     invisible to React's dependency tracking, and the compiler lint rejects that
     for the same reason it rejects the effect. */
  const [lastFromServer, setLastFromServer] = React.useState(initialTasks);
  if (lastFromServer !== initialTasks) {
    setLastFromServer(initialTasks);
    setTasks(initialTasks);
    /* Drop any selection pointing at rows that may no longer exist. Keeping it
       would let a bulk action fire at a task somebody else has since closed. */
    if (selectedIds.length > 0) setSelectedIds([]);
  }

  React.useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(timer);
  }, [flash]);

  const visible = React.useMemo(
    () =>
      tasks.filter((t) => {
        if (priority !== 'all' && t.priority !== priority) return false;
        if (assignee !== 'all' && (t.assigneeId ?? 'unassigned') !== assignee) return false;
        if (hideClosed) {
          const category = STATUS_META[t.status].category;
          if (category === 'done' || category === 'cancelled') return false;
        }
        if (search.trim()) {
          const needle = search.trim().toLowerCase();
          if (
            !t.title.toLowerCase().includes(needle) &&
            !t.reference.toLowerCase().includes(needle) &&
            !t.projectName.toLowerCase().includes(needle)
          ) {
            return false;
          }
        }
        return true;
      }),
    [tasks, priority, assignee, hideClosed, search],
  );

  const points = visible.reduce((sum, t) => sum + t.effortPoints, 0);
  const groups = React.useMemo(() => groupTasks(visible, groupBy), [visible, groupBy]);

  /* ---- The move ---------------------------------------------------------- */

  const commit = React.useCallback(
    async (task: TaskView, to: TaskStatus, reason?: string) => {
      const previous = task.status;
      setPending(true);
      // Optimistic: the card moves now.
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: to } : t)));

      let result: ActionResult;
      try {
        result = await changeStatusAction(task.id, to, reason);
      } catch {
        result = { ok: false, error: 'The change could not be saved. Nothing was altered.' };
      }

      if (!result.ok) {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: previous } : t)));
        setFlash({ tone: 'error', text: result.error ?? 'That move was refused.' });
      } else {
        setFlash({
          tone: 'ok',
          text: `${task.reference} moved to ${STATUS_META[to].label}.`,
        });
        router.refresh();
      }
      setPending(false);
    },
    [router],
  );

  const move = React.useCallback(
    (taskId: string, to: TaskStatus) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      /* FR-043 — ask first. A reason collected after the write is a write that
         cannot happen: the check constraint refuses the row. */
      if (transitionNeedsReason(task.status, to)) {
        setReasonText('');
        setReasonFor({ task, to });
        return;
      }
      void commit(task, to);
    },
    [tasks, commit],
  );

  /* ---- Drop legality ----------------------------------------------------
   * One question to lib/domain/task-machine.ts, which is doc 05 §2's transition
   * table as data. This component holds no rules of its own — and the same
   * function runs again on the server, so a tampered client gains nothing. */
  const canMove = React.useCallback(
    (task: TaskView, to: TaskStatus): string | null => {
      const verdict = evaluateTransition(task.status, to, {
        actorRole: currentUser.role,
        actorId: currentUser.id,
        assigneeId: task.assigneeId,
        createdById: task.createdById,
        // A reason is collected by the prompt, so it must not fail legality here.
        reason: 'pending',
      });
      return verdict.ok ? null : verdict.message;
    },
    [currentUser.id, currentUser.role],
  );

  const assigneeOptions = React.useMemo(() => {
    const present = new Map<string, string>();
    for (const task of tasks) present.set(task.assigneeId ?? 'unassigned', task.assignee);
    return [...present.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  return (
    <div className="space-y-4">
      {/* ---- Result of the last action ---- */}
      {flash && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-xl border px-4 py-3"
          style={
            flash.tone === 'error'
              ? {
                  borderColor: 'color-mix(in oklab, var(--feedback-error) 35%, transparent)',
                  backgroundColor:
                    'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
                }
              : {
                  borderColor: 'color-mix(in oklab, var(--feedback-success) 35%, transparent)',
                  backgroundColor:
                    'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
                }
          }
        >
          {flash.tone === 'error' ? (
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
          ) : (
            <CheckCircle2
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-success)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
          )}
          <p className="text-caption text-text-primary">{flash.text}</p>
        </div>
      )}

      <ViewTabs
        tabs={VIEW_TABS.map((tab) =>
          tab.key === 'calendar' ? tab : { ...tab, count: visible.length },
        )}
        activeKey={view}
        onSelect={(key) => {
          /* Calendar is a page, not a third view of this component. */
          if (key === 'calendar') {
            router.push('/calendar');
            return;
          }
          setView(key as 'list' | 'board');
        }}
      />

      <Toolbar aria-label="Task filters">
        {view === 'list' && (
          <ToolbarGroup>
            <ToolbarLabel>
              <Layers className="mr-1 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={2} />
              Group
            </ToolbarLabel>
            <ToggleGroup
              label="Group tasks by"
              options={GROUP_OPTIONS}
              value={groupBy}
              onChange={setGroupBy}
            />
          </ToolbarGroup>
        )}

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
              ...assigneeOptions.map(([id, name]) => ({ value: id, label: name })),
            ]}
            className="w-[11rem]"
          />
        </ToolbarGroup>

        <ToggleButton pressed={!hideClosed} onChange={(next) => setHideClosed(!next)} icon={EyeOff}>
          {hideClosed ? 'Closed hidden' : 'Closed shown'}
        </ToggleButton>

        <ToolbarSpacer />

        {pending && (
          <span className="inline-flex items-center gap-1.5 text-micro text-text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Saving…
          </span>
        )}

        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={refreshAll}
          disabled={refreshing}
          title="Reload from the server and clear the assignee filter"
        >
          <RotateCw
            className={cn('h-4 w-4', refreshing && 'animate-spin')}
            strokeWidth={2}
            aria-hidden="true"
          />
          Refresh
        </Button>
      </Toolbar>

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
        {search.trim() && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="text-micro font-semibold text-text-brand hover:underline"
          >
            Clear “{search.trim()}”
          </button>
        )}
        {priority !== 'all' && (
          <Badge token={PRIORITY_TOKEN[priority]} size="sm">
            {PRIORITY_LABEL[priority]} only
          </Badge>
        )}
      </div>

      {view === 'list' ? (
        <TaskList groups={groups} onOpen={setOpenTaskId} />
      ) : (
        <TaskBoard
          tasks={visible}
          onMove={move}
          /* ── Board order is a SESSION preference, not a saved one ───────────
             There is no ordering column on `tasks` — only `checklist_items`
             has a `sort_order` — so a card dropped at the top of a column stays
             there until the next revalidation replaces this list wholesale.
             Persisting it is a migration, and migrations wait for permission
             (rule R1). Recorded in REDESIGN-PLAN §8.

             Only ever a permutation: the task objects themselves are untouched,
             so this cannot fight `move`'s optimistic status update or its
             rollback when the server refuses. */
          onReorder={(orderedIds) =>
            setTasks((all) => {
              const rank = new Map(orderedIds.map((id, index) => [id, index]));
              const slots: number[] = [];
              all.forEach((task, index) => {
                if (rank.has(task.id)) slots.push(index);
              });
              const reordered = slots
                .map((index) => all[index])
                .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
              const next = [...all];
              slots.forEach((slot, index) => {
                next[slot] = reordered[index];
              });
              return next;
            })
          }
          canMove={canMove}
          onOpen={setOpenTaskId}
          onAddTask={setAddToStatus}
          selectedIds={selectedIds}
          onToggleSelect={(taskId) =>
            setSelectedIds((current) =>
              current.includes(taskId)
                ? current.filter((id) => id !== taskId)
                : [...current, taskId],
            )
          }
        />
      )}

      {/* ---- Create, from a board column ----
           Opened by "Add task" at the foot of a column, which until now did
           nothing at all. Carries that column's status, and the person the page
           was opened for if it arrived from their row on Team. */}
      <TaskDialog
        open={addToStatus !== null}
        onClose={() => setAddToStatus(null)}
        projects={projects}
        people={people}
        currentUser={{ id: currentUser.id, role: currentUser.role }}
        defaultStatus={addToStatus ?? undefined}
        defaultAssigneeId={arrivedFor ?? undefined}
      />

      {view === 'board' && (
        <BulkBar
          selectedIds={selectedIds}
          onClear={() => setSelectedIds([])}
          onDone={() => router.refresh()}
          people={people.map((person) => ({ id: person.id, name: person.name }))}
        />
      )}

      {/* ---- The reason prompt (FR-043) ---- */}
      <Dialog
        open={reasonFor !== null}
        onClose={() => setReasonFor(null)}
        title={
          reasonFor
            ? `Move ${reasonFor.task.reference} to ${STATUS_META[reasonFor.to].label}`
            : 'Reason'
        }
        description={
          reasonFor?.to === 'blocked'
            ? 'Say what is blocking it. Whoever picks this up needs to know what to unblock — a blocked task with no reason is useless to them (FR-043).'
            : reasonFor?.to === 'revisions'
              ? 'Say what needs changing. This reason is the brief the assignee works from.'
              : 'Say why. Cancelled work stays on the record with its reason attached.'
        }
        size="sm"
        footer={
          <>
            <Button type="button" variant="ghost" size="md" onClick={() => setReasonFor(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={!reasonText.trim() || pending}
              onClick={async () => {
                if (!reasonFor) return;
                const { task, to } = reasonFor;
                setReasonFor(null);
                await commit(task, to, reasonText);
              }}
            >
              {reasonFor ? `Move to ${STATUS_META[reasonFor.to].label}` : 'Confirm'}
            </Button>
          </>
        }
      >
        <Textarea
          value={reasonText}
          onChange={(event) => setReasonText(event.target.value)}
          rows={3}
          autoFocus
          placeholder={
            reasonFor?.to === 'blocked'
              ? 'Waiting on final creative approval from the client.'
              : 'What changed, and why.'
          }
          aria-label="Reason"
        />
      </Dialog>

      {/* ---- Task detail ---- */}
      <TaskDetail
        taskId={openTaskId}
        onClose={() => setOpenTaskId(null)}
        currentUser={currentUser}
        people={people}
        projects={projects}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
