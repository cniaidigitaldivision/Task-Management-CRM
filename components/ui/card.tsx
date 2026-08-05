import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Surface primitive. Cards are pure white on a tinted page, which is what
 * gives the interface depth — see styles/tokens.css.
 */
export function Card({
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border-default bg-bg-surface shadow-sm',
        interactive &&
          'transition-[border-color,box-shadow] duration-[160ms] hover:border-border-strong hover:shadow-md',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-h3 text-text-primary', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-caption text-text-secondary', className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('border-t border-border-subtle bg-bg-subtle/50 px-5 py-3', className)}
      {...props}
    />
  );
}
