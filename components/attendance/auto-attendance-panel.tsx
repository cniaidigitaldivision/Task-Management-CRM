'use client';

import * as React from 'react';
import { CalendarClock, Info } from 'lucide-react';

import { setAutoAttendanceAction } from '@/app/actions/attendance';
import { Avatar } from '@/components/ui/avatar';
import { Card, CardBody, CardToolbar } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import type { AutoAttendanceRow } from '@/lib/db/queries/attendance';
import { cn } from '@/lib/utils';

/* ============================================================================
 * ATTENDANCE THAT RECORDS ITSELF — the switch
 * ----------------------------------------------------------------------------
 * Owner (Umm-e-Habiba, Admin), 2026-09-27: *"an on/off radio button on my
 * dashboard ... If I create some more admins I will turn off that radio button
 * for them."* Then, immediately after: *"And this button I want on the attendees
 * page not anywhere else."* So it lives here, under the board it affects, and
 * nowhere else.
 *
 * ── ⚠️ THE SWITCH MOVES IN ITS OWN FRAME ────────────────────────────────────
 * Rule Zero. The flip is local state, the server call follows in a transition,
 * and a refusal puts the switch back and says why. A switch that waits for a
 * round trip before moving reads as broken — people press it twice.
 *
 * ── ⚠️ IT SHOWS WHEN IT LAST RAN, AND THAT IS THE POINT ─────────────────────
 * An automation you cannot see is an automation you do not trust. "Last recorded
 * 09:40 today" is the difference between believing the switch and opening the
 * database to check. The panel is therefore mostly evidence, and only slightly
 * control.
 * ========================================================================= */

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/**
 * `2026-09-27T04:40:00Z` → `09:40 today`, read in Karachi.
 *
 * ⚠️ `en-CA` for the DATE because it is the one locale that formats as
 * `YYYY-MM-DD`, which is what `todayKarachi` already is — so the comparison is a
 * string equality rather than arithmetic on a Date that has no timezone.
 *
 * ⚠️ AND `month: 'long'`, NOT `'short'`. `en-GB` abbreviates September to
 * "Sept", which disagrees with how this application spells months everywhere
 * else; two spellings of one month on a single screen has shipped here before.
 */
function whenLocal(iso: string | null, todayKarachi: string): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const zone = 'Asia/Karachi';
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at);
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);

  if (day === todayKarachi) return `${clock} today`;
  const nice = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, day: 'numeric', month: 'long',
  }).format(at);
  return `${clock} on ${nice}`;
}

export function AutoAttendancePanel({
  rows,
  me,
  canManage,
  todayKarachi,
}: {
  rows: readonly AutoAttendanceRow[];
  me: { id: string; fullName: string; avatarUrl: string | null; role: string };
  /** Admin+. A Member sees their own row read-only and no switch. */
  canManage: boolean;
  /** `YYYY-MM-DD` in Karachi, from the one clock reading the page already took. */
  todayKarachi: string;
}) {
  const [state, setState] = React.useState<readonly AutoAttendanceRow[]>(rows);
  const [busy, setBusy] = React.useState<string | null>(null);
  const toast = useToast();

  /* The server is the truth. When a navigation brings new rows, take them —
     unless a flip is still in flight, whose optimistic value must survive. */
  const seen = React.useRef(rows);
  if (seen.current !== rows && busy === null) {
    seen.current = rows;
    setState(rows);
  }

  /* ⚠️ The signed-in person always has a line, even with no row in the table —
     otherwise the first press has nothing to press. Their absence from
     `attendance_auto` IS the off state, and the panel should say so rather than
     leave them wondering where their own switch went. */
  const mine = state.find((r) => r.userId === me.id);
  const lines: readonly AutoAttendanceRow[] = mine
    ? state
    : [
        {
          userId: me.id,
          fullName: me.fullName,
          avatarUrl: me.avatarUrl,
          role: me.role,
          isEnabled: false,
          checkInLocal: '09:40',
          checkOutLocal: '19:10',
          workingDays: [1, 2, 3, 4, 5, 6],
          lastInAt: null,
          lastOutAt: null,
          note: null,
        },
        ...state,
      ];

  if (!canManage && lines.length === 0) return null;

  async function flip(row: AutoAttendanceRow) {
    if (!canManage) return;
    const next = !row.isEnabled;

    setBusy(row.userId);
    setState((current) => {
      const has = current.some((r) => r.userId === row.userId);
      return has
        ? current.map((r) => (r.userId === row.userId ? { ...r, isEnabled: next } : r))
        : [...current, { ...row, isEnabled: next }];
    });

    const result = await setAutoAttendanceAction(row.userId, next);
    setBusy(null);

    if (!result.ok) {
      /* Put it back. A switch that stays where it was pressed after the server
         refused is a lie the person will act on. */
      setState((current) =>
        current.map((r) => (r.userId === row.userId ? { ...r, isEnabled: row.isEnabled } : r)),
      );
      toast({ tone: 'error', text: result.error });
      return;
    }
    toast({ tone: 'ok', text: result.message });
  }

  return (
    <Card>
      <CardToolbar
        title="Automatic attendance"
        description="For people who work remotely. The day is recorded on a schedule and marked as such."
      />
      <CardBody className="space-y-3 p-4">
        {lines.map((row) => {
          const working = busy === row.userId;
          const off = DAY_NAMES.filter((_, i) => !row.workingDays.includes(i + 1));
          const lastIn = whenLocal(row.lastInAt, todayKarachi);
          const lastOut = whenLocal(row.lastOutAt, todayKarachi);

          return (
            <div
              key={row.userId}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-bg-surface-sunken px-3 py-2.5"
            >
              <Avatar name={row.fullName} src={row.avatarUrl} size="sm" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm font-medium text-text-primary">
                  {row.fullName}
                  {row.userId === me.id && (
                    <span className="ml-1.5 text-text-tertiary">(you)</span>
                  )}
                </p>
                <p className="text-caption text-text-secondary">
                  {row.isEnabled ? (
                    <>
                      In at <strong className="font-medium text-text-primary">{row.checkInLocal}</strong>,
                      out at <strong className="font-medium text-text-primary">{row.checkOutLocal}</strong>
                      {off.length > 0 && <> · {off.join(' and ')} off</>}
                    </>
                  ) : (
                    <>Recorded by hand, like everybody else.</>
                  )}
                </p>
              </div>

              {/* The evidence. Only worth the space once it has actually run. */}
              {row.isEnabled && (lastIn || lastOut) && (
                <p className="flex items-center gap-1.5 text-caption text-text-tertiary">
                  <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {lastIn && <>in {lastIn}</>}
                    {lastIn && lastOut && ' · '}
                    {lastOut && <>out {lastOut}</>}
                  </span>
                </p>
              )}

              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    'text-caption font-medium',
                    row.isEnabled ? 'text-text-primary' : 'text-text-tertiary',
                  )}
                >
                  {row.isEnabled ? 'On' : 'Off'}
                </span>
                {canManage ? (
                  <Switch
                    on={row.isEnabled}
                    busy={working}
                    onFlip={() => void flip(row)}
                    label={`Turn automatic attendance ${row.isEnabled ? 'off' : 'on'} for ${row.fullName}`}
                  />
                ) : null}
              </div>
            </div>
          );
        })}

        <p className="flex items-start gap-2 text-caption text-text-tertiary">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            A scheduled day is stamped <strong className="font-medium">scheduled</strong>, never{' '}
            <strong className="font-medium">self</strong>, so the export and the late count can
            always tell the two apart. It stands down on a day off and on approved leave, and it
            never overwrites a check-in you made yourself.
          </span>
        </p>
      </CardBody>
    </Card>
  );
}

/* The house switch — the same one `components/assistant/access-panel.tsx` uses.
   Kept local rather than shared: two copies of thirty lines is cheaper than a
   primitive that has to serve every future case, and the design system already
   has a gallery for the day somebody wants one. */
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
        on ? 'border-transparent bg-accent-primary' : 'border-border-default bg-bg-surface-sunken',
        busy && 'opacity-60',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'grid h-4.5 w-4.5 place-items-center rounded-full bg-bg-surface shadow-[var(--shadow-sm)] transition-transform',
          on ? 'translate-x-[1.4rem]' : 'translate-x-[0.19rem]',
        )}
      />
    </button>
  );
}
