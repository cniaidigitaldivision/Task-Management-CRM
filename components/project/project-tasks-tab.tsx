'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Flag, Layers, Plus, Search, Sun, User } from 'lucide-react';

import { changeStatusAction } from '@/app/actions/tasks';
import type { ShellPerson, ShellProject } from '@/components/layout/app-shell';
import { TaskDialog } from '@/components/task/task-dialog';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DateRange } from '@/components/ui/date-range';
import { Select } from '@/components/ui/select';
import {
  ToggleGroup,
  Toolbar,
  ToolbarGroup,
  ToolbarLabel,
  ToolbarSpacer,
} from '@/components/ui/toolbar';
import type { TaskRow } from '@/lib/db/queries/types';
import {
  CONTENT_KIND_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TOKEN,
  STATUS_META,
  type ContentKind,
  type Priority,
  type Role,
  type TaskStatus,
} from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

/* ============================================================================
 * A PROJECT'S TASKS — THE TAB, NOT A SPREADSHEET
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-22, looking at what was here:
 *
 *   *"it is just like a sheet you are showing me: reference, task, status,
 *   assigned, due… There is no note, managed by, or any filters available. It's
 *   not very interactive; it's blunt. I have to read it very carefully, like
 *   Google Sheets. I don't want that."*
 *
 * He is right, and the diagnosis matters more than the complaint. What was here
 * was five columns of raw values — `task.status.replace(/_/g, ' ')` printed the
 * database enum, `dueDate` printed an ISO string — with no filter of any kind.
 * Every question ("what is late?", "what is Najmulla on?") had to be answered by
 * reading every row.
 *
 * ── WHAT MAKES THIS DIFFERENT ────────────────────────────────────────────────
 * 1. STATE IS A SHAPE, NOT A WORD. Status is a coloured chip and priority is a
 *    coloured flag, so "three things are blocked" is visible without reading.
 * 2. LATE IS LOUD. An overdue date is coloured and says how late; a date without
 *    that treatment is one more thing to compare against today by hand.
 * 3. THE QUESTIONS ARE FILTERS. Status, assignee and category — the three things
 *    a coordinator actually asks — are controls, not something to scan for.
 * 4. IT IS STILL A TABLE. The owner asked for "a very interactive table", not
 *    for cards: forty rows of one project's work is exactly what a table is for.
 *    The fix was never to stop being a table.
 *
 * ⚠️ Filtering is CLIENT-SIDE and deliberately so. A project's task list is tens
 * of rows, already loaded, and a round trip per keystroke would make the search
 * feel worse than the spreadsheet it replaces.
 * ========================================================================= */

type StatusFilter = TaskStatus | 'all' | 'open';

const OPEN_STATUSES: readonly TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'revisions',
];

/** '2026-08-22' → 'Sat 22 Aug'. Parsed from the STRING: `new Date('2026-08-22')`
 *  is UTC midnight and reports the day before anywhere behind Greenwich. */
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDue(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m]}`;
}

/** Whole days between two ISO dates. Both are dates, so UTC is exact here. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function ProjectTasksTab({
  tasks,
  project,
  today,
  daily,
  currentUser,
  people,
}: {
  tasks: readonly TaskRow[];
  project: ShellProject;
  currentUser: { id: string; role: Role };
  people: readonly ShellPerson[];
  /** Resolved on the server — a component that reads the clock is not a pure
   *  render, and the browser can disagree about the date across midnight. */
  today: string;
  /** Everything the Today view needs. Rendered inside this tab rather than as a
   *  ninth tab: it is the same work, asked about differently, and a separate tab
   *  would mean checking two places to know whether today is finished. */
  daily: React.ReactNode;
}) {
  /* ── ⚠️ THE DEFAULT VIEW IS TODAY, NOT EVERYTHING ─────────────────────────
     Owner: *"the daily button is appearing or a filter is appearing. When he
     clicks on Daily, it shows some beautiful interactive UI."* He described it
     as a button, and it is — but it opens first, because for a social media
     manager the answer to "what am I doing" is almost always today's posts. The
     full list is one click away for the times it is not. */
  const [view, setView] = React.useState<'today' | 'all'>('today');
  /* ── ⚠️ EVERYTHING, NOT ONLY WHAT IS STILL OPEN ────────────────────────────
     Owner, 2026-08-24: *"when I click on the task, today's due task is nothing
     but all work is also showing nothing. Najmullah also did one task today
     already but maybe that is in Done. By default when I open Work, everything
     should open by default."*

     Exactly that: the default was `'open'`, and `OPEN_STATUSES` excludes done and
     cancelled. So on a project whose only work so far had been finished, the
     All-work view opened empty — and an empty list reads as "this tab is broken"
     rather than as "your filter excludes the three things you did". Filtering to
     open work is still one click away, and now it is a choice somebody made
     rather than a state they arrived in without being told. */
  const [status, setStatus] = React.useState<StatusFilter>('all');
  const [adding, setAdding] = React.useState(false);
  const [moving, setMoving] = React.useState<string | null>(null);
  const [flash, setFlash] = React.useState<{ ok: boolean; text: string } | null>(null);
  const projectId = project.id;
  const router = useRouter();

  /* A Member may move their own work and nobody else's; Coordinator and above
     may move anything. The server enforces it either way — this decides whether
     to render a control that would be refused. */
  const canMove = React.useCallback(
    (task: TaskRow) =>
      currentUser.role !== 'member' ||
      task.assigneeId === currentUser.id ||
      task.createdById === currentUser.id,
    [currentUser],
  );

  const move = async (taskId: string, next: TaskStatus) => {
    setMoving(taskId);
    setFlash(null);
    try {
      const result = await changeStatusAction(taskId, next);
      if (result.ok) {
        router.refresh();
        if (result.warning) setFlash({ ok: true, text: result.warning });
      } else {
        setFlash({ ok: false, text: result.error ?? 'That move was refused.' });
      }
    } catch {
      setFlash({ ok: false, text: 'The server did not answer. Nothing changed.' });
    } finally {
      setMoving(null);
    }
  };
  const [assignee, setAssignee] = React.useState<string>('all');
  const [kind, setKind] = React.useState<ContentKind | 'all'>('all');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [search, setSearch] = React.useState('');

  /* ⚠️ EVERY MEMBER OF THE PROJECT, NOT ONLY THOSE WITH A TASK TODAY.
     Built from the rows on screen at first, which meant somebody with nothing
     assigned was missing from the filter — so "does Yusra have anything?" could
     not be asked, and the answer to it (nothing) is exactly what a coordinator
     wants to know. Owner, 2026-08-22: *"I want all the team members that are
     present in the system to be displayed here."* */
  const assigneeOptions = React.useMemo(
    () => [...people].sort((a, b) => a.name.localeCompare(b.name)),
    [people],
  );

  const kinds = React.useMemo(() => {
    const seen = new Set<ContentKind>();
    for (const t of tasks) if (t.contentKind) seen.add(t.contentKind);
    return [...seen].sort();
  }, [tasks]);

  const visible = React.useMemo(
    () =>
      tasks.filter((t) => {
        if (status === 'open' && !OPEN_STATUSES.includes(t.status)) return false;
        if (status !== 'all' && status !== 'open' && t.status !== status) return false;
        if (assignee !== 'all' && (t.assigneeId ?? 'unassigned') !== assignee) return false;
        if (kind !== 'all' && t.contentKind !== kind) return false;

        /* ── ⚠️ A DATE RANGE, FROM AND TO ──────────────────────────────────
           This was a "next N days" dropdown first. Owner, 2026-08-23: *"I don't
           want that type of filter. I want a date range… from when to when,
           right, so I can select the date."*

           The dropdown could only ever look forward from today, so "what went
           out last week" — the question somebody asks before writing a client
           report — could not be expressed at all. Two dates can say that, and
           can still say "today" by setting both to today.

           Either end may be left empty and means unbounded on that side.
           Undated work is kept whatever the range: it has no date to be outside
           one, and dropping it would hide exactly the tasks nobody has
           scheduled, which are the ones most likely to be forgotten. */
        if (t.dueDate) {
          if (from && t.dueDate < from) return false;
          if (to && t.dueDate > to) return false;
        }
        if (search.trim()) {
          const needle = search.trim().toLowerCase();
          if (
            !t.title.toLowerCase().includes(needle) &&
            !t.reference.toLowerCase().includes(needle)
          ) {
            return false;
          }
        }
        return true;
      }),
    [tasks, status, assignee, kind, search, from, to],
  );

  /* Late first, then soonest — the order somebody triaging actually wants.
     Undated work sinks: it cannot be late and cannot be next. */
  const sorted = React.useMemo(
    () =>
      [...visible].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return a.reference.localeCompare(b.reference);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      }),
    [visible],
  );

  const overdue = sorted.filter(
    (t) => t.dueDate && t.dueDate < today && STATUS_META[t.status].category !== 'done'
      && STATUS_META[t.status].category !== 'cancelled',
  ).length;

  return (
    <Card>
      <CardBody className="space-y-3 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            label="Which view"
            value={view}
            onChange={setView}
            options={[
              { key: 'today', label: 'Today', icon: Sun },
              { key: 'all', label: 'All work', icon: Layers },
            ]}
          />

          {/* ⚠️ A BUTTON, NOT A LINK TO /tasks. Owner, 2026-08-22: *"When I click
              Add Task, the form should pop up here. Don't bring me to that task
              table or task page."*

              It used to navigate to `/tasks?project=…` because this component did
              not have the project list, the person list or the current user. The
              answer was to pass those three in, not to move the person. */}
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
            <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
            Add task
          </Button>
        </div>

        <TaskDialog
          open={adding}
          onClose={() => setAdding(false)}
          projects={[project]}
          people={people}
          currentUser={currentUser}
          /* The project is settled by where the button was pressed. */
          lockedProjectId={project.id}
        />

        {view === 'today' ? (
          daily
        ) : (
          <>
        <Toolbar>
          <ToolbarGroup>
            <ToolbarLabel>Status</ToolbarLabel>
            <Select
              label="Filter by status"
              icon={Layers}
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              options={[
                { value: 'open', label: 'Open work' },
                { value: 'all', label: 'Everything' },
                ...(Object.keys(STATUS_META) as TaskStatus[]).map((s) => ({
                  value: s,
                  label: STATUS_META[s].label,
                })),
              ]}
              className="w-[10.5rem]"
            />
          </ToolbarGroup>

          <ToolbarGroup>
            <ToolbarLabel>Who</ToolbarLabel>
            <Select
              label="Filter by assignee"
              icon={User}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              options={[
                { value: 'all', label: 'Everyone' },
                { value: 'unassigned', label: 'Unassigned' },
                ...assigneeOptions.map((p) => ({ value: p.id, label: p.name })),
              ]}
              className="w-[10.5rem]"
            />
          </ToolbarGroup>

          {kinds.length > 0 && (
            <ToolbarGroup>
              <ToolbarLabel>Category</ToolbarLabel>
              <Select
                label="Filter by category"
                icon={Flag}
                value={kind}
                onChange={(e) => setKind(e.target.value as ContentKind | 'all')}
                options={[
                  { value: 'all', label: 'All kinds' },
                  ...kinds.map((k) => ({ value: k, label: CONTENT_KIND_LABEL[k] })),
                ]}
                className="w-[11rem]"
              />
            </ToolbarGroup>
          )}

          <DateRange
            from={from}
            to={to}
            today={today}
            onFrom={setFrom}
            onTo={setTo}
            onClear={() => {
              setFrom('');
              setTo('');
            }}
          />

          <ToolbarSpacer />

          {overdue > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-micro font-semibold"
              style={{
                backgroundColor:
                  'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
                color: 'color-mix(in oklab, var(--feedback-error) 84%, var(--text-primary))',
              }}
            >
              {overdue} late
            </span>
          )}

          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-tertiary"
              aria-hidden="true"
            />
            <Input
              aria-label="Search this project’s tasks"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-[10rem] pl-8 text-caption"
            />
          </div>
        </Toolbar>

        {sorted.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-body-sm font-semibold text-text-primary">
              {tasks.length === 0 ? 'No tasks in this project yet' : 'Nothing matches those filters'}
            </p>
            <p className="mt-1 text-caption text-text-secondary">
              {tasks.length === 0 ? (
                <>
                  Use <span className="font-semibold text-text-primary">Create Content</span> above,
                  or generate the month&rsquo;s schedule from the Overview tab.
                </>
              ) : (
                <>
                  {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} are hidden by the controls
                  above.
                </>
              )}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse">
              <thead>
                <tr className="border-b border-border-default">
                  <th scope="col" className={TH}>Task</th>
                  <th scope="col" className={TH}>Status</th>
                  <th scope="col" className={TH}>Who</th>
                  <th scope="col" className={TH}>Due</th>
                  <th scope="col" className={cn(TH, 'text-right')}>Priority</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((task) => {
                  const meta = STATUS_META[task.status];
                  const closed = meta.category === 'done' || meta.category === 'cancelled';
                  const late = Boolean(task.dueDate && task.dueDate < today && !closed);
                  const dueToday = task.dueDate === today && !closed;

                  return (
                    <tr
                      key={task.id}
                      className="border-b border-border-subtle transition-colors last:border-0 hover:bg-bg-hover"
                    >
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/tasks?project=${projectId}&task=${task.id}`}
                          className="group block"
                        >
                          <span
                            className={cn(
                              'block truncate text-body-sm font-medium group-hover:underline',
                              closed ? 'text-text-secondary' : 'text-text-primary',
                            )}
                          >
                            {task.title}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-micro text-text-tertiary">
                              {task.reference}
                            </span>
                            {task.contentKind && (
                              <span className="rounded bg-bg-active px-1.5 text-micro text-text-secondary">
                                {CONTENT_KIND_LABEL[task.contentKind]}
                              </span>
                            )}
                          </span>
                        </Link>
                      </td>

                      {/* ── ⚠️ STATUS IS EDITABLE IN PLACE ────────────────────
                          Owner, 2026-08-22: *"Here I can update the task status.
                          All these start statuses should be dropdowns… if I
                          don't want to go to the task and update anything, a
                          team member wants to update any task."*

                          Everyone can SEE everyone's work here — that was
                          already true and the owner confirmed he wants it. What
                          changes is who can move it: a Member gets a control
                          only on a task that is theirs, and a read-only chip on
                          everybody else's. `changeStatusAction` refuses either
                          way; this decides whether to offer something that would
                          be refused. */}
                      <td className="px-3 py-2.5">
                        {canMove(task) ? (
                          <StatusPicker
                            task={task}
                            busy={moving === task.id}
                            onPick={(next) => move(task.id, next)}
                          />
                        ) : (
                          <Badge token={meta.token} size="sm">
                            {meta.label}
                          </Badge>
                        )}
                      </td>

                      <td className="px-3 py-2.5">
                        {task.assigneeId ? (
                          <span className="flex items-center gap-1.5">
                            <Avatar
                              name={task.assigneeName ?? '?'}
                              src={task.assigneeAvatarUrl}
                              size="xs"
                            />
                            <span className="truncate text-caption text-text-secondary">
                              {task.assigneeName}
                            </span>
                          </span>
                        ) : (
                          /* Named, not a dash. Unassigned work is a thing to act
                             on, and "—" reads as "nothing to see". */
                          <span className="text-caption text-text-tertiary italic">Unassigned</span>
                        )}
                      </td>

                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {task.dueDate ? (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 text-caption',
                              late ? 'font-semibold' : 'text-text-secondary',
                            )}
                            style={late ? { color: 'var(--feedback-error)' } : undefined}
                          >
                            <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                            {formatDue(task.dueDate)}
                            {late && (
                              <span className="font-normal">
                                · {daysBetween(task.dueDate, today)}d late
                              </span>
                            )}
                            {dueToday && (
                              <span className="font-semibold text-text-brand">· today</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-caption text-text-tertiary">—</span>
                        )}
                      </td>

                      <td className="px-3 py-2.5 text-right">
                        <Badge token={PRIORITY_TOKEN[task.priority as Priority]} size="sm" variant="soft">
                          {PRIORITY_LABEL[task.priority as Priority]}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {flash && (
          <p
            role="status"
            className={cn('text-caption', flash.ok ? 'text-text-secondary' : 'text-feedback-error')}
          >
            {flash.text}
          </p>
        )}

        <p className="text-micro text-text-tertiary">
          Showing {sorted.length} of {tasks.length}.
        </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}

const TH =
  'px-3 py-2 text-left text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase';

/**
 * The status control that sits in a table cell.
 *
 * ⚠️ Shows the CURRENT status as its value and every status as an option, rather
 * than only the legal next moves. The transition machine is the authority on
 * what is allowed and it lives on the server (doc 05 §2); duplicating its rules
 * here would put a second, drifting copy in front of the real one. An illegal
 * choice comes back with the machine's own sentence explaining why, which is
 * more useful than an option that was quietly missing.
 */
function StatusPicker({
  task,
  busy,
  onPick,
}: {
  task: TaskRow;
  busy: boolean;
  onPick: (next: TaskStatus) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: `var(--${STATUS_META[task.status].token})` }}
      />
      <Select
        size="sm"
        label={`Status of ${task.reference}`}
        value={task.status}
        disabled={busy}
        onChange={(e) => onPick(e.target.value as TaskStatus)}
        options={(Object.keys(STATUS_META) as TaskStatus[]).map((s) => ({
          value: s,
          label: STATUS_META[s].label,
        }))}
        className="w-[8.5rem]"
      />
    </span>
  );
}
