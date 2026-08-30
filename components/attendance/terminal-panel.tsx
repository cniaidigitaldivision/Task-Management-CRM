'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  Link2,
  Link2Off,
  Loader2,
  Radio,
  Search,
  UserCheck,
  UserX,
} from 'lucide-react';

import {
  mapPersonAction,
  setAttendanceModeAction,
  type DeviceResult,
} from '@/app/actions/attendance-devices';
import type {
  EnrolmentRow,
  TerminalRow,
  UnmatchedRow,
} from '@/lib/db/queries/attendance-devices';
import {
  METHOD_LABEL,
  MODE_META,
  type AttendanceMode,
} from '@/lib/domain/attendance-device';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE TERMINALS — owner request 2026-08-30
 * ----------------------------------------------------------------------------
 * *"I want in dashboard this feature… only in admin and superadmin… also show
 * all employee which are mapped with device and which are not."*
 *
 * Three questions, in the order somebody actually asks them:
 *
 *   1. Is the wall working?            the terminal strip
 *   2. Who scanned that I don't know?  the queue — and it is the mapping tool
 *   3. Who is set up and who is not?   the roster
 *
 * ── ⚠️ THE QUEUE IS THE MAPPING TOOL, AND THAT IS THE WHOLE DESIGN ─────────
 * The obvious build is a form where somebody types an employee number against a
 * name — which means reading a number off the terminal in another room, carrying
 * it across, and typing it correctly. Every step of that can go wrong silently:
 * a mistyped number produces a mapping that looks right on screen and never
 * matches a scan.
 *
 * So the flow is inverted. The person scans, Taskly shows *"019 — Abdul Moiz
 * scanned two minutes ago, nobody matched"*, and an Admin picks the account from
 * a list. The number is never retyped, and the terminal's own name for them is
 * right there to match against. Typing one by hand is still possible in the
 * roster below, for somebody enrolled who has not scanned yet.
 *
 * ⚠️ THIS PANEL IS NOT A SECURITY BOUNDARY. It is only rendered for
 * `attendance.manage_devices`, but migration 079 is what actually refuses a
 * Coordinator — both tables and both functions check rank themselves.
 * ========================================================================= */

const EMPTY: DeviceResult = { ok: false };

/* ⚠️ TWO EXPORTS, ON TWO DIFFERENT PAGES — owner, 2026-08-30: *"the mapping
   should be on the team page"*, with the terminal's health left on Attendance.

   That is the right cut, and not only because it was asked for. The two answer
   different questions to different people at different moments:

     TerminalHealth   "is the wall working?" — read while looking at today's
                      attendance and noticing somebody missing. Belongs beside
                      the record it explains.
     TerminalMapping  "who is this person?" — done once when somebody joins, in
                      the same sitting as creating their account and setting
                      their role. Belongs with the people, not with the times.

   They share `ago()` and the row components below rather than being split into
   two files, because the shared piece is the thing most likely to drift. */

/** The terminals and whether they are alive. For the Attendance page. */
export function TerminalHealth({
  terminals,
  nowMs,
}: {
  terminals: readonly TerminalRow[];
  nowMs: number;
}) {
  if (terminals.length === 0) return null;
  return <TerminalStrip terminals={terminals} nowMs={nowMs} />;
}

/** The queue and the roster — everything about who is who. For the Team page. */
export function TerminalMapping({
  unmatched,
  enrolments,
  nowMs,
}: {
  unmatched: readonly UnmatchedRow[];
  enrolments: readonly EnrolmentRow[];
  nowMs: number;
}) {
  const [note, setNote] = React.useState<DeviceResult | null>(null);

  const mapped = enrolments.filter((e) => e.devicePersonNo !== null);
  const unmappedPeople = enrolments.filter((e) => e.devicePersonNo === null);

  return (
    <div className="space-y-5">
      {note && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            color: note.ok ? 'var(--feedback-success)' : 'var(--feedback-error)',
          }}
        >
          {note.ok ? (
            <Check className="mt-px h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          )}
          {note.error ?? note.message}
        </p>
      )}

      <UnmatchedQueue unmatched={unmatched} people={enrolments} nowMs={nowMs} onDone={setNote} />
      <Roster mapped={mapped} unmapped={unmappedPeople} nowMs={nowMs} onDone={setNote} />
    </div>
  );
}

/* ==========================================================================
 * 1 · IS THE WALL WORKING
 * ========================================================================== */

/** "4 minutes ago". Computed from the server's clock, passed in. */
function ago(iso: string | null, nowMs: number): string {
  if (!iso) return 'never';
  const mins = Math.round((nowMs - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function TerminalStrip({
  terminals,
  nowMs,
}: {
  terminals: readonly TerminalRow[];
  nowMs: number;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {terminals.map((t) => {
        /* ⚠️ SIX HOURS, NOT ONE. A terminal is silent all night and all weekend
           without anything being wrong, so a tighter threshold would cry wolf
           every Monday morning and teach somebody to ignore it. */
        const silentMs = t.lastSeenAt ? nowMs - Date.parse(t.lastSeenAt) : Infinity;
        const quiet = silentMs > 6 * 3_600_000;

        return (
          <Card key={t.id}>
            <CardBody className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-body-sm font-semibold text-text-primary">
                    <Radio
                      className="size-3.5 shrink-0"
                      strokeWidth={2.5}
                      style={{
                        color: t.isActive && !quiet ? 'var(--feedback-success)' : 'var(--text-tertiary)',
                      }}
                      aria-hidden="true"
                    />
                    {t.label}
                  </p>
                  <p className="truncate text-micro text-text-tertiary">
                    {t.model ? `${t.model} · ` : ''}
                    {t.serialNo}
                    {t.location ? ` · ${t.location}` : ''}
                  </p>
                </div>

                <span
                  className="shrink-0 rounded-full px-2.5 py-1 text-micro font-semibold"
                  style={{
                    backgroundColor: `color-mix(in oklab, var(--${
                      t.isActive && !quiet ? 'feedback-success' : 'status-backlog'
                    }) 14%, transparent)`,
                    color: `var(--${t.isActive && !quiet ? 'feedback-success' : 'status-backlog'})`,
                  }}
                >
                  {!t.isActive ? 'Switched off' : quiet ? 'Quiet' : 'Live'}
                </span>
              </div>

              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-caption">
                <div>
                  <dt className="text-text-tertiary">Last heard from</dt>
                  <dd className="font-medium text-text-primary">{ago(t.lastSeenAt, nowMs)}</dd>
                </div>
                <div>
                  <dt className="text-text-tertiary">Scans today</dt>
                  <dd className="font-medium tabular-nums text-text-primary">{t.scansToday}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

/* ==========================================================================
 * 2 · WHO SCANNED THAT WE DO NOT KNOW
 * ========================================================================== */

function UnmatchedQueue({
  unmatched,
  people,
  nowMs,
  onDone,
}: {
  unmatched: readonly UnmatchedRow[];
  people: readonly EnrolmentRow[];
  nowMs: number;
  onDone: (r: DeviceResult) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserX className="size-4" strokeWidth={2.25} aria-hidden="true" />
          Scanned, but nobody matched
          {unmatched.length > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-micro font-semibold"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--feedback-warning) 16%, transparent)',
                color: 'var(--feedback-warning)',
              }}
            >
              {unmatched.length}
            </span>
          )}
        </CardTitle>
        <CardDescription>
          Somebody scanned and Taskly does not know who they are. Pick their account and every
          scan already received is applied to their attendance.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-2">
        {unmatched.length === 0 ? (
          <p className="py-6 text-center text-body-sm text-text-secondary">
            Nothing waiting. Every scan in the last 30 days matched somebody.
          </p>
        ) : (
          unmatched.map((row) => (
            <UnmatchedRowForm key={row.employeeNo} row={row} people={people} nowMs={nowMs} onDone={onDone} />
          ))
        )}
      </CardBody>
    </Card>
  );
}

function UnmatchedRowForm({
  row,
  people,
  nowMs,
  onDone,
}: {
  row: UnmatchedRow;
  people: readonly EnrolmentRow[];
  nowMs: number;
  onDone: (r: DeviceResult) => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(mapPersonAction, EMPTY);
  const seen = React.useRef(false);

  React.useEffect(() => {
    if ((state.ok || state.error) && !seen.current) {
      seen.current = true;
      onDone(state);
      if (state.ok) router.refresh();
    }
  }, [state, onDone, router]);

  /* ⚠️ SUGGESTED, NOT SELECTED. The terminal's name for somebody is a free-text
     field an installer typed; matching it to an account is a good guess and a
     bad decision. Pre-selecting would let an Admin confirm a wrong match with
     one distracted click, and attendance would then be filed against the wrong
     person silently. */
  const suggestion = React.useMemo(() => {
    if (!row.deviceName) return null;
    const needle = row.deviceName.trim().toLowerCase();
    return (
      people.find((p) => p.fullName.toLowerCase() === needle) ??
      people.find((p) => {
        const first = p.fullName.split(' ')[0].toLowerCase();
        return first.length > 2 && needle.includes(first);
      }) ??
      null
    );
  }, [row.deviceName, people]);

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5"
    >
      <input type="hidden" name="employeeNo" value={row.employeeNo} />

      <span className="min-w-0 flex-1 basis-[13rem]">
        <span className="block text-body-sm font-semibold text-text-primary">
          <span className="font-mono">{row.employeeNo}</span>
          {row.deviceName && <span className="text-text-secondary"> · {row.deviceName}</span>}
        </span>
        <span className="block text-micro text-text-tertiary">
          {row.scans} scan{row.scans === 1 ? '' : 's'} · last {ago(row.lastScannedAt, nowMs)} ·{' '}
          {METHOD_LABEL[row.lastMethod]} · {row.terminalLabel}
        </span>
      </span>

      <span className="w-full sm:w-[15rem]">
        <Select
          name="userId"
          required
          defaultValue=""
          aria-label={`Who is ${row.employeeNo}`}
          options={[
            { value: '', label: 'Who is this?' },
            ...people.map((p) => ({
              value: p.userId,
              label: p.devicePersonNo ? `${p.fullName} (now ${p.devicePersonNo})` : p.fullName,
            })),
          ]}
        />
        {suggestion && (
          <span className="mt-1 block text-micro text-text-tertiary">
            Looks like <strong className="text-text-secondary">{suggestion.fullName}</strong>
          </span>
        )}
      </span>

      <Button variant="primary" size="sm" type="submit" disabled={pending}>
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Link2 className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
        )}
        Link
      </Button>
    </form>
  );
}

/* ==========================================================================
 * 3 · WHO IS SET UP AND WHO IS NOT
 * ========================================================================== */

function Roster({
  mapped,
  unmapped,
  nowMs,
  onDone,
}: {
  mapped: readonly EnrolmentRow[];
  unmapped: readonly EnrolmentRow[];
  nowMs: number;
  onDone: (r: DeviceResult) => void;
}) {
  const [query, setQuery] = React.useState('');

  const match = (p: EnrolmentRow) =>
    query.trim() === '' ||
    `${p.fullName} ${p.email} ${p.devicePersonNo ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());

  const shownMapped = mapped.filter(match);
  const shownUnmapped = unmapped.filter(match);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="size-4" strokeWidth={2.25} aria-hidden="true" />
          Everybody, and whether the terminal knows them
        </CardTitle>
        <CardDescription>
          {mapped.length} of {mapped.length + unmapped.length} people are linked to a terminal.
          Anybody working remotely does not need to be.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="relative max-w-[22rem]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-tertiary"
            strokeWidth={2.25}
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people…"
            aria-label="Search people"
            className={cn(
              'h-9 w-full rounded-lg border border-border-default bg-bg-surface pl-9 pr-3',
              'text-body-sm text-text-primary placeholder:text-text-tertiary',
              'focus-visible:border-border-brand focus-visible:outline-none',
            )}
          />
        </div>

        {/* ⚠️ THE UNLINKED COME FIRST. This screen is opened to finish setting
            somebody up, so the people still needing work lead — a list sorted
            alphabetically buries them among the ones already done. */}
        {shownUnmapped.length > 0 && (
          <div className="space-y-2">
            <p className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
              Not on a terminal ({shownUnmapped.length})
            </p>
            {shownUnmapped.map((p) => (
              <PersonRow key={p.userId} person={p} nowMs={nowMs} onDone={onDone} />
            ))}
          </div>
        )}

        {shownMapped.length > 0 && (
          <div className="space-y-2">
            <p className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
              On a terminal ({shownMapped.length})
            </p>
            {shownMapped.map((p) => (
              <PersonRow key={p.userId} person={p} nowMs={nowMs} onDone={onDone} />
            ))}
          </div>
        )}

        {shownMapped.length === 0 && shownUnmapped.length === 0 && (
          <p className="py-6 text-center text-body-sm text-text-secondary">
            Nobody matches “{query}”.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function PersonRow({
  person,
  nowMs,
  onDone,
}: {
  person: EnrolmentRow;
  nowMs: number;
  onDone: (r: DeviceResult) => void;
}) {
  const router = useRouter();
  const [mapState, mapAction, mapping] = React.useActionState(mapPersonAction, EMPTY);
  const [modeState, modeAction, changingMode] = React.useActionState(setAttendanceModeAction, EMPTY);
  const [number, setNumber] = React.useState(person.devicePersonNo ?? '');
  const seenMap = React.useRef(false);
  const seenMode = React.useRef(false);

  React.useEffect(() => {
    if ((mapState.ok || mapState.error) && !seenMap.current) {
      seenMap.current = true;
      onDone(mapState);
      if (mapState.ok) router.refresh();
    }
  }, [mapState, onDone, router]);

  React.useEffect(() => {
    if ((modeState.ok || modeState.error) && !seenMode.current) {
      seenMode.current = true;
      onDone(modeState);
      if (modeState.ok) router.refresh();
    }
  }, [modeState, onDone, router]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border-subtle px-3 py-2.5">
      <span className="min-w-0 flex-1 basis-[12rem]">
        <span className="block truncate text-body-sm font-semibold text-text-primary">
          {person.fullName}
        </span>
        <span className="block truncate text-micro text-text-tertiary">
          {person.roleTitle ? `${person.roleTitle} · ` : ''}
          {person.lastScanAt ? `last scanned ${ago(person.lastScanAt, nowMs)}` : 'never scanned'}
        </span>
      </span>

      {/* Who they are on the terminal. Typed here only for somebody enrolled who
          has not scanned yet — otherwise the queue above is the better route. */}
      <form action={mapAction} className="flex items-center gap-1.5">
        <input type="hidden" name="userId" value={person.userId} />
        <Input
          name="employeeNo"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          placeholder="Number"
          aria-label={`Terminal number for ${person.fullName}`}
          className="w-[7.5rem] font-mono"
        />
        <Button
          variant={number === (person.devicePersonNo ?? '') ? 'ghost' : 'primary'}
          size="sm"
          type="submit"
          disabled={mapping || number === (person.devicePersonNo ?? '')}
          title={number ? 'Link this number' : 'Unlink from the terminal'}
        >
          {mapping ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : number ? (
            <Link2 className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <Link2Off className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
          )}
        </Button>
      </form>

      {/* ⚠️ Submits on change rather than behind a Save button. It is one field
          with two values and an immediate, reversible effect; a Save button here
          is a second click that only creates a state where the screen and the
          database disagree. */}
      <form action={modeAction}>
        <input type="hidden" name="userId" value={person.userId} />
        <Select
          name="mode"
          defaultValue={person.attendanceMode}
          disabled={changingMode}
          aria-label={`How ${person.fullName} records attendance`}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="w-[13rem]"
          options={(['either', 'terminal_only'] as AttendanceMode[]).map((m) => ({
            value: m,
            label: MODE_META[m].label,
          }))}
        />
      </form>
    </div>
  );
}
