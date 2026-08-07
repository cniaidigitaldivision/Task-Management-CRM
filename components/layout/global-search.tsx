'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { FolderKanban, Loader2, Search, SquareCheckBig, User } from 'lucide-react';

import { searchAction } from '@/app/actions/search';
import type { SearchResults } from '@/lib/db/queries/search';
import { STATUS_META } from '@/lib/domain/constants';

/* ============================================================================
 * GLOBAL SEARCH — FR-085
 * ----------------------------------------------------------------------------
 * ── ⌘K, AND THE SLASH THAT IS NOT ────────────────────────────────────────────
 * Cmd/Ctrl-K opens it, Escape closes it, the arrows move and Enter opens. The
 * single-key `/` shortcut most tools also bind is deliberately absent: this
 * application is full of text boxes, and a shortcut that steals a keystroke
 * mid-sentence is worse than no shortcut.
 *
 * ── IT SEARCHES ON THE SERVER, UNDER THE SEARCHER'S IDENTITY ─────────────────
 * No client-side filtering of a preloaded list. Search is where a permission
 * model usually leaks — the fast version ships every task to the browser and
 * hides most of them — and here RLS removes the rows before they are sent. A
 * Member's search box cannot return work they are not on, because the query
 * never sees it.
 * ========================================================================= */

const EMPTY: SearchResults = { tasks: [], projects: [], people: [], total: 0, tooShort: true };

const ICON = {
  task: SquareCheckBig,
  project: FolderKanban,
  person: User,
} as const;

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState('');
  const [results, setResults] = React.useState<SearchResults>(EMPTY);
  const [answeredFor, setAnsweredFor] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  /* ⌘K / Ctrl-K, bound at the window because it has to work wherever the focus
     happens to be. */
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  /* Debounced. Every keystroke firing a query is a request per character
     against a pooled connection, and the answers then race each other. */
  React.useEffect(() => {
    if (!open) return;
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
  }, [term, open]);

  const flat = React.useMemo(
    () => [...results.tasks, ...results.projects, ...results.people],
    [results],
  );

  const go = React.useCallback(
    (href: string) => {
      setOpen(false);
      setTerm('');
      setResults(EMPTY);
      router.push(href as never);
    },
    [router],
  );

  if (!open) {
    /* Looks like an input and is a button. It cannot be a real text field: the
       palette needs to own the keystrokes, and two boxes — one in the bar, one
       in the overlay — is a race to see which has focus. */
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 text-left text-caption text-text-tertiary transition-colors hover:border-border-strong hover:text-text-secondary"
      >
        <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Search tasks, projects, people…</span>
        <kbd className="hidden shrink-0 rounded border border-border-subtle px-1 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </button>
    );
  }

  const searching = term.trim().length >= 2 && answeredFor !== term;

  return (
    <>
      {/* A real button rather than a div with a click handler: the backdrop is
          a dismiss control, and making it one means it is reachable and
          announced instead of being invisible to anybody not using a mouse.
          Escape closes it too, bound at the window above. */}
      <button
        type="button"
        aria-label="Close search"
        className="fixed inset-0 z-50 bg-[var(--bg-scrim)] backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div className="fixed inset-x-0 top-[12vh] z-50 mx-auto w-[min(42rem,92vw)]">
        <div className="overflow-hidden rounded-xl border border-border-strong bg-bg-surface shadow-lg">
          <div className="flex items-center gap-2 border-b border-border-subtle px-3.5 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
            <input
              ref={inputRef}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setCursor((c) => Math.min(c + 1, flat.length - 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (event.key === 'Enter' && flat[cursor]) {
                  event.preventDefault();
                  go(flat[cursor].href);
                }
              }}
              placeholder="Search a reference, a task, a project, a person…"
              className="w-full bg-transparent text-body-sm text-text-primary outline-none placeholder:text-text-tertiary"
            />
            {searching && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-tertiary" aria-hidden="true" />
            )}
            <kbd className="shrink-0 rounded border border-border-subtle px-1 font-mono text-[10px] text-text-tertiary">
              esc
            </kbd>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {results.tooShort && (
              <p className="px-3.5 py-6 text-center text-caption text-text-tertiary">
                Type at least two characters. A reference like{' '}
                <span className="font-mono text-micro">EVT-142</span> jumps straight there.
              </p>
            )}

            {!results.tooShort && flat.length === 0 && !searching && (
              <p className="px-3.5 py-6 text-center text-caption text-text-tertiary">
                Nothing matches “{term}”. If you expected a task here, it may belong to somebody
                whose work you cannot see.
              </p>
            )}

            {(
              [
                ['Tasks', results.tasks],
                ['Projects', results.projects],
                ['People', results.people],
              ] as const
            ).map(([heading, hits]) =>
              hits.length === 0 ? null : (
                <div key={heading}>
                  <p className="bg-bg-surface-sunken px-3.5 py-1 text-micro font-semibold uppercase tracking-wide text-text-tertiary">
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
                            onMouseEnter={() => setCursor(index)}
                            onClick={() => go(hit.href)}
                            className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left ${
                              index === cursor ? 'bg-bg-selected' : 'hover:bg-bg-hover'
                            }`}
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
      </div>
    </>
  );
}
