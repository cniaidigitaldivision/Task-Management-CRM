'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Building,
  CalendarRange,
  FileText,
  Handshake,
  Loader2,
  Megaphone,
  Package,
  Tent,
} from 'lucide-react';

import {
  createProjectAction,
  updateProjectAction,
  type ProjectActionResult,
} from '@/app/actions/projects';
import { Button } from '@/components/ui/button';
import { ChoiceCards } from '@/components/ui/choice-card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ToggleGroup } from '@/components/ui/toolbar';
import { cn } from '@/lib/utils';
import type { ProjectRow } from '@/lib/db/queries/types';

import { PackageFields } from './package-fields';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_REQUIRES_REASON,
  PROJECT_TYPES,
  PROJECT_TYPE_META,
  type ProjectStatus,
  type ProjectType,
} from '@/lib/domain/constants';

/* ============================================================================
 * CREATE / EDIT A PROJECT
 * ----------------------------------------------------------------------------
 * ── THE FORM CHANGES SHAPE WITH THE TYPE ─────────────────────────────────────
 * That is doc 15 §3's whole point, and it is the difference between a project
 * record and a folder with a name. An Event asks for its date and venue and then
 * schedules backwards from it; a Client asks who the contact is and whether the
 * work is billable; anything filed under Other has to say who asked for it and
 * why it is not a real project.
 *
 * Forty fields on one form, mostly greyed out, would communicate none of that.
 *
 * ── WHAT THE FORM DOES *NOT* SEND ────────────────────────────────────────────
 * The reference prefix. `EVT` / `CLI` / `BIZ` is derived from the type on the
 * server, because a Client project created with the code `EVT` would make every
 * task in it lie about what kind of work it is — permanently, since references
 * are never rewritten.
 * ========================================================================= */

const EMPTY: ProjectActionResult = { ok: false };

/** Doc 15 §3, and the labels a human would actually use. */
const TYPE_FIELD_FORMS: Record<
  ProjectType,
  ReadonlyArray<{
    name: string;
    label: string;
    type?: string;
    hint?: string;
    placeholder?: string;
    /** Present ⇒ rendered as a `<select>` rather than a free-text box. */
    options?: readonly string[];
  }>
> = {
  event: [
    /* `event_date` is gone: it duplicated `start_date`, which is a real column
       the calendar, the workload window and every report already read. Two
       places recording when the event is, is how they start disagreeing. */
    { name: 'venue', label: 'Venue', placeholder: 'Karachi Expo Centre, Hall 3' },
    {
      name: 'expected_attendance',
      label: 'Expected attendance',
      type: 'number',
      placeholder: '400',
    },
  ],
  client: [
    { name: 'client_name', label: 'Client name', placeholder: 'ABC Traders' },
    { name: 'contract_end', label: 'Contract end', type: 'date' },
    { name: 'contact_person', label: 'Contact person' },
    { name: 'contact_email', label: 'Contact email', type: 'email' },
    { name: 'contact_phone', label: 'Contact phone' },
  ],
  business: [{ name: 'target_completion', label: 'Target completion', type: 'date' }],
  self_promotion: [
    { name: 'target_publish_date', label: 'Target publish date', type: 'date' },
  ],
  other: [{ name: 'requested_by', label: 'Who asked for this?' }],
};

/* ── ⚠️ NINE FIELDS REMOVED, 2026-08-19 ──────────────────────────────────────
   Owner: *"some are very extra things you have added in a project page."*
   Audited in docs/PROJECTS-REDESIGN.md §6. Gone from here and from `TYPE_FIELDS`
   in app/actions/projects.ts in the same change, because a field in one list and
   not the other either renders-and-is-dropped or is-stored-and-never-shown.

     priority_tier · expected_scale · retainer_hours_per_month ·
     internal_sponsor · reason_not_a_project · objective · area ·
     campaign_goal · channel · engagement_type

   Two are worth their own note:

   `channel` was the actively harmful one — "Instagram + YouTube" as prose, which
   is why no report could ever count platforms. It is now `project_platforms`
   rows, ticked in `PackageFields`.

   `engagement_type` (Retainer / One-off) is superseded by the package: a project
   with a package IS a retainer, and one with only services is not.

   `SHARED_TYPE_FIELDS` is gone entirely — it existed solely to ask every type
   for `expected_scale`, which no report ever read. The package now says how big
   the work is, in assets and money. */

/* ── The event duration, which decides what the date fields mean ──────────────
   Owner instruction: *"there should be an option of event length — if it is one
   day then it is only one due date, and if it is multiple days then it should
   be from the start time to the due time."*

   A single-day event still has two TIMES (09:00 to 17:00) but only one DATE, so
   asking for an end date is asking a question with one possible answer. The
   target end date is hidden in that case and submitted as the start date, which
   keeps the stored shape identical for both — every report, the calendar and
   the `projects_dates_ordered` constraint carry on reading two dates. */
type EventDuration = 'single' | 'multi';

/* ── The type cards (owner request 2026-08-19) ────────────────────────────────
   *"The form just looks like plain blank paper… make it something very intriguing
   and very interesting to fill out."*

   The type was a `<select>`, which is the wrong control for the most consequential
   answer on the form: it decides which questions get asked AND the reference prefix
   every task in the project carries for ever. Hiding four of five options behind a
   click made a permanent decision feel like a formality.

   `PROJECT_TYPE_META` already names an icon and a colour token per type — they were
   being used by the board and the badges and not here. These map its icon NAMES to
   the real components, because the meta lives in `lib/domain/` and may not import
   React (doc 20 §1). */
const TYPE_ICONS: Record<ProjectType, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  client: Handshake,
  event: Tent,
  business: Building,
  self_promotion: Megaphone,
  other: Package,
};

/** One line each, so the cards answer "which one is mine?" without a manual. */
const TYPE_HINTS: Record<ProjectType, string> = {
  client: 'Paid work for somebody outside the division',
  event: 'Has a date it must be ready for',
  business: 'Internal build — a site, a system, a deck',
  self_promotion: "The division's own marketing",
  other: 'Anything that is not really a project',
};

/* ----------------------------------------------------------------------------
 * A SECTION PLATE
 * ----------------------------------------------------------------------------
 * The form was one flat column of twenty fields in a single scroll — the "blank
 * paper" the owner described. It is the same twenty fields; what changed is that
 * they are now grouped, numbered and led by an icon, so the reader always knows
 * which of four questions they are answering and how much is left.
 *
 * Numbered rather than merely titled: a count is what turns a wall into a sequence,
 * and it is the cheapest possible progress indicator. A real wizard was considered
 * and rejected — hiding step 1 while step 3 is open unmounts its inputs, so either
 * they vanish from the submitted FormData or `required` fires on a field the browser
 * cannot scroll to ("not focusable"). One form, four plates, no traps.
 * ------------------------------------------------------------------------- */
function Section({
  step,
  total,
  title,
  hint,
  icon: Icon,
  children,
  className,
}: {
  step: number;
  total: number;
  title: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--accent-primary) var(--tint-medium), var(--bg-surface))',
            color: 'var(--accent-primary)',
          }}
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-baseline gap-x-2 text-body-sm font-semibold text-text-primary">
            {title}
            <span className="text-micro font-medium tabular-nums text-text-tertiary">
              {step} of {total}
            </span>
          </h3>
          {hint && <p className="mt-0.5 text-micro text-text-secondary">{hint}</p>}
        </div>
      </div>
      {/* The rail runs down the centre of the 28px icon tile (14px in) and the
          content resumes at 38px — the icon's width plus the 10px gap above — so
          the fields line up with the heading rather than with the number. */}
      <div className="ml-[14px] space-y-3 border-l border-border-subtle pl-[24px]">
        {children}
      </div>
    </section>
  );
}

export function ProjectDialog({
  open,
  onClose,
  people,
  project,
  canSeeFinance = false,
}: {
  open: boolean;
  onClose: () => void;
  people: ReadonlyArray<{ id: string; name: string }>;
  /** Present when editing. */
  project?: ProjectRow;
  /**
   * `project.view_finance` — Admin and above. Owner, 2026-08-19: *"this monthly fee
   * or any financial thing should only be visible to super admin and admin only."*
   *
   * ⚠️ Defaults to FALSE. A money field that appears because somebody forgot to
   * pass a prop is the failure that matters here; one that is missing until wired is
   * merely inconvenient.
   */
  canSeeFinance?: boolean;
}) {
  const isEdit = Boolean(project);

  /* "Now", read on every render. Same reasoning as task-dialog.tsx: `Dialog`
     renders `{open && …}`, so these inputs mount fresh each time it opens and
     `defaultValue` is only read then — which also means a tab left open
     overnight cannot pre-fill yesterday. LOCAL date parts, not `toISOString()`,
     which returns UTC and hands back tomorrow east of Greenwich. */
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const router = useRouter();

  const [state, formAction, pending] = React.useActionState(
    isEdit ? updateProjectAction : createProjectAction,
    EMPTY,
  );

  const [type, setType] = React.useState<ProjectType>(project?.type ?? 'client');
  const [status, setStatus] = React.useState<ProjectStatus>(project?.status ?? 'active');

  const needsReason = PROJECT_STATUS_REQUIRES_REASON.includes(status);
  /* Scale is asked of everything, then the type's own questions. */
  const fields = TYPE_FIELD_FORMS[type];

  const [duration, setDuration] = React.useState<EventDuration>(
    (project?.typeFields?.duration as EventDuration) ?? 'single',
  );
  const isSingleDayEvent = type === 'event' && duration === 'single';

  /* Controlled, because a single-day event submits this same value as its end
     date — a `defaultValue` would leave the hidden field holding whatever the
     date was when the dialog opened, so changing the date would silently move
     the start without moving the end. */
  const [startDate, setStartDate] = React.useState(
    project?.startDate ?? (isEdit ? '' : today),
  );

  /* The live reference preview needs the name as it is typed, so this one field is
     controlled where the rest are `defaultValue`. Worth the exception: watching
     "CLI-101 · ABC Traders" assemble itself is the difference between filling in a
     form and building something. */
  const [name, setName] = React.useState(project?.name ?? '');

  React.useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [state.ok, onClose, router]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${project?.name}` : 'New project'}
      description={
        isEdit
          ? 'Four sections. The type is fixed once tasks carry its reference prefix.'
          : 'Four short sections. Only the name is required — everything else can be filled in later.'
      }
      /* `lg`, up from the default `md`. The type and package pickers are
         three-column card grids; at max-w-2xl the cards wrapped to one per row and
         lost the side-by-side comparison that is the whole reason they are cards. */
      size="lg"
      footer={
        <>
          <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="project-form" variant="primary" size="md" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create project'}
          </Button>
        </>
      }
    >
      {/* `space-y-6` between plates and `space-y-3` inside them — the sections have
          to read as separate questions rather than as one continuous list, which is
          what the flat `space-y-4` produced. */}
      <form id="project-form" action={formAction} className="space-y-6">
        {isEdit && <input type="hidden" name="projectId" value={project?.id} />}
        {isEdit && <input type="hidden" name="type" value={project?.type} />}

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

        {/* ── The masthead ─────────────────────────────────────────────────────
            A brand-tinted strip carrying the reference that is being created. It
            exists because the reference prefix is permanent and was previously only
            described in a hint nobody reads — here it assembles as you choose, so
            the consequence of the type is visible at the moment you pick it. */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3.5 py-3"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--accent-primary) var(--tint-soft), var(--bg-surface))',
            border: '1px solid color-mix(in oklab, var(--accent-primary) 20%, transparent)',
          }}
        >
          <span
            className="rounded-md px-2 py-1 text-caption font-semibold tracking-[0.04em] tabular-nums"
            style={{
              backgroundColor: `var(--${PROJECT_TYPE_META[type].token})`,
              color: 'var(--text-on-brand)',
            }}
          >
            {PROJECT_TYPE_META[type].code}-101
          </span>
          <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-text-primary">
            {name.trim() || (
              <span className="font-normal text-text-tertiary">Name it below…</span>
            )}
          </span>
          {/* ⚠️ REMOVED, 2026-08-19: a trailing "every task here will carry CLI-".
              Owner: *"the CLI 101 name is below every task here. Will it carry CLI?
              This notification is appearing in the form. I don't want it, I don't
              know what it is so remove it."*

              It was explaining the reference prefix to somebody who had not asked,
              at the exact moment they were trying to name a project — and it read as
              a system notice rather than as a caption. The badge alone is enough:
              the code appears, and the projects list and every task reference show
              the same shape, which teaches it in context. */}
        </div>

        <Section
          step={1}
          total={4}
          title="What kind of work is this?"
          hint={
            isEdit
              ? 'The type is fixed once tasks carry its reference prefix.'
              : 'This decides what the rest of the form asks — and the prefix every task keeps for ever.'
          }
          icon={TYPE_ICONS[type]}
        >
          {!isEdit ? (
            <ChoiceCards
              ariaLabel="Project type"
              name="type"
              value={type}
              onChange={(next) => setType(next as ProjectType)}
              columns={3}
              choices={PROJECT_TYPES.map((option) => ({
                value: option,
                label: PROJECT_TYPE_META[option].label,
                meta: PROJECT_TYPE_META[option].code,
                hint: TYPE_HINTS[option],
                icon: TYPE_ICONS[option],
                token: PROJECT_TYPE_META[option].token,
              }))}
            />
          ) : (
            <p className="text-caption text-text-secondary">
              {PROJECT_TYPE_META[type].label} · references read {PROJECT_TYPE_META[type].code}-101
            </p>
          )}

          <Field label="Project name" htmlFor="name">
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Expo Karachi — Oct 2026"
              required
              autoFocus
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* "Lead", not "Owner" — owner instruction, Session 20: *"so it is
                easily understandable who is leading the project."* Label only; the
                column stays `owner_id` and nothing downstream changes. */}
            <Field label="Lead" htmlFor="ownerId" hint="Who is leading this project.">
              <Select size="md" id="ownerId" name="ownerId" defaultValue={project?.ownerId ?? ''}>
                <option value="">You</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Status" htmlFor="status">
              <Select
                size="md"
                id="status"
                name="status"
                value={status}
                onChange={(event) => setStatus(event.target.value as ProjectStatus)}
              >
                {PROJECT_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {option.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {needsReason && (
            <Field
              label={status === 'on_hold' ? 'Why is it on hold?' : 'Why was it cancelled?'}
              htmlFor="statusReason"
              hint="Required. The database refuses the row without it — work does not stop silently."
            >
              <Textarea
                id="statusReason"
                name="statusReason"
                rows={2}
                defaultValue={project?.statusReason ?? ''}
                required
              />
            </Field>
          )}
        </Section>

        <Section
          step={2}
          total={4}
          title="When does it run?"
          hint="All optional — but the calendar and the workload window both read these."
          icon={CalendarRange}
        >
        {/* Same rule as the task form (CHANGE-PLAN 3.1): start pre-filled with
            now, end left empty. `type="time"` uses the browser's own picker, so
            AM/PM appears on a 12-hour locale without the form choosing for
            anybody, and it always posts 24-hour "HH:MM". */}
        {/* ---- How long is it? Events only, and it changes the dates below ---- */}
        {type === 'event' && (
          <Field
            label="How long is the event?"
            htmlFor="duration"
            hint="A single day still has a start and an end time — it just does not need a second date."
          >
            <ToggleGroup
              label="Event length"
              value={duration}
              onChange={setDuration}
              options={[
                { key: 'single', label: 'One day' },
                { key: 'multi', label: 'Several days' },
              ]}
            />
            <input type="hidden" name="duration" value={duration} />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={isSingleDayEvent ? 'Date' : 'Start date'} htmlFor="startDate">
            <Input
              id="startDate"
              name="startDate"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </Field>
          <Field
            label={isSingleDayEvent ? 'Starts at' : 'Start time'}
            hint="Optional."
            htmlFor="startTime"
          >
            <Input
              id="startTime"
              name="startTime"
              type="time"
              defaultValue={project?.startTime ?? (isEdit ? '' : nowTime)}
            />
          </Field>

          {/* On a single day there is one possible answer to "which day does it
              end", so it is not asked. The value is still submitted, so the
              stored shape is identical either way. */}
          {isSingleDayEvent ? (
            <input type="hidden" name="targetEndDate" value={startDate} />
          ) : (
            <Field label="Target end date" htmlFor="targetEndDate">
              <Input
                id="targetEndDate"
                name="targetEndDate"
                type="date"
                defaultValue={project?.targetEndDate ?? ''}
              />
            </Field>
          )}

          <Field
            label={isSingleDayEvent ? 'Ends at' : 'Target end time'}
            hint="Optional."
            htmlFor="targetEndTime"
          >
            <Input
              id="targetEndTime"
              name="targetEndTime"
              type="time"
              defaultValue={project?.targetEndTime ?? ''}
            />
          </Field>
        </div>

        </Section>

        {/* ---- What we sold them (owner request 2026-08-19) ----
            The commercial shape: internal/external, client, package, and the
            targets the package suggests and the owner then adjusts. */}
        <Section
          step={3}
          total={4}
          title="What was sold"
          hint="The package fills these in; what you save is what this client was promised."
          icon={Handshake}
        >
          <PackageFields
            canSeeFinance={canSeeFinance}
            initial={{
              staticPostsPerDay: project?.staticPostsPerDay ?? null,
              reelsPerWeek: project?.reelsPerWeek ?? null,
              reelDays: project?.reelDays ?? [],
              postingDays: project?.postingDays ?? [],
              clientKind: project?.clientKind ?? null,
              clientId: project?.clientId ?? null,
              packageId: project?.packageId ?? null,
              monthlyFeePkr: project?.monthlyFeePkr ?? null,
              assetsTargetMin: project?.assetsTargetMin ?? null,
              assetsTargetMax: project?.assetsTargetMax ?? null,
              reelsTargetMin: project?.reelsTargetMin ?? null,
              renewsOn: project?.renewsOn ?? null,
              platformIds: project?.platforms.map((p) => p.id) ?? [],
            }}
          />
        </Section>

        {/* ---- The type-specific half of the form (doc 15 §3) ---- */}
        <Section
          step={4}
          total={4}
          title={`${PROJECT_TYPE_META[type].label} details`}
          hint={`The questions only a ${PROJECT_TYPE_META[type].label.toLowerCase()} project needs.`}
          icon={FileText}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <Field key={field.name} label={field.label} htmlFor={field.name} hint={field.hint}>
                {field.options ? (
                  <Select
                    size="md"
                    id={field.name}
                    name={field.name}
                    defaultValue={String(project?.typeFields?.[field.name] ?? '')}
                  >
                    <option value="">Not set</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={field.name}
                    name={field.name}
                    type={field.type ?? 'text'}
                    placeholder={field.placeholder}
                    defaultValue={String(project?.typeFields?.[field.name] ?? '')}
                  />
                )}
              </Field>
            ))}
          </div>

          <Field
            label="Description"
            htmlFor="description"
            hint="Optional. What it is for, in a sentence."
          >
            <Textarea
              id="description"
              name="description"
              rows={2}
              placeholder="Monthly social retainer — two platforms, reels weekly."
              defaultValue={project?.description ?? ''}
            />
          </Field>
        </Section>
      </form>
    </Dialog>
  );
}
