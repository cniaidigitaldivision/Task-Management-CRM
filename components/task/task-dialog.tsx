'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { createTaskAction, updateTaskAction, type ActionResult } from '@/app/actions/tasks';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import {
  WEEKDAY_CODES,
  WEEKDAY_LABEL,
  parseRecurrence,
} from '@/lib/domain/recurrence';
import {
  EFFORT_LABEL,
  EFFORT_POINTS,
  EFFORT_SIZES,
  PRIORITIES,
  PRIORITY_LABEL,
  PROJECT_TYPE_META,
  STATUS_META,
  type Role,
  type TaskStatus,
} from '@/lib/domain/constants';
import type { TaskRow } from '@/lib/db/queries/types';

import type { ShellPerson, ShellProject } from '@/components/layout/app-shell';

/* ============================================================================
 * CREATE / EDIT A TASK
 * ----------------------------------------------------------------------------
 * One form for both, because they validate identically and a second near-copy
 * would be the first place the two drifted apart.
 *
 * ── THREE THINGS THE FORM DOES THAT MATTER ───────────────────────────────────
 *
 * 1. THE "OTHER" DESCRIPTION APPEARS AND DISAPPEARS. Pick a project whose type
 *    is Other and a required field materialises asking what the work actually
 *    is (BR-012). It is not a hidden field that fails on submit — the point of
 *    doc 15 is to make ad-hoc work *visible*, and the form is where that starts.
 *
 * 2. EFFORT IS A SIZE, NOT A NUMBER. "A full day" instead of "4". Asking a
 *    designer for capacity points invites 3.5 and 7, and the number is the
 *    engine's unit, not a human's. The points are derived (doc 05 §5).
 *
 * 3. THE CAPACITY REFUSAL IS RECOVERABLE. When the server blocks an assignment
 *    for being over the limit (BR-003), the reason box appears in place rather
 *    than the form being cleared — so an Admin can authorise it in one step and
 *    everyone else can see exactly why they cannot.
 * ========================================================================= */

const EMPTY: ActionResult = { ok: false };

/**
 * The repeat control.
 *
 * ── IT SAYS WHEN THE NEXT ONE APPEARS, BECAUSE THAT IS THE SURPRISING PART ───
 * Every calendar app creates the whole series up front. This one creates the
 * next instance when the current one is marked done, so a weekly report three
 * weeks late is one task three weeks old rather than four tasks implying four
 * separate pieces of work. That is the better behaviour and it is not what
 * anybody expects, so the control explains itself rather than leaving somebody
 * to discover it by waiting.
 */
function RepeatField({ initial }: { initial: string | null }) {
  const parsed = initial ? parseRecurrence(initial) : null;
  const [freq, setFreq] = React.useState(parsed?.ok ? parsed.rule.freq : 'none');
  const [interval, setInterval] = React.useState(
    parsed?.ok ? String(parsed.rule.interval) : '1',
  );
  const [days, setDays] = React.useState<string[]>(parsed?.ok ? [...parsed.rule.byDay] : []);

  return (
    <div className="space-y-2">
      {/* Two columns, matching every other row on this form. The first draft
          had a w-40 select beside a w-20 number box with the word "every"
          between them — a third and fourth width on a form that is meant to
          have one. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Repeats"
          htmlFor="repeatFreq"
          hint={
            freq === 'none'
              ? 'A one-off.'
              : 'The next one appears when this is marked done — not on a timer, so the series can never run ahead of the work.'
          }
        >
          <Select
            id="repeatFreq"
            name="repeatFreq"
            size="md"
            value={freq}
            onChange={(event) => setFreq(event.target.value as typeof freq)}
          >
            <option value="none">Does not repeat</option>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </Select>
        </Field>

        {freq !== 'none' && (
          <Field
            label={`Every … ${freq === 'DAILY' ? 'days' : freq === 'WEEKLY' ? 'weeks' : 'months'}`}
            htmlFor="repeatInterval"
            hint="1 is every one."
          >
            <Input
              id="repeatInterval"
              name="repeatInterval"
              type="number"
              min="1"
              max="52"
              value={interval}
              onChange={(event) => setInterval(event.target.value)}
            />
          </Field>
        )}
      </div>

      {freq === 'WEEKLY' && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {WEEKDAY_CODES.map((code) => {
            const on = days.includes(code);
            return (
              <label
                key={code}
                className={`cursor-pointer rounded-lg border px-2.5 py-1 text-micro font-semibold ${
                  on
                    ? 'border-transparent bg-[image:var(--gradient-brand)] text-text-on-brand'
                    : 'border-border-subtle text-text-secondary hover:bg-bg-hover'
                }`}
              >
                <input
                  type="checkbox"
                  name="repeatByDay"
                  value={code}
                  checked={on}
                  onChange={(event) =>
                    setDays((current) =>
                      event.target.checked
                        ? [...current, code]
                        : current.filter((d) => d !== code),
                    )
                  }
                  className="sr-only"
                />
                {WEEKDAY_LABEL[code].slice(0, 3)}
              </label>
            );
          })}
          <p className="w-full text-micro text-text-tertiary">
            Leave all unticked to repeat on the same weekday as this one.
          </p>
        </div>
      )}
    </div>
  );
}

export function TaskDialog({
  open,
  onClose,
  projects,
  people,
  currentUser,
  task,
  defaultStatus,
  defaultAssigneeId,
}: {
  open: boolean;
  onClose: () => void;
  projects: readonly ShellProject[];
  people: readonly ShellPerson[];
  currentUser: { id: string; role: Role };
  /** Present when editing. Absent when creating. */
  task?: TaskRow;
  /** Pre-selects the starting status. Set by a board column's "Add task", so a
   *  card created from the Blocked column does not arrive in To Do. */
  defaultStatus?: TaskStatus;
  /** Pre-selects the assignee. Set when the Tasks screen is already filtered to
   *  one person — arriving from their row on Team — so the task lands on the
   *  person whose list you were looking at. Still changeable. */
  defaultAssigneeId?: string;
}) {
  const isEdit = Boolean(task);
  const router = useRouter();

  /* ── "Now", read on every render, which is the simplest correct thing ──────
     Not memoised. `Dialog` renders `{open && …}`, so these inputs are mounted
     fresh each time it opens and `defaultValue` is only read at that moment —
     an uncontrolled input keeps whatever has been typed regardless of what
     re-renders compute afterwards.

     That also fixes the case a memo would have to work around: a tab left open
     overnight would otherwise pre-fill yesterday's date, and nobody re-reads a
     field that already has a value in it.

     Safe to read the clock in a client component here, because these fields do
     not exist during the server render at all — there is nothing to hydrate
     against and so nothing to mismatch.

     Built from the LOCAL date parts, not `toISOString()`. That returns UTC, so
     anywhere east of Greenwich late in the evening it hands back tomorrow. */
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const [state, formAction, pending] = React.useActionState(
    isEdit ? updateTaskAction : createTaskAction,
    EMPTY,
  );

  const [projectId, setProjectId] = React.useState(task?.projectId ?? projects[0]?.id ?? '');
  const selected = projects.find((p) => p.id === projectId);
  const needsOtherDescription = selected?.type === 'other';

  /* The server asks for an override reason by saying so in the error. Showing
     the box only once it has been asked for keeps the ordinary path clean —
     nobody should see a "reason for overriding" field on a task that is not
     overriding anything. */
  const overrideAsked = Boolean(state.error && /reason to proceed|reason is required/i.test(state.error));

  React.useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [state.ok, onClose, router]);

  // Members cannot hand work to anyone else (doc 03 §3.3).
  const assignable = currentUser.role === 'member'
    ? people.filter((p) => p.id === currentUser.id)
    : people;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${task?.reference}` : 'New task'}
      description={
        isEdit
          ? 'Changes are logged, and raising the estimate re-checks the assignee’s capacity.'
          : 'Every task belongs to a project and carries an estimate — that is what makes the workload figures real.'
      }
      footer={
        <>
          <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" variant="primary" size="md" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <form id="task-form" action={formAction} className="space-y-4">
        {isEdit && <input type="hidden" name="taskId" value={task?.id} />}

        {state.error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
              border: '1px solid color-mix(in oklab, var(--feedback-error) 32%, transparent)',
            }}
          >
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-caption text-text-primary">{state.error}</p>
          </div>
        )}

        <Field label="What needs doing?" htmlFor="title">
          <Input
            id="title"
            name="title"
            defaultValue={task?.title ?? ''}
            placeholder="Edit the exhibition showreel — 30s vertical"
            required
            autoFocus
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project" htmlFor="projectId" hint="Every task belongs to exactly one (BR-011).">
            <Select
              size="md"
              id="projectId"
              name="projectId"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              required
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {PROJECT_TYPE_META[project.type as keyof typeof PROJECT_TYPE_META]?.label ?? project.type}
                  {' · '}
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Assignee" htmlFor="assigneeId" hint="Leave unassigned to plan it first.">
            <Select
              size="md"
              id="assigneeId"
              name="assigneeId"
              defaultValue={task?.assigneeId ?? defaultAssigneeId ?? ''}
            >
              <option value="">Unassigned</option>
              {assignable.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {person.roleTitle ? ` — ${person.roleTitle}` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* BR-012 — ad-hoc work has to explain itself, or "Other" becomes the
            drawer everything gets shoved into and doc 15's purpose is lost. */}
        {needsOtherDescription && (
          <Field
            label="What is this work?"
            htmlFor="otherDescription"
            hint="Required for Other projects. This is what makes ad-hoc work measurable instead of invisible (BR-012)."
          >
            <Textarea
              id="otherDescription"
              name="otherDescription"
              rows={2}
              defaultValue={task?.otherDescription ?? ''}
              placeholder="Favour for a former client — no billing. Roughly two hours."
              required
            />
          </Field>
        )}

        {/* ── ONE GRID, ONE COLUMN WIDTH ────────────────────────────────────
            This used to be a three-column row followed by two-column rows, so
            Priority and Effort sat visibly narrower than Project and Assignee
            directly above them. Owner: "some placeholders are bigger than the
            others and some are smaller."

            Every short field now pairs into the SAME two-column grid, and
            anything long spans it. Nothing is sized to its content. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Priority" htmlFor="priority">
            <Select size="md" id="priority" name="priority" defaultValue={task?.priority ?? 'medium'} required>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABEL[priority]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Effort" htmlFor="effortSize" hint="Sets the capacity cost.">
            <Select size="md" id="effortSize" name="effortSize" defaultValue={task?.effortSize ?? 'M'} required>
              {EFFORT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} — {EFFORT_LABEL[size]} ({EFFORT_POINTS[size]} pts)
                </option>
              ))}
            </Select>
          </Field>

          {/* ── DATE AND TIME, AND WHY ONLY ONE OF THEM IS PRE-FILLED ──────────
              Owner instruction, CHANGE-PLAN 3.1: *"the start date should
              auto-fill with the current time and date, and the due should only
              be left empty to select."*

              Start is pre-filled because work that is being created is, almost
              always, work starting now — and a date somebody has to type every
              time is a date most people leave blank. Due is deliberately empty:
              a guessed deadline nobody chose is worse than no deadline, because
              it looks like a commitment and drives the overdue count.

              `type="time"` renders the browser's own picker, which follows the
              operating system's clock format — so AM/PM appears for anybody set
              to a 12-hour locale without the form hard-coding either. It always
              POSTS 24-hour "HH:MM", which is what Postgres `time` wants. */}
          <Field label="Start date" htmlFor="startDate">
            <Input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={task?.startDate ?? (isEdit ? '' : today)}
            />
          </Field>

          <Field label="Start time" htmlFor="startTime" hint="Optional.">
            <Input
              id="startTime"
              name="startTime"
              type="time"
              defaultValue={task?.startTime ?? (isEdit ? '' : nowTime)}
            />
          </Field>

          <Field label="Due date" htmlFor="dueDate">
            <Input id="dueDate" name="dueDate" type="date" defaultValue={task?.dueDate ?? ''} />
          </Field>

          <Field label="Due time" htmlFor="dueTime" hint="Optional — blank means end of that day.">
            <Input id="dueTime" name="dueTime" type="time" defaultValue={task?.dueTime ?? ''} />
          </Field>

          {/* Paired deliberately: on create these two fill a row, and on edit
              the status control is gone so the time limit takes the left cell
              with the right one empty. A lone field stretched to full width
              would be a third distinct width on the same form. */}
          {!isEdit && (
            <Field label="Starting status" htmlFor="status">
              <Select
                size="md"
                id="status"
                name="status"
                defaultValue={
                  defaultStatus && (['backlog', 'todo', 'in_progress'] as const).includes(
                    defaultStatus as 'backlog' | 'todo' | 'in_progress',
                  )
                    ? defaultStatus
                    : 'todo'
                }
              >
                {/* Only the three a task may legally START in (doc 05 §2). A
                    board column further along still opens the form — it just
                    cannot pre-select a status the task machine would refuse. */}
                {(['backlog', 'todo', 'in_progress'] as const).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_META[status].label}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field label="Time limit" htmlFor="timeLimitHours" hint="Hours. Blank for none.">
            <Input
              id="timeLimitHours"
              name="timeLimitHours"
              type="number"
              min="0"
              step="0.5"
              defaultValue={task?.timeLimitMinutes ? task.timeLimitMinutes / 60 : ''}
            />
          </Field>
        </div>

        <RepeatField initial={task?.recurrenceRule ?? null} />

        <Field label="Detail" htmlFor="description" hint="Brief, links, references — anything the person needs.">
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={task?.description ?? ''}
          />
        </Field>

        {overrideAsked && (
          <Field
            label="Reason for going over the limit"
            htmlFor="overrideReason"
            hint="Logged against the task and visible in the audit trail (BR-003)."
          >
            <Textarea id="overrideReason" name="overrideReason" rows={2} required />
          </Field>
        )}
      </form>
    </Dialog>
  );
}
