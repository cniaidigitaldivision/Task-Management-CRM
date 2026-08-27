import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { AlertTriangle, type LucideIcon } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE HOLOGRAPHIC CONTROL ROOM
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25, with a full reference and their own globe asset: *"remove
 * everything from the dashboard… I want this UI to be exactly the same as shown
 * in the image."*
 *
 * The layout is the reference's, panel for panel. What differs is only what the
 * data allows, and every one of those differences is deliberate:
 *
 * ── ⚠️ NO FIGURE ON THIS PAGE IS INVENTED ──────────────────────────────────
 * The mockup carries plausible numbers — "Revenue (MTD) $28,540", "AI
 * Productivity 87/100", "System Uptime 99.9%", "Last Backup 10:42 AM". This
 * product has no finance tables, no model server, no uptime monitor and no
 * backup log. Wiring those panels to constants would produce a dashboard that
 * looks authoritative and reports fiction — the single worst outcome for a
 * screen people make decisions from.
 *
 * So each of those slots keeps its SHAPE and is filled with a real measurement
 * of the same weight:
 *   · Financial overview → Delivery overview (published assets, completed work)
 *   · AI productivity    → Operations score, computed in lib/domain/ops-score.ts
 *   · System uptime      → signals that can actually be observed (see below)
 *
 * The panels the owner's data DOES support — tasks, attendance, workload,
 * reports, activity, projects, notifications — are the reference's, unchanged.
 *
 * ── ⚠️ IN THE THEME, ALWAYS ─────────────────────────────────────────────────
 * The owner's standing correction from earlier the same day: *"Keep the theme
 * the same… make the theme keep working."* Every colour here is a token or a
 * mix of one, so the room is bright in light mode and deep in dark, and the
 * toggle governs the dashboard exactly as it governs every other screen.
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 * Shared shapes
 * ------------------------------------------------------------------------- */

export interface RoomStat {
  readonly label: string;
  readonly value: string;
  readonly icon: LucideIcon;
  readonly tone: string;
  /** `+12%` against the previous period, or null when there is no honest one. */
  readonly delta: { readonly text: string; readonly good: boolean } | null;
  /**
   * This figure's share of the total, 0–100 — draws a filling dial instead of
   * an icon plate. ONLY for a figure that really is part of a whole shown
   * beside it; see the note at the call site.
   */
  readonly ofTotal?: number;
}

export interface RoomSlice {
  readonly label: string;
  readonly value: number;
  readonly tone: 'brand' | 'good' | 'warn' | 'bad' | 'gold' | 'muted';
}

export interface RoomBar {
  readonly label: string;
  /** Stacked bottom-up, in order. A tone name from `TONE`. */
  readonly segments: readonly { readonly tone: string; readonly value: number }[];
}

export interface RoomActivity {
  readonly id: string;
  readonly actorName: string;
  /** The actor's photo. Null falls back to initials, which is `Avatar`'s job. */
  readonly avatarUrl: string | null;
  readonly summary: string;
  readonly at: string;
}

export interface RoomProject {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly donePct: number;
  readonly open: number;
}

export interface RoomAlert {
  readonly id: string;
  readonly title: string;
  readonly body: string | null;
  readonly tone: string;
  readonly href: string | null;
  /** Defaults to a warning triangle when the alert has no better glyph. */
  readonly icon?: LucideIcon;
}

export interface RoomSignal {
  readonly label: string;
  readonly state: string;
  readonly ok: boolean;
  readonly icon: LucideIcon;
}

/* ── ⚠️ THE PALETTE IS THE THEME'S, AND IT IS STILL VIVID ──────────────────
   Owner, 2026-08-25, comparing a build to the reference: *"you can see how
   colorful things are, plus how the logos are."* The first pass tinted every
   plate with the one brand accent, which read as five grey squares.

   These are the app's OWN status and project tokens — violet, blue, emerald,
   red, pink, gold. They are already vivid, already contrast-checked, and
   already flip with the theme, so the panel gets the reference's colour without
   a single fixed hex and without the theme correction being undone again. */
const TONE: Record<string, string> = {
  brand: 'var(--accent-primary)',
  good: 'var(--feedback-success)',
  warn: 'var(--feedback-warning)',
  bad: 'var(--feedback-error)',
  gold: 'var(--accent-gold)',
  muted: 'var(--text-tertiary)',
  violet: 'var(--status-progress)',
  blue: 'var(--status-todo)',
  emerald: 'var(--status-done)',
  pink: 'var(--status-review)',
  orange: 'var(--status-revisions)',
};

/** The colours a series of segments or rows cycles through, in order. */
const SPECTRUM = ['violet', 'blue', 'emerald', 'gold', 'pink', 'orange'] as const;

/**
 * A vivid icon plate — the reference's coloured rounded square with a white
 * glyph.
 *
 * ⚠️ The glyph is white in BOTH themes, not `--text-on-brand`: the plate is a
 * saturated colour in both, so the ink that reads on it does not change. A
 * token here would flip to dark in light mode and vanish into the plate.
 */
export function IconPlate({
  icon: Icon,
  tone,
  size = 'md',
}: {
  icon: LucideIcon;
  tone: string;
  size?: 'sm' | 'md';
}) {
  const ink = TONE[tone] ?? tone;
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-xl',
        size === 'md' ? 'size-10' : 'size-8',
      )}
      style={{
        background: `linear-gradient(145deg, color-mix(in oklab, ${ink} 82%, white), ${ink})`,
        boxShadow: `0 6px 14px -6px color-mix(in oklab, ${ink} 70%, transparent)`,
      }}
    >
      <Icon
        className={size === 'md' ? 'size-[1.15rem]' : 'size-4'}
        strokeWidth={2.25}
        style={{ color: '#fff' }}
        aria-hidden="true"
      />
    </span>
  );
}

/** A wash of a tone, for a tile's icon plate or a bar's track. */
const wash = (tone: string, pct: number) =>
  `color-mix(in oklab, ${TONE[tone] ?? tone} ${pct}%, transparent)`;

/**
 * A donut with a legend beside it — attendance, and any other split of a whole.
 *
 * ⚠️ No `<defs>` and no gradient ids anywhere in this file. Several of these
 * render on one page, and duplicated SVG ids make the second instance silently
 * paint with the first's fill — the exact fault the chart kit's header
 * documents. Flat token strokes read the same at this size.
 */
export function RoomRing({
  slices,
  centreValue,
  centreLabel,
  size = 104,
}: {
  slices: readonly RoomSlice[];
  centreValue: string;
  centreLabel: string;
  size?: number;
}) {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const r = 40;
  const c = 2 * Math.PI * r;

  /* Each slice starts where the ones before it ended — the same stroke-dash
     technique as the chart kit's donut, and for the same reason: no <defs>, so
     nothing can collide with another ring on the same page.

     ⚠️ Built with `reduce` rather than a `let` mutated inside `map`: the React
     compiler rejects a variable reassigned during render, and it is right to —
     a closure capturing that accumulator would read a different value on a
     re-render than it did on the first pass. */
  const arcs = slices.reduce<Array<{ slice: RoomSlice; share: number; offset: number }>>(
    (acc, slice) => {
      const share = total > 0 ? Math.max(0, slice.value) / total : 0;
      const previous = acc[acc.length - 1];
      const offset = previous ? previous.offset + previous.share : 0;
      return [...acc, { slice, share, offset }];
    },
    [],
  );

  return (
    /* `data-reveal="out"` holds the arcs at zero until the tile is on screen;
       `StageDirector` flips it to `in`. See the reveal rules in tokens.css. */
    <div className="flex items-center gap-3" data-reveal="out">
      {/* ⚠️ The tilt is on a WRAPPER, not on the `<svg>`. The svg already
          carries `-rotate-90` to start the arcs at twelve o'clock, and a
          `transform` on the same element would replace that rotation rather
          than compose with it — the ring would start from three o'clock and
          every segment would be a quarter turn out. */}
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        {/* Three layers of the SAME arcs — deepest first. See `.ring-3d-*`. */}
        {(['ring-3d-base', 'ring-3d-body'] as const).map((layer) => (
        <svg
          key={layer}
          viewBox="0 0 100 100"
          className={`${layer} h-full w-full -rotate-90`}
          aria-hidden="true"
        >
          {arcs.map(
            (arc) =>
              arc.share > 0 && (
                <circle
                  key={`body-${arc.slice.label}`}
                  className="reveal-ring"
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={TONE[arc.slice.tone]}
                  strokeWidth="11"
                  strokeDasharray={`${Math.max(0, arc.share * c - 1.5)} ${c}`}
                  strokeDashoffset={-arc.offset * c}
                  style={
                    { '--ring-len': c, '--ring-to': -arc.offset * c } as React.CSSProperties
                  }
                />
              ),
          )}
        </svg>
        ))}

        <svg viewBox="0 0 100 100" className="ring-3d relative h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r={r} fill="none" stroke={wash('brand', 12)} strokeWidth="11" />
          {arcs.map(
            (arc) =>
              arc.share > 0 && (
                <circle
                  key={arc.slice.label}
                  className="reveal-ring"
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={TONE[arc.slice.tone]}
                  strokeWidth="11"
                  strokeDasharray={`${Math.max(0, arc.share * c - 1.5)} ${c}`}
                  strokeDashoffset={-arc.offset * c}
                  style={
                    {
                      /* ⚠️ `--ring-to` is this segment's RESTING offset, which
                         is what positions it on the ring — the reveal sweeps in
                         from a full turn behind it rather than from zero.
                         Animating towards 0 instead would slide every segment
                         round to twelve o'clock and stack them. */
                      '--ring-len': c,
                      '--ring-to': -arc.offset * c,
                    } as React.CSSProperties
                  }
                />
              ),
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center px-3 text-center">
          <div>
            <p className="tabular text-body leading-none font-bold text-text-primary">
              {centreValue}
            </p>
            <p className="mt-0.5 text-micro leading-tight text-text-tertiary">{centreLabel}</p>
          </div>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: TONE[slice.tone] }}
            />
            <span className="min-w-0 flex-1 truncate text-micro text-text-secondary">
              {slice.label}
            </span>
            <span className="tabular shrink-0 text-caption font-semibold text-text-primary">
              {slice.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RoomBars({
  bars,
  height = 84,
  legend,
  action,
}: {
  bars: readonly RoomBar[];
  height?: number;
  legend?: readonly { label: string; value: number; tone: string }[];
  /** A control under the chart — the reference's period dropdown. */
  action?: React.ReactNode;
}) {
  /* ⚠️ The peak is over each bar's TOTAL, not its tallest segment. Scaling a
     stack by its largest part would let a two-segment day out-grow the axis. */
  const peak = Math.max(1, ...bars.map((b) => b.segments.reduce((a, seg) => a + seg.value, 0)));

  return (
    /* ── ⚠️ THE LEGEND SITS BELOW, NOT BESIDE ─────────────────────────────────
       The reference puts it to the right, and that was tried: in this column the
       panel is about 200px wide, the legend took 120 of them, and the seven
       weekday labels collapsed into an unreadable row of single letters. A
       legend beside the chart only works when the chart has room to spare.
       Below, wrapping, it reads at any width. */
    <div className="space-y-2.5" data-reveal="out">
      <div className="min-w-0">
        <div className="flex items-end gap-1.5" style={{ height }}>
          {bars.map((bar) => {
            const total = bar.segments.reduce((a, seg) => a + seg.value, 0);
            return (
              <div key={bar.label} className="group flex min-w-0 flex-1 flex-col items-center gap-1">
                <span className="tabular text-micro leading-none text-text-tertiary">
                  {total > 0 ? total : ''}
                </span>

                {/* ⚠️ ONE column, STACKED by state — not one bar per day in a
                    single colour. Owner, 2026-08-26: *"for Approval, Pending and
                    Returned use the data so that all 3 colors should appear."*
                    A single count can only ever be one colour; a stack shows
                    each state the moment the register holds one.

                    The whole stack scales together, so the segments keep their
                    proportions as the column grows on approach. */}
                <div
                  className="reveal-column flex w-full max-w-[11px] flex-col-reverse justify-start overflow-hidden rounded-full"
                  style={{
                    /* ⚠️ A 2px floor for an EMPTY day too, so a day with nothing
                       reads as a day with nothing rather than as a missing
                       column. */
                    height: `${Math.max(2, (total / peak) * (height - 16))}px`,
                    backgroundColor: total > 0 ? undefined : wash('brand', 20),
                  }}
                >
                  {bar.segments.map((seg) =>
                    seg.value > 0 ? (
                      <span
                        key={seg.tone}
                        style={{
                          flexGrow: seg.value,
                          background: `linear-gradient(180deg, color-mix(in oklab, ${TONE[seg.tone] ?? seg.tone} 58%, white), ${TONE[seg.tone] ?? seg.tone})`,
                        }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {bars.map((bar) => (
            <span
              key={bar.label}
              className="min-w-0 flex-1 truncate text-center text-micro text-text-tertiary"
            >
              {bar.label}
            </span>
          ))}
        </div>
      </div>

      {legend && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border-subtle pt-2">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: TONE[item.tone] }}
              />
              <span className="text-micro text-text-secondary">{item.label}</span>
              <span className="tabular text-micro font-semibold text-text-primary">
                {item.value}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* The reference's period control, under the chart. Passed in rather than
          built here: this component draws bars and knows nothing about periods,
          and the page owns which one is selected. */}
      {action}
    </div>
  );
}

export function ActivityFeed({ items }: { items: readonly RoomActivity[] }) {
  if (items.length === 0) {
    return <Empty text="Nothing yet. Every change lands here." />;
  }
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li
          key={item.id}
          className="slide-in flex items-start gap-2.5"
          style={{ '--slide-index': i } as React.CSSProperties}
        >
          <span className="tabular w-8 shrink-0 pt-0.5 text-micro text-text-tertiary">
            {item.at}
          </span>
          {/* ⚠️ `src` was missing here and the query never selected it, so every
              row drew initials — which is exactly what `Avatar` does when it has
              no photo, so the bug looked like a style choice. Owner, 2026-08-25:
              *"every team member has an image, you are not showing the image."* */}
          <Avatar name={item.actorName} src={item.avatarUrl} size="xs" />
          <p className="min-w-0 flex-1 text-micro leading-snug text-text-secondary">
            <span className="font-semibold text-text-primary">{item.actorName}</span>{' '}
            {/* ⚠️ Clamped to two lines. Unbounded, one long summary made this
                panel much taller than the four beside it, and a grid row is as
                tall as its tallest cell — so one verbose entry left white space
                in every other card on the row. */}
            <span className="line-clamp-2">{item.summary}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ProjectProgress({ projects }: { projects: readonly RoomProject[] }) {
  if (projects.length === 0) {
    return <Empty text="No active projects." />;
  }
  return (
    <ul className="space-y-3" data-reveal="out">
      {projects.map((project, i) => (
        <li
          key={project.id}
          className="slide-in flex items-center gap-2.5"
          style={{ '--slide-index': i } as React.CSSProperties}
        >
          {/* The reference's thumbnail. A vivid plate with the project's own
              initial, cycling the spectrum so a list of five reads as five
              distinct things: this product stores no project artwork, and a
              stock image would be decoration pretending to be a record. */}
          <span
            className="grid size-9 shrink-0 place-items-center rounded-lg text-caption font-bold"
            style={{
              background: `linear-gradient(145deg, color-mix(in oklab, ${TONE[SPECTRUM[i % SPECTRUM.length]]} 80%, white), ${TONE[SPECTRUM[i % SPECTRUM.length]]})`,
              color: '#fff',
              boxShadow: `0 6px 14px -6px color-mix(in oklab, ${TONE[SPECTRUM[i % SPECTRUM.length]]} 70%, transparent)`,
            }}
            aria-hidden="true"
          >
            {project.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-caption font-medium text-text-primary">
                {project.name}
              </span>
              <span className="tabular shrink-0 text-micro font-semibold text-text-primary">
                {project.donePct}%
              </span>
            </div>
            <p className="truncate text-micro text-text-tertiary">
              {project.kind} · {project.open} open
            </p>
            <div
              className="mt-1 h-1.5 overflow-hidden rounded-full"
              style={{ backgroundColor: wash(SPECTRUM[i % SPECTRUM.length], 14) }}
            >
              <div
                className="reveal-bar h-full rounded-full"
                style={
                  {
                    width: `${Math.max(2, project.donePct)}%`,
                    backgroundColor: TONE[SPECTRUM[i % SPECTRUM.length]],
                    '--bar-index': i,
                  } as React.CSSProperties
                }
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AlertList({ alerts }: { alerts: readonly RoomAlert[] }) {
  if (alerts.length === 0) {
    return <Empty text="Nothing needs attention." />;
  }
  return (
    <ul className="space-y-2">
      {alerts.map((alert, i) => {
        const body = (
          <>
            <IconPlate icon={alert.icon ?? AlertTriangle} tone={alert.tone} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-micro font-semibold text-text-primary">
                {alert.title}
              </span>
              {alert.body && (
                <span className="block truncate text-micro text-text-tertiary">{alert.body}</span>
              )}
            </span>
          </>
        );
        return (
          <li
            key={alert.id}
            className="slide-in"
            style={{ '--slide-index': i } as React.CSSProperties}
          >
            {alert.href ? (
              <Link
                href={alert.href as never}
                className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-bg-subtle p-2 hover:bg-bg-hover"
              >
                {body}
              </Link>
            ) : (
              <div className="flex items-center gap-2.5 rounded-lg border border-border-subtle bg-bg-subtle p-2">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------------------
 * AI insights, and the status board
 * ------------------------------------------------------------------------- */

export function AiInsights({
  score,
  headline,
  recommendations,
}: {
  score: number;
  headline: string;
  recommendations: readonly string[];
}) {
  /* ⚠️ `h-full` and a column that DISTRIBUTES. Owner, 2026-08-26: *"this AI
     assistant card is looking very pathetic… you can see a lot of white space
     over it."* The card was the tallest in its stack, and this panel was a
     fixed-height block sitting at the top of it — so every extra pixel of the
     tile became empty space underneath.

     The score row now takes the slack (`flex-1`) and the recommendation block
     sits at the foot, so the content fills whatever height the row settles on
     rather than pooling at the top. */
  return (
    <div className="flex h-full flex-col gap-3" data-reveal="out">
      <div className="flex flex-1 items-center gap-3">
        {/* ⚠️ A TRANSPARENT PNG, so it needs no plate and no blend mode. The
            earlier asset had a white field and carried a stack of per-theme
            workarounds to hide it; the owner supplied a cut-out on 2026-08-26
            and all of them were deleted. See the note in styles/tokens.css.

            A soft glow behind it, in the theme's accent, so the brain reads as
            lit rather than as a sticker — that is the one thing the asset does
            not bring with it. */}
        <span className="relative grid size-[5.5rem] shrink-0 place-items-center">
          {/* ── The glowing circle ──────────────────────────────────────────
              Owner, 2026-08-26: *"just make a glowing circle around it."*
              Three layers, because one flat disc reads as a sticker: a soft
              bloom that spills past the edge, a bright ring ON the edge, and a
              faint inner fill so the brain sits IN the circle rather than on
              top of one. */}
          <span
            aria-hidden="true"
            className="absolute -inset-1 rounded-full"
            style={{
              background: `radial-gradient(circle, ${wash('brand', 42)}, transparent 68%)`,
              filter: 'blur(10px)',
            }}
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border"
            style={{
              borderColor: wash('brand', 55),
              background: `radial-gradient(circle at 32% 28%, ${wash('brand', 20)}, transparent 72%)`,
              boxShadow: `0 0 18px -2px ${wash('brand', 60)}, inset 0 0 14px -4px ${wash('brand', 70)}`,
            }}
          />
          <Image
            src="/dashboard/brain-cutout.png"
            alt=""
            width={140}
            height={140}
            className="relative size-[5.4rem] object-contain"
            /* Not priority: it is below the fold on most windows and must not
               compete with the backdrop for the first paint. */
          />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-micro text-text-tertiary">Operations score</p>
          <p className="flex items-baseline gap-1">
            <span className="tabular text-h1 leading-none font-semibold text-text-primary">
              {score}
            </span>
            <span className="text-caption text-text-tertiary">/100</span>
          </p>
          {/* A bar under the score: the figure is out of 100, so it has a
              denominator worth drawing. Fills on approach like every other bar
              on the page. */}
          <span
            className="mt-2 block h-1.5 overflow-hidden rounded-full"
            style={{ backgroundColor: wash('brand', 14) }}
          >
            <span
              className="reveal-bar block h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, score))}%`,
                background: `linear-gradient(90deg, ${TONE.brand}, ${TONE.gold})`,
              }}
            />
          </span>
          <p className="mt-1.5 text-micro leading-snug text-text-secondary">{headline}</p>
        </div>
      </div>

      {/* ⚠️ `mt-auto` pins this to the foot of the card. Without it the block
          sits directly under the score and every extra pixel of tile height
          becomes dead space below — which is exactly what the owner reported
          ("a lot of white space over it"). The score row above takes the slack
          instead. */}
      <div className="mt-auto rounded-xl border border-border-subtle bg-bg-subtle p-2.5">
        <p className="text-micro font-semibold text-text-primary">
          {recommendations.length > 0 ? 'Top recommendation' : 'Nothing to flag'}
        </p>
        <ul className="mt-1 space-y-1">
          {recommendations.map((line, i) => (
            <li key={line} className="flex items-start gap-1.5 text-micro text-text-secondary">
              <span
                aria-hidden="true"
                className="mt-1 size-1 shrink-0 rounded-full"
                style={{ backgroundColor: TONE[SPECTRUM[i % SPECTRUM.length]] }}
              />
              {line}
            </li>
          ))}
          {recommendations.length === 0 && (
            <li className="text-micro text-text-secondary">
              Delivery, capacity and attendance are all inside their bands.
            </li>
          )}
        </ul>

        {/* The reference's "View Insights" button. It goes to Reports, which is
            where the figures behind this score actually live — a button that
            opened nothing would be the panel's only dishonest element. */}
        <Link
          href={'/reports' as never}
          className="mt-2 flex h-7 items-center justify-center rounded-lg text-micro font-semibold"
          style={{ backgroundColor: wash('brand', 16), color: 'var(--text-brand)' }}
        >
          View insights
        </Link>
      </div>
    </div>
  );
}

export function StatusBoard({ signals }: { signals: readonly RoomSignal[] }) {
  return (
    <ul className="space-y-2">
      {signals.map((signal, i) => (
        <li key={signal.label} className="flex items-center gap-2.5">
          {/* Each service keeps its own colour, as the reference draws them —
              the plate identifies the system, the text on the right reports
              its state. Mixing those two into one colour would mean a healthy
              service and a failing one looked like different products. */}
          <IconPlate
            icon={signal.icon}
            tone={signal.ok ? SPECTRUM[i % SPECTRUM.length] : 'bad'}
            size="sm"
          />
          <span className="min-w-0 flex-1 truncate text-micro text-text-secondary">
            {signal.label}
          </span>
          <span
            className="shrink-0 text-micro font-semibold"
            style={{
              color: signal.ok ? 'var(--feedback-success)' : 'var(--feedback-warning)',
            }}
          >
            {signal.state}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The one empty state these panels share, so they read alike when quiet. */
function Empty({ text }: { text: string }) {
  return <p className="py-6 text-center text-micro text-text-tertiary">{text}</p>;
}
