'use client';

import * as React from 'react';

import { PlatformIcon } from '@/components/brand/platform-icon';
import { Avatar } from '@/components/ui/avatar';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { WORK_STATUS_META, type PosterRow, type WorkReport, type WorkRow } from '@/lib/domain/work-report';
import { STATUS_META } from '@/lib/domain/constants';
import { WorkRowDetail } from './work-row-detail';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE WORK REPORT, AS THE OWNER DREW IT
 * ----------------------------------------------------------------------------
 * Two tables: a row per project-and-person, then posting performance per member.
 * Owner: *"All this data in this table in a sleek way… I want the same UI, but
 * make sure that the data is according to my database."*
 *
 * ── ⚠️ `nowMs` IS A PROP, NOT `Date.now()` ──────────────────────────────────
 * "1h ago" is the one thing on this page that depends on the clock, and a
 * component that reads the clock renders one string on the server and a different
 * one in the browser a moment later — a hydration mismatch. So the server passes
 * the instant down and every relative age on the page is measured from the same
 * one. That rule is `lib/now.ts` and it applies here like everywhere else.
 *
 * ── ⚠️ NO HORIZONTAL SCROLLBAR. TWELVE COLUMNS, ALL VISIBLE ────────────────
 * This started as `min-w-[68rem]` inside an `overflow-x-auto`, which is the usual
 * answer for a wide table and was the wrong one here. Owner: *"there is a
 * scrollbar appearing and the last column is not fully visible… I want you to not
 * add a scrollbar. It should be completely visible without a scrollbar."*
 *
 * They are right, and the reason is what the last column IS. Scrolling is
 * tolerable when the far columns are extra detail; here the far right holds Status
 * and Last Active — "is this late" and "has anybody touched it" — which are the
 * two things somebody scanning this page is looking for. A layout that hides them
 * until you drag hides the answer.
 *
 * So: `table-fixed` with a declared width per column, the shares below summing to
 * exactly 100. Three things make it fit at a laptop width:
 *
 *   · HEADERS WRAP. "Tasks Assigned" sets over two lines, so a column that needs
 *     roughly 90px of number gets 90px instead of the 110px its heading wanted.
 *   · The prose columns wrap instead of pushing. Content Type and Activity Summary
 *     are the only genuinely long text, and they are the ones that read fine over
 *     two or three lines.
 *   · Names and roles TRUNCATE with an ellipsis rather than wrapping, because a
 *     person's name broken across two lines is harder to scan than a shortened one,
 *     and the full text stays available as a `title`.
 *
 * ⚠️ `table-fixed` means these widths are obeyed rather than negotiated — the
 * browser stops measuring content, so one very long project name can no longer
 * stretch a column and push Last Active off the edge. That is the property being
 * bought here, and it is why the shares must keep summing to 100 if one is changed.
 * ========================================================================= */

export function WorkReportTables({
  work,
  nowMs,
}: {
  work: WorkReport;
  /** The server's clock. See the header. */
  nowMs: number;
}) {
  const pager = usePagination(work.rows);
  /* ── ⚠️ THE OPEN ROW, BY KEY RATHER THAN BY OBJECT ────────────────────────
     Owner, 2026-09-03: *"when I click on any row it will pop up."* Held as a
     key so a refresh that rebuilds `work.rows` re-resolves to the same pairing
     instead of pinning a stale copy of it open. */
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const open = openKey ? work.rows.find((row) => row.key === openKey) ?? null : null;

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-border-default bg-bg-surface">
        <div>
          <table className="w-full table-fixed border-collapse text-left">
            {/* The widths, in one place and summing to 100. See the header. */}
            <colgroup>
              {COLUMN_SHARES.map((share, index) => (
                <col key={index} style={{ width: `${share}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border-default bg-bg-subtle">
                {/* ── ⚠️ THREE COLUMNS OUT, ONE IN — owner, 2026-09-08 ─────
                    *"you can exclude the unnecessary. You can skip task
                    pending, post publish, and activity summary. Instead you
                    will add the description."*

                    Tasks Pending was Assigned minus Done, which the reader can
                    see beside it; Activity Summary restated Content Type in
                    prose; Posts Published belongs to the project-status report,
                    which is where posting is actually assessed. What was
                    missing was what the work WAS. */}
                <Th>Project</Th>
                <Th>Person</Th>
                <Th>Tasks</Th>
                <Th>Description</Th>
                <Th>Platform</Th>
                <Th numeric>Tasks Assigned</Th>
                <Th numeric>Tasks Done</Th>
                <Th>Content Type</Th>
                <Th>Status</Th>
                <Th numeric>Last Active</Th>
              </tr>
            </thead>
            <tbody>
              {pager.visible.map((row) => (
                <Row key={row.key} row={row} nowMs={nowMs} onOpen={() => setOpenKey(row.key)} />
              ))}
              {work.rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-caption text-text-tertiary">
                    No work matched this period and filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {open && <WorkRowDetail row={open} onClose={() => setOpenKey(null)} />}

      <section className="space-y-3">
        <h2 className="text-body font-semibold text-text-primary">Posting performance by member</h2>

        <div className="overflow-hidden rounded-2xl border border-border-default bg-bg-surface">
          <div>
            <table className="w-full table-fixed border-collapse text-left">
              <colgroup>
                {POSTER_SHARES.map((share, index) => (
                  <col key={index} style={{ width: `${share}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-border-default bg-bg-subtle">
                  <Th>Person</Th>
                  <Th>Project(s)</Th>
                  <Th numeric>Total Posts</Th>
                  <Th>Platforms</Th>
                  <Th>Most Used Platform</Th>
                  <Th numeric>This Week</Th>
                </tr>
              </thead>
              <tbody>
                {work.posters.map((poster) => (
                  <PosterLine key={poster.userId ?? '@unassigned'} poster={poster} />
                ))}
                {work.posters.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-caption text-text-tertiary">
                      Nobody published in this period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ⚠️ The COUNT is rendered here rather than left to `Pagination`, which
          returns null when everything fits on one page — correct for a pager,
          wrong for this line. The mockup shows "Showing 1 to 8 of 8 records"
          under a single-page table, and it is the sentence that tells a reader a
          filter has taken effect. So the count always shows and only the page
          buttons come and go. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-caption text-text-secondary">
          {pager.total === 0
            ? 'No records'
            : `Showing ${pager.from} to ${pager.to} of ${pager.total} record${pager.total === 1 ? '' : 's'}`}
        </p>
        <Pagination
          page={pager.page}
          pageCount={pager.pageCount}
          onPage={pager.setPage}
          from={pager.from}
          to={pager.to}
          total={pager.total}
          label="records"
        />
      </div>
    </div>
  );
}

/**
 * Column widths as percentages, in source order, summing to 100.
 *
 * ⚠️ The four count columns are deliberately equal and narrow. They hold one or
 * two digits; the only reason they ever looked wide is that their HEADINGS are two
 * words, and the headings now wrap. Giving them the width their text wanted was
 * what pushed Last Active off the page.
 */
const COLUMN_SHARES = [
  /* ── ⚠️ TEN COLUMNS NOW, AND THEY STILL SUM TO 100 — owner, 2026-09-08 ────
     Tasks Pending, Posts Published and Activity Summary are gone; Description
     is in. The 22 points it takes are almost exactly what those three released
     (6 + 6 + 6) plus a point from Tasks, which no longer has to carry the sense
     of the work on its own now that the sentence sits beside it.

     Description is the widest column on the table because it is the only one
     holding a sentence — everything else here is a word, a number or a date. */
  12, // Project
  12, // Person
  16, // Tasks
  22, // Description
  7, // Platform
  7, // Tasks Assigned
  6, // Tasks Done
  8, // Content Type
  /* 6, not 5: the pill reads "Completed". */
  6, // Status
  /* ⚠️ 4 is tight, and it is what is left. "just now" is the longest string
     this column renders; at `--content-max` 4% is 61px, which holds it after
     padding. If a longer relative age is ever added, take the point back from
     Content Type rather than from Description. */
  4, // Last Active
];

const POSTER_SHARES = [22, 30, 10, 14, 14, 10];

/* ---- Cells --------------------------------------------------------------- */

function Th({ children, numeric }: { children: React.ReactNode; numeric?: boolean }) {
  return (
    <th
      scope="col"
      /* ⚠️ NO `whitespace-nowrap`. Letting "Tasks Assigned" set over two lines is
         what buys the width that keeps Last Active on the page — see the header.
         `leading-tight` so a two-line heading does not make the row tall. */
      className={cn(
        'px-3 py-2.5 align-bottom text-caption font-medium leading-tight text-text-secondary',
        numeric && 'text-right',
      )}
    >
      {children}
    </th>
  );
}

/* px-3, not px-4: twelve columns times two sides is 24 paddings, and the eight
   points saved per side is a whole column's worth of room. */
const TD = 'px-3 py-3 align-middle text-caption';

function Row({
  row,
  nowMs,
  onOpen,
}: {
  row: WorkRow;
  nowMs: number;
  onOpen: () => void;
}) {
  const status = WORK_STATUS_META[row.status];

  return (
    /* ── ⚠️ THE WHOLE ROW OPENS THE DETAIL, AND IT IS KEYBOARD-REACHABLE ─────
        `onClick` on a `<tr>` alone is a mouse-only control. `tabIndex` plus the
        Enter/Space handler gives it the behaviour a button has, which matters
        here because this table is twelve columns wide and somebody navigating it
        with a keyboard has no other way in.

        Not a real <button>: one cannot wrap a table row, and a button inside
        every cell would be twelve tab stops per row. */
    <tr
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      title={`Open ${row.personName} on ${row.projectName}`}
      className="cursor-pointer border-b border-border-subtle last:border-0 hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none">
      <td className={cn(TD, 'text-text-primary')}>
        <span className="block truncate" title={row.projectName}>
          {row.projectName}
        </span>
      </td>

      <td className={TD}>
        {/* `flex-wrap`, so the badge drops under a long name instead of forcing
            the column wider than its share. */}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Avatar name={row.personName} src={row.avatarUrl} size="xs" />
          <span className="min-w-0 flex-1 truncate text-text-primary" title={row.personName}>
            {row.personName}
          </span>
        </span>
      </td>

      {/* ── ⚠️ THE TASKS, WHERE THE ROLE USED TO BE ──────────────────────────
          Owner, 2026-09-03: *"Task name should mention a list of all tasks names
          that should display… each row should display the task related to that
          person."*

          Capped at three with a count for the rest: a person with fourteen tasks
          would otherwise make one row taller than the screen, and the full list
          is one click away in the detail panel. Three is enough to recognise
          what the row is about. */}
      <td className={cn(TD, 'text-text-secondary')}>
        {row.tasks.length === 0 ? (
          <span className="text-text-tertiary">—</span>
        ) : (
          <span className="block space-y-0.5">
            {row.tasks.slice(0, 3).map((task) => (
              <span key={task.reference} className="flex items-baseline gap-1.5">
                {/* A dot in the status colour, so what is finished reads at a
                    glance without a word per line. */}
                <span
                  aria-hidden="true"
                  className="mt-[0.35em] size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: `var(--${STATUS_META[task.status].token})` }}
                />
                <span className="min-w-0 flex-1 truncate text-text-primary" title={task.title}>
                  {task.title}
                </span>
              </span>
            ))}
            {row.tasks.length > 3 && (
              <span className="block text-micro text-text-tertiary">
                and {row.tasks.length - 3} more
              </span>
            )}
          </span>
        )}
      </td>

      {/* ── ⚠️ ONE DESCRIPTION PER TASK, LINED UP WITH THE COLUMN BESIDE IT ──
          The row is a project-and-person pairing holding several tasks, so
          "the description" is not one string. Printing the first task's would
          silently attribute it to all of them. These are the same three tasks
          the Tasks column shows, in the same order, so the two columns read
          across — and an em dash holds the line for a task nobody described,
          which keeps the alignment honest rather than closing the gap. */}
      <td className={cn(TD, 'text-text-secondary')}>
        {row.tasks.length === 0 ? (
          <span className="text-text-tertiary">—</span>
        ) : (
          <span className="block space-y-0.5">
            {row.tasks.slice(0, 3).map((task) => (
              <span
                key={task.reference}
                className="block truncate"
                title={task.description ?? undefined}
              >
                {task.description ?? <span className="text-text-tertiary">—</span>}
              </span>
            ))}
            {row.tasks.length > 3 && (
              <span className="block text-micro text-text-tertiary">
                and {row.tasks.length - 3} more
              </span>
            )}
          </span>
        )}
      </td>

      <td className={TD}>
        {row.platforms.length === 0 ? (
          <span className="text-text-tertiary">—</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {row.platforms.map((slug) => (
              <PlatformIcon key={slug} slug={slug} size={16} />
            ))}
          </span>
        )}
      </td>

      <Num value={row.tasksAssigned} />
      <Num value={row.tasksDone} />

      <td className={cn(TD, 'text-text-secondary')}>
        {row.contentTypes.length > 0 ? row.contentTypes.join(', ') : '—'}
      </td>

      <td className={cn(TD, 'whitespace-nowrap')}>
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-micro font-semibold"
          style={{
            /* The status colour at low opacity for the ground and full strength
               for the text — one token per state, so a badge cannot drift from the
               colour the same state has on a board. */
            backgroundColor: `color-mix(in oklab, var(--${status.token}) 14%, transparent)`,
            color: `var(--${status.token})`,
          }}
        >
          {status.label}
        </span>
      </td>

      {/* `truncate` as well as nowrap: on a narrower laptop the percentages give
          this column less than its content needs, and under `table-fixed` an
          overflowing cell spills across its neighbour rather than widening the
          table. Clipping with an ellipsis keeps the row tidy; the exact time is on
          the title. */}
      <td className={cn(TD, 'text-right text-text-tertiary')}>
        <span className="block truncate" title={row.lastActive ?? undefined}>
          {relativeAge(row.lastActive, nowMs) ?? '—'}
        </span>
      </td>
    </tr>
  );
}

function Num({ value, strong }: { value: number; strong?: boolean }) {
  return (
    <td
      className={cn(
        TD,
        'text-right tabular-nums',
        strong ? 'font-semibold text-text-primary' : 'text-text-secondary',
      )}
    >
      {value}
    </td>
  );
}

function PosterLine({ poster }: { poster: PosterRow }) {
  return (
    <tr className="border-b border-border-subtle last:border-0 hover:bg-bg-hover">
      <td className={cn(TD, 'whitespace-nowrap')}>
        <span className="flex items-center gap-2">
          <Avatar name={poster.personName} src={poster.avatarUrl} size="xs" />
          <span className="text-text-primary">{poster.personName}</span>
        </span>
      </td>

      <td className={cn(TD, 'text-text-secondary')}>
        {/* De-duplicated: somebody with three rows on one project should read as
            that project once, not three times. Truncated with the full list on
            hover — somebody across five projects would otherwise set the row
            height for the whole table. */}
        {(() => {
          const names = [...new Set(poster.projects)].join(', ');
          return (
            <span className="block truncate" title={names}>
              {names || '—'}
            </span>
          );
        })()}
      </td>

      <Num value={poster.totalPosts} strong />

      <td className={TD}>
        {poster.platforms.length === 0 ? (
          <span className="text-text-tertiary">—</span>
        ) : (
          <span className="flex items-center gap-1">
            {poster.platforms.map((slug) => (
              <PlatformIcon key={slug} slug={slug} size={18} />
            ))}
          </span>
        )}
      </td>

      <td className={TD}>
        {poster.mostUsedPlatform ? (
          <PlatformIcon slug={poster.mostUsedPlatform} size={18} />
        ) : (
          <span className="text-text-tertiary">—</span>
        )}
      </td>

      <Num value={poster.thisWeek} />
    </tr>
  );
}

