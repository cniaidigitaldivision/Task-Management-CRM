'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import {
  ArrowUpDown,
  CalendarDays,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Filter,
  Info,
  Loader2,
  Paperclip,
  Repeat,
  User,
  UserCog,
  Users,
} from 'lucide-react';

import { taskLedgerDetailAction } from '@/app/actions/performance';
import { repeatWord } from '@/components/performance/person-record';
import { FilterPill, Nothing, Panel } from '@/components/performance/performance-ui';
import { Avatar } from '@/components/ui/avatar';
import type { LedgerDetail, LedgerRow } from '@/lib/db/queries/performance';
import { namedSummary } from '@/lib/view/task-name';

/* ============================================================================
 * THE TASK LEDGER — the owner's reference, 2026-09-24
 * ----------------------------------------------------------------------------
 * *"All the filters should be working properly ... when I click on that row,
 * that row turns light green. On the right side you can see a sleek way to
 * represent all the information relevant to all of that."*
 *
 * ── ⚠️ THE FILTERS NARROW ROWS THAT ARE ALREADY HERE ──────────────────────
 * Status, source, assigned-by and project are all columns of a row the server
 * already sent, so filtering is a `.filter()` and answers in its own frame
 * (Rule Zero, law 3). Only opening a task fetches, because a task's timeline,
 * files and comments are the one part a row genuinely could not know.
 *
 * ── ⚠️ THREE BOXES IN THE REFERENCE ARE NOT DRAWN AS THE REFERENCE DRAWS THEM
 * Each was measured against the database first, and each says what it is:
 *
 *   "Done unverified"     the owner removed the word "verified" an hour before
 *                         sending this image, so the chip reads "Done"
 *   Original vs latest    0 of 126 `updated` log rows touch the assignee, so a
 *     assigner            reassignment is not recorded — one "Assigned by"
 *   "Reason for change"   nobody is ever asked why a date moved. The MOVE is
 *                         real and is shown; the reason says it was not captured
 * ========================================================================= */

const num = (n: number) => n.toLocaleString('en-GB');

/* ⚠️ EVERY STATE ITS OWN COLOUR. Owner, 2026-09-24: *"status should display
   all in colors: done, overdue, all backlog should be in a different color."*
   Backlog and To do used to share one grey, so two different states read as
   the same thing at a glance — which is the whole point of a colour. */
const STATUS_LOOK: Record<string, { label: string; ink: string; bg: string }> = {
  backlog: { label: 'Backlog', ink: 'var(--pf-violet)', bg: 'var(--pf-violet-chip-bg)' },
  todo: { label: 'To do', ink: 'var(--pf-soft)', bg: 'var(--pf-strip)' },
  in_progress: { label: 'In progress', ink: 'var(--pf-blue)', bg: 'var(--pf-blue-bg)' },
  in_review: { label: 'Awaiting review', ink: 'var(--pf-amber)', bg: 'var(--pf-amber-bg)' },
  revisions: { label: 'Changes requested', ink: 'var(--pf-amber)', bg: 'var(--pf-amber-bg)' },
  blocked: { label: 'Blocked', ink: 'var(--pf-red-ink)', bg: 'var(--pf-red-bg)' },
  /* ⚠️ "Done", NOT "Done unverified" — see the file header. */
  done: { label: 'Done', ink: 'var(--pf-green)', bg: 'var(--pf-green-bg)' },
  cancelled: { label: 'Cancelled', ink: 'var(--pf-mute)', bg: 'var(--pf-strip)' },
};

/**
 * What a row's status chip should say, overdue included.
 *
 * ⚠️ "OVERDUE" IS NOT A STATUS IN THE DATABASE — it is open with a date that
 * has passed. The owner listed it beside done and backlog as something the
 * colour must show, so it is computed here and wins over the underlying state:
 * a manager scanning the column needs the late ones to shout.
 */
function statusOf(r: LedgerRow, today: string): { label: string; ink: string; bg: string } {
  const base = STATUS_LOOK[r.status] ?? { label: r.status, ink: 'var(--pf-soft)', bg: 'var(--pf-strip)' };
  const open = r.status !== 'done' && r.status !== 'cancelled';
  if (open && r.dueDate !== null && r.dueDate < today) {
    return { label: 'Overdue', ink: 'var(--pf-on-solid)', bg: 'var(--pf-red)' };
  }
  return base;
}

type Look = {
  label: string;
  ink: string;
  bg: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
};

/**
 * ⚠️ A REPEAT COPY IS ASSIGNED BY THE SYSTEM, AND IT IS NAMED "Automation".
 *
 * Owner, 2026-09-24: *"Why are you showing Rafay Abbasi in the Assigned By
 * field? You can say that the system assigns him automatically through daily
 * rotation. Instead of Rafay Abbasi say 'Automation'."*
 *
 * `created_by_id` on a generated copy is whoever set the SERIES up, which may
 * be somebody who did nothing that morning and has no business appearing in an
 * "assigned by" filter. The repeat engine handed the work out, so the engine is
 * named. The series' owner is still reachable on the Repeating tasks page.
 */
const AUTOMATION: Look = {
  label: 'Automation',
  ink: 'var(--pf-amber)',
  bg: 'var(--pf-amber-bg)',
  icon: Repeat,
};

const SOURCE_LOOK: Record<LedgerRow['sourceKind'], Look> = {
  /* Blue for self-created — the owner named this colour. */
  self: { label: 'Self-created', ink: 'var(--pf-blue)', bg: 'var(--pf-blue-bg)', icon: User },
  coordinator: { label: 'Coordinator', ink: 'var(--pf-green)', bg: 'var(--pf-green-bg)', icon: Users },
  admin: { label: 'Admin', ink: 'var(--pf-violet)', bg: 'var(--pf-violet-chip-bg)', icon: UserCog },
  /* ⚠️ NOT "Team member". Owner, 2026-09-24, twice: *"A team member has no
     right to assign tasks to anyone"* and *"I don't understand that."* They are
     right on both counts — `tasks_insert` refuses it, so the only rows that can
     reach this branch are demo data written straight to the database by
     scripts/seed-demo-workload.mjs, which bypasses RLS. A category that cannot
     legitimately occur must not read as though it routinely does. */
  teammate: { label: 'Assigned by', ink: 'var(--pf-soft)', bg: 'var(--pf-strip)', icon: User },
  unknown: { label: 'Not recorded', ink: 'var(--pf-mute)', bg: 'var(--pf-strip)', icon: Info },
};

/** Automation wins: nobody handed this out today. */
const lookOf = (r: LedgerRow): Look => (r.recurrenceRule ? AUTOMATION : SOURCE_LOOK[r.sourceKind]);

/** What the "Assigned by" cell and its filter call this row. */
const assignerOf = (r: LedgerRow): string =>
  r.recurrenceRule ? 'Automation' : r.sourceKind === 'self' ? 'Self-created' : (r.createdByName ?? 'Not recorded');

const shortDate = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const kb = (n: number | null) =>
  n === null ? '' : n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/* ⚠️ 'none' MEANS THE ORDER THE SERVER SENT, AND IT IS THE DEFAULT. The query
   already orders deliberately — blocked first, then in review, then by due date
   — and re-sorting by due on arrival threw that away. It also made the FIRST ROW
   on screen a different task from the one the server prefetched the detail for,
   so the seed never matched and the panel fetched anyway. */
type SortKey = 'none' | 'reference' | 'project' | 'owner' | 'status' | 'due';

const PAGE_SIZE = 25;

/* ⚠️ EVERY STATUS THE DATABASE HAS, IN WORKFLOW ORDER — not just the ones the
   loaded rows happen to use. Owner, 2026-09-24: *"you have already provided a
   very limited set of statuses: blocked, backlog, done. Not provided all the
   statuses."* Building the list from the rows meant a state nobody was in that
   week simply vanished from the filter, so there was no way to ask "is anything
   in revision?" and get the answer "no". The counts below make an empty option
   read as an answer rather than a dead end. */
const ALL_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'revisions',
  'blocked',
  'done',
  'cancelled',
] as const;

export function TaskLedger({
  rows,
  total,
  seed,
  today,
  personName,
  onExport,
}: {
  rows: readonly LedgerRow[];
  total: number;
  /** The first row's detail, already read on the server. */
  seed: { id: string; detail: LedgerDetail } | null;
  today: string;
  personName: string | null;
  onExport: () => void;
}) {
  const [status, setStatus] = React.useState('all');
  const [source, setSource] = React.useState('all');
  const [assignedBy, setAssignedBy] = React.useState('all');
  const [project, setProject] = React.useState('all');
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'none', dir: 1 });
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);

  /* The options are the rows' own values — a filter can never offer something
     that would empty the table. */
  const options = React.useMemo(() => {
    const tally = (pick: (r: LedgerRow) => string) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(pick(r), (m.get(pick(r)) ?? 0) + 1);
      return m;
    };
    const byStatus = tally((r) => r.status);
    const bySource = tally((r) => (r.recurrenceRule ? 'automation' : r.sourceKind));
    const statuses = ALL_STATUSES.map((v) => ({ value: v, n: byStatus.get(v) ?? 0 }));
    const sources = [...bySource.entries()].map(([value, n]) => ({ value, n }));
    /* ⚠️ BUILT FROM WHAT THE CELL SAYS, not from `created_by_id`. Otherwise
       the filter lists the person who set a repeat up years ago — the owner saw
       "Rafay Abbasi" there and rightly asked why. */
    const byPerson = tally(assignerOf);
    const people = [...byPerson.entries()].map(([value, n]) => ({ value, n })).sort((a, b) =>
      a.value.localeCompare(b.value),
    );
    const projects = [...new Map(rows.map((r) => [r.projectId, r.projectName])).entries()].sort((a, b) =>
      a[1].localeCompare(b[1]),
    );
    return { statuses, sources, people, projects };
  }, [rows]);

  const shown = React.useMemo(() => {
    const out = rows.filter(
      (r) =>
        (status === 'all' || r.status === status) &&
        (source === 'all' ||
          (source === 'automation' ? Boolean(r.recurrenceRule) : !r.recurrenceRule && r.sourceKind === source)) &&
        (assignedBy === 'all' || assignerOf(r) === assignedBy) &&
        (project === 'all' || r.projectId === project),
    );
    if (sort.key === 'none') return out;
    const val = (r: LedgerRow): string =>
      sort.key === 'reference'
        ? r.reference
        : sort.key === 'project'
          ? r.projectName
          : sort.key === 'owner'
            ? (r.ownerName ?? '')
            : sort.key === 'status'
              ? (STATUS_LOOK[r.status]?.label ?? r.status)
              : (r.dueDate ?? '9999-99-99');
    return [...out].sort((a, b) => val(a).localeCompare(val(b)) * sort.dir);
  }, [rows, status, source, assignedBy, project, sort]);

  /* ⚠️ DERIVED, NOT SYNCHRONISED, AND IT OPENS ON THE FIRST ROW.
     Owner, 2026-09-24: *"When the page loads automatically the first row will
     open on the right side."* Falling back to `shown[0]` does that without an
     effect — and it keeps working when a filter changes the list, because the
     panel simply follows whatever is now first.

     The same fallback is why `openId` is never cleared when a filter hides the
     chosen row: clearing state from an effect is a cascading render, and it
     would throw away a selection the reader may want back the moment they widen
     the filter again. */
  const open = shown.find((r) => r.taskId === openId) ?? shown[0] ?? null;

  /* ⚠️ PAGED. Owner, 2026-09-24: *"the tasks are getting very long so please
     divide them. Pagination should be added so the page will not get very
     long."* 200 rows is a page nobody scrolls to the end of.

     ⚠️ The page number is CLAMPED rather than reset by an effect — changing a
     filter shortens the list, and writing state from an effect to fix that is
     the cascading render the lint rule refuses. */
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const pageRows = shown.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="grid items-start gap-[1.1rem] min-[1500px]:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        {/* ── The filters ────────────────────────────────────────────────── */}
        <div className="mb-[1rem] flex flex-wrap items-center gap-[0.7rem]">
          <FilterPill
            icon={Filter}
            title="Status"
            label={status === 'all' ? 'Status: All' : (STATUS_LOOK[status]?.label ?? status)}
            value={status}
            options={[
              { value: 'all', label: `Status: All (${num(rows.length)})` },
              ...options.statuses.map((x) => ({
                value: x.value,
                label: `${STATUS_LOOK[x.value]?.label ?? x.value} (${x.n})`,
              })),
            ]}
            onChange={setStatus}
          />
          <FilterPill
            icon={Repeat}
            title="Source"
            label={
              source === 'all'
                ? 'Source: All'
                : source === 'automation'
                  ? AUTOMATION.label
                  : SOURCE_LOOK[source as LedgerRow['sourceKind']].label
            }
            value={source}
            options={[
              { value: 'all', label: `Source: All (${num(rows.length)})` },
              ...options.sources.map((x) => ({
                value: x.value,
                label: `${x.value === 'automation' ? AUTOMATION.label : SOURCE_LOOK[x.value as LedgerRow['sourceKind']].label} (${x.n})`,
              })),
            ]}
            onChange={setSource}
          />
          <FilterPill
            icon={UserCog}
            title="Assigned by"
            label={assignedBy === 'all' ? 'Assigned by: All' : assignedBy}
            value={assignedBy}
            options={[
              { value: 'all', label: 'Assigned by: All' },
              ...options.people.map((x) => ({ value: x.value, label: `${x.value} (${x.n})` })),
            ]}
            onChange={setAssignedBy}
          />
          <FilterPill
            icon={CalendarDays}
            title="Project"
            label={
              project === 'all'
                ? 'Project: All'
                : (options.projects.find(([id]) => id === project)?.[1] ?? 'Project')
            }
            value={project}
            options={[
              { value: 'all', label: 'Project: All' },
              ...options.projects.map(([id, name]) => ({ value: id, label: name })),
            ]}
            onChange={setProject}
          />
          <button
            type="button"
            onClick={onExport}
            className="ml-auto inline-flex items-center gap-[0.5rem] whitespace-nowrap rounded-[0.7rem] border px-[0.95rem] py-[0.72rem] text-[0.85rem] font-semibold leading-none"
            style={{
              background: 'var(--pf-surface)',
              borderColor: 'var(--pf-field-line)',
              color: 'var(--pf-ink)',
            }}
          >
            <Download className="size-[1rem]" aria-hidden="true" />
            Export task ledger
          </button>
        </div>

        <Panel
          title={`Tasks (${num(shown.length)})`}
          description={
            personName
              ? `Everything ${personName.split(' ')[0]} holds or closed in this period.`
              : 'Everything in scope.'
          }
        >
          {shown.length === 0 ? (
            <Nothing>No task matches these filters. Widen one of them above.</Nothing>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[50rem] table-fixed border-collapse">
                  <thead>
                    <tr
                      className="whitespace-nowrap border-y text-[0.76rem]"
                      style={{
                        background: 'var(--pf-head)',
                        borderColor: 'var(--pf-grid)',
                        color: 'var(--pf-soft)',
                      }}
                    >
                      <th className="py-[0.72rem] pl-[1.22rem] text-left font-medium" scope="col">
                        <button
                          type="button"
                          onClick={() =>
                            setSort((s) => ({ key: 'reference', dir: s.key === 'reference' && s.dir === 1 ? -1 : 1 }))
                          }
                          className="inline-flex items-center gap-[0.3rem] hover:underline"
                        >
                          Task / title
                          <ArrowUpDown className="size-[0.72rem] shrink-0 opacity-60" aria-hidden="true" />
                        </button>
                      </th>
                      <th className="w-[8rem] py-[0.72rem] text-left font-medium" scope="col">
                        Project
                      </th>
                      <th className="w-[8rem] py-[0.72rem] text-left font-medium" scope="col">
                        Assigned by
                      </th>
                      {/* ⚠️ A COLUMN THAT REPEATS ONE VALUE IS NOT A COLUMN. On a
                          person's own ledger every row says their name, and the
                          seven columns left the task TITLE — the thing somebody
                          reads the row for — rendered as "A...". The reference
                          shows it because it was drawn as a general view. */}
                      {!personName && (
                        <th className="w-[8.6rem] py-[0.72rem] text-left font-medium" scope="col">
                          Current owner
                        </th>
                      )}
                      <th className="w-[7.6rem] py-[0.72rem] text-left font-medium" scope="col">
                        Status
                      </th>
                      <th className="w-[6.4rem] py-[0.72rem] text-left font-medium" scope="col">
                        Due
                      </th>
                      <th className="w-[5.8rem] py-[0.72rem] pr-[1.22rem] text-left font-medium" scope="col">
                        Evidence
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const on = r.taskId === open?.taskId;
                      const st = statusOf(r, today);
                      const sc = lookOf(r);
                      const late =
                        r.status !== 'done' && r.status !== 'cancelled' && r.dueDate !== null && r.dueDate < today;
                      return (
                        <tr
                          key={r.taskId}
                          /* Selecting, not toggling: with the first row open by
                             default there is no "nothing selected" state to
                             toggle back to, and clicking the open row to close
                             it would silently jump the panel to row one. */
                          onClick={() => setOpenId(r.taskId)}
                          className="cursor-pointer border-b last:border-0"
                          style={{
                            borderColor: 'var(--pf-grid)',
                            height: '3.6rem',
                            /* ⚠️ THE OWNER'S LIGHT GREEN, and a left bar so the
                               selection survives being read in greyscale or by
                               anybody who cannot separate the two greens. */
                            background: on ? 'var(--pf-mint-card)' : undefined,
                            boxShadow: on ? 'inset 3px 0 0 0 var(--pf-teal)' : undefined,
                          }}
                          aria-selected={on}
                        >
                          <td className="pl-[1.22rem] pr-[0.6rem]" title={r.description ?? r.title}>
                            <span
                              className="block truncate text-[0.87rem] font-semibold"
                              style={{ color: 'var(--pf-ink)' }}
                            >
                              {r.title}
                            </span>
                            {/* ⚠️ THE REPEAT SITS WITH THE TASK, NOT IN "Assigned by".
                                It answers "how often does this come back", which
                                is a different question from "who gave it to me"
                                — and mixing them hid the second one entirely. */}
                            <span className="flex min-w-0 items-center gap-[0.4rem]">
                              <span
                                className="truncate text-[0.72rem]"
                                style={{ color: 'var(--pf-mute)' }}
                              >
                                {r.reference}
                              </span>
                              {r.recurrenceRule && (
                                <span
                                  className="inline-flex shrink-0 items-center gap-[0.2rem] rounded-full px-[0.35rem] text-[0.68rem] font-semibold"
                                  style={{ background: 'var(--pf-amber-bg)', color: 'var(--pf-amber)' }}
                                  title={`This task repeats: ${repeatWord(r.recurrenceRule).toLowerCase()}`}
                                >
                                  <Repeat className="size-[0.62rem]" aria-hidden="true" />
                                  {repeatWord(r.recurrenceRule)}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="pr-[0.6rem] text-[0.84rem]" title={r.projectName}>
                            <span className="block truncate" style={{ color: 'var(--pf-body)' }}>
                              {r.projectName}
                            </span>
                          </td>
                          <td className="pr-[0.6rem]">
                            <span
                              className="inline-flex max-w-full items-center gap-[0.35rem] truncate rounded-full px-[0.55rem] py-[0.22rem] text-[0.74rem] font-semibold"
                              style={{ background: sc.bg, color: sc.ink }}
                              title={
                                r.recurrenceRule
                                  ? `Created automatically by a ${repeatWord(r.recurrenceRule).toLowerCase()} repeat — nobody handed it out that day.`
                                  : r.sourceKind === 'self'
                                    ? 'They raised this task themselves'
                                    : r.sourceKind === 'teammate'
                                      ? `${r.createdByName ?? 'Somebody'} is a team member, and a team member cannot assign work in this system. This only appears on demo data seeded straight into the database.`
                                      : `${r.createdByName ?? 'Somebody'} · ${sc.label}`
                              }
                            >
                              <sc.icon className="size-[0.8rem] shrink-0" aria-hidden="true" />
                              <span className="truncate">{assignerOf(r)}</span>
                            </span>
                          </td>
                          {!personName && (
                            <td className="pr-[0.6rem]">
                              {r.ownerName ? (
                                <span className="flex min-w-0 items-center gap-[0.5rem]">
                                  <Avatar name={r.ownerName} src={r.ownerAvatarUrl} size="sm" />
                                  <span
                                    className="min-w-0 flex-1 truncate text-[0.84rem]"
                                    style={{ color: 'var(--pf-ink)' }}
                                  >
                                    {r.ownerName}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-[0.84rem]" style={{ color: 'var(--pf-red-ink)' }}>
                                  Nobody
                                </span>
                              )}
                            </td>
                          )}
                          <td className="pr-[0.6rem]">
                            <span
                              className="inline-flex items-center rounded-full px-[0.6rem] py-[0.22rem] text-[0.74rem] font-semibold"
                              style={{ background: st.bg, color: st.ink }}
                            >
                              {st.label}
                            </span>
                          </td>
                          <td
                            className="pr-[0.6rem] text-[0.84rem]"
                            style={{ color: late ? 'var(--pf-red-ink)' : 'var(--pf-body)' }}
                          >
                            {shortDate(r.dueDate) ?? (
                              <span style={{ color: 'var(--pf-mute)' }} title="No due date is set">
                                —
                              </span>
                            )}
                          </td>
                          <td className="pr-[1.22rem] text-[0.84rem]">
                            {r.evidenceCount > 0 ? (
                              <span
                                className="inline-flex items-center gap-[0.35rem]"
                                style={{ color: 'var(--pf-link)' }}
                              >
                                <Paperclip className="size-[0.85rem] shrink-0" aria-hidden="true" />
                                {r.evidenceCount} file{r.evidenceCount === 1 ? '' : 's'}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--pf-mute)' }}>Not added</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div
                className="flex flex-wrap items-center gap-[0.6rem] border-t px-[1.22rem] py-[0.8rem]"
                style={{ borderColor: 'var(--pf-grid)' }}
              >
                <span className="text-[0.82rem]" style={{ color: 'var(--pf-soft)' }}>
                  {num(current * PAGE_SIZE + 1)}–{num(current * PAGE_SIZE + pageRows.length)} of{' '}
                  {num(shown.length)}
                  {total > rows.length ? ` (${num(total)} in the period)` : ''}
                </span>
                <span className="ml-auto flex items-center gap-[0.4rem]">
                  <PageButton onClick={() => setPage(current - 1)} disabled={current === 0}>
                    Previous
                  </PageButton>
                  <span
                    className="px-[0.6rem] text-[0.82rem] tabular-nums"
                    style={{ color: 'var(--pf-ink)' }}
                  >
                    Page {current + 1} of {pages}
                  </span>
                  <PageButton onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>
                    Next
                  </PageButton>
                </span>
              </div>
            </>
          )}
        </Panel>
      </div>

      {/* ⚠️ KEYED BY TASK. Remounting resets the sub-tab to Timeline without
          an effect calling setState — which is a cascading render, and which
          the lint rule correctly refused. */}
      <TaskPanel key={open?.taskId ?? 'none'} row={open} today={today} seed={seed} />
    </div>
  );
}

/* ── The right-hand panel ────────────────────────────────────────────────── */

function TaskPanel({
  row,
  today,
  seed,
}: {
  row: LedgerRow | null;
  today: string;
  seed: { id: string; detail: LedgerDetail } | null;
}) {
  /* ⚠️ THE ANSWER CARRIES THE ID IT ANSWERS FOR. "Loading" is then DERIVED —
     `answer === null` — rather than written by the effect before it starts, so
     nothing calls setState synchronously in an effect body. It also means a
     reply for a task nobody is looking at any more can never paint. */
  /* ⚠️ SEEDED, SO THE DEFAULT ROW NEVER WAITS. The server already read the
     first row's detail in the page's wave; starting from it means the panel is
     complete on first paint and the effect below finds nothing to do. */
  const [answer, setAnswer] = React.useState<
    { id: string; detail: LedgerDetail } | { id: string; error: string } | null
  >(seed && seed.id === row?.taskId ? seed : null);
  const [tab, setTab] = React.useState<'timeline' | 'evidence' | 'comments'>('timeline');

  const id = row?.taskId ?? null;
  React.useEffect(() => {
    if (!id) return;
    /* Already have this one from the server — no round trip. */
    if (seed && seed.id === id) return;
    let live = true;
    void taskLedgerDetailAction(id).then((r) => {
      if (!live) return;
      setAnswer(
        r.ok && r.detail
          ? { id, detail: r.detail }
          : { id, error: r.error ?? 'That task could not be read.' },
      );
    });
    return () => {
      live = false;
    };
  }, [id, seed]);

  const settled = answer && answer.id === id ? answer : null;
  const loading = id !== null && settled === null;
  const failed = settled && 'error' in settled ? settled.error : null;

  if (!row) {
    return (
      <aside
        className="rounded-[0.95rem] border px-[1.22rem] py-[2.2rem] text-center"
        style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-line)', boxShadow: 'var(--pf-shadow)' }}
      >
        <FileText className="mx-auto size-[1.6rem]" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
        <p className="mt-[0.7rem] text-[0.88rem]" style={{ color: 'var(--pf-soft)' }}>
          Pick a task on the left to see its timeline, its files and everything said about it.
        </p>
      </aside>
    );
  }

  const st = statusOf(row, today);
  const sc = lookOf(row);
  const detail = settled && 'detail' in settled ? settled.detail : null;
  const moved = detail?.originalDue && detail.revisedDue && detail.originalDue !== detail.revisedDue;

  return (
    <aside
      className="overflow-hidden rounded-[0.95rem] border"
      style={{ background: 'var(--pf-surface)', borderColor: 'var(--pf-line)', boxShadow: 'var(--pf-shadow)' }}
    >
      <div className="px-[1.22rem] pb-[0.9rem] pt-[1.15rem]">
        <div className="flex items-start gap-[0.8rem]">
          <div className="min-w-0 flex-1">
            <p className="text-[0.74rem]" style={{ color: 'var(--pf-mute)' }}>
              {row.reference}
            </p>
            <h3 className="text-[1.15rem] font-bold leading-[1.3]" style={{ color: 'var(--pf-ink)' }}>
              {row.title}
            </h3>
          </div>
          <span
            className="shrink-0 rounded-full px-[0.65rem] py-[0.25rem] text-[0.75rem] font-semibold"
            style={{ background: st.bg, color: st.ink }}
          >
            {st.label}
          </span>
        </div>

        {row.description && (
          <p className="mt-[0.6rem] text-[0.85rem] leading-[1.5]" style={{ color: 'var(--pf-body)' }}>
            {row.description}
          </p>
        )}

        <dl className="mt-[0.9rem] grid grid-cols-2 gap-[0.6rem]">
          <Box label={row.sourceKind === 'self' ? 'Raised by' : 'Assigned by'}>
            <span className="inline-flex items-center gap-[0.35rem]" style={{ color: sc.ink }}>
              <sc.icon className="size-[0.85rem] shrink-0" aria-hidden="true" />
              {row.sourceKind === 'self' ? 'Themselves' : (row.createdByName ?? sc.label)}
            </span>
          </Box>
          <Box label="Current owner">{row.ownerName ?? 'Nobody'}</Box>
          <Box label="Project">{row.projectName}</Box>
          <Box label="Due">
            {shortDate(row.dueDate) ?? 'No date set'}
            {row.dueDate && row.dueDate < today && row.status !== 'done' && row.status !== 'cancelled' && (
              <span style={{ color: 'var(--pf-red-ink)' }}> · overdue</span>
            )}
          </Box>
        </dl>

        {/* ⚠️ THE MOVE IS REAL; THE REASON WAS NEVER CAPTURED. The reference has
            a "Reason for change" box reading "Scope update"; nothing in this
            system ever asks for one, so inventing a plausible reason on a page
            read as a judgement about somebody's work is the worst thing this
            panel could do. */}
        {moved && (
          <div
            className="mt-[0.7rem] rounded-[0.7rem] px-[0.9rem] py-[0.7rem] text-[0.82rem] leading-[1.5]"
            style={{ background: 'var(--pf-amber-card)', color: 'var(--pf-ink)' }}
          >
            The due date moved from <strong>{shortDate(detail!.originalDue)}</strong> to{' '}
            <strong>{shortDate(detail!.revisedDue)}</strong>.{' '}
            <span style={{ color: 'var(--pf-faint)' }}>
              No reason is recorded — nothing in this system asks for one when a date changes.
            </span>
          </div>
        )}
      </div>

      {/* ── Timeline / Evidence / Comments ─────────────────────────────── */}
      <div
        className="flex items-end gap-x-[1.5rem] border-b px-[1.22rem]"
        style={{ borderColor: 'var(--pf-grid)' }}
        role="tablist"
      >
        {(
          [
            ['timeline', `Timeline${detail ? ` (${detail.timeline.length})` : ''}`],
            ['evidence', `Evidence (${row.evidenceCount})`],
            ['comments', `Comments (${row.commentCount})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className="-mb-px pb-[0.55rem] pt-[0.2rem] text-[0.85rem]"
            style={{
              color: tab === k ? 'var(--pf-teal)' : 'var(--pf-soft)',
              fontWeight: tab === k ? 600 : 400,
              borderBottomStyle: 'solid',
              borderBottomWidth: '2.4px',
              borderBottomColor: tab === k ? 'var(--pf-teal)' : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="max-h-[26rem] overflow-y-auto">
        {loading && (
          <p
            className="flex items-center gap-[0.5rem] px-[1.22rem] py-[1.1rem] text-[0.85rem]"
            style={{ color: 'var(--pf-soft)' }}
          >
            <Loader2 className="size-[0.95rem] animate-spin" aria-hidden="true" /> Reading the record…
          </p>
        )}
        {failed && (
          <p className="px-[1.22rem] py-[1.1rem] text-[0.85rem]" style={{ color: 'var(--pf-red-ink)' }}>
            {failed}
          </p>
        )}

        {detail && tab === 'timeline' && (
          <Timeline events={detail.timeline} reference={row.reference} title={row.title} />
        )}

        {detail && tab === 'evidence' && (
          <ul className="divide-y" style={{ borderColor: 'var(--pf-grid)' }}>
            {detail.files.length === 0 && (
              <li className="px-[1.22rem] py-[1.1rem] text-[0.85rem]" style={{ color: 'var(--pf-soft)' }}>
                No file is attached to this task.
              </li>
            )}
            {detail.files.map((f) => (
              <li key={f.id} className="flex items-center gap-[0.7rem] px-[1.22rem] py-[0.7rem]">
                <span
                  className="grid size-[2rem] shrink-0 place-items-center rounded-[0.5rem]"
                  style={{ background: 'var(--pf-strip)' }}
                >
                  <Paperclip className="size-[0.9rem]" style={{ color: 'var(--pf-soft)' }} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.85rem]" style={{ color: 'var(--pf-ink)' }}>
                    {f.fileName}
                  </span>
                  <span className="block truncate text-[0.74rem]" style={{ color: 'var(--pf-mute)' }}>
                    {[kb(f.sizeBytes), f.uploadedByName, stamp(f.at)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {detail && tab === 'comments' && (
          <ul className="divide-y" style={{ borderColor: 'var(--pf-grid)' }}>
            {detail.comments.length === 0 && (
              <li className="px-[1.22rem] py-[1.1rem] text-[0.85rem]" style={{ color: 'var(--pf-soft)' }}>
                Nothing has been said on this task. Comments are barely used anywhere in this system,
                so a quiet task is not a sign of a quiet person.
              </li>
            )}
            {detail.comments.map((c) => (
              <li key={c.id} className="px-[1.22rem] py-[0.7rem]">
                <p className="text-[0.85rem] leading-[1.5]" style={{ color: 'var(--pf-ink)' }}>
                  {c.body}
                </p>
                <p className="text-[0.74rem]" style={{ color: 'var(--pf-mute)' }}>
                  {[c.authorName, stamp(c.at)].filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t px-[1.22rem] py-[0.85rem]" style={{ borderColor: 'var(--pf-grid)' }}>
        <Link
          href={`/tasks?task=${row.taskId}` as Route}
          target="_blank"
          className="inline-flex items-center gap-[0.45rem] text-[0.85rem] font-semibold hover:underline"
          style={{ color: 'var(--pf-link)' }}
        >
          Open the task <ExternalLink className="size-[0.9rem]" aria-hidden="true" />
          <ChevronRight className="size-[0.9rem]" aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}

function Box({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="min-w-0 rounded-[0.6rem] border px-[0.7rem] py-[0.55rem]"
      style={{ borderColor: 'var(--pf-line)', background: 'var(--pf-strip)' }}
    >
      <dt className="text-[0.72rem]" style={{ color: 'var(--pf-mute)' }}>
        {label}
      </dt>
      <dd className="truncate text-[0.85rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
        {children}
      </dd>
    </div>
  );
}

function PageButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[0.6rem] border px-[0.8rem] py-[0.5rem] text-[0.82rem] font-semibold leading-none disabled:opacity-40"
      style={{
        background: 'var(--pf-surface)',
        borderColor: 'var(--pf-field-line)',
        color: 'var(--pf-ink)',
      }}
    >
      {children}
    </button>
  );
}

/* ── The timeline, as the owner drew it ──────────────────────────────────── */

const DOT: Record<string, string> = {
  created: 'var(--pf-blue)',
  done: 'var(--pf-green)',
  in_review: 'var(--pf-amber)',
  in_progress: 'var(--pf-blue)',
  revisions: 'var(--pf-amber)',
  blocked: 'var(--pf-red)',
  cancelled: 'var(--pf-mute)',
  updated: 'var(--pf-violet)',
  attachment_added: 'var(--pf-green)',
  attachment_removed: 'var(--pf-mute)',
  'task.handoff': 'var(--pf-violet)',
};

const dayKey = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/**
 * Dots on a rail, grouped by day, newest first.
 *
 * ⚠️ THE RAIL IS ONE ELEMENT BEHIND THE DOTS, not a border on each row. A
 * per-row border leaves a hairline gap at every boundary and breaks entirely
 * across a date header; one absolutely-positioned line cannot.
 *
 * ⚠️ AND THE LAST DOT ENDS THE LINE. The rail stops at the final dot rather
 * than running on into the padding, which is what makes it read as a sequence
 * that finished rather than one that was cut off.
 */
function Timeline({
  events,
  reference,
  title,
}: {
  events: readonly { at: string; action: string; summary: string; actorName: string | null }[];
  reference: string;
  title: string;
}) {
  if (events.length === 0) {
    return (
      <p className="px-[1.22rem] py-[1.1rem] text-[0.85rem]" style={{ color: 'var(--pf-soft)' }}>
        Nothing is recorded against this task.
      </p>
    );
  }

  /* Newest first, and grouped by the day they happened in Karachi. */
  const days = new Map<string, typeof events>();
  for (const e of [...events].sort((a, b) => b.at.localeCompare(a.at))) {
    const k = dayKey(e.at);
    days.set(k, [...(days.get(k) ?? []), e] as typeof events);
  }

  return (
    <div className="pb-[0.8rem]">
      {[...days.entries()].map(([day, list]) => (
        <section key={day}>
          <h4
            className="flex items-baseline gap-[0.5rem] px-[1.22rem] py-[0.5rem] text-[0.78rem] font-semibold"
            style={{ background: 'var(--pf-head)', color: 'var(--pf-ink)' }}
          >
            {day}
            <span className="font-normal" style={{ color: 'var(--pf-mute)' }}>
              {list.length} event{list.length === 1 ? '' : 's'}
            </span>
          </h4>

          <ol className="relative px-[1.22rem] pt-[0.6rem]">
            {/* the rail: from the first dot's centre to the last dot's centre */}
            {list.length > 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[1.55rem] top-[1.15rem] w-px"
                style={{ background: 'var(--pf-line)', bottom: '1.1rem' }}
              />
            )}
            {list.map((e, i) => (
              <li key={`${e.at}-${i}`} className="relative flex gap-[0.7rem] pb-[0.75rem]">
                <span
                  aria-hidden="true"
                  className="relative z-10 mt-[0.32rem] size-[0.55rem] shrink-0 rounded-full ring-2"
                  style={{
                    background: DOT[e.action] ?? 'var(--pf-mute)',
                    // the ring is the panel's own background, so the rail is
                    // hidden behind the dot rather than crossing it
                    ['--tw-ring-color' as string]: 'var(--pf-surface)',
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-[0.5rem]">
                    <span
                      className="text-[0.78rem] tabular-nums"
                      style={{ color: 'var(--pf-mute)' }}
                    >
                      {clock(e.at)}
                    </span>
                    {e.actorName && (
                      <span className="text-[0.8rem] font-semibold" style={{ color: 'var(--pf-ink)' }}>
                        {e.actorName}
                      </span>
                    )}
                  </span>
                  <span className="block text-[0.84rem] leading-[1.45]" style={{ color: 'var(--pf-body)' }}>
                    {namedSummary(e.summary, reference, title)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
