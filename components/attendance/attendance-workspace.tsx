'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlarmClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  Loader2,
  LogIn,
  LogOut,
  MoreHorizontal,
  Pencil,
  Search,
  Sun,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';

import {
  checkInAction,
  checkOutAction,
  correctDayAction,
  exportAttendanceAction,
} from '@/app/actions/attendance';
import { AttendanceColumns } from '@/components/attendance/attendance-columns';
import {
  METHOD_LABEL,
  SOURCE_META,
  type AttendanceSource,
  type ScanMethod,
} from '@/lib/domain/attendance-device';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Donut3D } from '@/components/ui/chart';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { StatCard } from '@/components/ui/metric';
import { Select } from '@/components/ui/select';
import { downloadCsv, downloadXlsxFromBase64, openPdfInTab } from '@/lib/download';
import {
  ATTENDANCE_STATUS_META,
  OFFICE_TEAMS,
  clockLabel,
  durationLabel,
  minutesLate,
  minutesWorked,
  type AttendanceStatus,
} from '@/lib/domain/attendance';
import {
  GRANULARITIES,
  GRANULARITY_LABEL,
  NO_FILTERS,
  defaultGranularity,
  filterAttendanceRows,
  groupColumns,
  rangeLabel,
  shortDate,
  type AttendanceBoard,
  type BoardRow,
  type Granularity,
  type RangeKey,
  type RowFilters,
} from '@/lib/view/attendance-board';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE ATTENDANCE PAGE
 * ----------------------------------------------------------------------------
 * Built to the owner's reference, and revised on 2026-08-25 against a
 * side-by-side comparison they sent of the reference and the first build.
 *
 * ── ⚠️ THE LAYOUT IS THE REFERENCE'S, INCLUDING WHERE THE RULES CARD SITS ───
 * Three cards on the middle row — overview, distribution, quick check-in — and
 * then the records table BESIDE the office rules, not under them. The first build
 * stacked the rules under the quick card and ran the table full width, which is
 * the difference the owner spotted first.
 *
 * ── ⚠️ EVERY FIGURE COMES FROM ONE CLASSIFICATION ───────────────────────────
 * The board is built once, on the server, from person × day. This file arranges,
 * filters and paginates; it never decides whether somebody was late. That is why
 * the cards cannot disagree with the rows beneath them, and it is tested rather
 * than trusted.
 *
 * ── ⚠️ THE EXPORT DOES NOT SEND ROWS ────────────────────────────────────────
 * It sends the period and the four filters, and the server rebuilds. A report
 * posted back from a browser could claim any numbers at all, and this is the file
 * that leaves the building with the division's name on it. Because both sides run
 * the same `filterAttendanceRows`, what comes back is exactly what is on screen.
 * ========================================================================= */

type StatusFilter = 'all' | AttendanceStatus;

/** Rows per page. Enough to fill the card, few enough to scan. */
const PAGE_SIZE = 10;

/* ⚠️ The one-press periods on the TABLE, the four the owner named on 2026-08-25:
   *"a filter where I can directly show today, yesterday, the month, or the last
   month."* They navigate the page's range — every card and chart above derives
   from the same period, so the table cannot show one span while the donut is
   still describing another. */
const QUICK_RANGES: readonly { value: RangeKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
];

export interface AttendanceWorkspaceProps {
  readonly board: AttendanceBoard;
  readonly range: { key: RangeKey; from: string; to: string; label: string };
  readonly today: string;
  readonly nowMinutes: number;
  readonly mine: { checkedInAt: string | null; checkedOutAt: string | null } | null;
  readonly myName: string;
  /** `attendance.view_all` — Coordinator and above. */
  readonly canViewAll: boolean;
  /** `attendance.edit` — Admin and above. NOT the Coordinator, by instruction. */
  readonly canEdit: boolean;
}

export function AttendanceWorkspace({
  board,
  range,
  nowMinutes,
  mine,
  myName,
  canViewAll,
  canEdit,
}: AttendanceWorkspaceProps) {
  const router = useRouter();
  const [filters, setFilters] = React.useState<RowFilters>(NO_FILTERS);
  /* ⚠️ Opens on the grouping that suits the period — Weekly for the month this
     page opens on, by the owner's instruction. See `defaultGranularity`. */
  const [granularity, setGranularity] = React.useState<Granularity>(() =>
    defaultGranularity(range),
  );
  const [page, setPage] = React.useState(0);
  const [editing, setEditing] = React.useState<BoardRow | null>(null);
  const [showLate, setShowLate] = React.useState(false);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);
  const tableRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 5000);
    return () => window.clearTimeout(timer);
  }, [note]);

  /* ⚠️ Back to page one whenever the filters or the period change. Staying on
     page 4 of a list that now has two shows an empty table, which reads as "no
     results" for a filter that in fact matched plenty. Adjusted during render
     rather than in an effect — the lint refuses a synchronous setState there, and
     an effect would paint the empty page first. */
  const filterKey = `${filters.team}|${filters.status}|${filters.query}|${filters.onDate}|${range.from}|${range.to}`;
  const [seenFilters, setSeenFilters] = React.useState(filterKey);
  if (seenFilters !== filterKey) {
    setSeenFilters(filterKey);
    setPage(0);
  }

  /* ── ⚠️ THE GROUPING RE-DERIVES WHEN THE PERIOD CHANGES ─────────────────────
     A lazy initialiser runs once. This component is NOT remounted when the period
     changes — the range arrives as a new prop from the server — so without this,
     opening on the month (Weekly) and then picking "Today" would draw that single
     day as one column labelled "Week of 24 Aug".

     A manual choice still sticks: this fires only when the dates themselves move,
     so somebody who switches the month to Daily keeps Daily until they change
     period. Adjusted during render for the same reason as the page reset above —
     an effect would paint the wrong grouping first. */
  const [seenRange, setSeenRange] = React.useState(`${range.from}|${range.to}`);
  if (seenRange !== `${range.from}|${range.to}`) {
    setSeenRange(`${range.from}|${range.to}`);
    setGranularity(defaultGranularity(range));
  }

  const rows = React.useMemo(
    () => filterAttendanceRows(board.rows, filters),
    [board.rows, filters],
  );
  const columns = React.useMemo(
    () => groupColumns(board.days, granularity),
    [board.days, granularity],
  );
  const lateRows = React.useMemo(
    () => board.rows.filter((row) => row.status === 'late'),
    [board.rows],
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shown = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const patch = (next: Partial<RowFilters>) => setFilters((f) => ({ ...f, ...next }));

  const summary = board.summary;
  const todaySummary = board.todaySummary;

  return (
    <div className="space-y-4">
      {note && (
        <p
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            color: note.ok ? 'var(--feedback-success)' : 'var(--feedback-error)',
          }}
        >
          {note.text}
        </p>
      )}

      {/* ══ The five counters ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label={canViewAll ? 'Total employees' : 'Your working days'}
          value={canViewAll ? board.headcount : summary.settled}
          icon={Users}
          token="accent-primary"
          hint={canViewAll ? 'Active people' : rangeLabel(range)}
        />
        <StatCard
          label={canViewAll ? 'Present today' : 'Days present'}
          value={
            canViewAll ? todaySummary.present + todaySummary.late : summary.present + summary.late
          }
          icon={CheckCircle2}
          token="feedback-success"
          hint={
            canViewAll
              ? todaySummary.expected > 0
                ? `${todaySummary.expected} not in yet`
                : 'Everybody accounted for'
              : `${summary.late} late`
          }
        />
        <StatCard
          label="Average hours"
          value={durationLabel(summary.averageMinutes)}
          icon={Clock}
          token="accent-gold"
          hint="Per recorded day"
        />
        <StatCard
          label="Attendance rate"
          value={summary.rate === null ? '—' : `${summary.rate}%`}
          icon={TrendingUp}
          token="accent-primary"
          hint={
            summary.settled === 0
              ? 'Nothing settled yet'
              : `${summary.settled} day${summary.settled === 1 ? '' : 's'} counted`
          }
        />

        {/* ── ⚠️ THE ONE COUNTER THAT OPENS SOMETHING ───────────────────────
            Owner: *"For the late arrivals I want to see them. For example when I
            click on a late arrival, the form pops up and shows all the late
            arrivals."* It is the only figure here whose real answer is a list of
            names — "34 late" is useless without "whose". */}
        <button
          type="button"
          onClick={() => setShowLate(true)}
          disabled={lateRows.length === 0}
          aria-label={`Late arrivals: ${lateRows.length}. Open the list.`}
          className="text-left disabled:cursor-default"
        >
          <StatCard
            label="Late arrivals"
            value={summary.late}
            icon={AlarmClock}
            token="feedback-warning"
            hint={lateRows.length === 0 ? 'None in this period' : 'Click to see who'}
            className={lateRows.length > 0 ? 'cursor-pointer hover:border-border-brand' : undefined}
          />
        </button>
      </div>

      {/* ══ Three cards on one line ═══════════════════════════════════════════
          ── ⚠️ 6 / 3 / 3, AND EVERY CARD `h-full` ────────────────────────────
          Owner, 2026-08-25, with a second reference: *"the Attendance Overview has
          more width but less height. In that way the Next Attendance Distribution
          and the Quick Check In and Check Out will be equal to each other and the
          white space is also covered."*

          Both halves of that matter and they are separate fixes:

          WIDTH. The chart was on 5 of 12 with the donut on 4 — so the one card
          that has to fit a month of columns was the second-narrowest thing in the
          row. It now takes half the row and the other two split the rest evenly,
          which is also what makes them equal to each other.

          HEIGHT. Grid items stretch, so all three DIVS were already the same
          height — but the Cards inside them were not, which is why the quick card
          floated with a gap beneath it. `h-full` on each Card, and a flex column
          inside, means the surfaces end level and their contents distribute into
          the space instead of leaving it blank. The row's height is then set by
          the shortest thing that can honestly fill it: a 152px plot. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Card className="min-w-0 xl:col-span-6">
          <CardBody className="flex h-full flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-body font-semibold text-text-primary">Attendance overview</h2>
              {/* ⚠️ GRANULARITY, not the period — the period is the chip in the page
                  header. This decides whether a month is drawn as 31 columns or 5,
                  which is what made the first build's chart unreadable. Local
                  state, seeded from the period: grouping is arithmetic on data
                  already here. */}
              <Select
                label="Group the columns by"
                value={granularity}
                onChange={(event) => setGranularity(event.target.value as Granularity)}
                options={GRANULARITIES.map((g) => ({ value: g, label: GRANULARITY_LABEL[g] }))}
                className="w-[7.5rem]"
              />
            </div>
            <AttendanceColumns
              columns={columns}
              caption={`Present and absent, ${rangeLabel(range)}`}
              plotHeight={152}
            />
          </CardBody>
        </Card>

        <Card className="min-w-0 xl:col-span-3">
          <CardBody className="flex h-full flex-col gap-2 p-4">
            <h2 className="text-body font-semibold text-text-primary">Attendance distribution</h2>
            {/* ⚠️ `flex-1` and centred, so the figure takes the leftover height
                rather than sitting at the top of it. That gap under the donut was
                the "lot of white space at the bottom of this card". */}
            <div className="flex flex-1 items-center">
              <Donut3D
                slices={[
                  { label: 'Present', value: summary.present, token: 'feedback-success' },
                  { label: 'Late', value: summary.late, token: 'feedback-warning' },
                  { label: 'Absent', value: summary.absent, token: 'feedback-error' },
                  { label: 'On leave', value: summary.onLeave, token: 'accent-gold' },
                ]}
                centreLabel="Attendance rate"
                centreValue={summary.rate === null ? '—' : `${summary.rate}%`}
                caption={`How the days in ${rangeLabel(range)} were spent`}
                /* ⚠️ 140, not 150: this card is 3 of 12 columns and loses about
                   43px when the sidebar is expanded, which was enough to drop the
                   legend below the ring. Sized so the two stay side by side at
                   both sidebar widths. */
                size={140}
                className="w-full"
              />
            </div>
            <p className="border-t border-border-subtle pt-2 text-micro text-text-tertiary">
              {canViewAll ? `${board.headcount} people · ` : ''}
              {rangeLabel(range)}
            </p>
          </CardBody>
        </Card>

        <div className="min-w-0 xl:col-span-3">
          <QuickCard
            mine={mine}
            myName={myName}
            nowMinutes={nowMinutes}
            onMine={() => {
              /* "View my attendance" — on a page showing the whole division, that
                 means "narrow this to me", so it does exactly that and moves the
                 view to the table rather than navigating somewhere else. */
              patch({ query: myName, status: 'all', team: 'all', onDate: '' });
              tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            onDone={(result) => {
              setNote({ ok: result.ok, text: result.ok ? result.message : result.error });
              router.refresh();
            }}
          />
        </div>
      </div>

      {/* ══ The records, beside the rules — the reference's third row ══════ */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <Card className="min-w-0 xl:col-span-9">
          <div ref={tableRef} className="scroll-mt-4" />
          <CardBody className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="shrink-0 text-body font-semibold text-text-primary">
                {canViewAll ? 'Attendance records' : 'Your attendance'}
              </h2>

              <div className="flex flex-wrap items-center gap-2">
                <span className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary"
                    strokeWidth={2.25}
                    aria-hidden="true"
                  />
                  <Input
                    value={filters.query}
                    onChange={(event) => patch({ query: event.target.value })}
                    placeholder="Search employee…"
                    aria-label="Search employee"
                    className="h-9 w-[10rem] pl-7"
                  />
                </span>

                {/* When the current period is not one of the four (this week, a
                    custom span…), it is prepended so the control never claims the
                    page is showing something it is not. */}
                <Select
                  label="Show a period"
                  value={range.key}
                  onChange={(event) => {
                    const key = event.target.value;
                    if (key !== range.key) router.replace(`/attendance?range=${key}` as never);
                  }}
                  options={
                    QUICK_RANGES.some((quick) => quick.value === range.key)
                      ? QUICK_RANGES
                      : [{ value: range.key, label: range.label }, ...QUICK_RANGES]
                  }
                  className="w-[8rem]"
                />

                {/* ⚠️ A day INSIDE the period, not a second period. Owner asked for
                    "a calendar dropdown or a filter where I can select the date" on
                    this table: the header chip decides the span, this pins one day
                    of it, and the cross returns the whole span. */}
                <span className="flex items-center gap-1">
                  <Input
                    type="date"
                    value={filters.onDate}
                    min={range.from}
                    max={range.to}
                    onChange={(event) => patch({ onDate: event.target.value })}
                    aria-label="Show one day"
                    className="h-9 w-[8.5rem] text-caption"
                  />
                  {filters.onDate !== '' && (
                    <button
                      type="button"
                      aria-label="Show every day again"
                      title="Show every day again"
                      onClick={() => patch({ onDate: '' })}
                      className="grid size-7 place-items-center rounded-lg text-text-tertiary hover:bg-bg-active hover:text-text-primary"
                    >
                      <X className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                    </button>
                  )}
                </span>

                {canViewAll && (
                  <Select
                    label="Team"
                    value={filters.team}
                    onChange={(event) => patch({ team: event.target.value })}
                    options={[
                      { value: 'all', label: 'All teams' },
                      { value: 'blue_area', label: OFFICE_TEAMS.blue_area.label },
                      { value: 'wah', label: OFFICE_TEAMS.wah.label },
                    ]}
                    className="w-[7.5rem]"
                  />
                )}

                <Select
                  label="Status"
                  value={filters.status}
                  onChange={(event) => patch({ status: event.target.value as StatusFilter })}
                  options={[
                    { value: 'all', label: 'All statuses' },
                    { value: 'present', label: 'Present' },
                    { value: 'late', label: 'Late' },
                    { value: 'absent', label: 'Absent' },
                    { value: 'on_leave', label: 'On leave' },
                    { value: 'expected', label: 'Not in yet' },
                  ]}
                  className="w-[8.5rem]"
                />

                <ExportMenu
                  disabled={rows.length === 0}
                  request={{
                    range: range.key,
                    from: range.from,
                    to: range.to,
                    team: filters.team,
                    status: filters.status,
                    query: filters.query,
                    onDate: filters.onDate,
                    granularity,
                  }}
                  onNote={setNote}
                />
              </div>
            </div>

            {/* ⚠️ Scrolls inside its own card, never the page. */}
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[44rem] border-collapse">
                <thead>
                  <tr className="border-b border-border-default">
                    <Th>Employee</Th>
                    {canViewAll && <Th>Team</Th>}
                    <Th>Date</Th>
                    <Th>Check-in</Th>
                    <Th>Check-out</Th>
                    <Th>Total hours</Th>
                    <Th>Overtime</Th>
                    <Th>Status</Th>
                    {canEdit && <Th align="right">Action</Th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr
                      key={`${row.userId}-${row.onDate}`}
                      className="border-b border-border-subtle last:border-0 hover:bg-bg-hover"
                    >
                      <Td>
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar name={row.name} src={row.avatarUrl} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate text-caption font-medium text-text-primary">
                              {row.name}
                            </span>
                            <span className="block truncate text-micro text-text-tertiary">
                              {row.roleTitle ?? '—'}
                            </span>
                          </span>
                        </span>
                      </Td>
                      {canViewAll && (
                        <Td>
                          <TeamChip team={row.officeTeam} label={row.teamLabel} />
                        </Td>
                      )}
                      <Td>
                        <span className="whitespace-nowrap text-caption text-text-secondary">
                          {shortDate(row.onDate)}
                        </span>
                      </Td>
                      <Td>
                        <Stamp
                          iso={row.checkedInAt}
                          late={row.status === 'late'}
                          source={row.checkInSource}
                          method={row.checkInMethod}
                        />
                      </Td>
                      <Td>
                        {row.checkedInAt && !row.checkedOutAt ? (
                          <span
                            className="whitespace-nowrap text-caption font-medium"
                            style={{ color: 'var(--feedback-warning)' }}
                            title="They checked in and never checked out."
                          >
                            No check-out
                          </span>
                        ) : (
                          <Stamp
                            iso={row.checkedOutAt}
                            source={row.checkOutSource}
                            method={row.checkOutMethod}
                          />
                        )}
                      </Td>
                      <Td>
                        <span className="whitespace-nowrap text-caption tabular-nums text-text-primary">
                          {durationLabel(row.minutes)}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className="whitespace-nowrap text-caption tabular-nums"
                          style={{
                            color: row.overtime
                              ? 'var(--feedback-success)'
                              : 'var(--text-tertiary)',
                          }}
                        >
                          {durationLabel(row.overtime)}
                        </span>
                      </Td>
                      <Td>
                        <span className="flex items-center gap-1.5">
                          <StatusPill status={row.status} />
                          {row.status === 'late' && row.lateThisMonth >= 3 && (
                            <span
                              className="text-micro font-semibold"
                              style={{ color: 'var(--feedback-error)' }}
                              title={`${row.lateThisMonth} late arrivals this month — they have been told`}
                            >
                              ×{row.lateThisMonth}
                            </span>
                          )}
                        </span>
                      </Td>
                      {canEdit && (
                        <Td align="right">
                          <button
                            type="button"
                            aria-label={`Correct ${row.name}'s ${shortDate(row.onDate)}`}
                            title="Correct this record"
                            onClick={() => setEditing(row)}
                            className="grid size-8 place-items-center rounded-lg text-text-tertiary hover:bg-bg-active hover:text-text-primary"
                          >
                            <MoreHorizontal
                              className="size-4"
                              strokeWidth={2.25}
                              aria-hidden="true"
                            />
                          </button>
                        </Td>
                      )}
                    </tr>
                  ))}

                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-10 text-center text-caption text-text-tertiary">
                        {board.rows.length === 0
                          ? 'Nothing recorded in this period yet.'
                          : 'Nothing matches those filters.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ── ⚠️ PAGINATION, NOT A LONGER CARD ───────────────────────────
                Owner: *"There should be pagination: don't show all."* A month for
                six people is about 120 rows, and the first build drew every one —
                so the card grew past the window and the PAGE scrolled instead of
                the table. */}
            {rows.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-micro text-text-tertiary">
                  {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} of{' '}
                  {rows.length}
                  {rows.length !== board.rows.length && ` (filtered from ${board.rows.length})`} ·
                  days off are not listed
                </p>

                {pageCount > 1 && (
                  <div className="flex items-center gap-1">
                    <PageButton
                      label="Previous page"
                      icon={ChevronLeft}
                      disabled={page === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    />
                    <span className="px-1 text-caption tabular-nums text-text-secondary">
                      {page + 1} / {pageCount}
                    </span>
                    <PageButton
                      label="Next page"
                      icon={ChevronRight}
                      disabled={page >= pageCount - 1}
                      onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    />
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>

        <div className="min-w-0 xl:col-span-3">
          <TimingRules />
        </div>
      </div>

      {/* ══ Who was late ══════════════════════════════════════════════════ */}
      {showLate && (
        <LateDialog
          rows={lateRows}
          rangeText={rangeLabel(range)}
          canViewAll={canViewAll}
          onClose={() => setShowLate(false)}
        />
      )}

      {canEdit && editing && (
        <CorrectDialog
          row={editing}
          onClose={() => setEditing(null)}
          onDone={(result) => {
            setEditing(null);
            setNote({ ok: result.ok, text: result.ok ? result.message : result.error });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Export
 * ------------------------------------------------------------------------- */

function ExportMenu({
  request,
  disabled,
  onNote,
}: {
  request: Omit<Parameters<typeof exportAttendanceAction>[0], 'format'>;
  disabled: boolean;
  onNote: (note: { ok: boolean; text: string }) => void;
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  /* ⚠️ Closes on an outside click — `<details>` does not do that by itself, and
     the owner reported exactly this gap on the reports page's export menu. */
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const close = (event: Event) => {
      if (!node.open) return;
      if (event.type === 'mousedown' && node.contains(event.target as Node)) return;
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      node.removeAttribute('open');
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  const run = async (format: 'csv' | 'xlsx' | 'pdf') => {
    setBusy(format);
    ref.current?.removeAttribute('open');
    try {
      const result = await exportAttendanceAction({ ...request, format });
      if (!result.ok) {
        onNote({ ok: false, text: result.error });
        return;
      }

      if (format === 'csv') {
        downloadCsv(result.fileName, result.content);
      } else if (format === 'xlsx') {
        downloadXlsxFromBase64(result.fileName, result.content);
      } else {
        /* ⚠️ Opened, not downloaded. Owner, of the reports page: *"Don't generate a
           PDF report instantly. It should first open in a new tab. If I want to
           download it, then I can download it with the button."* */
        const opened = openPdfInTab(result.fileName, result.content);
        if (!opened) {
          onNote({
            ok: false,
            text: 'The PDF was blocked by your pop-up blocker. Allow pop-ups for this site, then try again.',
          });
          return;
        }
      }
      onNote({ ok: true, text: `${result.rowCount} row(s) exported.` });
    } catch {
      onNote({ ok: false, text: 'The export could not be produced.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <details ref={ref} className="relative">
      <summary
        aria-label="Export"
        className={cn(
          'flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg border border-border-default px-3',
          'text-caption font-semibold text-text-primary marker:content-none',
          'hover:bg-bg-hover [&::-webkit-details-marker]:hidden',
          disabled && 'pointer-events-none opacity-45',
        )}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="size-4" strokeWidth={2.25} aria-hidden="true" />
        )}
        Export
      </summary>

      <div className="absolute right-0 z-40 mt-1 w-[13rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[var(--shadow-lg)]">
        {/* ⚠️ PDF first: it is the one that uses the Reports page's own template,
            and the one somebody hands to another person. */}
        <ExportItem
          icon={FileText}
          label="PDF report"
          hint="Opens in a tab"
          onClick={() => void run('pdf')}
        />
        <ExportItem
          icon={FileSpreadsheet}
          label="Excel"
          hint=".xlsx"
          onClick={() => void run('xlsx')}
        />
        <ExportItem
          icon={FileSpreadsheet}
          label="CSV"
          hint="Plain text"
          onClick={() => void run('csv')}
        />
        <p className="border-t border-border-subtle px-3 pb-1 pt-2 text-micro leading-relaxed text-text-tertiary">
          Exports exactly the rows and the period on screen.
        </p>
      </div>
    </details>
  );
}

function ExportItem({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text-secondary hover:bg-bg-hover hover:text-text-primary"
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      <span className="min-w-0 flex-1 font-semibold">{label}</span>
      <span className="shrink-0 text-micro text-text-tertiary">{hint}</span>
    </button>
  );
}

/* ---------------------------------------------------------------------------
 * Who was late
 * ------------------------------------------------------------------------- */

/* ── ⚠️ A TABLE, NOT A LIST OF LISTS ────────────────────────────────────────
   Owner, 2026-08-25, on the first build: *"You can see how pathetic they look
   right now. This Late Arrival card you have to totally redesign it with a proper
   presentable table."*

   The old shape was a heading per person with a bare `<ul>` of dates under it,
   indented by a padding value. Two things were wrong with it and neither was
   cosmetic. Columns that do not line up between one person and the next cannot be
   compared down the page, which is the entire reason to open this. And the one
   number the reader actually wants — HOW late — was never there at all: a
   check-in of 10:47 AM means nothing unless you keep subtracting 10:30 in your
   head, thirty-four times.

   So: one row per late arrival, real aligned columns, a computed "late by", and
   the three figures that summarise it across the top. Sorting is offered because
   the two questions behind this dialog are "what happened lately" and "who is
   doing it repeatedly", and one order cannot answer both. */

type LateSort = 'recent' | 'person' | 'worst';

const LATE_SORTS: readonly { value: LateSort; label: string }[] = [
  { value: 'recent', label: 'Most recent' },
  { value: 'person', label: 'By person' },
  { value: 'worst', label: 'Latest arrival' },
];

function LateDialog({
  rows,
  rangeText,
  canViewAll,
  onClose,
}: {
  rows: readonly BoardRow[];
  rangeText: string;
  canViewAll: boolean;
  onClose: () => void;
}) {
  const [sort, setSort] = React.useState<LateSort>('recent');

  /* One pass, so the tiles and the rows cannot disagree about the same period. */
  const stats = React.useMemo(() => {
    const people = new Map<string, number>();
    let totalLate = 0;
    let counted = 0;
    for (const row of rows) {
      people.set(row.userId, (people.get(row.userId) ?? 0) + 1);
      const by = minutesLate(row.checkedInAt);
      if (by !== null) {
        totalLate += by;
        counted += 1;
      }
    }
    const worst = [...people.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      people: people.size,
      average: counted === 0 ? null : Math.round(totalLate / counted),
      repeat: [...people.values()].filter((n) => n >= 3).length,
      worstName: worst ? (rows.find((r) => r.userId === worst[0])?.name ?? null) : null,
      worstCount: worst ? worst[1] : 0,
    };
  }, [rows]);

  const sorted = React.useMemo(() => {
    const list = [...rows];
    if (sort === 'recent') {
      return list.sort((a, b) => (a.onDate === b.onDate ? a.name.localeCompare(b.name) : a.onDate < b.onDate ? 1 : -1));
    }
    if (sort === 'worst') {
      /* Null last: an unparseable stamp has no "late by" and must not sort as 0. */
      return list.sort((a, b) => (minutesLate(b.checkedInAt) ?? -1) - (minutesLate(a.checkedInAt) ?? -1));
    }
    return list.sort(
      (a, b) =>
        b.lateThisMonth - a.lateThisMonth ||
        a.name.localeCompare(b.name) ||
        (a.onDate < b.onDate ? 1 : -1),
    );
  }, [rows, sort]);

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title="Late arrivals"
      description={`${rangeText} · anything after 10:30 AM counts as late`}
    >
      {rows.length === 0 ? (
        <p className="py-10 text-center text-caption text-text-tertiary">
          Nobody arrived late in this period.
        </p>
      ) : (
        <div className="space-y-4">
          {/* ── The three figures ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <LateTile label="Late arrivals" value={String(rows.length)} token="feedback-warning" />
            <LateTile
              label={canViewAll ? 'People' : 'Your days'}
              value={String(canViewAll ? stats.people : rows.length)}
              hint={canViewAll && stats.repeat > 0 ? `${stats.repeat} at 3 or more` : undefined}
            />
            <LateTile
              label="Average late by"
              value={stats.average === null ? '—' : durationLabel(stats.average)}
            />
            <LateTile
              label={canViewAll ? 'Most often' : 'This month'}
              value={
                canViewAll
                  ? (stats.worstName?.split(' ')[0] ?? '—')
                  : String(rows[0]?.lateThisMonth ?? 0)
              }
              hint={canViewAll ? `${stats.worstCount} times` : 'counted to date'}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-micro text-text-tertiary">
              {rows.length} row{rows.length === 1 ? '' : 's'} · &ldquo;Late by&rdquo; is measured
              from 10:30 AM
            </p>
            <Select
              label="Sort the list"
              value={sort}
              onChange={(event) => setSort(event.target.value as LateSort)}
              options={LATE_SORTS}
              className="w-[9.5rem]"
            />
          </div>

          {/* ⚠️ Scrolls sideways inside its own box on a narrow window; the dialog
              body owns the vertical scroll, which is what the sticky header
              below sticks to. */}
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[36rem] border-collapse">
              <thead>
                <tr>
                  <LateTh>Employee</LateTh>
                  {canViewAll && <LateTh>Team</LateTh>}
                  <LateTh>Date</LateTh>
                  <LateTh>Check-in</LateTh>
                  <LateTh align="right">Late by</LateTh>
                  <LateTh align="right">Hours</LateTh>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const by = minutesLate(row.checkedInAt);
                  return (
                    <tr
                      key={`${row.userId}-${row.onDate}`}
                      className="border-b border-border-subtle last:border-0 hover:bg-bg-hover"
                    >
                      <Td>
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar name={row.name} src={row.avatarUrl} size="sm" />
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-caption font-medium text-text-primary">
                                {row.name}
                              </span>
                              {/* ⚠️ Red at three, because three is the point at
                                  which the system emails them. The colour is the
                                  rule, not decoration. */}
                              {row.lateThisMonth >= 3 && (
                                <span
                                  className="shrink-0 rounded-full px-1.5 text-micro font-semibold"
                                  title={`${row.lateThisMonth} late arrivals this month — they have been told`}
                                  style={{
                                    backgroundColor:
                                      'color-mix(in oklab, var(--feedback-error) 14%, transparent)',
                                    color: 'var(--feedback-error)',
                                  }}
                                >
                                  ×{row.lateThisMonth}
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-micro text-text-tertiary">
                              {row.roleTitle ?? '—'}
                            </span>
                          </span>
                        </span>
                      </Td>
                      {canViewAll && (
                        <Td>
                          <TeamChip team={row.officeTeam} label={row.teamLabel} />
                        </Td>
                      )}
                      <Td>
                        <span className="whitespace-nowrap text-caption text-text-secondary">
                          {shortDate(row.onDate)}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className="whitespace-nowrap text-caption font-medium tabular-nums"
                          style={{ color: 'var(--feedback-warning)' }}
                        >
                          {clockLabel(row.checkedInAt)}
                        </span>
                      </Td>
                      <Td align="right">
                        {/* A bar as well as a number, so thirteen minutes and two
                            hours are distinguishable without reading either. */}
                        <span className="flex items-center justify-end gap-2">
                          <span
                            aria-hidden="true"
                            className="hidden h-1.5 rounded-full sm:block"
                            style={{
                              width: `${Math.min(100, ((by ?? 0) / 120) * 100)}%`,
                              minWidth: by ? 4 : 0,
                              maxWidth: '3.5rem',
                              backgroundColor: 'var(--feedback-warning)',
                            }}
                          />
                          <span className="w-14 whitespace-nowrap text-right text-caption font-semibold tabular-nums text-text-primary">
                            {by === null ? '—' : durationLabel(by)}
                          </span>
                        </span>
                      </Td>
                      <Td align="right">
                        <span className="whitespace-nowrap text-caption tabular-nums text-text-secondary">
                          {durationLabel(row.minutes)}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ⚠️ Says what happens next, because it happens without anybody asking. */}
          {canViewAll && stats.repeat > 0 && (
            <p className="flex items-start gap-2 border-t border-border-subtle pt-3 text-micro leading-relaxed text-text-tertiary">
              <Info className="mt-px size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              Anybody at three or more late arrivals in a calendar month is told once, by email and
              in their notifications. The count resets on the 1st.
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}

function LateTile({
  label,
  value,
  hint,
  token,
}: {
  label: string;
  value: string;
  hint?: string;
  token?: string;
}) {
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-subtle px-3 py-2">
      <p className="truncate text-micro font-semibold tracking-wide text-text-tertiary uppercase">
        {label}
      </p>
      <p
        className="tabular mt-0.5 truncate text-body font-semibold"
        style={{ color: token ? `var(--${token})` : 'var(--text-primary)' }}
      >
        {value}
      </p>
      {hint && <p className="truncate text-micro text-text-tertiary">{hint}</p>}
    </div>
  );
}

/** ⚠️ Sticky, because this table can be thirty rows and the dialog body scrolls.
 *  A header that scrolls away turns "Late by" into an unlabelled column. */
function LateTh({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      scope="col"
      className={cn(
        'sticky top-0 z-10 border-b border-border-default bg-bg-surface px-2 py-2',
        'text-micro font-semibold uppercase tracking-wide text-text-tertiary',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

/* ---------------------------------------------------------------------------
 * The quick card and the rules
 * ------------------------------------------------------------------------- */

const OFFICE_HOURS = { start: '10:00 AM', end: '06:00 PM', lateAfter: '10:30 AM' };

function QuickCard({
  mine,
  myName,
  nowMinutes,
  onMine,
  onDone,
}: {
  mine: { checkedInAt: string | null; checkedOutAt: string | null } | null;
  myName: string;
  nowMinutes: number;
  onMine: () => void;
  onDone: (result: { ok: true; message: string } | { ok: false; error: string }) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const state = mine?.checkedOutAt ? 'done' : mine?.checkedInAt ? 'in' : 'open';

  /* From the server's minute, never `new Date()`: a greeting that says "morning"
     on the server and "evening" in the browser is a hydration mismatch. */
  const greeting =
    nowMinutes < 12 * 60 ? 'Good morning' : nowMinutes < 17 * 60 ? 'Good afternoon' : 'Good evening';

  const press = async () => {
    setBusy(true);
    try {
      onDone(state === 'in' ? await checkOutAction() : await checkInAction());
    } catch {
      onDone({ ok: false, error: 'That could not be recorded.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    /* ── ⚠️ `h-full`, AND THE BUTTONS ARE PUSHED TO THE BOTTOM ────────────────
       Owner: *"its height is not equal to the other cards."* The grid cell was
       always full height; the Card inside it was not, so it floated with a gap
       beneath. `h-full` fixes the surface and `mt-auto` on the buttons fixes what
       would otherwise replace the gap — four controls bunched at the top of a tall
       card, with the blank space simply moved inside it. */
    <Card className="h-full">
      <CardBody className="flex h-full flex-col gap-3 p-4">
        <h2 className="text-body font-semibold text-text-primary">Quick check in / check out</h2>

        <div
          className="flex items-start gap-2.5 rounded-xl border p-3"
          style={{
            borderColor: 'color-mix(in oklab, var(--accent-primary) 24%, transparent)',
            backgroundColor: 'color-mix(in oklab, var(--accent-primary) 7%, transparent)',
          }}
        >
          <Sun
            className="mt-0.5 size-4 shrink-0"
            strokeWidth={2.25}
            aria-hidden="true"
            style={{ color: 'var(--accent-gold)' }}
          />
          <div className="min-w-0">
            <p className="truncate text-caption font-semibold text-text-primary">
              {greeting}, {myName.split(' ')[0]}!
            </p>
            <p className="text-micro text-text-secondary">
              {state === 'done'
                ? 'Your day is recorded.'
                : state === 'in'
                  ? 'Ready to check out?'
                  : 'Ready to check in?'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-text-tertiary">Status</span>
          <span className="flex items-center gap-2">
            <StatusChip state={state} />
            {mine?.checkedInAt && (
              <span className="text-micro text-text-tertiary">
                since {clockLabel(mine.checkedInAt)}
              </span>
            )}
          </span>
        </div>

        {/* ⚠️ Today's two stamps, always both shown. This replaces a single line
            that appeared ONLY once the day was finished — so the card was at its
            emptiest exactly when somebody was mid-day and most likely to be
            looking at it. Two tiles is also real content for the height the row
            now has, rather than padding. */}
        <div className="grid grid-cols-2 gap-2">
          <Stamp2 label="In" iso={mine?.checkedInAt ?? null} token="feedback-success" />
          <Stamp2 label="Out" iso={mine?.checkedOutAt ?? null} token="accent-primary" />
        </div>

        <div className="mt-auto space-y-2">
          {state === 'done' ? (
            <p className="rounded-lg bg-bg-subtle px-3 py-2 text-center text-caption text-text-secondary">
              That is your day recorded —{' '}
              {durationLabel(
                minutesWorked({
                  checkedInAt: mine?.checkedInAt ?? null,
                  checkedOutAt: mine?.checkedOutAt ?? null,
                }),
              )}
              .
            </p>
          ) : (
            <Button
              variant="primary"
              size="md"
              className="w-full"
              disabled={busy}
              onClick={() => void press()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : state === 'in' ? (
                <LogOut className="size-4" strokeWidth={2.25} aria-hidden="true" />
              ) : (
                <LogIn className="size-4" strokeWidth={2.25} aria-hidden="true" />
              )}
              {state === 'in' ? 'Check out' : 'Check in'}
            </Button>
          )}

          {/* ⚠️ The reference's second button, missing from the first build. On a
              page showing the whole division, "my attendance" is a real question —
              this narrows the table to whoever is reading and moves to it. */}
          <Button variant="secondary" size="md" className="w-full" onClick={onMine}>
            <CalendarDays className="size-4" strokeWidth={2.25} aria-hidden="true" />
            View my attendance
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/** One of today's two stamps. Dashed and quiet until the stamp exists. */
function Stamp2({ label, iso, token }: { label: string; iso: string | null; token: string }) {
  return (
    <div
      className={cn('rounded-lg px-2.5 py-2', iso ? 'border' : 'border border-dashed')}
      style={
        iso
          ? {
              borderColor: `color-mix(in oklab, var(--${token}) 26%, transparent)`,
              backgroundColor: `color-mix(in oklab, var(--${token}) 8%, transparent)`,
            }
          : { borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-subtle)' }
      }
    >
      <p className="text-micro font-semibold tracking-wide text-text-tertiary uppercase">{label}</p>
      <p
        className="tabular text-caption font-semibold"
        style={{ color: iso ? `var(--${token})` : 'var(--text-tertiary)' }}
      >
        {clockLabel(iso)}
      </p>
    </div>
  );
}

function TimingRules() {
  return (
    <Card>
      <CardBody className="space-y-3 p-4">
        <h2 className="text-body font-semibold text-text-primary">Office timing rules</h2>

        {(['blue_area', 'wah'] as const).map((key) => {
          const team = OFFICE_TEAMS[key];
          return (
            <div key={key} className="space-y-1.5">
              <p className="flex items-center gap-2 text-caption font-semibold text-text-primary">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{
                    backgroundColor:
                      key === 'blue_area' ? 'var(--accent-primary)' : 'var(--feedback-success)',
                  }}
                />
                {team.label} team
                <span className="font-normal text-text-tertiary">· {team.where}</span>
              </p>
              <p className="flex items-center gap-2 text-micro text-text-secondary">
                <Clock className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                {OFFICE_HOURS.start} – {OFFICE_HOURS.end}
              </p>
              <p className="flex items-start gap-2 text-micro text-text-secondary">
                <CalendarDays
                  className="mt-px size-3.5 shrink-0"
                  strokeWidth={2.25}
                  aria-hidden="true"
                />
                <span>
                  {team.days}
                  <br />
                  <span className="text-text-tertiary">{team.restDay}</span>
                </span>
              </p>
            </div>
          );
        })}

        <p
          className="flex items-start gap-2 rounded-lg p-2.5 text-micro leading-relaxed"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
        >
          <Info className="mt-px size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          Arriving after {OFFICE_HOURS.lateAfter} counts as late. Times are recorded by the server in
          Pakistan time, not by your device.
        </p>
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------------------------
 * The correction
 * ------------------------------------------------------------------------- */

function timeValue(iso: string | null): string {
  if (!iso) return '';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  return new Date(at).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function CorrectDialog({
  row,
  onClose,
  onDone,
}: {
  row: BoardRow;
  onClose: () => void;
  onDone: (result: { ok: true; message: string } | { ok: false; error: string }) => void;
}) {
  const [checkIn, setCheckIn] = React.useState(timeValue(row.checkedInAt));
  const [checkOut, setCheckOut] = React.useState(timeValue(row.checkedOutAt));
  const [why, setWhy] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    try {
      onDone(
        await correctDayAction({
          userId: row.userId,
          onDate: row.onDate,
          checkIn: checkIn || null,
          checkOut: checkOut || null,
          note: why || null,
        }),
      );
    } catch {
      onDone({ ok: false, error: 'That could not be saved.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={`${row.name} — ${shortDate(row.onDate)}`}
      description="Times are in Pakistan time, on this date."
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Save the correction
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="block text-caption text-text-secondary">Check in</span>
            <Input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="block text-caption text-text-secondary">Check out</span>
            <Input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </label>
        </div>

        <label className="space-y-1">
          <span className="block text-caption text-text-secondary">
            Why (optional, but it is kept)
          </span>
          <Input
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder="Forgot to check out — confirmed with them"
          />
        </label>

        <p className="flex items-start gap-2 text-micro leading-relaxed text-text-tertiary">
          <Pencil className="mt-px size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          This is recorded as your correction, with the time you made it, and it goes to the audit
          log. Clearing both times marks the day as an absence.
        </p>

        {row.editedByName && (
          <p className="rounded-lg bg-bg-subtle px-3 py-2 text-micro text-text-secondary">
            Already corrected by {row.editedByName}
            {row.editNote ? ` — “${row.editNote}”` : ''}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------
 * Pieces
 * ------------------------------------------------------------------------- */

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      scope="col"
      className={cn(
        'px-2 py-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <td className={cn('px-2 py-2.5 align-middle', align === 'right' ? 'text-right' : 'text-left')}>
      {children}
    </td>
  );
}

/** ⚠️ Tinted per office, so the two are distinguishable at a glance down a column
 *  of forty rows — one grey chip made the team column decorative. */
function TeamChip({ team, label }: { team: string; label: string }) {
  const token = team === 'wah' ? 'feedback-success' : 'accent-primary';
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-semibold"
      style={{
        backgroundColor: `color-mix(in oklab, var(--${token}) 13%, transparent)`,
        color: `var(--${token})`,
      }}
    >
      {label}
    </span>
  );
}

/**
 * A time, and where it came from.
 *
 * ⚠️ THE SOURCE IS SHOWN AS A SMALL LABEL UNDER THE TIME, not as another column.
 * Owner, 2026-09-01: *"I want a proper column that should mention whether this
 * check-in is from a device or from the system."* Two more columns would have
 * been the literal reading and the wrong one — the table already carries eight
 * and scrolls sideways on a laptop, and the source belongs TO a time rather than
 * beside it. Under the stamp it is unambiguous which half it describes, and the
 * table stays the same width.
 *
 * ⚠️ THE METHOD RIDES ALONG where the terminal reported one, so a row reads
 * "Wall · Face" rather than making somebody open a detail panel to find out.
 * The button has no method, and prints none rather than inventing "Other".
 */
function Stamp({
  iso,
  late,
  source,
  method,
}: {
  iso: string | null;
  late?: boolean;
  source?: AttendanceSource;
  method?: ScanMethod | null;
}) {
  if (!iso) return <span className="text-caption text-text-tertiary">—</span>;

  const meta = source ? SOURCE_META[source] : null;

  return (
    <span className="whitespace-nowrap">
      <span className="flex items-center gap-1.5 text-caption text-text-primary">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: late ? 'var(--feedback-warning)' : 'var(--feedback-success)' }}
        />
        {clockLabel(iso)}
      </span>
      {meta && (
        <span
          className="mt-0.5 block text-micro font-medium"
          style={{ color: `var(--${meta.token})` }}
          /* The long form on hover: the label is two words at most so the row
             stays narrow, and "At the terminal, by face" is the sentence
             somebody actually wants when they stop to look. */
          title={`${meta.label}${method ? `, by ${METHOD_LABEL[method].toLowerCase()}` : ''}`}
        >
          {meta.short}
          {method ? ` · ${METHOD_LABEL[method]}` : ''}
        </span>
      )}
    </span>
  );
}

function StatusPill({ status }: { status: AttendanceStatus }) {
  const meta = ATTENDANCE_STATUS_META[status];
  return (
    <span
      className="inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-semibold"
      style={{
        backgroundColor: `color-mix(in oklab, var(--${meta.token}) 14%, transparent)`,
        color: `var(--${meta.token})`,
      }}
    >
      {meta.label}
    </span>
  );
}

function StatusChip({ state }: { state: 'open' | 'in' | 'done' }) {
  const meta =
    state === 'in'
      ? { label: 'Checked in', token: 'feedback-success' }
      : state === 'done'
        ? { label: 'Checked out', token: 'feedback-error' }
        : { label: 'Not in yet', token: 'text-tertiary' };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-micro font-semibold"
      style={{
        backgroundColor: `color-mix(in oklab, var(--${meta.token}) 14%, transparent)`,
        color: `var(--${meta.token})`,
      }}
    >
      {meta.label}
    </span>
  );
}

function PageButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof ChevronLeft;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid size-8 place-items-center rounded-lg border border-border-default text-text-secondary',
        'hover:bg-bg-hover hover:text-text-primary',
        'disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent',
      )}
    >
      <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}
