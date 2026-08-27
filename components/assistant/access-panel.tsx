'use client';

import * as React from 'react';
import { ChevronRight, Loader2, RotateCcw } from 'lucide-react';

import { setAssistantAccessAction } from '@/app/actions/assistant';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  type AssistantAccessRow,
  describeAccess,
  nextAccessEffect,
  resolveAssistantAccess,
} from '@/lib/domain/assistant-access';
import type { Role } from '@/lib/domain/constants';
import { ROLE_LABEL } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHO MAY USE THE ASSISTANT
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26: *"Later on maybe I can have a radio button for each
 * member, in the name of each member, that I can switch on and off at my
 * choice. By my choice I mean it's on admin or super admin choice."*
 *
 * And 2026-08-27, supplying a reference design: a roster — member, role,
 * permission, usage, a switch.
 *
 * ── ⚠️ THERE ARE THREE STATES AND ONE SWITCH, AND THAT USED TO BE A PROBLEM ─
 * On, off, and "whatever their rank says" — a two-position control cannot say
 * three things. The first build answered that with three buttons (On / Off /
 * Reset) and a note explaining why. The owner's design has a switch, and the
 * switch turns out to be BETTER once the third state stops being something you
 * set and becomes something the control maintains:
 *
 *   · flipping somebody AWAY from what their rank says writes an override
 *   · flipping them BACK to what their rank says DELETES it
 *
 * So the row only exists while it is carrying information. A Coordinator turned
 * off and on again ends with no row, exactly as they started — where the
 * three-button version would have left an `allow` row that says "an Admin
 * decided this" about a decision nobody made. `roleAllows` below is what makes
 * that possible, and it is computed from the same pure resolver the server and
 * the layout use.
 *
 * The badge beside the switch still distinguishes "by rank" from "by name",
 * because the two are revoked differently and somebody auditing this screen
 * needs to know which decisions were actually taken.
 *
 * ── ⚠️ WHAT THE SWITCH DOES NOT DO ─────────────────────────────────────────
 * It does not widen what anybody can SEE. The assistant reads the database as
 * the person asking, so a Member switched on still gets a Member's answers. The
 * footnote says so, because "gave them the AI" reads like "gave them access"
 * and that is the one misunderstanding this control could cause.
 * ========================================================================= */

export interface AccessPerson {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: Role;
  readonly roleTitle: string | null;
  readonly avatarUrl: string | null;
}

const ROLE_FILTER = [
  { value: 'all', label: 'All roles' },
  { value: 'super_admin', label: ROLE_LABEL.super_admin },
  { value: 'admin', label: ROLE_LABEL.admin },
  { value: 'team_coordinator', label: ROLE_LABEL.team_coordinator },
  { value: 'member', label: ROLE_LABEL.member },
] as const;

export function AccessPanel({
  people,
  overrides,
  currentUserId,
  asksByPerson,
  rangeLabel,
  onInspect,
}: {
  people: readonly AccessPerson[];
  overrides: readonly AssistantAccessRow[];
  currentUserId: string;
  /** Questions asked in the open period, keyed by user id. */
  asksByPerson: Readonly<Record<string, number>>;
  rangeLabel: string;
  onInspect: (person: AccessPerson) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState<string>('all');

  /* ⚠️ Server state, mirrored locally so a click responds immediately. The
     action revalidates the page, so the server's version arrives shortly after
     and this is only what fills the gap. */
  const [rows, setRows] = React.useState<readonly AssistantAccessRow[]>(overrides);

  const overrideFor = (userId: string) => rows.find((r) => r.userId === userId) ?? null;

  const apply = async (person: AccessPerson, effect: 'allow' | 'deny' | 'reset') => {
    setBusy(person.id);
    setNotice(null);

    const result = await setAssistantAccessAction(person.id, effect);
    setBusy(null);

    if (!result.ok) {
      setNotice({ ok: false, text: result.error });
      return;
    }

    setRows((prev) => {
      const without = prev.filter((r) => r.userId !== person.id);
      if (effect === 'reset') return without;
      return [
        ...without,
        {
          userId: person.id,
          effect,
          grantedByName: 'you',
          grantedAt: new Date().toISOString(),
          note: null,
        },
      ];
    });

    setNotice({ ok: true, text: `${person.fullName}: ${result.message}` });
  };

  const needle = query.trim().toLowerCase();
  const shown = people.filter((person) => {
    if (roleFilter !== 'all' && person.role !== roleFilter) return false;
    if (needle === '') return true;
    return (
      person.fullName.toLowerCase().includes(needle) ||
      person.email.toLowerCase().includes(needle) ||
      (person.roleTitle ?? '').toLowerCase().includes(needle)
    );
  });

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0 flex-1">
          <CardTitle>Who can use the assistant</CardTitle>
          <CardDescription>
            Coordinators and above have it by rank. The switch overrides that either way.
          </CardDescription>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            label="Search team members"
            placeholder="Search team member…"
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-52"
          />
          <Select
            label="Filter by role"
            size="sm"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            options={ROLE_FILTER}
          />
        </div>
      </CardHeader>

      <CardBody className="px-0 py-0">
        {notice && (
          <p
            role="status"
            className="border-b border-border-subtle px-5 py-2.5 text-caption font-medium"
            style={{ color: notice.ok ? 'var(--feedback-success)' : 'var(--feedback-error)' }}
          >
            {notice.text}
          </p>
        )}

        {/* ⚠️ A real <table>, not a grid of divs. This is tabular data with a
            header row, and the semantics are what let a screen reader announce
            "Usage, 12" instead of a bare number floating between two names.
            `overflow-x-auto` on the wrapper rather than the page — the shell
            clips horizontal overflow, so a table that outgrows its column would
            simply be cut off with no way to reach the rest. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-border-subtle">
                <Th className="pl-5">Member</Th>
                <Th>Role</Th>
                <Th>Access</Th>
                <Th className="text-right">Asked · {rangeLabel}</Th>
                <Th className="pr-5 text-right">On</Th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border-subtle">
              {shown.map((person) => {
                const override = overrideFor(person.id);
                const access = resolveAssistantAccess(
                  { id: person.id, role: person.role },
                  override,
                );

                /* What their RANK alone would say — the target the switch
                   returns to, and the reason no redundant row is ever left
                   behind. See the header. */
                const roleAllows = resolveAssistantAccess(
                  { id: person.id, role: person.role },
                  null,
                ).allowed;

                const isSelf = person.id === currentUserId;
                const working = busy === person.id;
                const asks = asksByPerson[person.id] ?? 0;

                /* The three-state rule lives in the domain layer and is tested
                   there — see `nextAccessEffect`. */
                const flip = () =>
                  void apply(person, nextAccessEffect(access.allowed, roleAllows));

                return (
                  <tr key={person.id} className="align-middle hover:bg-bg-surface-hover">
                    <td className="py-3 pl-5">
                      <button
                        type="button"
                        onClick={() => onInspect(person)}
                        className="group flex min-w-0 items-center gap-3 text-left"
                      >
                        <Avatar name={person.fullName} src={person.avatarUrl} size="sm" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1 text-caption font-medium text-text-primary group-hover:underline">
                            <span className="truncate">{person.fullName}</span>
                            {isSelf && (
                              <span className="shrink-0 text-micro text-text-tertiary">(you)</span>
                            )}
                            <ChevronRight
                              className="h-3.5 w-3.5 shrink-0 text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                              aria-hidden="true"
                            />
                          </span>
                          <span className="block truncate text-micro text-text-tertiary">
                            {person.email}
                          </span>
                        </span>
                      </button>
                    </td>

                    <td className="py-3 text-caption text-text-secondary">
                      {person.roleTitle ?? ROLE_LABEL[person.role]}
                    </td>

                    <td className="py-3">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          token={
                            access.allowed
                              ? access.reason === 'granted'
                                ? 'status-todo'
                                : 'status-done'
                              : 'status-cancelled'
                          }
                          variant="outline"
                          size="sm"
                        >
                          {describeAccess(access)}
                        </Badge>

                        {/* Who decided, and when — the whole reason the grant
                            row carries an author. Only shown where somebody
                            actually decided; a rank default has no author. */}
                        {override && (
                          <span className="text-micro text-text-tertiary">
                            by {override.grantedByName ?? 'an Admin'}
                          </span>
                        )}
                      </span>
                    </td>

                    <td className="tabular py-3 text-right text-caption text-text-secondary">
                      {asks === 0 ? <span className="text-text-tertiary">—</span> : asks}
                    </td>

                    <td className="py-3 pr-5">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* ⚠️ Only where there IS something to reset. After the
                            switch's own tidying this is a rare button — it
                            appears when a row was written by an older build, or
                            by the other Admin, and its only job is to say "this
                            was a decision" and offer to unmake it. */}
                        {override && (
                          <button
                            type="button"
                            disabled={working}
                            onClick={() => void apply(person, 'reset')}
                            title="Back to their rank default"
                            aria-label={`Reset ${person.fullName} to their rank default`}
                            className="grid h-7 w-7 place-items-center rounded-full text-text-tertiary transition-colors hover:bg-bg-surface-sunken hover:text-text-primary disabled:opacity-40"
                          >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}

                        <Switch
                          on={access.allowed}
                          busy={working}
                          onFlip={flip}
                          label={`${access.allowed ? 'Switch off' : 'Switch on'} the assistant for ${person.fullName}`}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {shown.length === 0 && (
          <p className="px-5 py-10 text-center text-caption text-text-tertiary">
            Nobody matches that.
          </p>
        )}

        <p className="border-t border-border-subtle px-5 py-3 text-micro text-text-tertiary">
          Showing {shown.length} of {people.length}. Switching somebody on does not widen what
          they can see — the assistant reads the database as them, so a Member who can use it
          still sees only a Member&rsquo;s data.
        </p>
      </CardBody>
    </Card>
  );
}

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className={cn(
        'py-2.5 text-micro font-semibold tracking-wide text-text-tertiary uppercase',
        className,
      )}
    >
      {children}
    </th>
  );
}

/* ── The switch ──────────────────────────────────────────────────────────────
   ⚠️ A `role="switch"` button, not a checkbox styled to look like one. The two
   are announced differently — "switch, on" versus "checkbox, checked" — and this
   control takes effect immediately with no form to submit, which is exactly what
   `switch` means and `checkbox` does not.

   ⚠️ `aria-busy` while the write is in flight, and the knob keeps its POSITION
   rather than jumping optimistically. A switch that flips and then flips back
   when the server refuses is worse than one that pauses for 200ms. */
function Switch({
  on,
  busy,
  onFlip,
  label,
}: {
  on: boolean;
  busy: boolean;
  onFlip: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy}
      disabled={busy}
      onClick={onFlip}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
        on
          ? 'border-transparent bg-accent-primary'
          : 'border-border-default bg-bg-surface-sunken',
        busy && 'opacity-60',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid h-4.5 w-4.5 place-items-center rounded-full bg-bg-surface shadow-[var(--shadow-sm)] transition-transform',
          on ? 'translate-x-[1.4rem]' : 'translate-x-[0.19rem]',
        )}
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin text-text-tertiary" aria-hidden="true" />}
      </span>
    </button>
  );
}
