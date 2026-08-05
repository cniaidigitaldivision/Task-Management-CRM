'use client';

import { Bell, Menu, Plus, Search } from 'lucide-react';

import { ThemeToggle } from '@/components/brand/theme-toggle';
import { Button } from '@/components/ui/button';

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
    <header className="sticky top-0 z-30 border-b border-border-default bg-bg-base/80 backdrop-blur-md">
      <div className="flex h-[var(--topbar-height)] items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          className="-ml-1 rounded-md p-2 text-text-secondary hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none lg:hidden"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-h2 text-text-primary">{title}</h1>
          {subtitle && (
            <p className="truncate text-caption text-text-secondary">{subtitle}</p>
          )}
        </div>

        {/* Search — wired in Phase 5 (FR-086) */}
        <div className="hidden items-center md:flex">
          <label className="relative block">
            <span className="sr-only">Search tasks and projects</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="Search…"
              className="h-9 w-56 rounded-lg border border-border-default bg-bg-surface pl-9 pr-3 text-body-sm text-text-primary placeholder:text-text-tertiary focus-visible:outline-none xl:w-72"
            />
          </label>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Notifications — 3 unread"
            className="relative rounded-md p-2 text-text-secondary transition-colors duration-[120ms] hover:bg-bg-hover hover:text-text-primary focus-visible:outline-none"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden="true" />
            <span
              aria-hidden="true"
              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-bg-base"
              style={{ backgroundColor: 'var(--feedback-error)' }}
            />
          </button>

          <ThemeToggle />

          <Button variant="primary" size="md" className="ml-1 hidden sm:inline-flex">
            <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            New task
          </Button>
          <Button variant="primary" size="icon" className="ml-1 sm:hidden" aria-label="New task">
            <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </header>
  );
}
