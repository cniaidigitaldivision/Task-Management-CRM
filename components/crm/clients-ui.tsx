'use client';

import * as React from 'react';
import { ChevronDown, EllipsisVertical } from 'lucide-react';

import { displayStatus, initials, STATUS_LOOK, type DisplayStatus } from '@/lib/domain/crm-client-board';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE CLIENTS PAGE'S OWN PARTS — the owner's design, sampled, 2026-09-22
 * ----------------------------------------------------------------------------
 * *"If I'm saying that I need the exact same UI, it means you have to put each
 * color, each icon, each styling, and everything the same … they are just
 * rectangular with curved corners and very sleek designs. Your designs have
 * just too many curves."*
 *
 * ── ⚠️ THE COLOURS ARE THE DESIGN'S, READ OUT OF THE PNG ──────────────────
 * Every value is a `--cl-*` token in styles/tokens.css, scoped to `.clients-ui`
 * with a dark twin, so this page can carry the reference's navy, slate and
 * multi-colour chips without one other screen changing.
 *
 * ── ⚠️ SIZES ARE THE DESIGN'S PIXELS DIVIDED BY 0.9 ───────────────────────
 * The app draws at `zoom: 0.9`, so a 32px button in the PNG is 2.2rem here.
 * Measured against the reference at the same 1584px window, not guessed.
 *
 * ── ⚠️ RADII ARE SMALL ON PURPOSE ─────────────────────────────────────────
 * Controls 6px, cards 8px, chips round — the reference's proportions. The
 * first build used the app's 12–16px, which is what "too many curves" meant.
 * ========================================================================= */

export const cv = (name: string) => `var(--cl-${name})`;

/* ── Relationship chips — each status its own hue, as in the design ────── */

const CHIP: Record<DisplayStatus, 'green' | 'blue' | 'sky' | 'amber' | 'grey'> = {
  active: 'green',
  prospect: 'blue',
  onboarding: 'sky',
  attention: 'amber',
  dormant: 'grey',
  archived: 'grey',
};

export function StatusChip({
  c,
  nowMs,
  wrap = false,
  small = false,
}: {
  c: Parameters<typeof displayStatus>[0];
  nowMs: number;
  /** The table's narrow column lets "Needs attention" break, as the design does. */
  wrap?: boolean;
  /** The table's size — a step smaller than the panel's and the cards'. */
  small?: boolean;
}) {
  const s = displayStatus(c, nowMs);
  const tone = CHIP[s];
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full font-medium leading-[1.15]',
        small ? 'gap-[0.3rem] px-[0.45rem] py-[0.3rem] text-[0.62rem]' : 'shrink-0 gap-[0.4rem] px-[0.7rem] py-[0.28rem] text-[0.8rem]',
        !wrap && 'whitespace-nowrap',
      )}
      style={{ background: cv(`${tone}-bg`), color: cv(tone) }}
    >
      <span className="size-[0.45rem] shrink-0 rounded-full" style={{ background: cv(`${tone}-dot`) }} aria-hidden="true" />
      <span className={wrap ? 'min-w-0' : undefined}>{STATUS_LOOK[s].label}</span>
    </span>
  );
}

/* ── Avatars — six pastels, stable per person ───────────────────────────── */

const AVATARS = ['blue', 'pink', 'mint', 'lilac', 'peach'] as const;

function hash(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function Avatar({
  id,
  name,
  size = 'md',
  owner = false,
}: {
  id: string;
  name: string;
  size?: 'xs' | 'sm' | 'row' | 'md' | 'card' | 'lg';
  /** A salesperson: the design draws every owner in the same rose, so the
      column reads as "who", not as another client. */
  owner?: boolean;
}) {
  const tone = owner ? 'rose' : AVATARS[hash(id) % AVATARS.length];
  const CLS: Record<NonNullable<typeof size>, string> = {
    lg: 'size-[3.35rem] text-[1.2rem]',
    card: 'size-[3.05rem] text-[1.1rem]',
    md: 'size-[2.25rem] text-[0.84rem]',
    row: 'size-[2.1rem] text-[0.78rem]',
    sm: 'size-[1.95rem] text-[0.7rem]',
    xs: 'size-[1.65rem] text-[0.6rem]',
  };
  const cls = CLS[size];
  return (
    <span
      className={cn('grid shrink-0 place-items-center rounded-full font-semibold', cls)}
      style={{ background: cv(`av-${tone}-bg`), color: cv(`av-${tone}`) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/* ── Square icon buttons ───────────────────────────────────────────────── */

export const SQUARE =
  'grid shrink-0 place-items-center rounded-[0.45rem] border bg-[var(--cl-surface)] transition-colors hover:bg-[var(--cl-head)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[var(--cl-surface)]';

export function Square({
  label,
  onClick,
  href,
  disabled,
  size = 'md',
  children,
}: {
  label: string;
  onClick?: () => void;
  href?: string | null;
  disabled?: boolean;
  size?: 'sm' | 'md';
  children: React.ReactNode;
}) {
  const box = size === 'sm' ? 'size-[2.15rem]' : 'size-[2.4rem]';
  const style = { borderColor: cv('line'), color: cv('ink') };
  /* ⚠️ ALWAYS DRAWN, DISABLED WHEN IT CANNOT WORK. Owner: *"You are showing
     just one button."* A client with no email still shows the email button —
     greyed, saying why — so every row and card has the same three. */
  if (href && !disabled) {
    return (
      <a href={href} aria-label={label} title={label} className={cn(SQUARE, box)} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled || (!onClick && !href)} aria-label={label} title={label} className={cn(SQUARE, box)} style={style}>
      {children}
    </button>
  );
}

/* ── Buttons ───────────────────────────────────────────────────────────── */

export const OUTLINE =
  'inline-flex items-center justify-center gap-2 rounded-[0.45rem] border bg-[var(--cl-surface)] font-medium transition-colors hover:bg-[var(--cl-head)] disabled:opacity-40';
export const outlineStyle = { borderColor: cv('brand-line'), color: cv('ink') } as const;

export const SOLID =
  'inline-flex items-center justify-center gap-2 rounded-[0.45rem] font-medium transition-colors bg-[var(--cl-brand)] hover:bg-[var(--cl-brand-hover)] disabled:opacity-40';
export const solidStyle = { color: cv('on-brand') } as const;

/* ── A select that looks like the design's: a flat box and a thin chevron ── */

export function Select({
  value,
  onChange,
  label,
  className,
  children,
}: {
  value: string | number;
  onChange: (v: string) => void;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full w-full cursor-pointer appearance-none truncate rounded-[0.45rem] border bg-[var(--cl-surface)] pl-[0.95rem] pr-9 text-[0.9rem] transition-colors focus:outline-none"
        style={{ borderColor: cv('line'), color: cv('ink') }}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-[1.15rem] -translate-y-1/2"
        style={{ color: cv('soft') }}
        aria-hidden="true"
      />
    </span>
  );
}

/* ── Popovers ──────────────────────────────────────────────────────────── */

export function usePopover() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

export const MENU =
  'absolute z-40 mt-1.5 overflow-hidden rounded-[0.55rem] border bg-[var(--cl-surface)] py-1 shadow-lg';
export const MENU_ITEM =
  'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[0.88rem] transition-colors hover:bg-[var(--cl-head)] disabled:cursor-not-allowed disabled:opacity-40';

export interface MenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly danger?: boolean;
}

/** The design's ⋮ — a bordered square, the same as the buttons beside it. */
export function Kebab({ items, label, size = 'md' }: { items: readonly MenuItem[]; label: string; size?: 'sm' | 'md' }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative">
      <Square label={label} onClick={() => setOpen(!open)} size={size}>
        <EllipsisVertical className="size-[1.15rem]" aria-hidden="true" />
      </Square>
      {open && (
        <div role="menu" className={cn(MENU, 'right-0 top-full w-56')} style={{ borderColor: cv('line') }}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
              className={MENU_ITEM}
              style={{ color: it.danger ? cv('red') : cv('ink') }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A tinted square with an icon in it — tiles, activity, related records. */
export function IconTile({
  icon: Icon,
  bg,
  ink,
  size = 'md',
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  bg: string;
  ink: string;
  size?: 'sm' | 'metric' | 'md' | 'lg';
}) {
  const box = size === 'lg' ? 'size-[3.45rem] rounded-[0.55rem]' : size === 'md' ? 'size-[2.35rem] rounded-[0.45rem]' : size === 'metric' ? 'size-[2.15rem] rounded-[0.42rem]' : 'size-[1.95rem] rounded-[0.4rem]';
  const glyph = size === 'lg' ? 'size-[1.75rem]' : size === 'sm' ? 'size-[1.05rem]' : 'size-[1.15rem]';
  return (
    <span className={cn('grid shrink-0 place-items-center', box)} style={{ background: bg }}>
      <Icon className={glyph} style={{ color: ink }} aria-hidden="true" />
    </span>
  );
}
