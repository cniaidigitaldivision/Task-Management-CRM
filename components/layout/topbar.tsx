'use client';

import { Bell, ChevronRight, Menu, Plus } from 'lucide-react';

import { ThemeToggle } from '@/components/brand/theme-toggle';
import { Button, IconButton } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/input';
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
        <IconButton
          label="Open navigation"
          icon={Menu}
          size="md"
          onClick={onOpenNav}
          className="-ml-1 lg:hidden"
        />

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

        {/* ---- Search — wired in Phase 5 (FR-086) ----
            Capped rather than fixed-width. `w-60 xl:w-80` with min-w-0 lets it
            give way when the breadcrumb is long, instead of forcing the bar
            wider than the viewport. */}
        <SearchInput
          label="Search tasks, projects and people"
          placeholder="Search tasks, projects, people…"
          shortcut="⌘K"
          size="md"
          className="hidden w-60 md:block xl:w-80"
        />

        <div className="flex shrink-0 items-center gap-1">
          <span className="relative inline-flex">
            <IconButton label="Notifications — 3 unread" icon={Bell} size="md" />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-1.5 right-1.5 h-2 w-2 rounded-full ring-2 ring-bg-surface"
              style={{ backgroundColor: 'var(--feedback-error)' }}
            />
          </span>

          <ThemeToggle />

          <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border-default" />

          <Button variant="primary" size="md" className="hidden sm:inline-flex">
            <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            New task
          </Button>
          <IconButton
            label="New task"
            icon={Plus}
            variant="primary"
            size="md"
            className="sm:hidden"
          />
        </div>
      </div>
    </header>
  );
}
