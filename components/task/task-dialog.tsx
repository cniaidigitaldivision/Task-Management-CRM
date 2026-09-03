'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { AlertTriangle, Loader2, Lock } from 'lucide-react';

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
  CONTENT_KINDS,
  CONTENT_KIND_LABEL,
  EFFORT_LABEL,
  EFFORT_SIZES,
  PRIORITIES,
  PRIORITY_LABEL,
  PROJECT_TYPE_META,
  STATUS_META,
  type EffortSize,
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

/* ============================================================================
 * EFFORT → A DUE DATE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-22: *"if one hour is selected, then the start date will be auto
 * select… but due date and due time will auto select to the effort. For example,
 * one hour then auto select same date and one hour difference… if he say that
 * the task will be completed in a two days, then due date will auto select."*
 *
 * ── ⚠️ WHY THE TWO LONGER SIZES DO NOT SET A TIME ───────────────────────────
 * An hour from now is a real moment and worth writing down. "Two to three days
 * at 4:37pm" is not — the minute is an artefact of when somebody happened to
 * open the form, and a due TIME on a multi-day task makes it overdue at an
 * arbitrary point in the afternoon. Those sizes set a date and leave the time
 * blank, which the rest of the system already reads as end of that day.
 *
 * ── WORKING DAYS, NOT CALENDAR DAYS, FOR THE WEEK ───────────────────────────
 * "A week" lands five working days out, skipping Sunday — this division posts
 * Monday to Saturday. A calendar week would put a deadline on the one day
 * nobody is working.
 * ========================================================================= */

/** Sunday is the rest day here; Mon–Sat are working days. */
function addWorkingDays(from: Date, count: number): Date {
  const out = new Date(from);
  let left = count;
  while (left > 0) {
    out.setDate(out.getDate() + 1);
    if (out.getDay() !== 0) left -= 1;
  }
  return out;
}

function dueFromEffort(size: EffortSize, from: Date): { date: string; time: string } {
  const pad = (value: number) => String(value).padStart(2, '0');
  const asDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const asTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  switch (size) {
    case 'XS': {
      const end = new Date(from.getTime() + 60 * 60 * 1000);
      return { date: asDate(end), time: asTime(end) };
    }
    case 'S': {
      const end = new Date(from.getTime() + 4 * 60 * 60 * 1000);
      return { date: asDate(end), time: asTime(end) };
    }
    case 'M':
      /* A full day: due at the end of today, so no time. */
      return { date: asDate(from), time: '' };
    case 'L':
      return { date: asDate(addWorkingDays(from, 2)), time: '' };
    case 'XL':
      return { date: asDate(addWorkingDays(from, 5)), time: '' };
  }
}

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
  /* No setter: the interval is fixed at 1 now that the "every N" box is gone.
     Read from an existing rule so editing a task that already repeats every two
     weeks does not silently rewrite it to weekly. */
  const [interval] = React.useState(parsed?.ok ? String(parsed.rule.interval) : '1');
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
            /* ── ⚠️ THIS SENTENCE DESCRIBED THE OPPOSITE BEHAVIOUR ──────────
               It read: *"The next one appears when this is marked done — not on
               a timer, so the series can never run ahead of the work."* True
               until 2026-09-03, when spawn-on-close was replaced by the
               midnight runner at the owner's instruction — and then it was a
               screen actively telling people the wrong rule.

               The owner caught it from the form itself: *"I told you that
               whether the previous task is completed or not, if it said that
               daily this task should generate then you have to generate daily.
               Then why are you showing this message?"* Nothing was wrong with
               the behaviour; the label had been left behind by it. */
            freq === 'none'
              ? 'A one-off.'
              : 'A fresh one is created automatically at midnight and assigned to the same person — whether or not the previous one is finished.'
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

        {/* ⚠️ "Every … N days/weeks/months" was a visible field and is now a
            fixed 1. Owner, 2026-08-22, listing the only types he wants:
            *"daily tasks, weekly tasks, monthly tasks, or do not repeat."*

            Nobody at this division runs a rhythm of "every third week", and the
            box was one more thing to read and get wrong on a form used several
            times a day. Kept as a hidden field rather than removed from the
            payload, because the recurrence rule the server stores still has an
            interval and would otherwise arrive malformed. */}
        <input type="hidden" name="repeatInterval" value={interval} />
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
  lockedProjectId,
}: {
  open: boolean;
  onClose: () => void;
  projects: readonly ShellProject[];
  people: readonly ShellPerson[];
  currentUser: { id: string; role: Role };
  /** Present when editing. Absent when creating. */
  task?: TaskRow;
  /** Known Drive folders, to suggest in the link fields. Empty is fine — the
   *  fields still accept any URL. */
  /**
   * ⚠️ Accepted and deliberately UNUSED since 2026-08-22.
   *
   * It fed the "Raw material" and "Finished file" suggestions, which the owner
   * removed from this form — those belong to the daily completion flow, where a
   * Drive folder is actually pickable against a finished asset. The prop is kept
   * so the callers that already pass it do not have to change twice: the daily
   * flow needs exactly this list.
   */
  driveFolders?: readonly { id: string; name: string; driveFolderId: string }[];
  /** Pre-selects the starting status. Set by a board column's "Add task", so a
   *  card created from the Blocked column does not arrive in To Do. */
  defaultStatus?: TaskStatus;
  /** Pre-selects the assignee. Set when the Tasks screen is already filtered to
   *  one person — arriving from their row on Team — so the task lands on the
   *  person whose list you were looking at. Still changeable. */
  defaultAssigneeId?: string;
  /** Set by a project's own Tasks tab. The project is then context rather than a
   *  question: shown as a fact and posted as a hidden field, never a dropdown. */
  lockedProjectId?: string;
}) {
  const isEdit = Boolean(task);
  const router = useRouter();
  const toast = useToast();

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

  const [projectId, setProjectId] = React.useState(
    task?.projectId ?? lockedProjectId ?? projects[0]?.id ?? '',
  );
  const lockedProject = lockedProjectId
    ? (projects.find((p) => p.id === lockedProjectId) ?? null)
    : null;
  const selected = projects.find((p) => p.id === (lockedProject?.id ?? projectId));
  const needsOtherDescription = selected?.type === 'other';

  /* ── EFFORT, AND THE DUE DATE IT WRITES ────────────────────────────────────
     Owner: *"the start date and due date and time will auto select by the
     effort."* Held as state rather than read off the DOM so the two due fields
     can be rewritten whenever the estimate changes — and still typed over
     afterwards, because the estimate is a default, not a rule.

     ⚠️ Seeded from the task when editing and left ALONE in that case. Reopening
     a task from three weeks ago and having its due date silently jump to today
     plus one hour would be a data change nobody asked for. */
  const [effort, setEffort] = React.useState<EffortSize>(task?.effortSize ?? 'M');

  /* Seeded from the default effort on create, so the form opens with a due date
     already in it rather than filling one in a moment later. */
  const seed = isEdit ? null : dueFromEffort(task?.effortSize ?? 'M', now);
  const [dueDate, setDueDate] = React.useState(task?.dueDate ?? seed?.date ?? '');
  const [dueTime, setDueTime] = React.useState(task?.dueTime ?? seed?.time ?? '');

  /* ── ⚠️ WRITTEN IN THE CHANGE HANDLER, NOT AN EFFECT ──────────────────────
     The first version watched `effort` with a `useEffect` and called setState
     inside it. That works and `react-hooks/set-state-in-effect` refuses it,
     correctly: an effect that only ever runs because a value it derives from
     changed is a render the component did not need. Recomputing where the
     change actually happens is one pass instead of two, and it also stops the
     effect from overwriting a due date somebody has just typed. */
  const chooseEffort = (size: EffortSize) => {
    setEffort(size);
    if (isEdit) return;
    const next = dueFromEffort(size, new Date());
    setDueDate(next.date);
    setDueTime(next.time);
  };

  /* A Member can only ever assign to themselves, so there is nothing to choose.
     `assignable` below is already filtered to one; this decides whether to show
     a control at all.

     ⚠️ Applies when EDITING too, not just creating. The select was still shown
     on edit, and although it listed only the Member themselves it also offered
     "Unassigned" — so the one thing a Member could do with it was give their own
     task away to nobody. `updateTaskAction` now refuses an assignee change from
     a Member outright; this stops the control existing to be tried. */
  const isSelfOnly = currentUser.role === 'member';

  /* The server asks for an override reason by saying so in the error. Showing
     the box only once it has been asked for keeps the ordinary path clean —
     nobody should see a "reason for overriding" field on a task that is not
     overriding anything. */
  const overrideAsked = Boolean(state.error && /reason to proceed|reason is required/i.test(state.error));

  /* ── ⚠️ FIRES ONCE — THE SAME TRAP THE PROJECT DIALOG HAD ─────────────────
     `useRouter()` returns a new object identity on every render, so `router` in
     the dependency array makes this eligible to re-run on each one — and
     `router.refresh()` below causes renders. `state.ok` stays true, so anything
     that ACCUMULATES runs again and again. The project dialog produced ten
     stacked notices from one project before this was understood; the shape was
     identical here and would have done the same the moment a notice was added.

     A ref, not state: setting state here would itself cause the render that
     re-runs the effect. */
  const announced = React.useRef(false);

  React.useEffect(() => {
    if (state.ok && !announced.current) {
      announced.current = true;

      /* ── Only on CREATE, and the reference is the useful part ──────────────
         Owner, 2026-09-03: *"same way when new Task created, successful
         notification should appear."* An edit already shows its result on the
         board behind the dialog; a new task may be filed on a page that does
         not list it, which is why this one carries a link.

         ⚠️ A capacity advisory turns the notice ORANGE rather than green. The
         task WAS created, so it is not an error — but "you have just put them
         over their limit" is not a success either, and colouring it green would
         hide the one sentence worth reading. */
      if (isEdit) {
        /* ⚠️ Edits announce too, because REASSIGNING is an edit. Owner,
           2026-09-03: *"if I say it, 'Reassign to someone,' that notification
           should display."* No link: they are already looking at the task. */
        toast({
          tone: state.warning ? 'warn' : 'ok',
          text: state.warning
            ? `${task?.reference ?? 'The task'} updated. ${state.warning}`
            : `${task?.reference ?? 'The task'} updated.`,
        });
      } else if (state.taskId) {
        toast({
          tone: state.warning ? 'warn' : 'ok',
          text: state.warning
            ? `${state.reference ?? 'The task'} is created. ${state.warning}`
            : `${state.reference ?? 'The task'} is created.`,
          href: `/tasks?task=${state.taskId}`,
          linkLabel: 'Open it',
        });
      }

      router.refresh();
      onClose();
    }
  }, [
    state.ok,
    state.taskId,
    state.reference,
    state.warning,
    isEdit,
    task?.reference,
    onClose,
    router,
    toast,
  ]);

  // Members cannot hand work to anyone else (doc 03 §3.3).
  const assignable = currentUser.role === 'member'
    ? people.filter((p) => p.id === currentUser.id)
    : people;

  /* ── ⚠️ A NEW TASK DEFAULTS TO THE PERSON RAISING IT ──────────────────────
     Owner, 2026-09-03: *"when he creates a task auto select should be Kashif…
     but by default the Kashif himself is selected."*

     It defaulted to Unassigned, which is the wrong bet: the common case is
     somebody writing down work they are about to do, and an unassigned task
     belongs to nobody, appears on nobody's board, and — since the review flow
     of 2026-09-02 — has no assignee for BR-002 to hold apart from the reviewer.
     Handing it to somebody else is the deliberate act and stays one choice away.

     ⚠️ ONLY ON CREATE. On an edit the task's own assignee wins, INCLUDING when
     that is deliberately nobody: `task?.assigneeId ?? self` would have quietly
     assigned every unassigned task to whoever opened it to change a due date.

     ⚠️ AND ONLY IF THEY ARE ACTUALLY ASSIGNABLE. On a project they are not a
     member of, the creator is not in `assignable`, and defaulting to a name the
     select cannot show would submit an id the server then refuses. */
  const defaultAssignee = isEdit
    ? (task?.assigneeId ?? '')
    : (defaultAssigneeId ??
      (assignable.some((person) => person.id === currentUser.id) ? currentUser.id : ''));

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

        {/* ── ⚠️ LABELS ARE WRITTEN FOR A SOCIAL MEDIA MANAGER ─────────────────
            Owner, 2026-08-22: *"write the labels in such a way that could be
            easily understandable… they are just social media manager. They can
            understand little things."*

            "What needs doing?" is a project manager's phrasing — it asks for a
            description when the field wants a name. Every label on this form was
            reviewed against that: say the noun the person is about to type. */}
        <Field label="Name the task" htmlFor="title" hint="One line. What is it?">
          <Input
            id="title"
            name="title"
            defaultValue={task?.title ?? ''}
            placeholder="Eid sale post — Instagram"
            required
            autoFocus
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* ── ⚠️ LOCKED WHEN THE PROJECT IS ALREADY THE ANSWER ────────────────
              Owner: *"in the tasks tab, it should auto select or auto
              understandable that this all task and any new task created here is
              assigned to that project whose project is clicked."*

              Opened from inside a project, the project is not a question — it is
              context. Rendering a dropdown there invites a wrong answer for no
              benefit, and picking the wrong project is the exact mistake the
              owner described somebody making. Shown as a fact, posted as a
              hidden field, still a real dropdown everywhere else. */}
          {lockedProject ? (
            <Field label="Project" hint="Set by the project you are in.">
              <div className="flex h-9 items-center gap-2 rounded-lg border border-border-subtle bg-bg-subtle px-3">
                <Lock className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
                <span className="truncate text-body-sm text-text-primary">{lockedProject.name}</span>
              </div>
              <input type="hidden" name="projectId" value={lockedProject.id} />
            </Field>
          ) : (
            <Field label="Project" htmlFor="projectId" hint="Every task belongs to exactly one.">
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
          )}

          {/* ── ⚠️ A MEMBER SEES THEIR OWN NAME, NOT A DROPDOWN OF ONE ──────────
              Owner: *"any member who create his task, definitely that task is
              assigned to that person."* A Member could only ever pick themselves
              — `assignable` has already filtered the list to one — so a select
              is a control that cannot do anything. Worse, it defaulted to
              "Unassigned", so a Member creating their own task got a task
              belonging to nobody unless they noticed.

              Coordinator and above still choose, because assigning to somebody
              else is exactly what their rank is for. */}
          {isSelfOnly ? (
            <Field label="Assigned to" hint="Your own task.">
              <div className="flex h-9 items-center gap-2 rounded-lg border border-border-subtle bg-bg-subtle px-3">
                <Lock className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
                <span className="truncate text-body-sm text-text-primary">
                  {people.find((p) => p.id === currentUser.id)?.name ?? 'You'}
                </span>
              </div>
              <input type="hidden" name="assigneeId" value={currentUser.id} />
            </Field>
          ) : (
            <Field
              label="Assigned to"
              htmlFor="assigneeId"
              hint="You, unless you hand it to somebody on this project."
            >
              <Select
                size="md"
                id="assigneeId"
                name="assigneeId"
                defaultValue={defaultAssignee}
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
          )}
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

          {/* ── ⚠️ EFFORT DRIVES THE DUE DATE ───────────────────────────────────
              Owner: *"if he say that under one hour, then the start date will be
              auto select… but due date and due time will auto select to the
              effort… I hope you get my point."*

              Four date and time boxes is three too many for somebody logging a
              post. The one thing they genuinely know is how long it will take, so
              that is the only thing asked for — the dates follow from it and stay
              editable for the rare case that is wrong.

              The XS–XL scale is kept because the whole capacity and workload
              engine is built on its points; only the LABEL leads with time now.
              Replacing the scale with real durations would have meant reworking
              the workload maths for a wording change. */}
          <Field
            label="How long will it take?"
            htmlFor="effortSize"
            hint="Fills in the due date below."
          >
            <Select
              size="md"
              id="effortSize"
              name="effortSize"
              value={effort}
              onChange={(event) => chooseEffort(event.target.value as EffortSize)}
              required
            >
              {EFFORT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {EFFORT_LABEL[size]}
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

          {/* Controlled, unlike every other input on this form: these two are the
              ones the effort control writes into. `defaultValue` is read once at
              mount and would ignore every later change. */}
          <Field label="Due date" htmlFor="dueDate" hint="Filled in from the effort. Change it if you need to.">
            <Input
              id="dueDate"
              name="dueDate"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>

          <Field label="Due time" htmlFor="dueTime" hint="Blank means end of that day.">
            <Input
              id="dueTime"
              name="dueTime"
              type="time"
              value={dueTime}
              onChange={(event) => setDueTime(event.target.value)}
            />
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

          {/* ⚠️ "Time limit" was here and is gone. Owner, 2026-08-22: *"he's
              saying that one hour, then due time will auto select, right? So I
              think so we can exclude this time limit."* It asked the same
              question as the effort control in a different unit, and two fields
              that disagree about how long something takes is worse than one.

              The COLUMN survives — `tasks.time_limit_minutes`, the timer and the
              extension-request flow all still work and are still reachable from a
              task's own page. It is only off the create form, where it was making
              somebody answer twice. */}
        </div>

        <RepeatField initial={task?.recurrenceRule ?? null} />

        {/* ══ CATEGORY ══════════════════════════════════════════════════════════
            ⚠️ THIS BLOCK WAS FOUR FIELDS AND IS NOW ONE.

            Owner, 2026-08-22: *"published on, exclude this field. Raw material
            exclude it, and finish file also exclude it… every post will be a
            different URL. So we can't take it as a single task, right? So we
            will deal them separately."* Confirmed by the ✓/× marks on the
            notebook page: Details ✓, Publish on ×, Raw material ×, Finished
            file ×.

            The reasoning is his, and it is correct. Those three describe what
            happened to a deliverable AFTER the work — a URL, a date, a folder —
            and they were being asked for at the moment the task is created, when
            all three are necessarily empty. On a daily post they are also not
            singular: one task can go out on three platforms with three different
            links, which no single "Published on" field can hold.

            They move to the daily completion flow, where they are answerable.
            `tasks.published_on`, `source_drive_url` and `asset_drive_url` all
            still exist and are still written — just not from here.

            Category stays, and stays on the create form, because it is the one
            thing that must be decided up front: it is what makes the task
            countable against the package target. */}
        <Field
          label="Category"
          htmlFor="contentKind"
          hint="What this produces. Leave blank if it is not a client deliverable."
        >
          <Select
            size="md"
            id="contentKind"
            name="contentKind"
            defaultValue={task?.contentKind ?? ''}
            options={[
              { value: '', label: 'Not a deliverable' },
              ...CONTENT_KINDS.map((k) => ({
                value: k,
                label: CONTENT_KIND_LABEL[k],
              })),
            ]}
          />
        </Field>

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
