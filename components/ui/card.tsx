import * as React from 'react';

import { cn } from '@/lib/utils';

/* ============================================================================
 * CARD — the surface primitive
 * ----------------------------------------------------------------------------
 * A card only reads as a raised object if three things line up: the page behind
 * it is meaningfully darker, the border is actually visible, and the shadow is
 * real. All three were too weak before — a 2% surface step, a #dde7e8 hairline
 * and a 0.06-alpha shadow — so cards dissolved into the page and the interface
 * looked flat. The tokens carry the fix; this file just uses them properly.
 * ========================================================================= */

export function Card({
  className,
  interactive = false,
  accentToken,
  lit = false,
  textured = false,
  toneToken,
  children,
  style,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  /** Paints a 3px accent edge along the top. Chrome or category, never state. */
  accentToken?: string;
  /**
   * ── THE TEXTURE VOCABULARY (UI redesign, texture pass) ─────────────────────
   * The references are not glass. They are layered SOLID surfaces: a lit panel,
   * a faint hue wash, film grain. Those three are what actually produces the
   * look, and all three existed as utilities from step 1 while being applied
   * almost nowhere.
   *
   * They are OPT-IN rather than on by default, and that is the plan's rule
   * rather than caution: "grain on large surfaces … never behind a table or
   * dense text". A `Card` wrapping a 40-row table must stay flat, so the
   * default has to be flat and the caller has to say otherwise.
   */
  /** `--panel-lit`: a soft top-lit gradient. For large panels, not table shells. */
  lit?: boolean;
  /** Film grain over the surface. Large panels and empty states only. */
  textured?: boolean;
  /** A faint radial wash of a token's colour, as the KPI cards use. */
  toneToken?: string;
}) {
  /* ── BACKGROUND LAYERS, NOT OVERLAY ELEMENTS ────────────────────────────────
     The tone wash is painted as a `background-image` on the card itself rather
     than as an absolutely positioned child, and that is a correctness point, not
     a style preference: a positioned element paints ABOVE its static siblings
     regardless of DOM order, so an overlay span would sit on top of whatever the
     card contains. StatCard gets away with the span only because it marks every
     one of its own content blocks `relative`; `Card` takes arbitrary children
     and cannot.

     Layering them here also lets `lit` and `toneToken` coexist — two
     background-images on one element, comma-separated, first on top — where two
     competing utilities would have fought over the same property. */
  const layers: string[] = [];
  if (toneToken) {
    /* Matches StatCard's wash exactly, including the 24% it was raised to on
       2026-08-15 — a panel and a KPI card tinted with the same token must look
       like the same idea, and they drift the moment these two numbers differ. */
    layers.push(
      `radial-gradient(24rem 13rem at 100% 0%, color-mix(in oklab, var(--${toneToken}) 24%, transparent), transparent 72%)`,
    );
  }
  if (lit) layers.push('var(--panel-lit)');

  return (
    <div
      className={cn(
        'relative rounded-xl border border-border-default bg-bg-surface shadow-sm',
        accentToken && 'overflow-hidden',
        textured && 'grain',
        interactive &&
          'transition-[border-color,box-shadow,transform] duration-[180ms] hover:-translate-y-px hover:border-border-strong hover:shadow-md',
        className,
      )}
      style={layers.length > 0 ? { backgroundImage: layers.join(', '), ...style } : style}
      {...rest}
    >
      {accentToken && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{
            background: `linear-gradient(90deg, var(--${accentToken}), color-mix(in oklab, var(--${accentToken}) 35%, transparent))`,
          }}
        />
      )}
      {children}
    </div>
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-3.5',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-body font-semibold tracking-tight text-text-primary', className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-0.5 text-caption text-text-tertiary', className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'space-y-3 border-t border-border-subtle bg-bg-surface-sunken px-5 py-3',
        className,
      )}
      {...props}
    />
  );
}

/* --------------------------------------------------------------------------
 * Section — a titled block with actions, used above lists and tables
 * ------------------------------------------------------------------------ */

export function CardToolbar({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <CardHeader className={className}>
      <div className="min-w-0">
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </CardHeader>
  );
}
