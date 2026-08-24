'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FolderKanban, Loader2, Search, SquareCheckBig, User, X } from 'lucide-react';

import { searchAction } from '@/app/actions/search';
import type { SearchResults } from '@/lib/db/queries/search';
import { STATUS_META } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

/* ============================================================================
 * GLOBAL SEARCH — FR-085
 * ----------------------------------------------------------------------------
 * ── IT IS A REAL BOX IN THE BAR. IT DOES NOT OPEN A SCREEN ───────────────────
 * Owner instruction, Session 17: *"if I click the search it should just search
 * there… the cursor should start blinking over there… I don't want it to pop up
 * and give another screen, it's looking very bad."*
 *
 * This used to be a button that looked like an input and opened a full-screen
 * command palette over a dimmed backdrop. The reasoning at the time was that the
 * palette needs to own the keystrokes, and that two boxes — one in the bar, one
 * in the overlay — is a race to see which has focus.
 *
 * That reasoning was sound and the conclusion was still wrong, because there is
 * a third option it missed: **one** box, in the bar, that owns its own
 * keystrokes. No overlay, no backdrop, no second input, no focus race. The
 * results hang under it as a dropdown, anchored to the box they came from, and
 * the page behind stays exactly where it was.
 *
 * ── WHAT THAT COSTS, AND WHY IT IS WORTH IT ──────────────────────────────────
 * The dropdown is narrower than a centred palette, so a long task title truncates
 * sooner. Against that: you can see the page you are searching from, nothing
 * moves, and there is no modal to dismiss. For a search that mostly ends in
 * "jump to EVT-142" the anchored box is plainly better.
 *
 * ⌘K still works. It focuses this box rather than opening anything.
 *
 * ── IT SEARCHES ON THE SERVER, UNDER THE SEARCHER'S IDENTITY ─────────────────
 * Unchanged, and the important part. No client-side filtering of a preloaded
 * list. Search is where a permission model usually leaks — the fast version
 * ships every task to the browser and hides most of them — and here RLS removes
 * the rows before they are sent. A Member's search cannot return work they are
 * not on, because the query never sees it.
 * ========================================================================= */

const EMPTY: SearchResults = { tasks: [], projects: [], people: [], total: 0, tooShort: true };

const ICON = {
  task: SquareCheckBig,
  project: FolderKanban,
  person: User,
} as const;

export function GlobalSearch() {
  const router = useRouter();
  const [term, setTerm] = React.useState('');
  const [results, setResults] = React.useState<SearchResults>(EMPTY);
  const [answeredFor, setAnsweredFor] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  /* Whether the dropdown is showing. Distinct from "has a term": clicking away
     must hide the results without throwing away what was typed. */
  const [showing, setShowing] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  /* Click outside closes the dropdown. The input keeps its text and its focus
     ring is gone, so the next click straight back in resumes where they were. */
  React.useEffect(() => {
    if (!showing) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setShowing(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showing]);

  const tooShort = term.trim().length < 2;

  /* Debounced. Every keystroke firing a query is a request per character
     against a pooled connection, and the answers then race each other.
     Nothing is set when the term is too short — that case is DERIVED below
     rather than stored, because writing it here would be a setState in an
     effect body and a cascading render (react-hooks/set-state-in-effect). */
  React.useEffect(() => {
    if (tooShort) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchAction(term)
        .then((found) => {
          if (cancelled) return;
          setResults(found);
          setAnsweredFor(term);
          setCursor(0);
        })
        .catch(() => {
          if (cancelled) return;
          setAnsweredFor(term);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, tooShort]);

  /* ── Only ever show the answer to the term that is CURRENTLY typed ──────────
     `results` still holds the last answered query while a new one is in flight.
     Rendering that would flash somebody else's matches under a half-typed word,
     which is precisely the jumpiness this box was rebuilt to remove. */
  const settled = !tooShort && answeredFor === term;
  const shown = settled ? results : EMPTY;

  const flat = React.useMemo(
    () => [...shown.tasks, ...shown.projects, ...shown.people],
    [shown],
  );

  const go = React.useCallback(
    (href: string) => {
      setShowing(false);
      setTerm('');
      setResults(EMPTY);
      inputRef.current?.blur();
      router.push(href as never);
    },
    [router],
  );

  const searching = !tooShort && !settled;
  const open = showing && term.trim().length > 0;

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border bg-bg-surface px-2.5 py-1.5',
          'transition-colors duration-[120ms]',
          open ? 'border-border-brand' : 'border-border-default hover:border-border-strong',
        )}
      >
        {/* The magnifier is a real button — the owner asked for one they can
            click. It focuses the box when empty and re-runs the term when not,
            which is what "click it and it searches" means for a box that is
            already searching as you type. */}
        <button
          type="button"
          aria-label="Search"
          onClick={() => {
            inputRef.current?.focus();
            if (term.trim().length > 0) setShowing(true);
          }}
          className="shrink-0 rounded text-text-tertiary transition-colors hover:text-text-secondary focus-visible:outline-none"
        >
          <Search className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        </button>

        <input
          ref={inputRef}
          type="search"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setShowing(true);
          }}
          onFocus={() => setShowing(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setShowing(true);
              setCursor((c) => Math.min(c + 1, flat.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (event.key === 'Enter' && flat[cursor]) {
              event.preventDefault();
              go(flat[cursor].href);
            } else if (event.key === 'Escape') {
              /* Not stopped from bubbling on purpose: if the dropdown is already
                 shut, Escape should still reach whatever else wants it. */
              if (open) {
                event.preventDefault();
                setShowing(false);
              }
            }
          }}
          placeholder="Search tasks, projects, people…"
          aria-label="Search tasks, projects and people"
          aria-expanded={open}
          role="combobox"
          aria-controls="global-search-results"
          className={cn(
            'min-w-0 flex-1 bg-transparent text-caption text-text-primary outline-none',
            'placeholder:text-text-tertiary',
            /* Chrome draws its own clear button on type=search and it collides
               with ours. */
            '[&::-webkit-search-cancel-button]:appearance-none',
          )}
        />

        {searching && (
          <Loader2
            className="h-3.5 w-3.5 shrink-0 animate-spin text-text-tertiary"
            aria-hidden="true"
          />
        )}

        {term.length > 0 && !searching && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setTerm('');
              setResults(EMPTY);
              setShowing(false);
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded text-text-tertiary transition-colors hover:text-text-secondary focus-visible:outline-none"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
        )}

        {term.length === 0 && (
          <kbd className="hidden shrink-0 rounded border border-border-subtle px-1 font-mono text-[10px] text-text-tertiary sm:inline">
            ⌘K
          </kbd>
        )}
      </div>

      {/* ---- Results, anchored under the box ----
          `absolute` inside a `relative` parent, so it hangs off the input and
          scrolls with the bar rather than being pinned to the viewport. */}
      {open && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute top-[calc(100%+6px)] right-0 z-50 w-[min(30rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-strong bg-bg-surface shadow-[var(--shadow-xl)]"
        >
          {/* /var(--ui-scale): vh ignores the density zoom on body — see tokens.css */}
          <div className="max-h-[calc(60vh/var(--ui-scale))] overflow-y-auto">
            {tooShort && (
              <p className="px-3.5 py-5 text-center text-caption text-text-tertiary">
                Type at least two characters. A reference like{' '}
                <span className="font-mono text-micro">EVT-142</span> jumps straight there.
              </p>
            )}

            {searching && (
              <p className="px-3.5 py-5 text-center text-caption text-text-tertiary">Searching…</p>
            )}

            {settled && flat.length === 0 && (
              <p className="px-3.5 py-5 text-center text-caption text-text-tertiary">
                Nothing matches “{term}”. If you expected a task here, it may belong to somebody
                whose work you cannot see.
              </p>
            )}

            {(
              [
                ['Tasks', shown.tasks],
                ['Projects', shown.projects],
                ['People', shown.people],
              ] as const
            ).map(([heading, hits]) =>
              hits.length === 0 ? null : (
                <div key={heading}>
                  <p className="bg-bg-surface-sunken px-3.5 py-1 text-micro font-semibold tracking-wide text-text-tertiary uppercase">
                    {heading}
                  </p>
                  <ul>
                    {hits.map((hit) => {
                      const index = flat.indexOf(hit);
                      const Icon = ICON[hit.kind];
                      return (
                        <li key={`${hit.kind}-${hit.id}`}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={index === cursor}
                            onMouseEnter={() => setCursor(index)}
                            onClick={() => go(hit.href)}
                            className={cn(
                              'flex w-full items-center gap-2.5 px-3.5 py-2 text-left',
                              index === cursor ? 'bg-bg-selected' : 'hover:bg-bg-hover',
                            )}
                          >
                            <Icon
                              className="h-4 w-4 shrink-0 text-text-tertiary"
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                            <span className="tabular w-20 shrink-0 truncate text-micro font-semibold text-text-brand">
                              {hit.label}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-caption text-text-primary">
                              {hit.title}
                            </span>
                            {hit.status && (
                              <span className="flex shrink-0 items-center gap-1 text-micro text-text-tertiary">
                                <span
                                  aria-hidden="true"
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{
                                    backgroundColor: `var(--${STATUS_META[hit.status].token})`,
                                  }}
                                />
                                {STATUS_META[hit.status].label}
                              </span>
                            )}
                            {hit.detail && !hit.status && (
                              <span className="shrink-0 truncate text-micro text-text-tertiary">
                                {hit.detail}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}
