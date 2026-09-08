'use client';

import * as React from 'react';
import { CalendarDays, ExternalLink } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Dialog } from '@/components/ui/dialog';
import { STATUS_META } from '@/lib/domain/constants';
import type { DiaryEntry, WorkDiary } from '@/lib/domain/work-diary';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE WORK DIARY ON SCREEN — one table per member, a row per day
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-08: *"This whole report will be generated member by member:
 * first member's table, then the next member's name and that's their table, and
 * then the next name and that's their table."*
 *
 * ── ⚠️ THE DAY IS A ROW HEADER, NOT A REPEATED CELL ────────────────────────
 * Where a day holds three tasks, the date is written once against the first and
 * the other two are indented under it. Repeating "3 September" three times down
 * a column is what makes a report look like a database dump — the owner's
 * complaint about an earlier screen was *"it is just like a sheet you are
 * showing me… I have to read it very carefully, like Google Sheets."*
 *
 * ── ⚠️ AND THE EMPTY DAYS ARE PRINTED, QUIETLY ─────────────────────────────
 * Every day in the range appears; the ones with nothing recorded say so in
 * muted type rather than being skipped. The gap is the point of the report —
 * see the note in lib/domain/work-diary.ts.
 * ========================================================================= */

/** "Tue 1 Sep". Weekday included because a blank day reads differently on a
 *  Sunday, and a reader should not have to work that out. */
function dayLabel(iso: string): { weekday: string; date: string } {
  const at = new Date(`${iso}T00:00:00`);
  return {
    weekday: at.toLocaleDateString(undefined, { weekday: 'short' }),
    date: at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  };
}

const BASIS_LABEL: Readonly<Record<DiaryEntry['dateBasis'], string>> = {
  published: 'published',
  completed: 'completed',
  due: 'due',
};

export function WorkDiaryTables({ diary }: { diary: WorkDiary }) {
  const [open, setOpen] = React.useState<DiaryEntry | null>(null);

  if (diary.groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border-default bg-bg-surface px-6 py-14 text-center">
        <p className="text-body-sm font-semibold text-text-primary">Nothing in this period</p>
        <p className="mx-auto mt-1 max-w-md text-caption text-text-secondary">
          No work falls between {diary.from} and {diary.to} for the projects and people selected.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {diary.groups.map((group) => (
        <section key={group.key} className="space-y-2">
          {/* ── The name, which is what makes this "member by member" ──────── */}
          <div className="flex flex-wrap items-center gap-2.5">
            {diary.grouping === 'member' ? (
              <Avatar name={group.title} src={group.avatarUrl} size="sm" />
            ) : (
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-bg-subtle">
                <CalendarDays className="size-3.5 text-text-tertiary" aria-hidden="true" />
              </span>
            )}

            <h2 className="text-body font-semibold text-text-primary">{group.title}</h2>

            <span className="text-caption text-text-tertiary">
              {group.tasksAssigned} assigned · {group.tasksDone} done · active on{' '}
              {group.activeDays} of {group.days.length} days
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border-default bg-bg-surface">
            <table className="w-full table-fixed border-collapse text-left">
              <colgroup>
                <col style={{ width: '13%' }} />
                <col style={{ width: '24%' }} />
                <col style={{ width: '17%' }} />
                {/* ⚠️ The widest column on the table. Owner: *"the most
                    important thing is to add a description column"* — and a
                    description is a sentence where everything beside it is a
                    word or a date. */}
                <col style={{ width: '34%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>

              <thead>
                <tr className="border-b border-border-default bg-bg-subtle">
                  <Th>Date</Th>
                  <Th>Task</Th>
                  <Th>{diary.grouping === 'member' ? 'Project' : 'Person'}</Th>
                  <Th>Description</Th>
                  <Th>Status</Th>
                </tr>
              </thead>

              <tbody>
                {group.days.map((day) => {
                  const label = dayLabel(day.date);

                  if (day.entries.length === 0) {
                    return (
                      <tr key={day.date} className="border-b border-border-subtle last:border-0">
                        <DateCell weekday={label.weekday} date={label.date} muted />
                        <td colSpan={4} className="px-3 py-2 text-caption text-text-tertiary">
                          No work recorded
                        </td>
                      </tr>
                    );
                  }

                  return day.entries.map((entry, index) => (
                    <tr
                      key={`${day.date}-${entry.reference}`}
                      onClick={() => setOpen(entry)}
                      className="cursor-pointer border-b border-border-subtle transition-colors last:border-0 hover:bg-bg-hover"
                    >
                      {/* Written once per day — see the header. */}
                      {index === 0 ? (
                        <DateCell weekday={label.weekday} date={label.date} span={day.entries.length} />
                      ) : null}

                      <td className="px-3 py-2 align-top">
                        <span className="block truncate text-body-sm text-text-primary">
                          {entry.title}
                        </span>
                        <span className="mt-0.5 block text-micro text-text-tertiary">
                          {entry.category} · {BASIS_LABEL[entry.dateBasis]}
                        </span>
                      </td>

                      <td className="px-3 py-2 align-top">
                        <span className="block truncate text-caption text-text-secondary">
                          {entry.counterpart}
                        </span>
                      </td>

                      <td className="px-3 py-2 align-top">
                        {entry.description ? (
                          /* Two lines then an ellipsis; the whole thing is one
                             click away. A description that expands the row to
                             nine lines destroys the day-by-day scan this table
                             exists for. */
                          <span className="line-clamp-2 text-caption text-text-secondary">
                            {entry.description}
                          </span>
                        ) : (
                          <span className="text-caption text-text-tertiary">—</span>
                        )}
                      </td>

                      <td className="px-3 py-2 align-top">
                        <StatusPill status={entry.status} label={entry.statusLabel} />
                      </td>
                    </tr>
                  ));
                })}

                {/* ⚠️ Tasks that belong to this period but sit on no day of it.
                    Printed last rather than dropped — see work-diary.ts. */}
                {group.undated.length > 0 && (
                  <>
                    <tr className="border-b border-border-subtle bg-bg-subtle">
                      <td colSpan={5} className="px-3 py-1.5 text-micro text-text-tertiary">
                        No date recorded — counted in the totals above, not on any day
                      </td>
                    </tr>
                    {group.undated.map((entry) => (
                      <tr
                        key={`undated-${entry.reference}`}
                        onClick={() => setOpen(entry)}
                        className="cursor-pointer border-b border-border-subtle transition-colors last:border-0 hover:bg-bg-hover"
                      >
                        <td className="px-3 py-2 align-top text-caption text-text-tertiary">—</td>
                        <td className="px-3 py-2 align-top">
                          <span className="block truncate text-body-sm text-text-primary">
                            {entry.title}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top text-caption text-text-secondary">
                          {entry.counterpart}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span className="line-clamp-2 text-caption text-text-secondary">
                            {entry.description ?? '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <StatusPill status={entry.status} label={entry.statusLabel} />
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <EntryDialog entry={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function DateCell({
  weekday,
  date,
  span = 1,
  muted = false,
}: {
  weekday: string;
  date: string;
  span?: number;
  muted?: boolean;
}) {
  return (
    <td
      rowSpan={span}
      className={cn(
        'border-r border-border-subtle px-3 py-2 align-top',
        muted ? 'text-text-tertiary' : 'text-text-primary',
      )}
    >
      <span className="block text-caption font-semibold tabular-nums">{date}</span>
      <span className="block text-micro text-text-tertiary">{weekday}</span>
    </td>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2 text-micro font-semibold tracking-wide text-text-tertiary uppercase"
    >
      {children}
    </th>
  );
}

function StatusPill({ status, label }: { status: DiaryEntry['status']; label: string }) {
  const token = STATUS_META[status].token;
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-micro font-semibold"
      style={{
        backgroundColor: `color-mix(in oklab, var(--${token}) var(--tint-soft), var(--bg-surface))`,
        color: `color-mix(in oklab, var(--${token}) 82%, var(--text-primary))`,
      }}
    >
      {label}
    </span>
  );
}

/**
 * The row, opened.
 *
 * Owner: *"When I click on a row it will pop up and show the description."* The
 * column truncates at two lines so the day-by-day scan survives; this is where
 * the whole thing is readable, with the placement links beside it.
 */
function EntryDialog({ entry, onClose }: { entry: DiaryEntry | null; onClose: () => void }) {
  return (
    <Dialog
      open={entry !== null}
      onClose={onClose}
      size="md"
      title={entry?.title ?? ''}
      description={entry ? `${entry.counterpart} · ${entry.category}` : undefined}
    >
      {entry && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={entry.status} label={entry.statusLabel} />
            <span className="text-micro text-text-tertiary">
              Filed under the day it was {BASIS_LABEL[entry.dateBasis]}
            </span>
          </div>

          <div>
            <h3 className="mb-1 text-caption font-semibold text-text-primary">Description</h3>
            {entry.description ? (
              <p className="rounded-lg bg-bg-subtle px-3 py-2.5 text-caption leading-relaxed break-words whitespace-pre-wrap text-text-secondary">
                {entry.description}
              </p>
            ) : (
              <p className="text-caption text-text-tertiary">
                Nothing was written in this task&rsquo;s description.
              </p>
            )}
          </div>

          {entry.links.length > 0 && (
            <div>
              <h3 className="mb-1 text-caption font-semibold text-text-primary">Where it went</h3>
              <ul className="space-y-1">
                {entry.links.map((link) => (
                  <li key={`${link.slug}-${link.url ?? ''}`}>
                    {link.url ? (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-caption text-text-brand hover:underline"
                      >
                        {link.platformName}
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="text-caption text-text-tertiary">
                        {link.platformName} — no link recorded
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
