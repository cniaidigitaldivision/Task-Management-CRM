'use client';

import * as React from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

/* ============================================================================
 * PICK SEVERAL PEOPLE, WITH CHECKBOXES
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25, of the credential form's "Issued to" dropdown:
 *
 *   "I have to assign only Kashif and Larip so how can I select them? I want that
 *    dropdown to show the team names with checkboxes so I can select multiple team
 *    members and select 'Nobody' instead of using 'Everyone'. It is more
 *    understandable."
 *
 * ── ⚠️ WHY THIS IS NOT A `<select multiple>` ────────────────────────────────
 * A native multi-select is the obvious answer and is unusable: selecting a second
 * option requires ctrl-clicking, which nobody discovers, and clicking a second
 * name without it silently deselects the first. Every real product uses a menu of
 * checkboxes for this, and that is what the owner drew.
 *
 * ── ⚠️ "NOBODY" IS AN EXPLICIT CHOICE, NOT AN EMPTY LIST ────────────────────
 * The owner's exact objection: *"nobody is particularly selected. That means
 * everybody can do it."* An empty picker is ambiguous between "I have not chosen
 * yet" and "I mean nobody" — so the first row says **Nobody** and is ticked when
 * the list is empty. The summary then reads "Nobody" rather than a blank field,
 * and there is no state where the control declines to say what it means.
 *
 * ── STILL A REAL FORM CONTROL ───────────────────────────────────────────────
 * The credential dialog submits with a plain `<form>` and a server action, so the
 * value has to reach `FormData`. Each selected id is rendered as a hidden input
 * under the same `name`, which is exactly what a native multi-select would send —
 * so `formData.getAll(name)` works and no handler had to change shape.
 * ========================================================================= */

export interface PeoplePickerProps {
  /** The form field name. Each selection is submitted under it. */
  readonly name: string;
  readonly people: ReadonlyArray<{ id: string; name: string; avatarUrl?: string | null }>;
  readonly selected: readonly string[];
  readonly onChange: (next: string[]) => void;
  /** What the empty state is called — "Nobody" for custody, "Everyone" elsewhere. */
  readonly emptyLabel?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function PeoplePicker({
  name,
  people,
  selected,
  onChange,
  emptyLabel = 'Nobody',
  placeholder = 'Search people…',
  disabled = false,
  className,
}: PeoplePickerProps) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = React.useState('');

  /* `<details>` gives keyboard toggling and Escape for free; the outside-click it
     does not provide is added here. ⚠️ NO close-on-pick — ticking three people is
     three clicks in one panel, which is the whole point of the control. */
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const close = (event: Event) => {
      if (!node.open) return;
      if (event.type === 'mousedown' && node.contains(event.target as Node)) return;
      if (event.type === 'keydown' && (event as KeyboardEvent).key !== 'Escape') return;
      node.removeAttribute('open');
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  const chosen = new Set(selected);
  const shown = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((p) => p.name.toLowerCase().includes(needle));
  }, [people, query]);

  const toggle = (id: string) => {
    onChange(chosen.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };

  /* One name in full, two names in full, then a count — "Kashif Ahmed, Lareeb Khan"
     is far more use than "2 selected", and beyond two nothing fits. */
  const names = selected
    .map((id) => people.find((p) => p.id === id)?.name)
    .filter((n): n is string => Boolean(n));
  const summary =
    names.length === 0
      ? emptyLabel
      : names.length <= 2
        ? names.join(', ')
        : `${names[0]} and ${names.length - 1} others`;

  return (
    <details ref={ref} className={cn('relative', className)}>
      <summary
        aria-label="Choose people"
        className={cn(
          'flex h-10 cursor-pointer list-none items-center gap-2 rounded-lg border px-3',
          'text-body-sm marker:content-none [&::-webkit-details-marker]:hidden',
          disabled
            ? 'pointer-events-none border-border-subtle text-text-disabled'
            : selected.length > 0
              ? 'border-border-brand text-text-primary'
              : 'border-border-default text-text-secondary hover:border-border-strong',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {selected.length > 0 && (
          <span
            role="presentation"
            aria-hidden="true"
            title="Clear"
            onClick={(event) => {
              /* Stops the summary toggling the panel open as well as clearing. */
              event.preventDefault();
              event.stopPropagation();
              onChange([]);
            }}
            className="grid size-5 shrink-0 place-items-center rounded text-text-tertiary hover:bg-bg-active hover:text-text-primary"
          >
            <X className="size-3.5" strokeWidth={2.5} />
          </span>
        )}
        <ChevronDown className="size-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      </summary>

      <div className="absolute left-0 z-40 mt-1 w-full min-w-[15rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-[var(--shadow-lg)]">
        {/* Only worth a search box when the list is long enough to scan badly. */}
        {people.length > 6 && (
          <div className="relative border-b border-border-subtle p-2">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary"
              strokeWidth={2.25}
              aria-hidden="true"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
              className="h-8 w-full rounded-lg border border-border-default bg-bg-surface pl-7 pr-2 text-caption text-text-primary placeholder:text-text-tertiary focus-visible:border-border-brand focus-visible:outline-none"
            />
          </div>
        )}

        <div className="max-h-[14rem] overflow-y-auto py-1">
          {/* ⚠️ "Nobody" FIRST, and ticked when nothing is chosen. See the header:
              an empty picker cannot say whether somebody meant nobody or had not
              decided, and that ambiguity is what the owner objected to. */}
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-caption text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          >
            <span className="font-semibold">{emptyLabel}</span>
            {selected.length === 0 && (
              <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
            )}
          </button>

          <div className="my-1 h-px bg-border-subtle" />

          {shown.map((person) => {
            const on = chosen.has(person.id);
            return (
              <button
                key={person.id}
                type="button"
                /* `aria-checked` with `role="checkbox"`: a screen reader should hear
                   the state, and these are independent toggles rather than one
                   choice among several — which is what separates this from a
                   radiogroup. */
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(person.id)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-caption',
                  on ? 'text-text-primary' : 'text-text-secondary',
                  'hover:bg-bg-hover hover:text-text-primary',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-4 shrink-0 place-items-center rounded border-2',
                    on ? 'border-border-brand bg-accent-primary' : 'border-border-strong',
                  )}
                >
                  {on && (
                    <Check
                      className="size-3"
                      strokeWidth={3}
                      style={{ color: 'var(--text-on-brand)' }}
                    />
                  )}
                </span>
                <Avatar name={person.name} src={person.avatarUrl ?? null} size="xs" />
                <span className="min-w-0 flex-1 truncate">{person.name}</span>
              </button>
            );
          })}

          {shown.length === 0 && (
            <p className="px-3 py-4 text-center text-micro text-text-tertiary">
              {people.length === 0 ? 'No people to choose from.' : `Nobody matches “${query}”.`}
            </p>
          )}
        </div>
      </div>

      {/* ⚠️ The form value. One hidden input per selection under the same name, so
          `formData.getAll(name)` returns them — identical to what a native
          multi-select submits, which is why no action had to change shape. */}
      {selected.map((id) => (
        <input key={id} type="hidden" name={name} value={id} />
      ))}
    </details>
  );
}
