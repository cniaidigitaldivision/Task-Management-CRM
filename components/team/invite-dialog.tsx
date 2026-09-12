'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Copy, Loader2, Mail, Plus, UserPlus } from 'lucide-react';

import {
  createDepartmentAction,
  listColleaguesAction,
  listDepartmentsAction,
} from '@/app/actions/departments';
import { invitePersonAction, type TeamActionResult } from '@/app/actions/team';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { OFFICE_TEAMS, OFFICE_TEAM_KEYS } from '@/lib/domain/attendance';
import { ROLE_LABEL, SYSTEM_DEFAULTS, type Role } from '@/lib/domain/constants';

/* ============================================================================
 * ADD SOMEBODY TO THE TEAM
 * ----------------------------------------------------------------------------
 * ── THERE IS NO PASSWORD FIELD, AND THAT IS THE FEATURE ──────────────────────
 * The obvious form has one. This one cannot: the account is created with no
 * credential at all, and the invitee sets their own through a single-use link.
 * Nothing to leak, because nothing exists to leak (doc 16 §3).
 *
 * ── THE LINK IS ALWAYS SHOWN, EVEN WHEN THE EMAIL WORKED ─────────────────────
 * Because on the free Resend sender it very often has not arrived, whatever the
 * API said. The sandbox address only delivers to the Resend account's own
 * mailbox and drops everything else with a cheerful 200. Showing the link makes
 * that a shrug rather than a mystery, and means a mail outage never blocks
 * onboarding.
 * ========================================================================= */

const EMPTY: TeamActionResult = { ok: false };

export function InviteDialog({
  open,
  onClose,
  assignableRoles,
  actorRoleLabel,
  canSetPay,
}: {
  open: boolean;
  onClose: () => void;
  assignableRoles: readonly Role[];
  actorRoleLabel: string;
  /** Admin and above. See the note at the salary field. */
  canSetPay: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(invitePersonAction, EMPTY);
  const [copied, setCopied] = React.useState(false);

  /* ── ⚠️ WHAT THE LAST ATTEMPT SENT ────────────────────────────────────────
     React 19 resets a form once its action returns, so an uncontrolled input is
     already empty by the time the error renders. Owner, 2026-09-12: *"in case
     some error occurs, the fields will not remove the value entered. I don't
     need to enter it again and again."* Every field below reads through this.
     Same shape as `app/(auth)/setup/setup-form.tsx`, which has always done it. */
  const keep = (field: string, fallback = '') => state.sent?.[field] ?? fallback;

  const [departments, setDepartments] = React.useState<
    Array<{ id: string; key: string; name: string; people: number }>
  >([]);
  const [colleagues, setColleagues] = React.useState<
    Array<{ id: string; name: string; role: string; department: string | null }>
  >([]);
  /* ⚠️ DERIVED DURING RENDER, NOT RESTORED IN AN EFFECT. `picked` is null until
     somebody actually chooses; until then the value falls back to whatever the
     last rejected submit sent. So a failed invite keeps the department without
     a second render pass, and the first open starts empty. */
  const [picked, setPicked] = React.useState<string | null>(null);
  const departmentId = picked ?? state.sent?.departmentId ?? '';
  const [newDeptOpen, setNewDeptOpen] = React.useState(false);
  const [newDeptName, setNewDeptName] = React.useState('');
  const [newDeptError, setNewDeptError] = React.useState<string | null>(null);
  const [savingDept, setSavingDept] = React.useState(false);


  React.useEffect(() => {
    if (!open) return;
    /* ⚠️ Both awaited inside the async body rather than set synchronously — the
       linter is right that a setState in an effect body cascades renders, and
       a fetch that resolves later does not. */
    let live = true;
    void (async () => {
      const [depts, people] = await Promise.all([listDepartmentsAction(), listColleaguesAction()]);
      if (!live) return;
      setDepartments(depts);
      setColleagues(people);
    })();
    return () => {
      live = false;
    };
  }, [open]);

  async function addDepartment() {
    setSavingDept(true);
    setNewDeptError(null);
    const result = await createDepartmentAction(newDeptName);
    setSavingDept(false);
    if (!result.ok) {
      setNewDeptError(result.error ?? 'That did not work.');
      return;
    }
    /* ⚠️ Reloaded and SELECTED, so the reason somebody opened this dialog —
       filing the person they are inviting — completes in one step. */
    setDepartments(await listDepartmentsAction());
    if (result.id) setPicked(result.id);
    setNewDeptName('');
    setNewDeptOpen(false);
  }

  /* Does this department work leads? Then ask what the person handles.
     ⚠️ Matched on the department the owner is filing them into, not on the word
     "sales" — the division's own product leads route to AI & Digital. */
  const chosen = departments.find((d) => d.id === departmentId);
  const showSpecialisation = Boolean(chosen);

  React.useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  /* ---- Invited: hand over the link ---- */
  if (state.ok && state.activationUrl) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Invitation created"
        description="The account exists but cannot be signed into until they set their own password."
        size="md"
        footer={
          <Button variant="primary" size="md" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="space-y-4">
          <div
            className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
              border: '1px solid color-mix(in oklab, var(--feedback-success) 32%, transparent)',
            }}
          >
            <Mail
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-success)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-caption text-text-secondary">{state.emailNote}</p>
          </div>

          <div>
            <p className="mb-1.5 text-caption font-semibold text-text-primary">
              Their activation link
            </p>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 rounded-lg border border-border-default bg-bg-surface-sunken px-3 py-2.5 font-mono text-micro break-all text-text-secondary">
                {state.activationUrl}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(state.activationUrl!);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2500);
                  } catch {
                    /* The link is on screen regardless. */
                  }
                }}
              >
                {copied ? (
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                ) : (
                  <Copy className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="mt-1.5 text-micro text-text-tertiary">
              Works once, expires in {SYSTEM_DEFAULTS.activationTokenTtlHours} hours. Send it however
              you like — WhatsApp is fine. It is single-use, so it stops working the moment they use
              it.
            </p>
          </div>
        </div>
      </Dialog>
    );
  }

  /* ---- The form ---- */
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a member"
      description="They get a link and choose their own password. No password is generated, sent, or shown to you."
      footer={
        <>
          <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" variant="primary" size="md" disabled={pending}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <UserPlus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            )}
            {pending ? 'Creating…' : 'Create and invite'}
          </Button>
        </>
      }
    >
      <form id="invite-form" action={formAction} className="space-y-4">
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

        <Field label="Their full name" htmlFor="fullName">
          <Input id="fullName" name="fullName" placeholder="Kashif Ahmed" defaultValue={keep('fullName')} required autoFocus />
        </Field>

        <Field
          label="Their email"
          htmlFor="email"
          hint="This becomes their sign-in address, and where the invitation goes."
        >
          <Input id="email" name="email" type="email" inputMode="email" defaultValue={keep('email')} required />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Role"
            htmlFor="role"
            hint={`As ${actorRoleLabel} you can appoint these.`}
          >
            <Select size="md" id="role" name="role" defaultValue={keep('role', assignableRoles.at(-1) ?? '')} required>
              {assignableRoles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Job title" htmlFor="roleTitle" hint="What they actually do.">
            <Input id="roleTitle" name="roleTitle" placeholder="Graphic Designer" defaultValue={keep('roleTitle')} />
          </Field>
        </div>

        {/* ══ WHERE THEY SIT IN THE COMPANY ═══════════════════════
            Added 2026-09-12. Owner: "when adding a new team member, the
            department should be coming from the department tables."

            ⚠️ UNTIL NOW THE FORM DID NOT ASK. Somebody was invited, and their
            department was set afterwards from a second action — so anybody who
            forgot left a person filed nowhere, which is how four departments
            came to hold nobody at all. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Department"
            htmlFor="departmentId"
            hint={
              departments.length === 0
                ? 'None yet — create one with the button below.'
                : 'Decides what they can open, and where their leads come from.'
            }
          >
            <Select
              size="md"
              id="departmentId"
              name="departmentId"
              value={departmentId}
              onChange={(e) => setPicked(e.target.value)}
            >
              <option value="">Not filed yet</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.people > 0 ? ` — ${d.people}` : ' — empty'}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="In that department they are a"
            htmlFor="departmentRole"
            hint="A manager sees everyone's work in it."
          >
            <Select
              size="md"
              id="departmentRole"
              name="departmentRole"
              defaultValue={keep('departmentRole', 'member')}
            >
              <option value="member">Member</option>
              <option value="manager">Manager</option>
            </Select>
          </Field>
        </div>

        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setNewDeptOpen((v) => !v)}
          >
            <Plus className="size-4" aria-hidden="true" />
            New department
          </Button>

          {newDeptOpen && (
            <div className="mt-2 rounded-lg border border-border-subtle bg-bg-subtle p-3">
              <Field label="What is it called?" htmlFor="newDeptName">
                <Input
                  id="newDeptName"
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="Procurement"
                  onKeyDown={(e) => {
                    /* ⚠️ Enter must NOT submit the invite behind it. */
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addDepartment();
                    }
                  }}
                />
              </Field>
              {newDeptError && (
                <p className="mt-1 text-caption" style={{ color: 'var(--feedback-error)' }}>
                  {newDeptError}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" onClick={() => void addDepartment()} disabled={savingDept}>
                  {savingDept ? 'Adding…' : 'Add it'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setNewDeptOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ⚠️ ONLY ONCE A DEPARTMENT IS CHOSEN, and free text on purpose. Q19:
            the owner has not yet asked the sales team what they specialise in,
            and agreed the field must not be invented meanwhile. So this imposes
            no list. It becomes structured when real answers show a real
            pattern, not before. */}
        {showSpecialisation && (
          <Field
            label={`What does this person handle in ${chosen?.name}?`}
            htmlFor="specialisation"
            hint="Optional, and in your own words — products, a city, a budget range, a language."
          >
            <Input
              id="specialisation"
              name="specialisation"
              placeholder="ERP enquiries, Islamabad, speaks Pashto"
              defaultValue={keep('specialisation')}
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Reports to"
            htmlFor="reportsToId"
            hint="Who approves their leave, and sees their work."
          >
            <Select size="md" id="reportsToId" name="reportsToId" defaultValue={keep('reportsToId')}>
              <option value="">Nobody yet</option>
              {colleagues.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.department ? ` — ${c.department}` : ''}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Joined on" htmlFor="joinedOn" hint="Optional. Used for tenure.">
            <Input id="joinedOn" name="joinedOn" type="date" defaultValue={keep('joinedOn')} />
          </Field>
        </div>

        {/* ⚠️ BOTH OR NEITHER — the action refuses one half. Half a working day
            cannot answer "are they at work now", which is the only question
            these exist for. See docs/crm/10-LEAD-ASSIGNMENT.md, signal 2. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Working day starts" htmlFor="workStartsAt" hint="Optional. Their local time.">
            <Input id="workStartsAt" name="workStartsAt" type="time" defaultValue={keep('workStartsAt')} />
          </Field>
          <Field label="and ends" htmlFor="workEndsAt" hint="Leave both empty if it varies.">
            <Input id="workEndsAt" name="workEndsAt" type="time" defaultValue={keep('workEndsAt')} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="How they check in"
            htmlFor="attendanceMode"
            hint="Terminal only means the office device, never the app."
          >
            <Select
              size="md"
              id="attendanceMode"
              name="attendanceMode"
              defaultValue={keep('attendanceMode', 'either')}
            >
              <option value="either">App or the office terminal</option>
              <option value="terminal_only">Office terminal only</option>
            </Select>
          </Field>

          <Field
            label="Terminal ID"
            htmlFor="devicePersonNo"
            hint="Their number on the office device. Without it, terminal check-ins never match them."
          >
            <Input id="devicePersonNo" name="devicePersonNo" defaultValue={keep('devicePersonNo')} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* ── ⚠️ THE OFFICE IS NOT COSMETIC ────────────────────────────────
              `office_team` decides which weekdays count as an absence — Blue
              Area rests on Sunday, Wah on Friday. Until this field existed the
              form could not set it, so everybody landed on the default and a
              Wah hire was marked absent every Friday. */}
          <Field
            label="Which office"
            htmlFor="officeTeam"
            hint="Decides their day off, and their attendance."
          >
            <Select size="md" id="officeTeam" name="officeTeam" defaultValue={keep('officeTeam', 'blue_area')} required>
              {OFFICE_TEAM_KEYS.map((key) => (
                <option key={key} value={key}>
                  {OFFICE_TEAMS[key].label} — {OFFICE_TEAMS[key].where} ({OFFICE_TEAMS[key].restDay})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Phone" htmlFor="phone" hint="Optional.">
            <Input id="phone" name="phone" type="tel" inputMode="tel" placeholder="+92 300 1234567" defaultValue={keep('phone')} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Weekly capacity"
            htmlFor="weeklyCapacityPoints"
            hint={`${SYSTEM_DEFAULTS.defaultWeeklyCapacity} points is the default — 75% of a 48-hour week, because attendance hours are not productive hours.`}
          >
            <Input
              id="weeklyCapacityPoints"
              name="weeklyCapacityPoints"
              defaultValue={keep('weeklyCapacityPoints', String(SYSTEM_DEFAULTS.defaultWeeklyCapacity))}
              type="number"
              min="1"
              max="48"
            />
          </Field>

          <Field
            label="Concurrent tasks"
            htmlFor="maxConcurrentTasks"
            hint="The second guard: attention, not volume."
          >
            <Input
              id="maxConcurrentTasks"
              name="maxConcurrentTasks"
              defaultValue={keep('maxConcurrentTasks', String(SYSTEM_DEFAULTS.defaultMaxConcurrentTasks))}
              type="number"
              min="1"
              max="20"
            />
          </Field>
        </div>

        {/* ── ⚠️ SHOWN ONLY TO AN ADMIN, AND THAT IS THE SECOND LOCK ────────
            `employee_compensation` is Admin+ by its own RLS policy, so a
            Coordinator who submitted this field would simply be refused by the
            database. Hiding it is therefore not the security boundary — it is
            an honesty measure, so nobody is offered a control that cannot work.
            The boundary is in migration 062. */}
        {canSetPay && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Monthly salary"
              htmlFor="monthlySalary"
              hint="Optional — can be set later. Visible to Admins only."
            >
              <Input
                id="monthlySalary"
                name="monthlySalary"
                defaultValue={keep('monthlySalary')}
                type="number"
                min="0"
                step="1000"
                inputMode="numeric"
                placeholder="120000"
              />
            </Field>
          </div>
        )}

        <p className="text-micro text-text-tertiary">
          The account is created with no password at all. They set one through a single-use link
          that expires in {SYSTEM_DEFAULTS.activationTokenTtlHours} hours, so there is never a
          credential in an email or in anybody else&rsquo;s hands (doc 16 §3).
        </p>
      </form>
    </Dialog>
  );
}
