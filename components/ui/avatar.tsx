import { cn } from '@/lib/utils';

/* ============================================================================
 * AVATAR — initials, deterministically tinted
 * ----------------------------------------------------------------------------
 * The tint is derived from the name, so the same person is always the same
 * colour everywhere in the app without storing a preference. Hues avoid brand
 * gold entirely (BR-024) — an avatar must never be mistaken for a status.
 *
 * Each tint is a gradient rather than a flat fill, built from ONE token by
 * mixing it lighter at the top and darker at the bottom. That reads as a lit
 * sphere instead of a paint chip, and it costs one expression rather than
 * sixteen hand-picked colour pairs to keep in sync.
 * ========================================================================= */

const TINT_TOKENS = [
  'teal-600',
  'status-todo',
  'status-progress',
  'status-review',
  'project-event',
  'status-done',
  'project-business',
  'teal-500',
] as const;

function tokenFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TINT_TOKENS[hash % TINT_TOKENS.length];
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES = {
  xs: 'h-6 w-6 text-[0.625rem]',
  sm: 'h-7 w-7 text-micro',
  md: 'h-9 w-9 text-caption',
  lg: 'h-11 w-11 text-body-sm',
  xl: 'h-14 w-14 text-body',
} as const;

export function Avatar({
  name,
  size = 'md',
  className,
  ring = false,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
  /** A surface-coloured ring, for overlapping stacks. */
  ring?: boolean;
}) {
  const colour = `var(--${tokenFor(name)})`;

  return (
    <span
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none',
        'text-neutral-0 shadow-xs',
        SIZES[size],
        ring && 'ring-2 ring-bg-surface',
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(145deg, color-mix(in srgb, ${colour} 82%, white) 0%, ${colour} 52%, color-mix(in srgb, ${colour} 84%, black) 100%)`,
      }}
    >
      {initialsOf(name)}
      <span className="sr-only">{name}</span>
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Overlapping stack, for "who is on this" without a list
 * ------------------------------------------------------------------------ */

export function AvatarStack({
  names,
  max = 4,
  size = 'sm',
  className,
}: {
  names: readonly string[];
  max?: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;

  return (
    <span className={cn('inline-flex items-center', className)}>
      {shown.map((name, i) => (
        <Avatar
          key={name}
          name={name}
          size={size}
          ring
          className={i > 0 ? '-ml-2' : undefined}
        />
      ))}
      {extra > 0 && (
        <span
          className={cn(
            '-ml-2 inline-flex items-center justify-center rounded-full',
            'bg-bg-active font-semibold text-text-secondary ring-2 ring-bg-surface',
            SIZES[size],
          )}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
