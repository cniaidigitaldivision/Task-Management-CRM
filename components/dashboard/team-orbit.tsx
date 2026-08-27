import * as React from 'react';

import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/* ============================================================================
 * TEAM CAPACITY
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-26, with a reference: a thick 3D donut in a teal→blue ramp,
 * each person's avatar sitting on their own segment with their name and
 * percentage beside it, and the team average in the middle.
 *
 * This replaces the constellation that stood here. The constellation encoded
 * workload as DISTANCE from a core, which was readable but unconventional; a
 * donut encodes it as ARC, which everybody already knows how to read.
 *
 * ── ⚠️ THE ARC IS SHARE OF LOAD; THE LABEL IS OWN UTILISATION ──────────────
 * These are two different quantities and the panel shows both, so it has to be
 * clear about which is which. A person's SEGMENT is their share of the team's
 * total load in points — points sum, so they can legitimately make a ring. A
 * person's PERCENTAGE is their own utilisation against their own capacity —
 * those do NOT sum to anything (four people at 40% is not 160% of a division),
 * so they could never be the ring.
 *
 * The reference has the same split and does not say so. Here the centre is
 * labelled "avg utilisation" and each figure sits against a face, which is the
 * least ambiguous arrangement available without adding a paragraph.
 *
 * ── ⚠️ A SERVER COMPONENT ───────────────────────────────────────────────────
 * Every position is arithmetic on props; the depth and the reveal are CSS. It
 * renders on the server and needs no client bundle.
 * ========================================================================= */

export interface OrbitPerson {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  /** 0–100+. Their own utilisation, shown as their label. */
  readonly utilisationPct: number;
  readonly openTasks: number;
  /** A token name without the `--`, from the workload band. Kept for callers. */
  readonly token: string;
}

/* ── The ramp ────────────────────────────────────────────────────────────────
   The reference's teal → cyan → sky → blue. Built by MIXING the theme's own
   accent towards blue rather than as fixed hexes, so the card still follows the
   palette — the app's accent is already teal, so this ramp reads as the
   reference's while remaining the product's own colour. */
const RAMP = [
  'var(--accent-primary)',
  'color-mix(in oklab, var(--accent-primary) 72%, #38bdf8)',
  'color-mix(in oklab, var(--accent-primary) 38%, #38bdf8)',
  'color-mix(in oklab, #38bdf8 68%, #2563eb)',
  'color-mix(in oklab, #2563eb 82%, #1e3a8a)',
  'color-mix(in oklab, #1e3a8a 88%, black)',
] as const;

export function TeamOrbit({
  people,
  corePct,
  coreLabel,
  className,
}: {
  people: readonly OrbitPerson[];
  corePct: number;
  coreLabel: string;
  className?: string;
}) {
  if (people.length === 0) {
    return (
      <p className={cn('py-10 text-center text-caption text-text-tertiary', className)}>
        Nobody to show yet.
      </p>
    );
  }

  /* Busiest first, so the ramp runs from the heaviest load and the reading
     order matches what the picture emphasises. */
  const ordered = [...people].sort((a, b) => b.utilisationPct - a.utilisationPct);

  /* ⚠️ Shares are of the SUM OF UTILISATIONS, not of 100. Using each person's
     raw percentage as an arc would leave the ring part-empty whenever the team
     is under capacity — a 22% team would draw a ring that is 78% gap, which
     reads as missing data rather than as spare capacity. Normalising makes the
     ring a full circle whose segments are each person's share of the work being
     carried, which is the thing the reference is actually showing. */
  const total = ordered.reduce((sum, p) => sum + Math.max(0, p.utilisationPct), 0);

  const r = 33;
  const c = 2 * Math.PI * r;
  const GAP = 0.012; // a sliver of ring between neighbours

  const segments = ordered.reduce<
    Array<{ person: OrbitPerson; share: number; offset: number; mid: number; ink: string }>
  >((acc, person, i) => {
    const share = total > 0 ? Math.max(0, person.utilisationPct) / total : 1 / ordered.length;
    const previous = acc[acc.length - 1];
    const offset = previous ? previous.offset + previous.share : 0;
    return [
      ...acc,
      {
        person,
        share,
        offset,
        /* The angular middle of this segment, in degrees clockwise from twelve
           o'clock — where the avatar sits. */
        mid: (offset + share / 2) * 360 - 90,
        ink: RAMP[i % RAMP.length],
      },
    ];
  }, []);

  return (
    <div
      className={cn('relative mx-auto aspect-square w-full max-w-[17rem]', className)}
      data-reveal="out"
    >
      {/* ── The donut ────────────────────────────────────────────────────────
          Two SVGs: a darkened body and the lit face over it. The pair reads as
          one extruded solid, and because both are the same geometry a segment
          can never sit in a different place on the body than on the face —
          which a hand-drawn side wall would risk. */}
      <div className="absolute inset-[16%]">
        {/* Three layers of the SAME arcs — deepest first. See `.ring-3d-*`. */}
        {(['ring-3d-base', 'ring-3d-body'] as const).map((layer) => (
        <svg key={layer} viewBox="0 0 100 100" className={`${layer} h-full w-full -rotate-90`} aria-hidden="true">
          {segments.map((seg) => (
            <circle
              key={`${layer}-${seg.person.id}`}
              className="reveal-ring"
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={seg.ink}
              strokeWidth="15"
              strokeDasharray={`${Math.max(0, (seg.share - GAP) * c)} ${c}`}
              strokeDashoffset={-seg.offset * c}
              style={{ '--ring-len': c, '--ring-to': -seg.offset * c } as React.CSSProperties}
            />
          ))}
        </svg>
        ))}

        <svg viewBox="0 0 100 100" className="ring-3d relative h-full w-full -rotate-90" aria-hidden="true">
          {/* The track, so a short ring still reads as a share of something. */}
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke="color-mix(in oklab, var(--accent-primary) 10%, transparent)"
            strokeWidth="15"
          />
          {segments.map((seg) => (
            <circle
              key={seg.person.id}
              className="reveal-ring"
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={seg.ink}
              strokeWidth="15"
              strokeLinecap="butt"
              strokeDasharray={`${Math.max(0, (seg.share - GAP) * c)} ${c}`}
              strokeDashoffset={-seg.offset * c}
              style={{ '--ring-len': c, '--ring-to': -seg.offset * c } as React.CSSProperties}
            />
          ))}
        </svg>
      </div>

      {/* ── The centre ───────────────────────────────────────────────────── */}
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="tabular text-h1 leading-none font-bold text-text-primary">{corePct}%</p>
          <p className="mt-0.5 text-micro text-text-tertiary">{coreLabel}</p>
        </div>
      </div>

      {/* ── The people, on their own segments ────────────────────────────────
          ⚠️ Placed by `rotate → translate → counter-rotate`, so each avatar
          lands on its segment's midpoint but stays upright. Rotating without
          the counter-rotation tips every face by its own angle. */}
      {segments.map((seg, i) => (
        <div
          key={seg.person.id}
          className="orbit-seat absolute top-1/2 left-1/2"
          style={
            {
              transform: `rotate(${seg.mid}deg) translateX(7.2em) rotate(${-seg.mid}deg)`,
              '--seat-index': i,
            } as React.CSSProperties
          }
        >
          <div className="-translate-x-1/2 -translate-y-1/2">
            <div className="flex flex-col items-center gap-0.5">
              <span
                className="block rounded-full p-[2px]"
                style={{ backgroundColor: seg.ink }}
              >
                <Avatar name={seg.person.name} src={seg.person.avatarUrl} size="sm" />
              </span>
              <span className="max-w-[5rem] truncate text-micro leading-tight font-medium text-text-secondary">
                {seg.person.name.split(' ')[0]}
              </span>
              <span
                className="tabular text-micro leading-none font-bold"
                style={{ color: seg.ink }}
              >
                {seg.person.utilisationPct}%
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
