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

/* ── ONE COMPONENT, SO ONE CHANGE PUT PHOTOS EVERYWHERE ──────────────────────
   Owner instruction, Session 20: *"avatars should be on every task the member,
   coordinator, admin is assigned to."*

   Every screen already rendered `<Avatar name=… />` — the board, the list, the
   task drawer, Team, Workload, the rail, the assignee stacks. Adding `src` here
   is what makes a picture appear in all of them at once. Anything that does not
   pass a `src` yet simply keeps its initials, which is also the fallback for
   anybody who has not uploaded one.

   ── A PLAIN <img>, NOT next/image ─────────────────────────────────────────────
   next/image would route every avatar through the optimiser: a serverless
   invocation per face per page, for a file already stored at exactly the size
   it is displayed. These are ≤2 MB, served from a public bucket with its own
   CDN, and rendered at 28–56px. `loading="lazy"` and `decoding="async"` cover
   what matters here. */
export function Avatar({
  name,
  src,
  size = 'md',
  className,
  ring = false,
}: {
  name: string;
  /** Their uploaded picture. Falls back to initials when absent or broken. */
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
  /** A surface-coloured ring, for overlapping stacks. */
  ring?: boolean;
}) {
  const colour = `var(--${tokenFor(name)})`;

  const shell = cn(
    'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
    'font-semibold select-none text-neutral-0 shadow-xs',
    SIZES[size],
    ring && 'ring-2 ring-bg-surface',
    className,
  );

  /* The initials stay underneath the picture rather than being replaced by it.
     A photo that 404s — a removed object, a bucket rename — then shows the same
     coloured initials as everybody else instead of a broken-image icon. */
  return (
    <span
      title={name}
      className={shell}
      style={{
        backgroundImage: `linear-gradient(145deg, color-mix(in srgb, ${colour} 82%, white) 0%, ${colour} 52%, color-mix(in srgb, ${colour} 84%, black) 100%)`,
      }}
    >
      {initialsOf(name)}
      {src && (
        /* Deliberately a plain <img>: next/image would mean a serverless
           optimiser invocation per face per page, for a ≤2 MB file rendered at
           28–56px that already sits behind the storage CDN. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          /* NOT `loading="lazy"`. Lazy loading is for images below the fold;
             these are 5 KB and almost always in the first viewport — the rail,
             the page header, the top row of the board. Deferring them buys
             nothing and costs a visible flash of initials before the face
             arrives. Browsers also defer lazy images entirely in a background
             tab, so a board opened in a second tab would show no faces at all
             until it was looked at. */
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

/* --------------------------------------------------------------------------
 * Overlapping stack, for "who is on this" without a list
 * ------------------------------------------------------------------------ */

/**
 * ⚠️ AN ITEM MAY BE A STRING **OR** A PERSON WITH A PICTURE, and the union is
 * deliberate rather than lazy. This took `readonly string[]` and therefore drew
 * initials only — so the one thing a stack of faces is for, recognising people
 * without reading, it could not do. Every existing call site passes plain strings
 * (there were none at all when this changed, which is why the signature could
 * move), and a caller that has avatar URLs passes objects.
 *
 * Keyed by index, not by name: two people called "Ali" is a real thing in this
 * division and a duplicate React key would drop one of the faces.
 */
export type StackPerson = string | { readonly name: string; readonly src?: string | null };

const nameOf = (person: StackPerson) => (typeof person === 'string' ? person : person.name);
const srcOf = (person: StackPerson) => (typeof person === 'string' ? null : person.src ?? null);

export function AvatarStack({
  names,
  max = 4,
  size = 'sm',
  className,
}: {
  names: readonly StackPerson[];
  max?: number;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;

  return (
    <span className={cn('inline-flex items-center', className)}>
      {shown.map((person, i) => (
        <Avatar
          key={i}
          name={nameOf(person)}
          src={srcOf(person)}
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
