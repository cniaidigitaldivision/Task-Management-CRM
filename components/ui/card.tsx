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
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
  /** Paints a 3px accent edge along the top. Chrome or category, never state. */
  accentToken?: string;
}) {
  return (
    <div
      className={cn(
        'relative rounded-xl border border-border-default bg-bg-surface shadow-sm',
        accentToken && 'overflow-hidden',
        interactive &&
          'transition-[border-color,box-shadow,transform] duration-[180ms] hover:-translate-y-px hover:border-border-strong hover:shadow-md',
        className,
      )}
      {...props}
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
