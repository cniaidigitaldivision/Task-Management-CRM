'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';

import {
  createProjectAction,
  updateProjectAction,
  type ProjectActionResult,
} from '@/app/actions/projects';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { ProjectRow } from '@/lib/db/queries/types';
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
    { name: 'event_date', label: 'Event date', type: 'date', hint: 'Deliverables schedule backwards from this.' },
    { name: 'venue', label: 'Venue', placeholder: 'Karachi Expo Centre, Hall 3' },
    /* Owner instruction, Session 20: *"the scale should become a dropdown… I
       should not write what the scale is."* It was a free-text box whose
       placeholder was the word `large`, so every project recorded a slightly
       different spelling of the same three ideas. */
    { name: 'expected_scale', label: 'Expected scale', options: ['Small', 'Medium', 'Large'] },
  ],
  client: [
    { name: 'client_name', label: 'Client name', placeholder: 'ABC Traders' },
    { name: 'contact_person', label: 'Contact person' },
    { name: 'contact_email', label: 'Contact email', type: 'email' },
    { name: 'contact_phone', label: 'Contact phone' },
    { name: 'engagement_type', label: 'Engagement', placeholder: 'retainer or project' },
    {
      name: 'retainer_hours_per_month',
      label: 'Retainer hours a month',
      type: 'number',
      hint: 'Leave blank for project work.',
    },
    { name: 'priority_tier', label: 'Priority tier', placeholder: 'A' },
  ],
  business: [
    { name: 'objective', label: 'Objective', placeholder: 'Convert more inbound enquiries' },
    { name: 'area', label: 'Area', placeholder: 'Marketing' },
    { name: 'target_completion', label: 'Target completion', type: 'date' },
  ],
  self_promotion: [
    { name: 'channel', label: 'Channel', placeholder: 'Instagram + YouTube' },
    { name: 'campaign_goal', label: 'Goal', placeholder: 'Reach and credibility' },
    { name: 'target_publish_date', label: 'Target publish date', type: 'date' },
  ],
  other: [
    { name: 'requested_by', label: 'Who asked for this?' },
    {
      name: 'reason_not_a_project',
      label: 'Why is this not a project?',
      hint: 'Surfaced in the Other audit, so ad-hoc work stays measurable (doc 15 §6).',
    },
  ],
};

export function ProjectDialog({
  open,
  onClose,
  people,
  project,
}: {
  open: boolean;
  onClose: () => void;
  people: ReadonlyArray<{ id: string; name: string }>;
  /** Present when editing. */
  project?: ProjectRow;
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
  const fields = TYPE_FIELD_FORMS[type];

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
          ? 'The type is fixed once tasks carry its reference prefix.'
          : 'The type decides what the form asks for, and the reference prefix every task in it will carry.'
      }
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
      <form id="project-form" action={formAction} className="space-y-4">
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

        <Field label="Project name" htmlFor="name">
          <Input
            id="name"
            name="name"
            defaultValue={project?.name ?? ''}
            placeholder="Expo Karachi — Oct 2026"
            required
            autoFocus
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {!isEdit && (
            <Field
              label="Type"
              htmlFor="type"
              hint={`References will read ${PROJECT_TYPE_META[type].code}-101, ${PROJECT_TYPE_META[type].code}-102…`}
            >
              <Select
                size="md"
                id="type"
                name="type"
                value={type}
                onChange={(event) => setType(event.target.value as ProjectType)}
                required
              >
                {PROJECT_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {PROJECT_TYPE_META[option].label} ({PROJECT_TYPE_META[option].code})
                  </option>
                ))}
              </Select>
            </Field>
          )}

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

        {/* Same rule as the task form (CHANGE-PLAN 3.1): start pre-filled with
            now, end left empty. `type="time"` uses the browser's own picker, so
            AM/PM appears on a 12-hour locale without the form choosing for
            anybody, and it always posts 24-hour "HH:MM". */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" htmlFor="startDate">
            <Input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={project?.startDate ?? (isEdit ? '' : today)}
            />
          </Field>
          <Field label="Start time" htmlFor="startTime" hint="Optional.">
            <Input
              id="startTime"
              name="startTime"
              type="time"
              defaultValue={project?.startTime ?? (isEdit ? '' : nowTime)}
            />
          </Field>
          <Field label="Target end date" htmlFor="targetEndDate">
            <Input
              id="targetEndDate"
              name="targetEndDate"
              type="date"
              defaultValue={project?.targetEndDate ?? ''}
            />
          </Field>
          <Field label="Target end time" htmlFor="targetEndTime" hint="Optional.">
            <Input
              id="targetEndTime"
              name="targetEndTime"
              type="time"
              defaultValue={project?.targetEndTime ?? ''}
            />
          </Field>
        </div>

        <Field label="Description" htmlFor="description">
          <Textarea
            id="description"
            name="description"
            rows={2}
            defaultValue={project?.description ?? ''}
          />
        </Field>

        {/* ---- The type-specific half of the form (doc 15 §3) ---- */}
        <fieldset className="space-y-4 rounded-xl border border-border-subtle bg-bg-surface-sunken p-4">
          <legend className="px-1 text-micro font-semibold tracking-[0.08em] text-text-tertiary uppercase">
            {PROJECT_TYPE_META[type].label} details
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
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
        </fieldset>
      </form>
    </Dialog>
  );
}
