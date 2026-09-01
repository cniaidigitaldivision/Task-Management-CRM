'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CalendarOff, Gauge, Loader2, Pencil, Plus, UserPlus, X } from 'lucide-react';

import {
  addAvailabilityAction,
  removeSkillAction,
  setSkillAction,
  updateCapacityAction,
  type PeopleActionResult,
} from '@/app/actions/people';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { ProgressBar } from '@/components/ui/progress';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { ToggleGroup, Toolbar, ToolbarGroup, ToolbarLabel } from '@/components/ui/toolbar';
import { InviteDialog } from './invite-dialog';
import type { ResetTrailView } from '@/lib/view/reset-trail';

import { PersonActions } from './person-actions';
import type { PersonWorkload } from '@/lib/db/queries/workload';
import type { AvailabilityRow, PersonRow, SkillRow, UserSkillRow } from '@/lib/db/queries/types';
import {
  AVAILABILITY_TYPES,
  ROLE_LABEL,
  WORKLOAD_BAND_META,
  type Role,
} from '@/lib/domain/constants';

/* ============================================================================
 * TEAM — doc 10 §6, FR-010 to FR-017
 * ----------------------------------------------------------------------------
 * One row per person, carrying the four things that decide whether they can take
 * work: their capacity, their concurrent limit, their skills, and whether they
 * are actually here this week.
 *
 * ── PROVISIONING LIVES HERE (FR-141 to FR-144) ───────────────────────────────
 * Add somebody, re-send or withdraw their invitation, deactivate and restore,
 * change a role, force a password reset. There is no password field anywhere in
 * it: an account is created with no credential at all, and the invitee sets
 * their own through a single-use link (doc 16 §3).
 *
 * ── THE SUPER ADMIN ROW SHOWS BUT DOES NOT EDIT ──────────────────────────────
 * Not because this component hides the button — migration 005's trigger refuses
 * any foreign write to it, so the button would simply fail. Saying so is more
 * useful than pretending the option exists (BR-027, FR-140).
 * ========================================================================= */

const EMPTY: PeopleActionResult = { ok: false };

export function TeamWorkspace({
  people,
  workload,
  skills,
  userSkills,
  availability,
  currentUser,
  canManage,
  canProvision,
  assignableRoles,
  pendingUserIds,
  resetTrails,
}: {
  people: readonly PersonRow[];
  workload: readonly PersonWorkload[];
  skills: readonly SkillRow[];
  userSkills: readonly UserSkillRow[];
  availability: readonly AvailabilityRow[];
  currentUser: { id: string; role: Role };
  canManage: boolean;
  /** doc 03 §3.1 — Admin and above may create and manage accounts. */
  canProvision: boolean;
  assignableRoles: readonly Role[];
  /** Invited, not yet activated. They get a re-send option and no capacity edit. */
  pendingUserIds: readonly string[];
  /** The latest forced password reset per person, keyed by user id. Empty for a
   *  viewer who may not see them — the PAGE decides that, not this component, so
   *  there is one place to look when asking who can read a reset trail. */
  resetTrails: Readonly<Record<string, ResetTrailView>>;
}) {
  const [editing, setEditing] = React.useState<PersonRow | null>(null);
  const [leaveFor, setLeaveFor] = React.useState<PersonRow | null>(null);
  const [skillsFor, setSkillsFor] = React.useState<PersonRow | null>(null);
  const [inviting, setInviting] = React.useState(false);

  const loadOf = (id: string) => workload.find((w) => w.userId === id);
  const skillsOf = (id: string) => userSkills.filter((s) => s.userId === id);
  const leaveOf = (id: string) => availability.filter((a) => a.userId === id);

  /* ── Active / Inactive / Deactivated as switches (CHANGE-PLAN 4.2) ──────────
     Owner instruction: *"I can switch from active members, inactive members,
     deactivated members — put those options in switches."*

     Three states, and they are three because the schema has two independent
     facts about an account, not one:

       is_active = false          the account has been turned off (BR-007 —
                                  deactivated, never deleted)
       account_state <> 'active'  the account exists and is on, but cannot be
                                  used yet or right now: awaiting activation,
                                  a forced password reset, MFA not set up,
                                  locked by failed attempts, suspended

     Collapsing those two into one switch would hide the difference between
     "gone" and "stuck", which are the two cases an Admin acts on differently —
     one gets restored, the other gets unblocked. */
  const [shown, setShown] = React.useState<'active' | 'inactive' | 'deactivated'>('active');

  const groups = React.useMemo(() => {
    const active = people.filter((p) => p.isActive && p.accountState === 'active');
    const inactive = people.filter((p) => p.isActive && p.accountState !== 'active');
    const deactivated = people.filter((p) => !p.isActive);
    return { active, inactive, deactivated };
  }, [people]);

  const visiblePeople = groups[shown];

  /* Pages the FILTERED list, so the count in the footer and the count on the
     switch always agree. */
  const pager = usePagination(visiblePeople);

  return (
    <div className="space-y-4">
      {canProvision && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-caption text-text-secondary">
            <span className="tabular font-semibold text-text-primary">{people.length}</span>{' '}
            {people.length === 1 ? 'account' : 'accounts'}
            {pendingUserIds.length > 0 && (
              <>
                {' · '}
                <span className="font-semibold" style={{ color: 'var(--feedback-warning)' }}>
                  {pendingUserIds.length} waiting to accept
                </span>
              </>
            )}
          </p>
          <Button variant="primary" size="md" onClick={() => setInviting(true)}>
            <UserPlus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            Add member
          </Button>
        </div>
      )}

      <Toolbar aria-label="Which accounts to show">
        <ToolbarGroup>
          <ToolbarLabel>Showing</ToolbarLabel>
          <ToggleGroup
            label="Which accounts to show"
            value={shown}
            onChange={setShown}
            options={[
              { key: 'active' as const, label: `Active · ${groups.active.length}` },
              { key: 'inactive' as const, label: `Inactive · ${groups.inactive.length}` },
              { key: 'deactivated' as const, label: `Deactivated · ${groups.deactivated.length}` },
            ]}
          />
        </ToolbarGroup>
      </Toolbar>

      {visiblePeople.length === 0 ? (
        <Card>
          <p className="px-5 py-8 text-center text-caption text-text-secondary">
            {shown === 'active'
              ? 'Nobody is fully active yet.'
              : shown === 'inactive'
                ? 'Nobody is waiting on activation, a reset, MFA setup, or a lock.'
                : 'Nobody has been deactivated. Accounts are switched off, never deleted (BR-007).'}
          </p>
        </Card>
      ) : (
      <Card>
        <ul className="divide-y divide-border-subtle">
          {pager.visible.map((person) => {
            const load = loadOf(person.id);
            const band = load ? WORKLOAD_BAND_META[load.workload.band] : null;
            const theirSkills = skillsOf(person.id);
            const theirLeave = leaveOf(person.id);
            const isSuperAdmin = person.role === 'super_admin';
            const editable = canManage && !isSuperAdmin;

            return (
              <li key={person.id} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-start gap-4">
                  <Avatar name={person.fullName} src={person.avatarUrl} size="lg" />

                  <div className="min-w-[12rem] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-body font-semibold text-text-primary">{person.fullName}</p>
                      <Badge
                        token={
                          person.role === 'super_admin'
                            ? 'accent-gold'
                            : person.role === 'admin'
                              ? 'accent-primary'
                              : person.role === 'team_coordinator'
                                ? 'accent-secondary'
                                : 'neutral-500'
                        }
                        size="sm"
                      >
                        {ROLE_LABEL[person.role]}
                      </Badge>
                      {!person.isActive && (
                        <Badge token="neutral-500" size="sm" variant="outline">
                          Deactivated
                        </Badge>
                      )}
                      {person.accountState !== 'active' && person.isActive && (
                        <Badge token="feedback-warning" size="sm" variant="outline">
                          {person.accountState.replace(/_/g, ' ')}
                        </Badge>
                      )}
                      {person.lockedAt && (
                        <Badge token="feedback-error" size="sm">
                          Locked
                        </Badge>
                      )}
                    </div>
                    <p className="text-caption text-text-secondary">{person.roleTitle ?? '—'}</p>
                    <p className="text-micro text-text-tertiary">{person.email}</p>
                  </div>

                  {load && band && (
                    <div className="min-w-[11rem] flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-micro text-text-tertiary">This week</span>
                        <span
                          className="tabular text-body-sm font-semibold"
                          style={{ color: `var(--${band.token})` }}
                        >
                          {load.workload.isFullyUnavailable
                            ? 'On leave'
                            : `${load.workload.utilisationPct}%`}
                        </span>
                      </div>
                      <ProgressBar
                        value={Math.min(load.workload.utilisationPct, 100)}
                        token={band.token}
                        size="md"
                        label={`${person.fullName}: ${load.workload.utilisationPct}% of capacity`}
                      />
                      <p className="tabular mt-1 text-micro text-text-tertiary">
                        {load.workload.loadPoints} / {load.workload.effectiveCapacityPoints} pts ·{' '}
                        {load.workload.activeTaskCount}/{load.workload.maxConcurrentTasks} in flight
                      </p>
                    </div>
                  )}

                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {editable && (
                      <>
                        <IconButton
                          label={`Edit ${person.fullName}'s capacity`}
                          icon={Pencil}
                          size="sm"
                          onClick={() => setEditing(person)}
                        />
                        <IconButton
                          label={`Record leave for ${person.fullName}`}
                          icon={CalendarOff}
                          size="sm"
                          onClick={() => setLeaveFor(person)}
                        />
                        <IconButton
                          label={`Edit ${person.fullName}'s skills`}
                          icon={Gauge}
                          size="sm"
                          onClick={() => setSkillsFor(person)}
                        />
                      </>
                    )}
                    {canProvision && (
                      <PersonActions
                        person={person}
                        currentUser={currentUser}
                        assignableRoles={assignableRoles}
                        isPendingActivation={pendingUserIds.includes(person.id)}
                        resetTrail={resetTrails[person.id] ?? null}
                      />
                    )}
                    <Link
                      href={`/tasks?assignee=${person.id}`}
                      className="inline-flex h-8 items-center rounded-md px-2.5 text-micro font-semibold text-text-brand hover:bg-bg-hover"
                    >
                      Tasks
                    </Link>
                  </div>
                </div>

                {/* ---- Skills and leave ---- */}
                <div className="flex flex-wrap items-center gap-1.5 sm:pl-[3.75rem]">
                  {theirSkills.length === 0 ? (
                    <span className="text-micro text-text-tertiary">
                      No skills recorded — the assignment engine has nothing to match on (FR-012).
                    </span>
                  ) : (
                    theirSkills.map((skill) => (
                      <Badge
                        key={skill.skillId}
                        token={skill.isPrimary ? 'accent-primary' : 'neutral-500'}
                        size="sm"
                        variant={skill.isPrimary ? 'solid' : 'outline'}
                      >
                        {skill.skillLabel} · {skill.proficiency}
                      </Badge>
                    ))
                  )}

                  {theirLeave.map((leave) => (
                    <Badge key={leave.id} token="feedback-warning" size="sm" variant="outline">
                      {leave.type.replace('_', ' ')} {leave.startDate}
                      {leave.endDate !== leave.startDate && ` → ${leave.endDate}`}
                    </Badge>
                  ))}
                </div>

                {isSuperAdmin && canManage && currentUser.role !== 'super_admin' && (
                  <p className="text-micro text-text-tertiary sm:pl-[3.75rem]">
                    This account cannot be altered by anybody else — enforced by a database trigger,
                    not by hiding a button (BR-027, FR-140).
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <div className="px-5 pb-4">
          <Pagination
            page={pager.page}
            pageCount={pager.pageCount}
            onPage={pager.setPage}
            from={pager.from}
            to={pager.to}
            total={pager.total}
            label={pager.total === 1 ? 'person' : 'people'}
          />
        </div>
      </Card>
      )}

      <InviteDialog
        open={inviting}
        onClose={() => setInviting(false)}
        assignableRoles={assignableRoles}
        actorRoleLabel={ROLE_LABEL[currentUser.role]}
        /* Admin+ — see the note at the salary field. */
        canSetPay={currentUser.role === 'admin' || currentUser.role === 'super_admin'}
      />

      {editing && (
        <CapacityDialog
          person={editing}
          /* ⚠️ `canManage` is `user.set_capacity_and_skills` — Admin+, the same
             rank the pay and terminal fields need. Passing it rather than
             re-deriving keeps one answer to "may this person edit everything". */
          canManageAll={canManage}
          onClose={() => setEditing(null)}
        />
      )}
      {leaveFor && <LeaveDialog person={leaveFor} onClose={() => setLeaveFor(null)} />}
      {skillsFor && (
        <SkillsDialog
          person={skillsFor}
          skills={skills}
          assigned={skillsOf(skillsFor.id)}
          onClose={() => setSkillsFor(null)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Capacity
 * ------------------------------------------------------------------------- */

function ActionError({ error }: { error?: string }) {
  if (!error) return null;
  return (
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
      <p className="text-caption text-text-primary">{error}</p>
    </div>
  );
}

/**
 * Everything true about one person, editable in one place.
 *
 * ⚠️ IT USED TO BE THREE FIELDS. Owner, 2026-09-01: *"when I click it, it shows
 * me just a few options. If I want all the options, like name change, salary
 * change, or anything like their office change, give me all the options."*
 * Fair — job title, capacity and concurrency were the only things reachable,
 * while name, phone, office, salary and the terminal number were all editable in
 * the database and reachable from nowhere.
 *
 * ⚠️ THE ADMIN-ONLY HALF IS NOT RENDERED, NOT DISABLED. A greyed-out salary box
 * still tells a Coordinator that one exists and roughly where it sits; more to
 * the point, `PersonRow` crosses into the RSC payload, so the only thing that
 * actually keeps a pay figure away from them is the query not fetching it
 * (see `listPeople`). This component draws what it was given.
 *
 * ⚠️ ROLE IS DELIBERATELY ABSENT. Owner's choice, and the right one: changing
 * somebody's permissions is a different kind of act from correcting their phone
 * number, and it keeps its own confirmation on the row's ⋯ menu.
 */
function CapacityDialog({
  person,
  canManageAll,
  onClose,
}: {
  person: PersonRow;
  /** `attendance.manage_devices` — Admin and Super Admin. Decides whether the
   *  pay and terminal fields exist at all on this form. */
  canManageAll: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(updateCapacityAction, EMPTY);

  React.useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [state.ok, onClose, router]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit ${person.fullName}`}
      description="Their details, what the system will let anybody give them, and how they record attendance."
      size="md"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="capacity-form" variant="primary" size="md" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save
          </Button>
        </>
      }
    >
      <form id="capacity-form" action={formAction} className="space-y-5">
        <input type="hidden" name="userId" value={person.id} />
        <ActionError error={state.error} />

        {/* ══ WHO THEY ARE ══════════════════════════════════════════════════ */}
        <div className="space-y-4">
          <p className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            Who they are
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="fullName">
              <Input id="fullName" name="fullName" defaultValue={person.fullName} required />
            </Field>

            <Field label="Job title" htmlFor="roleTitle" hint="What they actually do.">
              <Input id="roleTitle" name="roleTitle" defaultValue={person.roleTitle ?? ''} />
            </Field>

            <Field label="Phone" htmlFor="phone" hint="Optional.">
              <Input id="phone" name="phone" defaultValue={person.phone ?? ''} placeholder="03xx xxxxxxx" />
            </Field>

            {/* ⚠️ Shown, never editable here. Changing an address is an identity
                change — it needs the person to confirm the new inbox, which is
                what the separate email flow does. A quiet edit in this dialog
                would let an Admin take over an account. */}
            <Field label="Email" hint="Changed from their own profile, with confirmation.">
              <Input value={person.email} readOnly disabled />
            </Field>
          </div>
        </div>

        {canManageAll && (
          <>
            {/* ══ WHERE THEY WORK ═══════════════════════════════════════════ */}
            <div className="space-y-4 border-t border-border-subtle pt-4">
              <p className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
                Where they work
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* ⚠️ This decides which days count as absences, not just a
                    label: Blue Area rests on Sunday and Wah on Friday. Getting
                    it wrong marks somebody absent on the days they work. */}
                <Field
                  label="Office"
                  htmlFor="officeTeam"
                  hint="Decides their days off — Blue Area rests Sunday, Wah rests Friday."
                >
                  <Select
                    id="officeTeam"
                    name="officeTeam"
                    defaultValue={person.officeTeam}
                    options={[
                      { value: 'blue_area', label: 'Blue Area — Islamabad' },
                      { value: 'wah', label: 'Wah — Headquarters' },
                    ]}
                  />
                </Field>

                <Field
                  label="Monthly salary"
                  htmlFor="monthlySalary"
                  hint="PKR. Leave empty for anybody not on payroll."
                >
                  <Input
                    id="monthlySalary"
                    name="monthlySalary"
                    type="number"
                    min="0"
                    step="1000"
                    defaultValue={person.monthlySalary ?? ''}
                    placeholder="85000"
                  />
                </Field>
              </div>
            </div>

            {/* ══ ATTENDANCE ════════════════════════════════════════════════ */}
            <div className="space-y-4 border-t border-border-subtle pt-4">
              <p className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
                How they record attendance
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Terminal number"
                  htmlFor="devicePersonNo"
                  hint="Their employee number on the reader. Empty for remote staff."
                >
                  <Input
                    id="devicePersonNo"
                    name="devicePersonNo"
                    defaultValue={person.devicePersonNo ?? ''}
                    placeholder="019"
                    className="font-mono"
                  />
                </Field>

                <Field
                  label="Allowed to"
                  htmlFor="attendanceMode"
                  hint="Terminal only refuses the button in Taskly."
                >
                  <Select
                    id="attendanceMode"
                    name="attendanceMode"
                    defaultValue={person.attendanceMode}
                    options={[
                      { value: 'either', label: 'Terminal or Taskly' },
                      { value: 'terminal_only', label: 'Terminal only' },
                    ]}
                  />
                </Field>
              </div>
            </div>
          </>
        )}

        {/* ══ WHAT THEY CAN BE GIVEN ════════════════════════════════════════ */}
        <div className="space-y-4 border-t border-border-subtle pt-4">
          <p className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            What the system will let anybody give them
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Weekly capacity, in points"
              htmlFor="weeklyCapacityPoints"
              hint="36 is the default. Not 48 — attendance hours are not productive hours (ADR-004)."
            >
              <Input
                id="weeklyCapacityPoints"
                name="weeklyCapacityPoints"
                type="number"
                min="1"
                max="48"
                defaultValue={person.weeklyCapacityPoints}
              />
            </Field>

            <Field
              label="Concurrent tasks"
              htmlFor="maxConcurrentTasks"
              hint="Somebody at 40% capacity juggling twelve things is still in trouble."
            >
              <Input
                id="maxConcurrentTasks"
                name="maxConcurrentTasks"
                type="number"
                min="1"
                max="20"
                defaultValue={person.maxConcurrentTasks}
              />
            </Field>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------
 * Leave
 * ------------------------------------------------------------------------- */

function LeaveDialog({ person, onClose }: { person: PersonRow; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(addAvailabilityAction, EMPTY);

  React.useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
  }, [state.ok, onClose, router]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Record time away — ${person.fullName}`}
      description="Reduces their effective capacity for those days, so the workload figures stay honest while they are out."
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="leave-form" variant="primary" size="md" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Record it
          </Button>
        </>
      }
    >
      <form id="leave-form" action={formAction} className="space-y-4">
        <input type="hidden" name="userId" value={person.id} />
        <ActionError error={state.error} />

        <Field label="Type" htmlFor="type">
          <Select size="md" id="type" name="type" defaultValue="leave" required>
            {AVAILABILITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}
                {type === 'half_day' ? ' (counts as 50% capacity)' : ' (fully out)'}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From" htmlFor="startDate">
            <Input id="startDate" name="startDate" type="date" required />
          </Field>
          <Field label="To" htmlFor="endDate" hint="Blank for a single day.">
            <Input id="endDate" name="endDate" type="date" />
          </Field>
        </div>

        <Field label="Note" htmlFor="note">
          <Textarea id="note" name="note" rows={2} placeholder="Approved leave" />
        </Field>

        <p className="text-micro text-text-tertiary">
          Sundays are ignored — they were never capacity, so a Sunday holiday reduces nobody&rsquo;s
          week (ADR-004).
        </p>
      </form>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------
 * Skills
 * ------------------------------------------------------------------------- */

function SkillsDialog({
  person,
  skills,
  assigned,
  onClose,
}: {
  person: PersonRow;
  skills: readonly SkillRow[];
  assigned: readonly UserSkillRow[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [skillId, setSkillId] = React.useState(skills[0]?.id ?? '');
  const [proficiency, setProficiency] = React.useState(3);

  const unassigned = skills.filter((s) => !assigned.some((a) => a.skillId === s.id));

  const run = async (fn: () => Promise<PeopleActionResult>) => {
    setBusy(true);
    setError(null);
    const result = await fn();
    if (!result.ok) setError(result.error ?? 'That could not be saved.');
    else router.refresh();
    setBusy(false);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`${person.fullName} — skills`}
      description="Proficiency 1 to 5: 5 is expert, 3 is capable, 1 is can-help. The assignment engine weights skill match at 38% of its score (doc 07 §3)."
      size="md"
      footer={
        <Button variant="primary" size="md" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        <ActionError error={error ?? undefined} />

        <ul className="space-y-2">
          {assigned.length === 0 && (
            <li className="text-caption text-text-tertiary">
              Nothing recorded yet. Without skills the engine has nothing to match a task against
              and falls back to keyword guessing (FR-055).
            </li>
          )}
          {assigned.map((skill) => (
            <li
              key={skill.skillId}
              className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-surface px-3 py-2"
            >
              <span className="flex-1 text-caption font-medium text-text-primary">
                {skill.skillLabel}
                {skill.isPrimary && (
                  <span className="ml-1.5 text-micro font-semibold text-text-brand">headline</span>
                )}
              </span>

              <Select
                label={`${skill.skillLabel} proficiency`}
                value={String(skill.proficiency)}
                disabled={busy}
                onChange={(event) =>
                  void run(() =>
                    setSkillAction(
                      person.id,
                      skill.skillId,
                      Number(event.target.value),
                      skill.isPrimary,
                    ),
                  )
                }
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `Level ${n}` }))}
                className="w-[7rem]"
              />

              <IconButton
                label={`Remove ${skill.skillLabel}`}
                icon={X}
                size="sm"
                disabled={busy}
                onClick={() => void run(() => removeSkillAction(person.id, skill.skillId))}
              />
            </li>
          ))}
        </ul>

        {unassigned.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border-subtle pt-4">
            <div className="min-w-[12rem] flex-1">
              <label className="mb-1.5 block text-micro font-semibold text-text-secondary" htmlFor="add-skill">
                Add a skill
              </label>
              <Select
                size="md"
                id="add-skill"
                value={skillId}
                onChange={(event) => setSkillId(event.target.value)}
              >
                {unassigned.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.category ? `${skill.category} · ` : ''}
                    {skill.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="mb-1.5 block text-micro font-semibold text-text-secondary" htmlFor="add-prof">
                Level
              </label>
              <Select
                size="md"
                id="add-prof"
                value={String(proficiency)}
                onChange={(event) => setProficiency(Number(event.target.value))}
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
                className="w-[5.5rem]"
              />
            </div>

            <Button
              variant="secondary"
              size="md"
              disabled={busy || !skillId}
              onClick={() => void run(() => setSkillAction(person.id, skillId, proficiency))}
            >
              <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
              Add
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
