import { cn } from '@/lib/utils';

/**
 * Initials avatar.
 *
 * The tint is derived deterministically from the name, so the same person is
 * always the same colour everywhere in the app without storing a preference.
 * Hues avoid brand gold entirely (BR-024) — an avatar must never be mistaken
 * for a status indicator.
 */
const TINTS = [
  'bg-teal-700 text-white',
  'bg-teal-600 text-white',
  'bg-status-progress text-white',
  'bg-status-review text-white',
  'bg-project-event text-white',
  'bg-status-done text-white',
  'bg-status-todo text-white',
  'bg-project-business text-white',
] as const;

function tintFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TINTS[hash % TINTS.length];
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES = {
  xs: 'h-6 w-6 text-micro',
  sm: 'h-7 w-7 text-micro',
  md: 'h-9 w-9 text-caption',
  lg: 'h-11 w-11 text-body-sm',
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
  ring?: boolean;
}) {
  return (
    <span
      title={name}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold',
        SIZES[size],
        tintFor(name),
        ring && 'ring-2 ring-bg-surface',
        className,
      )}
    >
      {initialsOf(name)}
      <span className="sr-only">{name}</span>
    </span>
  );
}
