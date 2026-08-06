'use client';

import { Bell, ChevronRight, Menu, Plus, Search } from 'lucide-react';

import { ThemeToggle } from '@/components/brand/theme-toggle';
import { Button } from '@/components/ui/button';
import { APP_NAME } from '@/lib/domain/constants';

/* ============================================================================
 * TOPBAR
 * ----------------------------------------------------------------------------
 * Theme-aware, unlike the rail — this follows the ClickUp/Asana arrangement of
 * a constant dark navigation rail beside a light, airy content area. A dark bar
 * here as well would close the interface in and make the content feel cramped.
 *
 * It is a solid surface with a real border, not a translucent blur over the
 * page. The old version had no edge of its own, so the header and the content
 * ran together and nothing anchored the top of the screen.
 *
 * The bar carries orientation (where am I) and global actions (search, alerts,
 * create). Page-specific headings live in the content, so nothing is said
 * twice.
 * ========================================================================= */

export function Topbar({
  title,
  subtitle,
  onOpenNav,
}: {
  title: string;
  subtitle?: string;
  onOpenNav: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border-default bg-bg-surface/85 backdrop-blur-xl">
      <div className="flex h-[var(--topbar-height)] items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          className="-ml-1 rounded-lg p-2 text-text-secondary transition-colors duration-[120ms] hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none lg:hidden"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>

        {/* ---- Breadcrumb ----
            Orientation, not decoration: it names the workspace, then the page,
            which is what tells someone deep in a task list where they are. */}
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 items-center gap-1.5">
            <li className="hidden shrink-0 sm:block">
              <span className="text-caption font-medium text-text-tertiary">{APP_NAME}</span>
            </li>
            <li aria-hidden="true" className="hidden shrink-0 sm:block">
              <ChevronRight className="h-3.5 w-3.5 text-text-disabled" strokeWidth={2} />
            </li>
            <li className="min-w-0">
              <h1 className="truncate text-h3 font-semibold text-text-primary">{title}</h1>
              {subtitle && (
                <p className="truncate text-micro text-text-tertiary">{subtitle}</p>
              )}
            </li>
          </ol>
        </nav>

        {/* ---- Search — wired in Phase 5 (FR-086) ---- */}
        <div className="hidden items-center md:flex">
          <label className="relative block">
            <span className="sr-only">Search tasks, projects and people</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-tertiary"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="Search tasks, projects, people…"
              className="h-9 w-60 rounded-lg border border-border-default bg-bg-surface-sunken pr-14 pl-9 text-body-sm text-text-primary transition-[border-color,box-shadow] duration-[140ms] placeholder:text-text-tertiary hover:border-border-strong focus:border-border-brand focus:bg-bg-surface focus-visible:outline-none xl:w-80"
            />
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-md border border-border-default bg-bg-surface px-1.5 py-0.5 font-sans text-micro font-semibold text-text-tertiary"
            >
              ⌘K
            </kbd>
          </label>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Notifications — 3 unread"
            className="relative rounded-lg p-2 text-text-secondary transition-colors duration-[120ms] hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
            <span
              aria-hidden="true"
              className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full ring-2 ring-bg-surface"
              style={{ backgroundColor: 'var(--feedback-error)' }}
            />
          </button>

          <ThemeToggle />

          <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-border-default" />

          <Button variant="primary" size="md" className="hidden sm:inline-flex">
            <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            New task
          </Button>
          <Button variant="primary" size="icon" className="sm:hidden" aria-label="New task">
            <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </header>
  );
}
