import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { NotificationList } from '@/components/notifications/notification-list';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth/current-user';
import { countNotifications, countUnread, listNotifications } from '@/lib/db/queries/feed';
import { APP_NAME } from '@/lib/domain/constants';
import { isoDateIn, nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Notifications' };

/* ============================================================================
 * NOTIFICATIONS — owner, 2026-09-08
 * ----------------------------------------------------------------------------
 * The full history behind the bell. See components/notifications for the list
 * itself and the reasoning about clicking a row.
 *
 * ── ⚠️ `requireUser`, NOT `requireRole` ─────────────────────────────────────
 * Every rank has an inbox and every rank's inbox is their own: RLS on
 * `notifications` restricts every row to its own user INCLUDING the Super
 * Admin, so there is no scope here to widen and nothing a floor would protect.
 * A role gate would only lock people out of their own messages.
 *
 * ── PAGED, BECAUSE "ALL" HAS NO CEILING ─────────────────────────────────────
 * *"I want to see all the notifications"* — and a person who has been here a
 * year has thousands. Fifty at a time keeps the payload small, which is where
 * this application's slowness has actually been, twice.
 * ========================================================================= */

const PER_PAGE = 50;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  /* ⚠️ Clamped rather than trusted. `?page=-4` would send a negative offset to
     Postgres, which refuses it with a 500 — an error page for a URL somebody
     typed by hand. */
  const requested = Number(params.page ?? '1');
  const page = Number.isFinite(requested) && requested > 1 ? Math.floor(requested) : 1;
  const offset = (page - 1) * PER_PAGE;

  const [notifications, total, unread] = await Promise.all([
    listNotifications(user.id, PER_PAGE, offset),
    countNotifications(user.id),
    countUnread(user.id),
  ]);

  const today = isoDateIn(nowMs());
  const yesterday = isoDateIn(nowMs() - 86_400_000);
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-6">
      <PageHeader
        eyebrow={APP_NAME}
        title="Notifications"
        description={
          total === 0
            ? 'Everything the system has told you will appear here.'
            : `Everything the system has told you — ${total} in total, newest first.`
        }
      />

      <NotificationList
        notifications={notifications}
        unreadCount={unread}
        todayIso={today}
        yesterdayIso={yesterday}
      />

      {lastPage > 1 && (
        <nav
          className="flex items-center justify-between gap-3 border-t border-border-subtle pt-4"
          aria-label="Notification pages"
        >
          {/* Links rather than buttons, so a page of history can be bookmarked
              and opened in a new tab like any other address. */}
          {page > 1 ? (
            <Link
              href={`/notifications?page=${page - 1}` as '/notifications'}
              className="inline-flex items-center gap-1.5 text-caption font-semibold text-text-brand hover:underline"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
              Newer
            </Link>
          ) : (
            <span />
          )}

          <p className="text-caption text-text-tertiary">
            Page {page} of {lastPage}
          </p>

          {page < lastPage ? (
            <Link
              href={`/notifications?page=${page + 1}` as '/notifications'}
              className="inline-flex items-center gap-1.5 text-caption font-semibold text-text-brand hover:underline"
            >
              Older
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
