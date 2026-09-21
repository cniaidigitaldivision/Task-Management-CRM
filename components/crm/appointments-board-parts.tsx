'use client';

import * as React from 'react';
import {
  ArrowRight,
  Bookmark,
  Building2,
  CalendarCheck2,
  CalendarDays,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  MoreHorizontal,
  Phone,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';

import {
  karachiDay,
  NO_FILTERS,
  presetViews,
  sameFilters,
  STATUS_LOOK,
  weekOf,
  type BoardFilters,
  type DisplayStatus,
  type SavedView,
  type Tone,
} from '@/lib/domain/crm-appointment-board';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE APPOINTMENTS PAGE'S PIECES — drawn from the owner's design, 2026-09-21
 * ----------------------------------------------------------------------------
 * ⚠️ EVERY COLOUR IS A THEME TOKEN MIXED WITH THE SURFACE, so light and dark
 * both hold. Ink on a tint is the token darkened toward the text colour — a
 * bare feedback token as text fails contrast in the light theme
 * (chart-tokens-fail-as-text).
 * ========================================================================= */

const TOKEN: Record<Tone, string> = {
  green: 'var(--feedback-success)',
  amber: 'var(--feedback-warning)',
  /* ⚠️ NOT --feedback-info: in this theme it is the brand teal, and "blue"
     cards and pills read as grey. The channel blue is the one blue we have. */
  blue: 'var(--channel-email)',
  red: 'var(--feedback-error)',
  grey: 'var(--text-secondary)',
  gold: 'var(--accent-gold)',
};

export const tint = (tone: Tone, pct: number) => `color-mix(in oklab, ${TOKEN[tone]} ${pct}%, var(--bg-surface))`;
export const ink = (tone: Tone) => `color-mix(in oklab, ${TOKEN[tone]} 72%, var(--text-primary))`;

const STATUS_ICON: Record<DisplayStatus, React.ComponentType<{ className?: string }>> = {
  needs_recording: Clock3,
  confirmed: CheckCircle2,
  awaiting: Clock3,
  scheduled: CircleDot,
  completed: CheckCircle2,
  cancelled: XCircle,
  no_show: XCircle,
};

export function StatusPill({ status, className }: { status: DisplayStatus; className?: string }) {
  const look = STATUS_LOOK[status];
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold leading-tight',
        className,
      )}
      style={{ background: tint(look.tone, 14), color: ink(look.tone) }}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{look.label}</span>
    </span>
  );
}

export const KIND_ICON: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  site_visit: Car,
  office_visit: Building2,
  meeting: Users,
  call: Phone,
};

/* ── The four cards ──────────────────────────────────────────────────────── */

export function StatCard({
  label,
  count,
  tone,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone: Tone;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    /* ⚠️ COLOURFUL ON PURPOSE. Owner, 2026-09-21: *"the above cards … should
       all be colorful, like green, orange, yellow … so they are more visible."*
       A solid badge in the card's own colour, a tinted wash, and the count in
       the colour's ink — each card readable at a glance, in both themes. */
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      /* ⚠️ THE BORDER IS THE SELECTION, AND NOTHING ELSE. Owner, 2026-09-21:
         *"when a card is selected, its border color should be added. Otherwise
         no border color should be added and it will be easier to observe which
         card is open."* So an unselected card has no coloured edge at all, and
         the selected one has its own colour, solid — plus a lift. */
      className={cn(
        'flex items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left transition-[box-shadow,transform,border-color] hover:-translate-y-px',
        active ? '-translate-y-px shadow-md' : 'border-transparent shadow-sm hover:shadow-md',
      )}
      style={{
        background: `linear-gradient(135deg, ${tint(tone, 22)} 0%, ${tint(tone, 8)} 100%)`,
        ...(active ? { borderColor: TOKEN[tone] } : null),
      }}
    >
      <span className="grid size-12 shrink-0 place-items-center rounded-xl shadow-sm" style={{ background: TOKEN[tone] }}>
        <Icon className="size-6" style={{ color: 'white' }} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-body-sm font-semibold" style={{ color: ink(tone) }}>{label}</span>
        <span className="block text-[1.75rem] font-bold leading-tight tabular-nums" style={{ color: ink(tone) }}>{count}</span>
      </span>
    </button>
  );
}

/* ── A popover that closes on an outside click or Escape ─────────────────── */

function usePopover() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const CONTROL =
  'inline-flex h-10 items-center gap-2 rounded-xl border border-border-default bg-bg-surface px-3 text-body-sm text-text-primary transition-colors hover:border-border-strong';

/* ── Select date range ───────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

export function DateRangeButton({
  from,
  to,
  nowMs,
  onChange,
}: {
  from: string;
  to: string;
  nowMs: number;
  onChange: (from: string, to: string) => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const today = karachiDay(nowMs);
  const week = weekOf(today);
  const plus = (n: number) => karachiDay(nowMs + n * 86_400_000);
  const monthStart = `${today.slice(0, 8)}01`;
  const monthEnd = (() => {
    const d = new Date(`${monthStart}T00:00:00Z`);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  })();
  const label = from || to ? `${from ? day(from) : 'Any'} – ${to ? day(to) : 'Any'}` : 'Select date range';
  const shortcuts: ReadonlyArray<[string, string, string]> = [
    ['Today', today, today],
    ['Tomorrow', plus(1), plus(1)],
    ['This week', week.from, week.to],
    ['Next 7 days', today, plus(7)],
    ['This month', monthStart, monthEnd],
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(CONTROL, 'w-full min-w-0 justify-start', (from || to) && 'border-[var(--pick-border)]')}
      >
        <CalendarDays className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
        <span className={cn('truncate', !(from || to) && 'text-text-secondary')}>{label}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-border-subtle bg-bg-surface p-3 shadow-lg">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-caption text-text-secondary">
              From
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => onChange(e.target.value, to)}
                className="mt-1 w-full rounded-lg border border-border-default bg-bg-base px-2 py-1.5 text-body-sm text-text-primary"
              />
            </label>
            <label className="block text-caption text-text-secondary">
              To
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => onChange(from, e.target.value)}
                className="mt-1 w-full rounded-lg border border-border-default bg-bg-base px-2 py-1.5 text-body-sm text-text-primary"
              />
            </label>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {shortcuts.map(([name, a, b]) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onChange(a, b);
                  setOpen(false);
                }}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-caption font-medium',
                  from === a && to === b
                    ? 'border-[var(--pick-border)] bg-[var(--pick-bg)] text-text-primary'
                    : 'border-border-default text-text-secondary hover:text-text-primary',
                )}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-between">
            <button
              type="button"
              onClick={() => {
                onChange('', '');
                setOpen(false);
              }}
              className="text-caption font-medium text-text-secondary hover:text-text-primary"
            >
              Clear
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-caption font-semibold text-text-brand">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Saved views ─────────────────────────────────────────────────────────── */

const VIEWS_KEY = 'crm.appointments.views.v1';

function readViews(): SavedView[] {
  try {
    const raw = window.localStorage.getItem(VIEWS_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedView[]) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.name === 'string' && v.filters) : [];
  } catch {
    return [];
  }
}

function writeViews(views: SavedView[]) {
  try {
    window.localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
  } catch {
    /* A browser that will not store it still applies the view now. */
  }
}

/**
 * Presets everyone has, plus the person's own saved in THIS browser.
 *
 * ⚠️ READ WHEN THE MENU OPENS, never during render: localStorage is not on the
 * server, and a label that differed between the two renders is a hydration
 * error.
 */
export function SavedViewPicker({
  filters,
  nowMs,
  onApply,
}: {
  filters: BoardFilters;
  nowMs: number;
  onApply: (f: BoardFilters) => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const [mine, setMine] = React.useState<SavedView[]>([]);
  const [name, setName] = React.useState('');
  const presets = presetViews(nowMs);
  const current = [...presets, ...mine].find((v) => sameFilters(v.filters, filters));
  const label = current && !sameFilters(filters, NO_FILTERS) ? current.name : 'Saved view';

  const toggle = () => {
    if (!open) setMine(readViews());
    setOpen(!open);
  };
  const save = () => {
    const n = name.trim();
    if (!n) return;
    const next = [...mine.filter((v) => v.name.toLowerCase() !== n.toLowerCase()), { id: `v${Date.now()}`, name: n, filters }];
    setMine(next);
    writeViews(next);
    setName('');
  };
  const remove = (id: string) => {
    const next = mine.filter((v) => v.id !== id);
    setMine(next);
    writeViews(next);
  };

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={toggle} aria-expanded={open} className={cn(CONTROL, 'w-full min-w-0 justify-between')}>
        <span className={cn('truncate', label === 'Saved view' && 'text-text-secondary')}>{label}</span>
        <ChevronDown className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-border-subtle bg-bg-surface p-2 shadow-lg">
          <p className="px-2 pb-1 pt-0.5 text-micro font-semibold uppercase tracking-wide text-text-tertiary">Views</p>
          {presets.map((v) => (
            <ViewRow key={v.id} view={v} active={sameFilters(v.filters, filters)} onPick={() => { onApply(v.filters); setOpen(false); }} />
          ))}
          {mine.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-micro font-semibold uppercase tracking-wide text-text-tertiary">Yours</p>
              {mine.map((v) => (
                <ViewRow
                  key={v.id}
                  view={v}
                  active={sameFilters(v.filters, filters)}
                  onPick={() => { onApply(v.filters); setOpen(false); }}
                  onRemove={() => remove(v.id)}
                />
              ))}
            </>
          )}
          <div className="mt-2 flex gap-1.5 border-t border-border-subtle px-1 pt-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              maxLength={40}
              placeholder="Save these filters as…"
              className="min-w-0 flex-1 rounded-lg border border-border-default bg-bg-base px-2 py-1.5 text-caption text-text-primary placeholder:text-text-tertiary"
            />
            <button
              type="button"
              disabled={!name.trim()}
              onClick={save}
              className="inline-flex items-center gap-1 rounded-lg bg-accent-primary px-2.5 text-caption font-semibold text-white disabled:opacity-40"
            >
              <Bookmark className="size-3.5" aria-hidden="true" /> Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewRow({
  view,
  active,
  onPick,
  onRemove,
}: {
  view: SavedView;
  active: boolean;
  onPick: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="group flex items-center rounded-lg hover:bg-bg-subtle">
      <button type="button" onClick={onPick} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-body-sm text-text-primary">
        <Check className={cn('size-3.5 shrink-0', active ? 'text-text-brand' : 'invisible')} aria-hidden="true" />
        <span className="truncate">{view.name}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Delete the view ${view.name}`}
          className="mr-1 grid size-7 place-items-center rounded-md text-text-tertiary hover:text-feedback-error"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* ── The row's "…" menu ──────────────────────────────────────────────────── */

export interface MenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}

export function RowMenu({ items, label }: { items: readonly MenuItem[]; label: string }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={label}
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-lg border border-border-subtle bg-bg-surface text-text-secondary transition-colors hover:border-border-default hover:text-text-primary"
      >
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-border-subtle bg-bg-surface p-1 shadow-lg">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={cn(
                'block w-full rounded-lg px-2.5 py-1.5 text-left text-body-sm transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
                it.danger ? 'text-feedback-error' : 'text-text-primary',
              )}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── The calendar view — a month ─────────────────────────────────────────── */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface CalendarItem {
  readonly id: string;
  readonly day: string;
  readonly time: string;
  readonly who: string;
  readonly status: DisplayStatus;
}

export function CalendarMonth({
  items,
  month,
  today,
  selectedId,
  onMonth,
  onPick,
  onDay,
}: {
  items: readonly CalendarItem[];
  /** "2026-09" */
  month: string;
  today: string;
  selectedId: string | null;
  onMonth: (month: string) => void;
  onPick: (id: string) => void;
  onDay: (day: string) => void;
}) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const start = Date.UTC(y, m - 1, 1 - lead);
  const cells = Array.from({ length: 42 }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  const byDay = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const list = byDay.get(it.day);
    if (list) list.push(it);
    else byDay.set(it.day, [it]);
  }
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    onMonth(d.toISOString().slice(0, 7));
  };

  return (
    <div>
      <div className="flex items-center gap-2 px-5 pb-3">
        <h3 className="text-body font-semibold text-text-primary">
          {LONG_MONTHS[m - 1]} {y}
        </h3>
        <span className="flex-1" />
        <button type="button" onClick={() => onMonth(today.slice(0, 7))} className="rounded-lg border border-border-default px-2.5 py-1 text-caption font-medium text-text-primary hover:bg-bg-subtle">
          Today
        </button>
        <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="grid size-8 place-items-center rounded-lg border border-border-default hover:bg-bg-subtle">
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Next month" onClick={() => shift(1)} className="grid size-8 place-items-center rounded-lg border border-border-default hover:bg-bg-subtle">
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 border-t border-border-subtle">
        {WEEKDAYS.map((w) => (
          <div key={w} className="border-b border-border-subtle bg-bg-subtle/50 px-2 py-1.5 text-caption font-semibold text-text-secondary">
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          const list = byDay.get(d) ?? [];
          const inMonth = d.slice(0, 7) === month;
          return (
            <div
              key={d}
              className={cn(
                'min-h-[6.25rem] border-b border-border-subtle p-1.5',
                i % 7 !== 6 && 'border-r',
                !inMonth && 'bg-bg-subtle/40',
              )}
            >
              <button
                type="button"
                onClick={() => onDay(d)}
                title="Show this day in the list"
                className={cn(
                  'mb-1 grid size-6 place-items-center rounded-full text-caption font-semibold',
                  d === today ? 'bg-accent-primary text-white' : inMonth ? 'text-text-primary hover:bg-bg-subtle' : 'text-text-tertiary',
                )}
              >
                {Number(d.slice(8, 10))}
              </button>
              <div className="space-y-1">
                {list.slice(0, 3).map((it) => {
                  const look = STATUS_LOOK[it.status];
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => onPick(it.id)}
                      title={`${it.time} · ${it.who} · ${look.label}`}
                      className={cn(
                        'block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[0.72rem] font-medium leading-snug',
                        it.id === selectedId && 'ring-1 ring-[var(--pick-border)]',
                      )}
                      style={{ background: tint(look.tone, 16), color: ink(look.tone) }}
                    >
                      {it.time} · {it.who}
                    </button>
                  );
                })}
                {list.length > 3 && (
                  <button type="button" onClick={() => onDay(d)} className="block px-1.5 text-[0.72rem] font-medium text-text-secondary hover:text-text-primary">
                    +{list.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── The last recorded outcome ───────────────────────────────────────────── */

export interface OutcomeStep {
  readonly title: string;
  readonly detail: string;
  readonly when?: string | null;
  readonly tone: Tone;
  readonly icon: 'check' | 'people' | 'calendar' | 'cross' | 'clock';
}

const STEP_ICON = { check: Check, people: Users, calendar: CalendarCheck2, cross: XCircle, clock: Clock3 } as const;

export function OutcomeStrip({ steps }: { steps: readonly OutcomeStep[] }) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-stretch">
      {steps.map((s, i) => {
        const Icon = STEP_ICON[s.icon];
        return (
          <React.Fragment key={s.title}>
            {i > 0 && (
              <span className="hidden shrink-0 items-center self-center text-text-tertiary md:flex" aria-hidden="true">
                <ArrowRight className="size-4" />
              </span>
            )}
            <div className="flex min-w-0 flex-1 items-center gap-3.5 rounded-xl px-4 py-3.5" style={{ background: tint(s.tone, 8) }}>
              <span className="grid size-11 shrink-0 place-items-center rounded-full" style={{ background: tint(s.tone, 18) }}>
                <Icon className="size-5" style={{ color: ink(s.tone) }} />
              </span>
              <span className="min-w-0">
                <span className="block text-body-sm font-semibold text-text-primary">{s.title}</span>
                <span className="block text-caption leading-snug text-text-secondary">{s.detail}</span>
                {s.when && (
                  <span className="mt-1 flex items-center gap-1.5 text-caption font-medium text-text-primary">
                    <CalendarDays className="size-3.5 text-text-tertiary" aria-hidden="true" />
                    {s.when}
                  </span>
                )}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
