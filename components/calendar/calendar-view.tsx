'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

import { calendarAction } from '@/app/actions/search';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import type { CalendarTask } from '@/lib/db/queries/search';
import { PRIORITY_LABEL, STATUS_META } from '@/lib/domain/constants';

/* ============================================================================
 * CALENDAR — FR-088
 * ----------------------------------------------------------------------------
 * A month of due dates.
 *
 * ── EVERY DATE CALCULATION IS UTC ────────────────────────────────────────────
 * A due date is a DAY, not an instant. `new Date('2026-08-07')` is midnight UTC
 * and `getDate()` answers in the local zone — so west of Greenwich every task
 * lands in the cell before the one it belongs in, and nobody notices until a
 * deadline is missed by a day. The same trap the recurrence engine had.
 *
 * ── SUNDAY IS THE WEEKEND HERE, NOT SATURDAY ─────────────────────────────────
 * The working week is Monday to Saturday (doc 03, ADR-004), so the grid starts
 * on Monday and Sunday is the shaded column. Shipping a Sunday-first calendar
 * would put the team's quiet day in the middle of the row.
 * ========================================================================= */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Monday … 6 = Sunday. `getUTCDay()` is Sunday-first, so it is shifted. */
function mondayIndex(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function CalendarView({
  initialTasks,
  initialYear,
  initialMonth,
  todayIso,
  people,
  currentUserId,
  canSeeOthers,
}: {
  initialTasks: readonly CalendarTask[];
  initialYear: number;
  initialMonth: number;
  /** Passed from the server — reading the clock during render is impure. */
  todayIso: string;
  people: readonly { id: string; name: string }[];
  currentUserId: string;
  /**
   * Whether the person dropdown is offered at all.
   *
   * Owner instruction: *"mine by default and then a dropdown lets the superadmin
   * and admin see all other members work, others only see their own by default
   * and cannot see other members tasks."* So Admin and above get the dropdown;
   * everybody else sees their own work and no control.
   *
   * ⚠️ This is a UI narrowing, not a security boundary. Row-level security would
   * permit a Coordinator to see the division's tasks — and still does on the
   * Tasks screen. Narrower than permitted is always safe; the reverse would not
   * be, which is why this decides what to *offer* and never what to *return*.
   */
  canSeeOthers: boolean;
}) {
  const router = useRouter();
  const [year, setYear] = React.useState(initialYear);
  const [month, setMonth] = React.useState(initialMonth);

  /* Defaults to the reader's own work, so the calendar opens as their diary
     rather than as the division's noticeboard. */
  const [assignee, setAssignee] = React.useState(currentUserId);

  /* ── EVERY MONTH IS KEPT ONCE IT HAS BEEN SEEN ─────────────────────────────
     The first version refetched on every click, so paging back and forth cost a
     round trip to Singapore each time — the owner measured two to three seconds
     for something that should be instant.

     A Map keyed by year-month, held for the life of the page. Going back to
     August after visiting September is now zero network and renders in the same
     frame. Stale data is the trade, and it is the right one here: a calendar is
     a planning view, the page is re-rendered from the server on any navigation,
     and nothing in it is a number somebody acts on to the second. */
  const [months, setMonths] = React.useState<ReadonlyMap<string, readonly CalendarTask[]>>(
    () => new Map([[`${initialYear}-${initialMonth}`, initialTasks]]),
  );

  const key = `${year}-${month}`;
  const tasks = months.get(key);
  const loading = tasks === undefined;

  /* Fetch what is missing — the month being shown, and the two either side of
     it, so the NEXT click has nothing to wait for. Neighbours are fetched
     without blocking: the arrows are already usable while they arrive. */
  React.useEffect(() => {
    let cancelled = false;

    const want = [
      { y: year, m: month },
      month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 },
      month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 },
    ].filter((slot) => !months.has(`${slot.y}-${slot.m}`));

    if (want.length === 0) return;

    for (const slot of want) {
      calendarAction({
        from: iso(slot.y, slot.m, 1),
        to: iso(slot.y, slot.m, daysInMonth(slot.y, slot.m)),
      })
        .then((rows) => {
          if (cancelled) return;
          setMonths((current) => new Map(current).set(`${slot.y}-${slot.m}`, rows));
        })
        .catch(() => {
          /* An empty month rather than a spinner forever. The arrows keep
             working and a reload retries. */
          if (cancelled) return;
          setMonths((current) => new Map(current).set(`${slot.y}-${slot.m}`, []));
        });
    }

    return () => {
      cancelled = true;
    };
  }, [year, month, months]);

  const visible = React.useMemo(() => {
    const rows = tasks ?? [];
    return assignee === 'all' ? rows : rows.filter((t) => t.assigneeId === assignee);
  }, [tasks, assignee]);

  const byDay = React.useMemo(() => {
    const map = new Map<string, CalendarTask[]>();
    for (const task of visible) {
      map.set(task.dueDate, [...(map.get(task.dueDate) ?? []), task]);
    }
    return map;
  }, [visible]);

  const total = daysInMonth(year, month);
  const leading = mondayIndex(year, month, 1);
  const cells: Array<number | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const step = (delta: number) => {
    const next = month + delta;
    if (next < 1) {
      setMonth(12);
      setYear(year - 1);
    } else if (next > 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(next);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="md" onClick={() => step(-1)}>
          <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">Previous month</span>
        </Button>
        <h2 className="min-w-[10rem] text-h3 text-text-primary">{monthName}</h2>
        <Button variant="secondary" size="md" onClick={() => step(1)}>
          <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">Next month</span>
        </Button>

        {/* The arrows are never disabled. Locking navigation while a month
            loads is precisely the stalled feeling the cache exists to remove —
            keep paging and the months fill in behind you. */}
        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" aria-hidden="true" />
        )}

        {canSeeOthers ? (
          <select
            aria-label="Whose work to show"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            className="ml-auto rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 text-caption text-text-primary"
          >
            <option value={currentUserId}>My work</option>
            <option value="all">Everybody</option>
            {people
              .filter((person) => person.id !== currentUserId)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
          </select>
        ) : (
          /* No control rather than a disabled one: there is nothing else this
             person could choose, so a greyed-out select would only raise the
             question of what they are missing. */
          <span className="ml-auto text-caption text-text-secondary">Your work</span>
        )}

        <span className="tabular text-micro text-text-tertiary">
          {visible.length} with a due date
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[46rem]">
          <div className="grid grid-cols-7 gap-px rounded-t-xl bg-border-subtle">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className={`bg-bg-surface-sunken px-2 py-1.5 text-center text-micro font-semibold ${
                  day === 'Sun' ? 'text-text-tertiary' : 'text-text-secondary'
                }`}
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px rounded-b-xl bg-border-subtle">
            {cells.map((day, index) => {
              if (day === null) {
                return <div key={`pad-${index}`} className="min-h-[6.5rem] bg-bg-surface-sunken" />;
              }

              const date = iso(year, month, day);
              const isToday = date === todayIso;
              const isSunday = index % 7 === 6;
              const dayTasks = byDay.get(date) ?? [];

              return (
                <div
                  key={date}
                  className={`min-h-[6.5rem] p-1.5 ${isSunday ? 'bg-bg-surface-sunken' : 'bg-bg-surface'}`}
                >
                  <div className="mb-1 flex items-baseline justify-between">
                    <span
                      className={`tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-micro font-semibold ${
                        isToday
                          ? 'bg-[image:var(--gradient-brand)] text-text-on-brand'
                          : 'text-text-tertiary'
                      }`}
                    >
                      {day}
                    </span>
                    {dayTasks.length > 3 && (
                      <span className="text-micro text-text-tertiary">{dayTasks.length}</span>
                    )}
                  </div>

                  {/* ── WHAT A DAY SHOWS WITHOUT BEING CLICKED ─────────────────
                      Owner: *"each task shall be displayed with a brief detail
                      about the work and highlighted on the dates or times."*

                      Time, title, project, assignee and a status colour — enough
                      to read the day, and no more. The status colour is a left
                      bar rather than a dot because a bar survives being three
                      pixels wide on a narrow month grid, and because a row of
                      dots at the start of each line reads as a bulleted list
                      instead of as a schedule.

                      Three per day, then a count. Not because more would not fit
                      but because a cell that grows with its contents makes every
                      OTHER row in the month taller, and a month where one busy
                      Tuesday sets the height of six weeks is unreadable. */}
                  <ul className="space-y-1">
                    {dayTasks.slice(0, 3).map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          title={[
                            `${task.reference} · ${task.title}`,
                            task.projectName,
                            task.dueTime ? `due ${task.dueTime}` : 'no set time',
                            PRIORITY_LABEL[task.priority],
                            `${task.effortPoints} pts`,
                            STATUS_META[task.status].label,
                            task.assigneeName ?? 'Unassigned',
                          ].join(' · ')}
                          onClick={() => router.push(`/tasks?task=${task.id}` as never)}
                          className="flex w-full gap-1.5 rounded px-1 py-1 text-left hover:bg-bg-hover"
                        >
                          <span
                            aria-hidden="true"
                            className="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full"
                            style={{
                              backgroundColor: `var(--${STATUS_META[task.status].token})`,
                            }}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-1">
                              {task.dueTime && (
                                <span className="tabular shrink-0 text-micro font-semibold text-text-secondary">
                                  {task.dueTime}
                                </span>
                              )}
                              <span className="min-w-0 flex-1 truncate text-micro font-medium text-text-primary">
                                {task.title}
                              </span>
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="min-w-0 flex-1 truncate text-micro text-text-tertiary">
                                {task.projectName}
                              </span>
                              {/* Only when looking at more than one person's work
                                  — a face on every row of your own calendar is
                                  your own face, repeated. */}
                              {assignee === 'all' && (
                                <Avatar
                                  name={task.assigneeName ?? 'Unassigned'}
                                  src={task.assigneeAvatarUrl}
                                  size="xs"
                                />
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                    {dayTasks.length > 3 && (
                      <li className="px-1 text-micro text-text-tertiary">
                        +{dayTasks.length - 3} more
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="text-micro text-text-tertiary">
        Only tasks with a due date appear here — a calendar cannot place work nobody has dated.
        Sunday is shaded because the working week runs Monday to Saturday (ADR-004).
      </p>
    </div>
  );
}
