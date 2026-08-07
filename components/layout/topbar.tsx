'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, ChevronRight, Menu, Plus } from 'lucide-react';

import { markAllReadAction } from '@/app/actions/notifications';
import { ThemeToggle } from '@/components/brand/theme-toggle';
import { GlobalSearch } from '@/components/layout/global-search';
import { Button, IconButton } from '@/components/ui/button';
import type { NotificationRow } from '@/lib/db/queries/types';
import { APP_NAME } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

/* ============================================================================
 * TOPBAR
 * ----------------------------------------------------------------------------
 * Theme-aware, unlike the rail — this follows the ClickUp/Asana arrangement of a
 * constant dark navigation rail beside a light, airy content area. A dark bar
 * here as well would close the interface in and make the content feel cramped.
 *
 * It carries orientation (where am I) and global actions (search, alerts,
 * create). Page-specific headings live in the content, so nothing is said twice.
 *
 * ── SEARCH SUBMITS, IT DOES NOT FILTER-AS-YOU-TYPE ───────────────────────────
 * Enter navigates to /tasks?q=…, and the Tasks screen does the filtering with a
 * real query. Live filtering here would need every task on every page, which is
 * a lot of data to hold just so a header can be clever — and the results would
 * be wrong for a member, whose row-level view is narrower.
 * ========================================================================= */

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

export function Topbar({
  title,
  subtitle,
  onOpenNav,
  onNewTask,
  notifications,
  unreadCount,
}: {
  title: string;
  subtitle?: string;
  onOpenNav: () => void;
  onNewTask: () => void;
  notifications: readonly NotificationRow[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [bellOpen, setBellOpen] = React.useState(false);
  const bellRef = React.useRef<HTMLDivElement>(null);

  /* Close on an outside click or Escape. Both, because either alone leaves the
     panel feeling stuck — keyboard users get no way out of the first, mouse
     users get no way out of the second. */
  React.useEffect(() => {
    if (!bellOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!bellRef.current?.contains(event.target as Node)) setBellOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBellOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [bellOpen]);

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

        {/* ---- Breadcrumb: orientation, not decoration ---- */}
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
              {subtitle && <p className="truncate text-micro text-text-tertiary">{subtitle}</p>}
            </li>
          </ol>
        </nav>

        {/* Was a tasks-only form that advertised ⌘K and did not implement it.
            The palette covers tasks, projects and people, and the shortcut is
            now real. */}
        <div className="hidden w-60 md:block xl:w-80">
          <GlobalSearch />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* ---- Notifications ---- */}
          <div ref={bellRef} className="relative inline-flex">
            <IconButton
              label={unreadCount > 0 ? `Notifications — ${unreadCount} unread` : 'Notifications'}
              icon={Bell}
              size="md"
              onClick={() => setBellOpen((v) => !v)}
              aria-expanded={bellOpen}
            />
            {unreadCount > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  'tabular pointer-events-none absolute -top-0.5 -right-0.5 inline-flex min-w-[17px]',
                  'items-center justify-center rounded-full px-1 text-[10px] font-bold leading-[17px]',
                  'ring-2 ring-bg-surface',
                )}
                style={{ backgroundColor: 'var(--feedback-error)', color: 'var(--neutral-0)' }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}

            {bellOpen && (
              <div
                className="absolute top-[calc(100%+8px)] right-0 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-[var(--shadow-xl)]"
                role="dialog"
                aria-label="Notifications"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3.5 py-2.5">
                  <span className="text-caption font-semibold text-text-primary">Notifications</span>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={async () => {
                        await markAllReadAction();
                        router.refresh();
                      }}
                      className="inline-flex items-center gap-1 text-micro font-semibold text-text-brand hover:underline"
                    >
                      <CheckCheck className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                      Mark all read
                    </button>
                  )}
                </div>

                <ul className="max-h-[22rem] divide-y divide-border-subtle overflow-y-auto">
                  {notifications.length === 0 && (
                    <li className="px-3.5 py-6 text-center text-caption text-text-tertiary">
                      Nothing yet. You will hear about work assigned to you, reviews and blockers.
                    </li>
                  )}
                  {notifications.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={(item.linkTo ?? '/tasks') as '/tasks'}
                        onClick={() => setBellOpen(false)}
                        className={cn(
                          'block px-3.5 py-2.5 transition-colors hover:bg-bg-surface-sunken',
                          !item.isRead && 'bg-bg-gold-subtle',
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {!item.isRead && (
                            <span
                              aria-hidden="true"
                              className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ backgroundColor: 'var(--accent-gold)' }}
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-caption font-semibold text-text-primary">
                              {item.title}
                            </p>
                            {item.body && (
                              <p className="truncate text-micro text-text-secondary">{item.body}</p>
                            )}
                            <p className="mt-0.5 text-micro text-text-tertiary">
                              {relative(item.createdAt)}
                            </p>
                          </div>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <ThemeToggle />

          <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border-default" />

          <Button
            variant="primary"
            size="md"
            className="hidden sm:inline-flex"
            onClick={onNewTask}
            title="New task (N)"
          >
            <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            New task
          </Button>
          <IconButton
            label="New task"
            icon={Plus}
            variant="primary"
            size="md"
            className="sm:hidden"
            onClick={onNewTask}
          />
        </div>
      </div>
    </header>
  );
}
