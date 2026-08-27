'use client';

import * as React from 'react';
import {
  CalendarCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Clock,
  ExternalLink,
  Filter as FilterIcon,
} from 'lucide-react';

import type { CalendarTask } from '@/lib/db/queries/search';
import type { PlacementRow } from '@/lib/db/queries/placements';
import { CONTENT_KIND_LABEL, type ContentKind } from '@/lib/domain/constants';
import { monthPlan, type Cadence } from '@/lib/domain/cadence';
import { PlatformIcon } from '@/components/brand/platform-icon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE POSTING MONTH, POST BY POST
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24, with a mockup: *"in the Calendar tab… there is an empty
 * calendar showing a posting month. I want every posting month to display
 * everything like this."* — a month grid where each day stacks its posts as
 * chips: platform logo, what it is, and the time.
 *
 * ── ⚠️ WHAT THIS REPLACES, AND WHAT IT KEEPS ────────────────────────────────
 * `MonthRhythm` drew the agreed CADENCE as coloured squares — one tint per day,
 * counting done and missed. That answered "are we keeping to the rhythm" and could
 * not answer "what went out on the 13th", which is the question the mockup is
 * about and the reason the tab looked empty even when there were posts.
 *
 * It keeps the half of `MonthRhythm` that was genuinely load-bearing: the PLAN.
 * `monthPlan` still says which days the contract expects a post, so a day the
 * rhythm wanted and which has nothing is marked — the owner's *"some days with
 * absent"*. Without that, an empty Tuesday and a Tuesday that was missed look
 * identical, and only one of them is a problem.
 *
 * ── ⚠️ A CHIP IS A PLACEMENT, NOT A TASK ────────────────────────────────────
 * One task can go to Facebook AND Instagram, and it is one piece of work with two
 * publications. The mockup shows them as separate rows because that is what they
 * are to whoever is checking the month — so the grid flattens tasks into
 * placements and falls back to a single platform-less chip for a deliverable with
 * no placement recorded yet.
 *
 * ── WHERE EVERY PART COMES FROM ─────────────────────────────────────────────
 *   the chip's logo     `placement.platformSlug` → `PlatformIcon`
 *   the chip's label    `placement.contentKind`, or the task's
 *   the time            `task.dueTime` ('HH:MM', migration 020)
 *   published or not    `placement.url` — a live link opens it
 *   done / late / due   `task.status` against `today`
 * ========================================================================= */

/** How a day reads at a glance. Ordered by how much attention it deserves. */
type DayMood = 'missed' | 'today' | 'published' | 'planned' | 'absent' | 'quiet';

export type PostFilter = 'all' | 'published' | 'due' | 'late';

interface Chip {
  readonly key: string;
  readonly taskId: string;
  readonly title: string;
  readonly time: string | null;
  readonly platformSlug: string | null;
  readonly kind: ContentKind | null;
  readonly url: string | null;
  readonly status: CalendarTask['status'];
  readonly late: boolean;
}

/** 'HH:MM' → '9:00 AM'. Built by hand rather than through `Intl`: the value is a
 *  wall-clock time with no date and no zone, so handing it to a formatter would
 *  mean inventing a date to attach it to — and whichever one we invented could
 *  shift the hour across a DST boundary. */
function clockLabel(time: string | null): string | null {
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m ?? 0).padStart(2, '0')} ${suffix}`;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Monday-first index for an ISO date. `Date.UTC` because the value is a date and
 *  parsing 'YYYY-MM-DD' directly is UTC midnight — a day earlier anywhere behind
 *  Greenwich, which would shift the whole grid by a column. */
function mondayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function shiftMonth(monthStart: string, by: number): string {
  const [y, m] = monthStart.split('-').map(Number);
  const at = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const monthLabel = (monthStart: string) => {
  const [y, m] = monthStart.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

export function PostingCalendar({
  tasks,
  placements,
  cadence,
  monthStart,
  today,
  months,
  onMonth,
}: {
  /** This project's tasks for the visible month. Deliverables are picked out here
   *  rather than by the caller, so the filter row's counts and the grid agree. */
  tasks: readonly CalendarTask[];
  placements: readonly PlacementRow[];
  cadence: Cadence;
  monthStart: string;
  today: string;
  /** The months the picker offers, newest first, from the server. */
  months: readonly string[];
  /** Navigating writes the month to the URL, so a month is a place you can send
   *  somebody — the same reason the project itself is a route and not a drawer. */
  onMonth: (monthStart: string) => void;
}) {
  const [filter, setFilter] = React.useState<PostFilter>('all');

  const plan = React.useMemo(() => monthPlan(cadence, monthStart), [cadence, monthStart]);

  /** Placements grouped by task, so each task's chips are one lookup. */
  const byTask = React.useMemo(() => {
    const map = new Map<string, PlacementRow[]>();
    for (const p of placements) {
      const list = map.get(p.taskId);
      if (list) list.push(p);
      else map.set(p.taskId, [p]);
    }
    return map;
  }, [placements]);

  /* ── ONE CHIP PER PLACEMENT, KEYED BY DATE ────────────────────────────────
     Deliverables only: `contentKind === null` is ordinary work, which belongs on
     the Work due view and would drown the posting month. */
  const chipsByDate = React.useMemo(() => {
    const map = new Map<string, Chip[]>();

    for (const task of tasks) {
      if (task.contentKind === null) continue;

      const late = task.status !== 'done' && task.status !== 'cancelled' && task.dueDate < today;
      const rows = byTask.get(task.id) ?? [];

      /* A deliverable with no placement recorded still belongs on the calendar —
         it is planned work, just with no platform named yet. One chip, no logo. */
      const made: Chip[] =
        rows.length > 0
          ? rows.map((p) => ({
              key: `${task.id}:${p.id}`,
              taskId: task.id,
              title: task.title,
              time: task.dueTime,
              platformSlug: p.platformSlug,
              kind: p.contentKind ?? task.contentKind,
              url: p.url,
              status: task.status,
              late,
            }))
          : [
              {
                key: task.id,
                taskId: task.id,
                title: task.title,
                time: task.dueTime,
                platformSlug: null,
                kind: task.contentKind,
                url: null,
                status: task.status,
                late,
              },
            ];

      const keep = made.filter((chip) => {
        if (filter === 'all') return true;
        if (filter === 'published') return chip.status === 'done';
        if (filter === 'late') return chip.late;
        return chip.status !== 'done' && !chip.late;
      });
      if (keep.length === 0) continue;

      const list = map.get(task.dueDate);
      if (list) list.push(...keep);
      else map.set(task.dueDate, keep);
    }

    /* Sorted by the clock, so a day reads in the order it happens. Nulls last —
       "some time that day" comes after everything with an hour on it. */
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.time === b.time) return a.title.localeCompare(b.title);
        if (a.time === null) return 1;
        if (b.time === null) return -1;
        return a.time.localeCompare(b.time);
      });
    }
    return map;
  }, [tasks, byTask, today, filter]);

  /** Which days the contract wanted a post on. Used only to mark an ABSENT day. */
  const plannedDates = React.useMemo(
    () => new Set(plan.days.filter((d) => d.staticPosts > 0 || d.reels > 0).map((d) => d.date)),
    [plan],
  );

  const totals = React.useMemo(() => {
    let published = 0;
    let late = 0;
    let due = 0;
    for (const list of chipsByDate.values()) {
      for (const chip of list) {
        if (chip.status === 'done') published += 1;
        else if (chip.late) late += 1;
        else due += 1;
      }
    }
    return { published, late, due, total: published + late + due };
  }, [chipsByDate]);

  const dayCount = plan.days.length;
  const firstDate = `${monthStart.slice(0, 7)}-01`;
  const lead = mondayIndex(firstDate);
  const isThisMonth = today.slice(0, 7) === monthStart.slice(0, 7);

  return (
    <div className="space-y-3">
      {/* ══ THE CONTROL ROW ═══════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          /* Disabled when it would do nothing — the current month is already
             showing. A control that is a no-op is worse than one that is absent,
             because pressing it teaches nothing. */
          disabled={isThisMonth}
          onClick={() => onMonth(`${today.slice(0, 7)}-01`)}
        >
          Today
        </Button>

        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="sm" onClick={() => onMonth(shiftMonth(monthStart, -1))}>
            <ChevronLeft className="size-4" strokeWidth={2.5} aria-hidden="true" />
            <span className="sr-only">The month before</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onMonth(shiftMonth(monthStart, 1))}>
            <ChevronRight className="size-4" strokeWidth={2.5} aria-hidden="true" />
            <span className="sr-only">The month after</span>
          </Button>
        </div>

        {/* ⚠️ A real `<select>`, styled. The month list comes from the server and a
            native picker gets keyboard, type-ahead and mobile behaviour for free. */}
        <label className="relative inline-flex items-center">
          <span className="sr-only">Which month</span>
          <select
            value={monthStart}
            onChange={(event) => onMonth(event.target.value)}
            className="appearance-none rounded-lg border border-border-default bg-bg-surface py-1.5 pl-3 pr-8 text-caption font-semibold text-text-primary"
          >
            {/* The visible month is always an option, even if it is outside the
                server's list — otherwise paging back far enough would blank the
                control. */}
            {(months.includes(monthStart) ? months : [monthStart, ...months]).map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 size-3.5 text-text-tertiary"
            strokeWidth={2.5}
            aria-hidden="true"
          />
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <FilterIcon className="size-4 text-text-tertiary" strokeWidth={2.25} aria-hidden="true" />
          {(
            [
              ['all', 'All', totals.total],
              ['published', 'Published', totals.published],
              ['due', 'Due', totals.due],
              ['late', 'Late', totals.late],
            ] as ReadonlyArray<readonly [PostFilter, string, number]>
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-caption font-semibold transition-colors duration-[120ms]',
                filter === value
                  ? 'bg-bg-selected text-text-brand'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
              )}
            >
              {label}
              {/* ⚠️ The count is of what the filter WOULD show, except for the
                  active one where it is what is shown. Both are the same number
                  because the totals are computed after filtering — which is why
                  switching filters changes them, and why that is correct rather
                  than a bug: they describe the visible month. */}
              <span className="tabular ml-1 text-micro opacity-70">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ══ THE GRID ══════════════════════════════════════════════════════════ */}
      <div className="overflow-x-auto">
        <div className="min-w-[52rem]">
          <div className="grid grid-cols-7 gap-px rounded-t-xl bg-border-subtle">
            {WEEKDAYS.map((day) => (
              <div
                key={day}
                className="bg-bg-surface-sunken py-2 text-center text-micro font-bold uppercase tracking-wide text-text-tertiary"
              >
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px rounded-b-xl bg-border-subtle">
            {/* Blank cells before the 1st, so the month starts on its real weekday.
                `aria-hidden` — they are layout, not days. */}
            {Array.from({ length: lead }, (_, i) => (
              <div key={`lead-${i}`} aria-hidden="true" className="min-h-[7rem] bg-bg-subtle/40" />
            ))}

            {plan.days.map((day) => {
              const chips = chipsByDate.get(day.date) ?? [];
              const isToday = day.date === today;
              const past = day.date < today;
              const wanted = plannedDates.has(day.date);

              /* ── THE DAY'S MOOD, DECIDED ONCE ───────────────────────────────
                 Ordered by how much attention it deserves: a missed day outranks a
                 published one, because a day with one post out and one missed is a
                 problem, not a success. */
              const mood: DayMood = chips.some((c) => c.late)
                ? 'missed'
                : isToday
                  ? 'today'
                  : chips.some((c) => c.status === 'done')
                    ? 'published'
                    : chips.length > 0
                      ? 'planned'
                      : wanted && past
                        ? 'absent'
                        : 'quiet';

              return (
                <div
                  key={day.date}
                  className={cn(
                    'min-h-[7rem] p-2',
                    mood === 'missed' && 'bg-[color-mix(in_oklab,var(--feedback-error)_7%,var(--bg-surface))]',
                    mood === 'today' && 'bg-bg-selected',
                    mood === 'published' && 'bg-[color-mix(in_oklab,var(--feedback-success)_6%,var(--bg-surface))]',
                    mood === 'planned' && 'bg-bg-surface',
                    /* ⚠️ THE OWNER'S "ABSENT" CASE. The rhythm wanted a post, the
                       day has gone by, and nothing exists — which is invisible
                       unless it is drawn. A hatch rather than a colour, so it does
                       not compete with the red of a post that exists and is late. */
                    mood === 'absent' &&
                      'bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklab,var(--feedback-warning)_14%,transparent)_6px_12px)]',
                    mood === 'quiet' && 'bg-bg-surface',
                  )}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-1">
                    <span
                      className={cn(
                        'tabular text-caption font-bold',
                        isToday
                          ? 'grid size-5 place-items-center rounded-full bg-[image:var(--gradient-brand)] text-text-on-brand'
                          : past
                            ? 'text-text-tertiary'
                            : 'text-text-primary',
                      )}
                    >
                      {Number(day.date.slice(-2))}
                    </span>

                    {mood === 'absent' && (
                      <span
                        title="The agreed rhythm expected a post on this day and there is none."
                        className="flex items-center gap-0.5 text-micro font-semibold"
                        style={{ color: 'var(--feedback-warning)' }}
                      >
                        <CircleSlash className="size-3" strokeWidth={2.5} aria-hidden="true" />
                        none
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {chips.map((chip) => (
                      <PostChip key={chip.key} chip={chip} />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Trailing blanks, so the last row is a full seven and the grid keeps
                its rectangle. */}
            {Array.from({ length: (7 - ((lead + dayCount) % 7)) % 7 }, (_, i) => (
              <div key={`tail-${i}`} aria-hidden="true" className="min-h-[7rem] bg-bg-subtle/40" />
            ))}
          </div>
        </div>
      </div>

      {/* ══ THE LEGEND ════════════════════════════════════════════════════════
          Four states, named. Colour alone fails for the ~8% of men with red-green
          colour blindness, and "why is this square pink" is otherwise unanswerable
          from the screen. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-micro text-text-tertiary">
        <Key className="bg-[color-mix(in_oklab,var(--feedback-success)_25%,transparent)]" label={`Published · ${totals.published}`} />
        <Key className="bg-[color-mix(in_oklab,var(--feedback-error)_25%,transparent)]" label={`Late · ${totals.late}`} />
        <Key className="bg-bg-active" label={`Still to come · ${totals.due}`} />
        <Key
          className="bg-[repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_oklab,var(--feedback-warning)_35%,transparent)_3px_6px)]"
          label="Rhythm wanted a post, nothing filed"
        />
        <span className="ml-auto inline-flex items-center gap-1">
          <CalendarCheck className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          {plan.staticPosts} posts and {plan.reels} reels agreed this month
        </span>
      </div>
    </div>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn('size-3 rounded-[4px]', className)} />
      {label}
    </span>
  );
}

/* ----------------------------------------------------------------------------
 * ONE POST
 * ----------------------------------------------------------------------------
 * ⚠️ AN ANCHOR WHEN IT IS PUBLISHED, A DIV WHEN IT IS NOT. A published post has a
 * live URL and clicking it should go there; a planned one has nowhere to go, and
 * rendering it as a link that does nothing is the thing that makes people stop
 * trusting the links that do work.
 * ------------------------------------------------------------------------- */
function PostChip({ chip }: { chip: Chip }) {
  const time = clockLabel(chip.time);
  const label = chip.kind ? CONTENT_KIND_LABEL[chip.kind] : 'Post';

  const body = (
    <>
      {chip.platformSlug ? (
        <PlatformIcon slug={chip.platformSlug} size={18} className="shrink-0" />
      ) : (
        /* No platform named yet — planned work. A neutral square keeps the row
           aligned with the ones that have a logo. */
        <span
          aria-hidden="true"
          className="grid size-[18px] shrink-0 place-items-center rounded-[28%] bg-bg-active"
        >
          <Clock className="size-3 text-text-tertiary" strokeWidth={2.5} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-micro font-semibold text-text-primary">{label}</span>
        {time && <span className="block text-micro text-text-tertiary">{time}</span>}
      </span>
      {chip.url && (
        <ExternalLink
          className="size-3 shrink-0 text-text-tertiary"
          strokeWidth={2.5}
          aria-hidden="true"
        />
      )}
    </>
  );

  const shell = cn(
    'flex items-center gap-1.5 rounded-md border px-1.5 py-1',
    chip.late
      ? 'border-[color-mix(in_oklab,var(--feedback-error)_35%,transparent)] bg-[color-mix(in_oklab,var(--feedback-error)_8%,var(--bg-surface))]'
      : chip.status === 'done'
        ? 'border-border-subtle bg-bg-surface'
        : 'border-dashed border-border-subtle bg-bg-surface',
  );

  /* The full title on hover. The chip shows the KIND, because "Static post" is
     what somebody is scanning for; the title is the detail behind it. */
  const hint = `${chip.title}${time ? ` · ${time}` : ''}${
    chip.late ? ' · late' : chip.status === 'done' ? ' · published' : ' · not yet'
  }`;

  if (chip.url) {
    return (
      <a
        href={chip.url}
        target="_blank"
        /* `noreferrer` as well as `noopener`: a client's public post should not
           receive this CRM's URL as a referrer. */
        rel="noopener noreferrer"
        title={`${hint} — open it`}
        className={cn(shell, 'hover:border-border-strong')}
      >
        {body}
      </a>
    );
  }

  return (
    <div title={hint} className={shell}>
      {body}
    </div>
  );
}
