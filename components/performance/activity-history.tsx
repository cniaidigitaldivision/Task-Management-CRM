'use client';

import * as React from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Download,
  FileSpreadsheet,
  FileText,
  FilePlus2,
  Filter,
  Folder,
  Loader2,
  ListFilter,
  MessageSquare,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  User,
  UserCog,
  Workflow,
  X,
} from 'lucide-react';

import {
  activitySummaryAction,
  exportActivityAction,
  type ActivityFormat,
} from '@/app/actions/performance';
import { FilterPill, Nothing, Panel } from '@/components/performance/performance-ui';
import { Avatar } from '@/components/ui/avatar';
import { downloadBase64 } from '@/lib/browser/download';
import type { ActivitySummary } from '@/lib/ai/narrative';
import type { HistoryEntry } from '@/lib/db/queries/performance';
import {
  KIND_LABEL,
  dayWord,
  eventKind,
  phraseOf,
  statusWord,
  type EventKind,
  type Phrase,
} from '@/lib/view/activity';

/* ============================================================================
 * ACTIVITY HISTORY — the owner's reference, 2026-09-24
 * ----------------------------------------------------------------------------
 * *"I want the activity history tab to be exactly the same as in the reference
 * image ... They are showing some dummy data, obviously, but you will show the
 * exact data properly, logically, and with each and every thing wired up. Use
 * that term we are using in any place you can see that something is out. Don't
 * make things unnecessary; just make them sleek nice and beautiful."*
 *
 * ── ⚠️ WHAT THE REFERENCE DRAWS THAT THIS DOES NOT ────────────────────────
 * Two controls in the mock-up are left out, on the owner's own instruction not
 * to make things unnecessary:
 *
 *   "More filters"  — everything it would hold is already a pill on the row.
 *   "Save view"     — nothing in the database stores a saved view. A button
 *                     that silently forgets is worse than no button; it needs a
 *                     small table, and that is a decision to take, not to
 *                     invent here.
 *
 * The mock-up's date-range pill is also not repeated: the period pill already
 * sits directly above this tab, in the record's own scope row, and reads the
 * same range. One control, one place.
 *
 * ── ⚠️ EVERY FILTER NARROWS WHAT IS ALREADY DRAWN ─────────────────────────
 * Rule Zero. The whole period arrives with the page inside `history`, so
 * changing a pill, typing in the search box, turning a page or regrouping never
 * touches the network. The one control that does is the AI summary, and it says
 * so while it waits.
 * ========================================================================= */

const PAGE_SIZE = 20;

type Grouping = 'day' | 'task';
type Direction = 'all' | 'theirs' | 'others';

interface Look {
  readonly tone: string;
  readonly bg: string;
  readonly icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}

const KIND_LOOK: Readonly<Record<EventKind, Look>> = {
  created: { tone: 'var(--pf-blue)', bg: 'var(--pf-blue-bg)', icon: FilePlus2 },
  status: { tone: 'var(--pf-teal)', bg: 'var(--pf-mint)', icon: RefreshCw },
  edited: { tone: 'var(--pf-violet)', bg: 'var(--pf-violet-chip-bg)', icon: Pencil },
  assigned: { tone: 'var(--pf-violet)', bg: 'var(--pf-violet-chip-bg)', icon: UserCog },
  file: { tone: 'var(--pf-green)', bg: 'var(--pf-green-bg)', icon: Paperclip },
  comment: { tone: 'var(--pf-blue)', bg: 'var(--pf-blue-bg)', icon: MessageSquare },
  placement: { tone: 'var(--pf-green)', bg: 'var(--pf-green-bg)', icon: CheckCircle2 },
  workflow: { tone: 'var(--pf-violet)', bg: 'var(--pf-violet-chip-bg)', icon: Workflow },
  deleted: { tone: 'var(--pf-red-ink)', bg: 'var(--pf-red-bg)', icon: Trash2 },
  project: { tone: 'var(--pf-soft)', bg: 'var(--pf-strip)', icon: Folder },
  people: { tone: 'var(--pf-soft)', bg: 'var(--pf-strip)', icon: User },
  other: { tone: 'var(--pf-mute)', bg: 'var(--pf-strip)', icon: Circle },
};

/**
 * The colour a status chip carries.
 *
 * ⚠️ THE SAME COLOURS AS THE LEDGER. Owner, 2026-09-24: *"status should display
 * all in colors."* A status that is green on the Tasks tab and grey here would
 * teach the reader that the colour means nothing.
 */
const STATUS_LOOK: Readonly<Record<string, { ink: string; bg: string }>> = {
  backlog: { ink: 'var(--pf-violet)', bg: 'var(--pf-violet-chip-bg)' },
  todo: { ink: 'var(--pf-soft)', bg: 'var(--pf-strip)' },
  in_progress: { ink: 'var(--pf-blue)', bg: 'var(--pf-blue-bg)' },
  in_review: { ink: 'var(--pf-amber)', bg: 'var(--pf-amber-bg)' },
  revisions: { ink: 'var(--pf-amber)', bg: 'var(--pf-amber-bg)' },
  blocked: { ink: 'var(--pf-red-ink)', bg: 'var(--pf-red-bg)' },
  done: { ink: 'var(--pf-green)', bg: 'var(--pf-green-bg)' },
  cancelled: { ink: 'var(--pf-mute)', bg: 'var(--pf-strip)' },
};

const statusLook = (word: string) => {
  const key = Object.keys(STATUS_LOOK).find((k) => statusWord(k) === word);
  return key ? STATUS_LOOK[key] : { ink: 'var(--pf-soft)', bg: 'var(--pf-strip)' };
};

/** Where the work came from, in the words the record already uses. */
const SOURCE_WORD: Readonly<Record<HistoryEntry['sourceKind'], string>> = {
  self: 'Self-created',
  coordinator: 'Assigned by a team coordinator',
  admin: 'Assigned by an admin',
  teammate: 'Seeded data',
  unknown: 'Not recorded',
};

const num = (n: number) => n.toLocaleString('en-GB');

/**
 * The day an event happened, in Karachi.
 *
 * ⚠️ NOT `toLocaleDateString('en-GB', { month: 'short' })`. That writes
 * "23 Sept 2026" while the period label two rows above the tab — built from the
 * page's own MONTHS table — writes "21 – 24 Sep 2026". Two spellings of the same
 * month on one screen reads as a bug in the data. `en-CA` is used only to get
 * the Karachi Y-M-D out; `dayWord` then does the writing, the same function the
 * date chips use.
 */
const dayKey = (iso: string) =>
  dayWord(
    new Date(iso).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }),
  ) as string;

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Karachi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const stamp = (iso: string) => `${dayKey(iso)}, ${clock(iso)} PKT`;

/* ── The tab ─────────────────────────────────────────────────────────────── */

export function ActivityHistory({
  history,
  person,
  rangeLabel,
  onOpenTask,
}: {
  history: readonly HistoryEntry[];
  person: { id: string; name: string };
  rangeLabel: string;
  onOpenTask: (taskId: string) => void;
}) {
  const [kind, setKind] = React.useState<string>('all');
  const [actor, setActor] = React.useState<string>('all');
  const [project, setProject] = React.useState<string>('all');
  const [task, setTask] = React.useState<string>('all');
  const [source, setSource] = React.useState<string>('all');
  const [direction, setDirection] = React.useState<Direction>('all');
  const [query, setQuery] = React.useState('');
  const [group, setGroup] = React.useState<Grouping>('day');
  const [page, setPage] = React.useState(0);
  /* `undefined` means nobody has chosen yet, so the first event opens;
     `null` means the reader closed the panel and it stays closed. */
  const [picked, setPicked] = React.useState<string | null | undefined>(undefined);

  /* ⚠️ THE OPTIONS ARE BUILT FROM THE ROWS, NOT FROM A CONSTANT. A dropdown
     offering "Changes requested" on a record that holds none sends somebody
     hunting for rows that do not exist; every option below is present in the
     data, and carries how many. */
  const options = React.useMemo(() => {
    const count = <T,>(pick: (h: HistoryEntry) => T | null) => {
      const seen = new Map<T, number>();
      for (const h of history) {
        const key = pick(h);
        if (key === null) continue;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      return seen;
    };
    return {
      kinds: count((h) => eventKind(h.action)),
      actors: count((h) => h.actorName),
      projects: count((h) => h.projectName),
      tasks: count((h) => h.title),
      sources: count((h) => (h.taskId ? h.sourceKind : null)),
    };
  }, [history]);

  const shown = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return history.filter((h) => {
      if (kind !== 'all' && eventKind(h.action) !== kind) return false;
      if (actor !== 'all' && h.actorName !== actor) return false;
      if (project !== 'all' && h.projectName !== project) return false;
      if (task !== 'all' && h.title !== task) return false;
      if (source !== 'all' && h.sourceKind !== source) return false;
      if (direction === 'theirs' && !h.byThem) return false;
      if (direction === 'others' && h.byThem) return false;
      if (needle) {
        const hay = [h.title, h.reference, h.summary, h.actorName, h.projectName, h.description, h.reason]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [history, kind, actor, project, task, source, direction, query]);

  /* ⚠️ CLAMPED, NOT RESET FROM AN EFFECT. Narrowing a filter shortens the list;
     writing page state from an effect to cope is the cascading render the lint
     rule refuses and a frame the reader can see. */
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const pageRows = shown.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  /* ⚠️ DERIVED. The first event on the page opens by itself — the owner asked
     for exactly this on the Tasks tab and the two must behave alike. */
  const selected =
    picked === null ? null : (pageRows.find((h) => h.id === picked) ?? pageRows[0] ?? null);

  const keyOf = React.useCallback(
    (h: HistoryEntry) => (group === 'day' ? dayKey(h.at) : (h.title ?? 'Not a task')),
    [group],
  );

  /* ⚠️ THE HEADER COUNTS THE DAY, NOT THE PAGE. Counting the rows underneath
     it made "23 Sep 2026 · 12 events" appear on a day that actually held 40 —
     the other 28 were simply on page two. A figure on this page that changes
     when you turn a page is a wrong figure, so the total comes from the whole
     filtered set and the header says when it is showing only part of it. */
  const totals = React.useMemo(() => {
    const out = new Map<string, number>();
    for (const h of shown) out.set(keyOf(h), (out.get(keyOf(h)) ?? 0) + 1);
    return out;
  }, [shown, keyOf]);

  const groups = React.useMemo(() => {
    const out = new Map<string, HistoryEntry[]>();
    for (const h of pageRows) out.set(keyOf(h), [...(out.get(keyOf(h)) ?? []), h]);
    return [...out.entries()];
  }, [pageRows, keyOf]);

  /* ⚠️ THE EXPORT SAYS WHAT IT LEFT OUT. A colleague handed 40 events out of
     109 with nothing on the sheet saying so reads it as the whole record — and
     the record is about a named person. */
  const filterWords = [
    kind !== 'all' ? `Event type: ${KIND_LABEL[kind as EventKind]}` : null,
    actor !== 'all' ? `Actor: ${actor}` : null,
    project !== 'all' ? `Project: ${project}` : null,
    task !== 'all' ? `Task: ${task}` : null,
    source !== 'all' ? `Source: ${SOURCE_WORD[source as HistoryEntry['sourceKind']]}` : null,
    direction === 'theirs'
      ? `Only actions by ${person.name}`
      : direction === 'others'
        ? 'Only actions by somebody else'
        : null,
    query.trim() ? `Search: “${query.trim()}”` : null,
  ].filter(Boolean) as string[];

  return (
    <div>
      {/* ── The filters ──────────────────────────────────────────────────── */}
      <div className="mb-[0.75rem] flex flex-wrap items-center gap-[0.7rem]">
        <FilterPill
          icon={ListFilter}
          title="Event type"
          label={kind === 'all' ? 'Event type: All' : KIND_LABEL[kind as EventKind]}
          value={kind}
          options={[
            { value: 'all', label: `Event type: All (${num(history.length)})` },
            ...[...options.kinds.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => ({ value: k as string, label: `${KIND_LABEL[k]} (${num(n)})` })),
          ]}
          onChange={(v) => {
            setKind(v);
            setPage(0);
          }}
        />
        <FilterPill
          icon={User}
          title="Actor"
          label={actor === 'all' ? 'Actor: All' : actor}
          value={actor}
          options={[
            { value: 'all', label: 'Actor: All' },
            ...[...options.actors.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([name, n]) => ({ value: name, label: `${name} (${num(n)})` })),
          ]}
          onChange={(v) => {
            setActor(v);
            setPage(0);
          }}
        />
        <FilterPill
          icon={Folder}
          title="Project"
          label={project === 'all' ? 'Project: All' : project}
          value={project}
          options={[
            { value: 'all', label: 'Project: All' },
            ...[...options.projects.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([name, n]) => ({ value: name, label: `${name} (${num(n)})` })),
          ]}
          onChange={(v) => {
            setProject(v);
            setPage(0);
          }}
        />
        <FilterPill
          icon={Filter}
          title="Task"
          label={task === 'all' ? 'Task: All' : task}
          value={task}
          options={[
            { value: 'all', label: 'Task: All' },
            ...[...options.tasks.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([name, n]) => ({ value: name, label: `${name} (${num(n)})` })),
          ]}
          onChange={(v) => {
            setTask(v);
            setPage(0);
          }}
        />
        <FilterPill
          icon={UserCog}
          title="Source"
          label={source === 'all' ? 'Source: All' : SOURCE_WORD[source as HistoryEntry['sourceKind']]}
          value={source}
          options={[
            { value: 'all', label: 'Source: All' },
            ...[...options.sources.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => ({
                value: k as string,
                label: `${SOURCE_WORD[k as HistoryEntry['sourceKind']]} (${num(n)})`,
              })),
          ]}
          onChange={(v) => {
            setSource(v);
            setPage(0);
          }}
        />
        {/* ⚠️ THE ONE FILTER THE REFERENCE DOES NOT DRAW, AND THE MOST USEFUL.
            This feed now holds what was done TO their work as well as what they
            did; a manager asking "what did he do himself" needs to say so. */}
        <FilterPill
          icon={RefreshCw}
          title="Whose action"
          label={
            direction === 'all'
              ? 'All history'
              : direction === 'theirs'
                ? `By ${firstName(person.name)}`
                : 'On their work'
          }
          value={direction}
          options={[
            { value: 'all', label: 'All history' },
            { value: 'theirs', label: `By ${firstName(person.name)}` },
            { value: 'others', label: 'On their work, by somebody else' },
          ]}
          onChange={(v) => {
            setDirection(v as Direction);
            setPage(0);
          }}
        />
      </div>

      {/* ── Search, and how the days are grouped ─────────────────────────── */}
      <div className="mb-[1.1rem] flex flex-wrap items-center gap-[0.8rem]">
        <span
          className="relative flex min-w-[16rem] flex-1 items-center gap-[0.6rem] rounded-[0.7rem] border px-[0.85rem] py-[0.72rem]"
          style={{
            background: 'var(--pf-field)',
            borderColor: 'var(--pf-field-line)',
            boxShadow: 'var(--pf-shadow)',
          }}
        >
          <Search className="size-[0.95rem] shrink-0" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search tasks, projects or changes…"
            aria-label="Search this history"
            className="min-w-0 flex-1 bg-transparent text-[0.86rem] leading-none outline-none"
            style={{ color: 'var(--pf-ink)' }}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear the search"
              className="shrink-0"
            >
              <X className="size-[0.95rem]" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
            </button>
          )}
        </span>

        <span className="flex items-center gap-[0.6rem]">
          <span className="text-[0.84rem]" style={{ color: 'var(--pf-soft)' }}>
            Group by
          </span>
          <span
            className="inline-flex rounded-[0.7rem] border p-[0.2rem]"
            style={{ background: 'var(--pf-field)', borderColor: 'var(--pf-field-line)' }}
          >
            {(['day', 'task'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGroup(g)}
                aria-pressed={group === g}
                className="rounded-[0.5rem] px-[1.1rem] py-[0.5rem] text-[0.84rem] font-semibold leading-none"
                style={{
                  background: group === g ? 'var(--pf-mint)' : 'transparent',
                  color: group === g ? 'var(--pf-teal)' : 'var(--pf-soft)',
                }}
              >
                {g === 'day' ? 'Day' : 'Task'}
              </button>
            ))}
          </span>
        </span>
      </div>

      {/* ── The events, and the one in hand ──────────────────────────────── */}
      <div className="grid items-start gap-[1.1rem] min-[1500px]:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <Panel
          title="Activity history"
          description={`Who did what, when, and the exact change made. ${rangeLabel}, times in PKT.`}
        >
          {shown.length === 0 ? (
            <Nothing>
              {history.length === 0
                ? `Nothing is recorded against ${firstName(person.name)} in this period. The log holds task creation, status moves, edits, files, comments and reassignments — widen the period above to see more.`
                : `None of the ${num(history.length)} events in this period match these filters.`}
            </Nothing>
          ) : (
            <>
              <div className="border-t" style={{ borderColor: 'var(--pf-grid)' }}>
                {groups.map(([label, list]) => (
                  <section key={label}>
                    <h3
                      className="flex flex-wrap items-baseline gap-[0.6rem] border-b px-[1.22rem] py-[0.6rem] text-[0.86rem] font-bold"
                      style={{
                        background: 'var(--pf-head)',
                        borderColor: 'var(--pf-grid)',
                        color: 'var(--pf-ink)',
                      }}
                    >
                      <span className="min-w-0 truncate">{label}</span>
                      <span className="font-normal" style={{ color: 'var(--pf-mute)' }}>
                        {(totals.get(label) ?? list.length) > list.length
                          ? `${num(list.length)} of ${num(totals.get(label) ?? 0)} events`
                          : `${num(list.length)} event${list.length === 1 ? '' : 's'}`}
                      </span>
                    </h3>
                    <ol className="relative">
                      {/* The rail behind the dots — one element, so no hairline
                          gap appears between rows. */}
                      {list.length > 1 && (
                        /* ⚠️ 1.495rem IS THE DOT'S CENTRE, not a guess: the row
                           is padded 1.22rem and the dot is 0.55rem wide, so its
                           middle is 1.22 + 0.275. At 1.64rem the line ran 2px to
                           the right of every dot and read as a stray border. */
                        <span
                          aria-hidden="true"
                          className="absolute left-[1.495rem] w-px"
                          style={{ background: 'var(--pf-mint-line)', top: '1.4rem', bottom: '1.4rem', width: '1.5px' }}
                        />
                      )}
                      {list.map((h) => (
                        <EventRow
                          key={h.id}
                          event={h}
                          on={selected?.id === h.id}
                          onPick={() => setPicked(h.id)}
                          onOpenTask={onOpenTask}
                        />
                      ))}
                    </ol>
                  </section>
                ))}
              </div>

              <div
                className="flex flex-wrap items-center gap-[0.7rem] border-t px-[1.22rem] py-[0.85rem]"
                style={{ borderColor: 'var(--pf-grid)' }}
              >
                <span className="text-[0.84rem]" style={{ color: 'var(--pf-soft)' }}>
                  Showing {num(current * PAGE_SIZE + 1)}–{num(current * PAGE_SIZE + pageRows.length)} of{' '}
                  {num(shown.length)} event{shown.length === 1 ? '' : 's'}
                  {shown.length !== history.length ? ` (${num(history.length)} in the period)` : ''}
                </span>

                <span className="ml-auto flex items-center gap-[0.4rem]">
                  <Pager
                    label="Previous page"
                    icon={ChevronLeft}
                    onClick={() => setPage(current - 1)}
                    disabled={current === 0}
                  />
                  <span
                    className="px-[0.5rem] text-[0.84rem] tabular-nums"
                    style={{ color: 'var(--pf-ink)' }}
                  >
                    {current + 1} of {pages}
                  </span>
                  <Pager
                    label="Next page"
                    icon={ChevronRight}
                    onClick={() => setPage(current + 1)}
                    disabled={current >= pages - 1}
                  />
                </span>

                <ExportMenu
                  personId={person.id}
                  eventIds={shown.map((h) => h.id)}
                  filters={filterWords}
                  periodLabel={rangeLabel}
                  totalInPeriod={history.length}
                />
              </div>
            </>
          )}
        </Panel>

        <EventPanel
          event={selected}
          person={person}
          shown={shown}
          onClose={() => setPicked(null)}
          onOpenTask={onOpenTask}
        />
      </div>
    </div>
  );
}

const firstName = (name: string) => name.trim().split(/\s+/)[0];

/* ── One event ───────────────────────────────────────────────────────────── */

function EventRow({
  event,
  on,
  onPick,
  onOpenTask,
}: {
  event: HistoryEntry;
  on: boolean;
  onPick: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const p = phraseOf(event);
  const look = KIND_LOOK[eventKind(event.action)];

  return (
    <li
      /* ⚠️ THE WHOLE ROW OPENS, because the whole row highlights. The guard is
         the pattern in CLAUDE.md: a control inside the row keeps its own job. */
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a')) return;
        onPick();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-current={on}
      className="relative flex cursor-pointer flex-wrap items-center gap-x-[0.65rem] gap-y-[0.35rem] border-b py-[0.62rem] pl-[1.22rem] pr-[0.9rem] last:border-b-0"
      style={{
        borderColor: 'var(--pf-grid)',
        /* Owner, on the Tasks tab: *"that row turns light green."* Same here. */
        background: on ? 'var(--pf-mint)' : 'transparent',
        boxShadow: on ? 'inset 3px 0 0 0 var(--pf-teal)' : undefined,
      }}
    >
      <span
        aria-hidden="true"
        className="relative z-10 size-[0.55rem] shrink-0 rounded-full ring-2"
        style={{
          background: look.tone,
          ['--tw-ring-color' as string]: on ? 'var(--pf-mint)' : 'var(--pf-surface)',
        }}
      />
      <span
        className="w-[2.9rem] shrink-0 text-[0.82rem] tabular-nums"
        style={{ color: 'var(--pf-soft)' }}
      >
        {clock(event.at)}
      </span>

      <span className="flex min-w-0 shrink-0 items-center gap-[0.45rem]">
        <Avatar name={event.actorName ?? 'Unknown'} src={event.actorAvatarUrl} size="xs" />
        {/* ⚠️ aria-hidden: `Avatar` already carries the name in an sr-only
            span, so without this a screen reader says it twice on every row. */}
        <span
          aria-hidden="true"
          className="max-w-[8.5rem] truncate text-[0.85rem] font-semibold"
          style={{ color: 'var(--pf-ink)' }}
        >
          {event.actorName ?? 'Not recorded'}
        </span>
      </span>

      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[0.4rem] gap-y-[0.25rem]">
        <span className="text-[0.85rem]" style={{ color: 'var(--pf-soft)' }}>
          {p.verb}
        </span>
        {event.taskId && event.title ? (
          <button
            type="button"
            onClick={() => onOpenTask(event.taskId as string)}
            title={event.title}
            className="max-w-[20rem] truncate text-[0.85rem] font-semibold underline underline-offset-2"
            style={{ color: 'var(--pf-link)' }}
          >
            {event.title}
          </button>
        ) : (
          <span className="text-[0.85rem]" style={{ color: 'var(--pf-body)' }}>
            {event.summary}
          </span>
        )}
        <Diff phrase={p} />
      </span>

      <button
        type="button"
        onClick={onPick}
        className="ml-auto shrink-0 rounded-[0.55rem] border px-[0.75rem] py-[0.4rem] text-[0.79rem] font-semibold leading-none"
        style={{
          background: on ? 'var(--pf-surface)' : 'var(--pf-field)',
          borderColor: 'var(--pf-field-line)',
          color: 'var(--pf-ink)',
        }}
      >
        Details
      </button>
    </li>
  );
}

/** The before → after pair, or the note that stands in for it. */
function Diff({ phrase }: { phrase: Phrase }) {
  if (phrase.changes.length === 0) {
    return phrase.note ? (
      <span
        className="max-w-[22rem] truncate rounded-full px-[0.6rem] py-[0.2rem] text-[0.78rem]"
        style={{ background: 'var(--pf-strip)', color: 'var(--pf-soft)' }}
        title={phrase.note}
      >
        {phrase.note}
      </span>
    ) : null;
  }

  return (
    <>
      {phrase.changes.map((c) => {
        const to = c.field === 'Status' ? statusLook(c.to ?? '') : null;
        return (
          <span key={c.field} className="flex items-center gap-[0.35rem]">
            {c.from && (
              <>
                <span
                  className="rounded-full px-[0.6rem] py-[0.2rem] text-[0.78rem]"
                  style={{
                    background: c.field === 'Status' ? statusLook(c.from).bg : 'var(--pf-strip)',
                    color: c.field === 'Status' ? statusLook(c.from).ink : 'var(--pf-soft)',
                  }}
                >
                  {c.from}
                </span>
                <ArrowRight
                  className="size-[0.85rem] shrink-0"
                  style={{ color: 'var(--pf-mute)' }}
                  aria-hidden="true"
                />
              </>
            )}
            <span
              className="rounded-full px-[0.6rem] py-[0.2rem] text-[0.78rem] font-semibold"
              style={{
                background: to ? to.bg : 'var(--pf-green-bg)',
                color: to ? to.ink : 'var(--pf-green)',
              }}
            >
              {c.to ?? 'Not set'}
            </span>
          </span>
        );
      })}
    </>
  );
}

function Pager({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-[2rem] place-items-center rounded-[0.6rem] border disabled:opacity-40"
      style={{
        background: 'var(--pf-surface)',
        borderColor: 'var(--pf-field-line)',
        color: 'var(--pf-ink)',
      }}
    >
      <Icon className="size-[1rem]" aria-hidden="true" />
    </button>
  );
}

/* ── The selected event ──────────────────────────────────────────────────── */

function EventPanel({
  event,
  person,
  shown,
  onClose,
  onOpenTask,
}: {
  event: HistoryEntry | null;
  person: { id: string; name: string };
  shown: readonly HistoryEntry[];
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  if (!event) {
    return (
      <aside
        className="rounded-[0.95rem] border px-[1.22rem] py-[2.2rem] text-center"
        style={{
          background: 'var(--pf-surface)',
          borderColor: 'var(--pf-line)',
          boxShadow: 'var(--pf-shadow)',
        }}
      >
        <Circle className="mx-auto size-[1.5rem]" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
        <p className="mt-[0.7rem] text-[0.88rem]" style={{ color: 'var(--pf-soft)' }}>
          Pick an event on the left to see exactly what changed.
        </p>
      </aside>
    );
  }

  const p = phraseOf(event);
  const kindKey = eventKind(event.action);
  const look = KIND_LOOK[kindKey];

  return (
    <aside
      className="overflow-hidden rounded-[0.95rem] border"
      style={{
        background: 'var(--pf-surface)',
        borderColor: 'var(--pf-line)',
        boxShadow: 'var(--pf-shadow)',
      }}
    >
      <div className="flex items-start gap-[0.8rem] px-[1.22rem] pb-[0.5rem] pt-[1.15rem]">
        <h3 className="min-w-0 flex-1 text-[1.15rem] font-bold" style={{ color: 'var(--pf-ink)' }}>
          Selected event
        </h3>
        <button type="button" onClick={onClose} aria-label="Close this event" className="shrink-0">
          <X className="size-[1.05rem]" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
        </button>
      </div>

      <dl className="px-[1.22rem] pb-[0.9rem]">
        <Field label="Type">
          <span className="inline-flex items-center gap-[0.4rem]" style={{ color: look.tone }}>
            <look.icon className="size-[0.9rem] shrink-0" aria-hidden="true" />
            {KIND_LABEL[kindKey]}
          </span>
        </Field>
        <Field label="Actor">
          <span className="inline-flex items-center gap-[0.4rem]">
            <Avatar name={event.actorName ?? 'Unknown'} src={event.actorAvatarUrl} size="xs" />
            <span aria-hidden="true">{event.actorName ?? 'Not recorded'}</span>
            {!event.byThem && (
              <span className="text-[0.78rem]" style={{ color: 'var(--pf-mute)' }}>
                · not {firstName(person.name)}
              </span>
            )}
          </span>
        </Field>
        <Field label="Task">
          {event.taskId && event.title ? (
            <button
              type="button"
              onClick={() => onOpenTask(event.taskId as string)}
              className="text-left underline underline-offset-2"
              style={{ color: 'var(--pf-link)' }}
            >
              {event.title}
            </button>
          ) : (
            <span style={{ color: 'var(--pf-soft)' }}>{event.summary}</span>
          )}
        </Field>
        {event.projectName && <Field label="Project">{event.projectName}</Field>}
        <Field label="Timestamp">{stamp(event.at)}</Field>
        {/* ⚠️ THE REFERENCE PRINTS A REASON ON EVERY ROW. THE PRODUCT ASKS FOR
            ONE ONLY WHEN WORK IS BLOCKED OR CANCELLED, so this says which it is
            rather than inventing a sentence. */}
        <Field label="Reason">
          {event.reason ? (
            <span style={{ color: 'var(--pf-ink)' }}>{event.reason}</span>
          ) : (
            <span style={{ color: 'var(--pf-mute)' }}>
              Not asked for — only blocking and cancelling take a reason
            </span>
          )}
        </Field>
        {event.taskId && (
          <Field label="Source">
            {SOURCE_WORD[event.sourceKind]}
            {event.sourceName && event.sourceKind !== 'self' ? ` · ${event.sourceName}` : ''}
          </Field>
        )}
      </dl>

      {p.changes.length > 0 ? (
        <div className="px-[1.22rem] pb-[0.9rem]">
          {p.changes.map((c) => (
            <div key={c.field} className="mb-[0.55rem] last:mb-0">
              <p className="mb-[0.3rem] text-[0.78rem] font-semibold" style={{ color: 'var(--pf-label)' }}>
                {c.field}
              </p>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-[0.5rem]">
                <span
                  className="rounded-[0.6rem] px-[0.7rem] py-[0.5rem] text-[0.83rem]"
                  style={{ background: 'var(--pf-strip)', color: 'var(--pf-body)' }}
                >
                  {c.from ?? 'Not set'}
                </span>
                <ArrowRight
                  className="size-[0.9rem]"
                  style={{ color: 'var(--pf-mute)' }}
                  aria-hidden="true"
                />
                <span
                  className="rounded-[0.6rem] px-[0.7rem] py-[0.5rem] text-[0.83rem] font-semibold"
                  style={{ background: 'var(--pf-green-bg)', color: 'var(--pf-green)' }}
                >
                  {c.to ?? 'Not set'}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-[1.22rem] pb-[0.9rem] text-[0.84rem]" style={{ color: 'var(--pf-soft)' }}>
          {p.note ?? 'This event records that it happened, and nothing that changed.'}
        </p>
      )}

      {event.description && (
        <div className="px-[1.22rem] pb-[0.9rem]">
          <p className="mb-[0.25rem] text-[0.78rem] font-semibold" style={{ color: 'var(--pf-label)' }}>
            About the task
          </p>
          <p className="text-[0.83rem] leading-[1.5]" style={{ color: 'var(--pf-body)' }}>
            {event.description}
          </p>
        </div>
      )}

      <Legend events={shown} />
      <Summarise person={person} events={shown} />
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-[0.8rem] py-[0.3rem]">
      <dt className="w-[5.5rem] shrink-0 text-[0.83rem]" style={{ color: 'var(--pf-soft)' }}>
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-[0.85rem]" style={{ color: 'var(--pf-ink)' }}>
        {children}
      </dd>
    </div>
  );
}

/**
 * What kinds of event this record actually holds.
 *
 * ⚠️ IT IS A COUNT, NOT A KEY. The reference draws a fixed list of twelve
 * labels; a legend that names event types this person has none of tells the
 * reader nothing. These are the kinds in view, with how many of each.
 */
function Legend({ events }: { events: readonly HistoryEntry[] }) {
  const [open, setOpen] = React.useState(true);

  const counts = React.useMemo(() => {
    const seen = new Map<EventKind, number>();
    for (const e of events) {
      const k = eventKind(e.action);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  if (counts.length === 0) return null;

  return (
    <div className="border-t px-[1.22rem] py-[0.85rem]" style={{ borderColor: 'var(--pf-grid)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-[0.5rem] text-left"
      >
        <span className="min-w-0 flex-1 text-[0.88rem] font-bold" style={{ color: 'var(--pf-ink)' }}>
          Recorded event types
        </span>
        {open ? (
          <ChevronUp className="size-[1rem] shrink-0" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
        ) : (
          <ChevronDown className="size-[1rem] shrink-0" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="mt-[0.6rem] flex flex-wrap gap-[0.4rem]">
          {counts.map(([k, n]) => {
            const look = KIND_LOOK[k];
            return (
              <span
                key={k}
                className="inline-flex items-center gap-[0.4rem] rounded-full px-[0.65rem] py-[0.3rem] text-[0.78rem]"
                style={{ background: look.bg, color: look.tone }}
              >
                <span
                  aria-hidden="true"
                  className="size-[0.45rem] rounded-full"
                  style={{ background: look.tone }}
                />
                {KIND_LABEL[k]}
                <span className="tabular-nums opacity-70">{num(n)}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── The written summary ─────────────────────────────────────────────────── */

function Summarise({
  person,
  events,
}: {
  person: { id: string; name: string };
  events: readonly HistoryEntry[];
}) {
  const [state, setState] = React.useState<
    | { kind: 'idle' }
    | { kind: 'asking' }
    | { kind: 'done'; summary: ActivitySummary }
    | { kind: 'failed'; error: string }
  >({ kind: 'idle' });

  const ask = () => {
    setState({ kind: 'asking' });
    void activitySummaryAction(
      person.id,
      events.slice(0, 120).map((e) => e.id),
    ).then((r) => {
      setState(
        r.ok && r.summary
          ? { kind: 'done', summary: r.summary }
          : { kind: 'failed', error: r.error ?? 'The summary could not be produced.' },
      );
    });
  };

  return (
    <div className="border-t px-[1.22rem] py-[0.95rem]" style={{ borderColor: 'var(--pf-grid)' }}>
      <button
        type="button"
        onClick={ask}
        disabled={state.kind === 'asking' || events.length === 0}
        className="flex w-full items-center justify-center gap-[0.5rem] rounded-[0.75rem] px-[1rem] py-[0.75rem] text-[0.88rem] font-semibold leading-none disabled:opacity-60"
        style={{ background: 'var(--pf-violet)', color: 'var(--pf-on-solid)' }}
      >
        <Sparkles className="size-[1rem]" aria-hidden="true" />
        {state.kind === 'asking' ? 'Reading the events…' : 'Summarise this activity'}
      </button>
      <p className="mt-[0.5rem] text-center text-[0.78rem]" style={{ color: 'var(--pf-mute)' }}>
        {/* ⚠️ IT SAYS WHAT IT WILL READ. "Summarise this activity" over a
            filtered list is ambiguous, and somebody reading a summary of the
            wrong 20 events would not know. */}
        {events.length === 0
          ? 'Nothing is in view to summarise.'
          : `Describes the ${num(Math.min(events.length, 120))} event${
              Math.min(events.length, 120) === 1 ? '' : 's'
            } these filters have in view.`}
      </p>

      {state.kind === 'failed' && (
        <p className="mt-[0.7rem] text-[0.83rem]" style={{ color: 'var(--pf-red-ink)' }}>
          {state.error}
        </p>
      )}

      {state.kind === 'done' && (
        <div className="mt-[0.85rem]">
          <p className="text-[0.92rem] font-bold leading-[1.4]" style={{ color: 'var(--pf-ink)' }}>
            {state.summary.headline}
          </p>
          {state.summary.summary.map((line, i) => (
            <p
              key={i}
              className="mt-[0.5rem] text-[0.85rem] leading-[1.55]"
              style={{ color: 'var(--pf-body)' }}
            >
              {line}
            </p>
          ))}
          {state.summary.pattern.length > 0 && (
            <ul className="mt-[0.7rem] space-y-[0.35rem]">
              {state.summary.pattern.map((line, i) => (
                <li key={i} className="flex gap-[0.5rem] text-[0.84rem]" style={{ color: 'var(--pf-body)' }}>
                  <span aria-hidden="true" style={{ color: 'var(--pf-violet)' }}>
                    •
                  </span>
                  <span className="min-w-0 flex-1">{line}</span>
                </li>
              ))}
            </ul>
          )}
          {/* ⚠️ THE CHECK IS SHOWN, NOT SWALLOWED. `verifyFigures` reads the
              reply back against the events it was given; a number it could not
              find is reported here rather than quietly printed as fact. */}
          {state.summary.unverifiedFigures.length > 0 && (
            <p className="mt-[0.7rem] text-[0.8rem]" style={{ color: 'var(--pf-amber)' }}>
              These figures are not in the events the model was given, so do not rely on them:{' '}
              {state.summary.unverifiedFigures.join(', ')}.
            </p>
          )}
          <p className="mt-[0.6rem] text-[0.76rem]" style={{ color: 'var(--pf-mute)' }}>
            Written by {state.summary.model} from the events above. It was given no figure it did not
            read from this record.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── The export drop-up ──────────────────────────────────────────────────── */

const FORMATS: ReadonlyArray<{
  key: ActivityFormat;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}> = [
  {
    key: 'pdf',
    label: 'PDF',
    hint: 'The CNI sheet, for printing or sending on',
    icon: FileText,
  },
  {
    key: 'xlsx',
    label: 'Excel',
    hint: 'A workbook, with the filters on a second sheet',
    icon: FileSpreadsheet,
  },
  { key: 'csv', label: 'CSV', hint: 'Plain rows, for anything that reads them', icon: Download },
];

/**
 * Three formats behind one button.
 *
 * ⚠️ IT OPENS UPWARDS. The button sits on the last row of a long panel, so a
 * menu dropping down would open below the fold and read as nothing happening —
 * which is exactly how the export dialog failed on this page once already.
 *
 * ⚠️ AND IT IS `absolute`, NOT `fixed`. `.perf-ui` runs a reveal animation that
 * ends on `transform: none` with `fill-mode: both`, leaving an identity matrix
 * on an ancestor — and a transformed ancestor traps `position: fixed`. That is
 * the same trap, and this is why the menu is positioned within its own row.
 */
function ExportMenu({
  personId,
  eventIds,
  filters,
  periodLabel,
  totalInPeriod,
}: {
  personId: string;
  eventIds: readonly string[];
  filters: readonly string[];
  periodLabel: string;
  totalInPeriod: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<ActivityFormat | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const box = React.useRef<HTMLSpanElement>(null);

  /* Clicking anywhere else, or pressing Escape, closes it. */
  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const run = (format: ActivityFormat) => {
    setBusy(format);
    setError(null);
    void exportActivityAction({
      personId,
      eventIds: [...eventIds],
      format,
      filters: [...filters],
      periodLabel,
      totalInPeriod,
    }).then((r) => {
      setBusy(null);
      if (!r.ok || !r.base64 || !r.fileName || !r.mime) {
        setError(r.error ?? 'That export could not be made.');
        return;
      }
      downloadBase64(r.fileName, r.base64, r.mime);
      setOpen(false);
    });
  };

  return (
    <span ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={eventIds.length === 0}
        className="inline-flex items-center gap-[0.5rem] rounded-[0.7rem] border px-[0.95rem] py-[0.6rem] text-[0.84rem] font-semibold leading-none disabled:opacity-50"
        style={{
          background: 'var(--pf-surface)',
          borderColor: 'var(--pf-field-line)',
          color: 'var(--pf-ink)',
        }}
      >
        {busy ? (
          <Loader2 className="size-[0.95rem] animate-spin" aria-hidden="true" />
        ) : (
          <Download className="size-[0.95rem]" aria-hidden="true" />
        )}
        {busy ? 'Building the file…' : 'Export filtered history'}
        <ChevronUp
          className="size-[0.9rem]"
          style={{ color: 'var(--pf-mute)', transform: open ? 'rotate(180deg)' : undefined }}
          aria-hidden="true"
        />
      </button>

      {open && (
        <span
          role="menu"
          className="absolute bottom-[calc(100%+0.45rem)] right-0 z-20 w-[17.5rem] overflow-hidden rounded-[0.8rem] border"
          style={{
            background: 'var(--pf-surface)',
            borderColor: 'var(--pf-line)',
            boxShadow: '0 12px 28px -8px rgb(0 0 0 / 0.28)',
          }}
        >
          {FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="menuitem"
              onClick={() => run(f.key)}
              disabled={busy !== null}
              className="flex w-full items-start gap-[0.6rem] border-b px-[0.85rem] py-[0.65rem] text-left last:border-b-0 disabled:opacity-50"
              style={{ borderColor: 'var(--pf-grid)' }}
            >
              <f.icon
                className="mt-[0.1rem] size-[1rem] shrink-0"
                style={{ color: 'var(--pf-teal)' }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span
                  className="block text-[0.85rem] font-semibold leading-none"
                  style={{ color: 'var(--pf-ink)' }}
                >
                  {f.label}
                </span>
                <span
                  className="mt-[0.22rem] block text-[0.76rem] leading-[1.35]"
                  style={{ color: 'var(--pf-mute)' }}
                >
                  {f.hint}
                </span>
              </span>
            </button>
          ))}
          <span
            className="block px-[0.85rem] py-[0.55rem] text-[0.74rem]"
            style={{ background: 'var(--pf-head)', color: 'var(--pf-soft)' }}
          >
            {/* ⚠️ THE COUNT IS THE FILTERED SET, NOT THE PAGE. */}
            {eventIds.length.toLocaleString('en-GB')} event
            {eventIds.length === 1 ? '' : 's'}
            {filters.length > 0 ? `, filtered by ${filters.length} rule${filters.length === 1 ? '' : 's'}` : ''}
          </span>
        </span>
      )}

      {error && (
        <span
          className="absolute bottom-[calc(100%+0.45rem)] right-0 z-20 w-[17.5rem] rounded-[0.7rem] border px-[0.8rem] py-[0.6rem] text-[0.8rem]"
          style={{
            background: 'var(--pf-surface)',
            borderColor: 'var(--pf-red)',
            color: 'var(--pf-red-ink)',
          }}
        >
          {error}
        </span>
      )}
    </span>
  );
}
