'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCheck } from 'lucide-react';

import { markAllReadAction, markReadAction } from '@/app/actions/notifications';
import { notificationHref } from '@/lib/domain/task-notice';
import type { NotificationRow } from '@/lib/db/queries/types';
import { cn } from '@/lib/utils';

/* ============================================================================
 * THE NOTIFICATIONS PAGE — owner, 2026-09-08
 * ----------------------------------------------------------------------------
 *   *"create a notification page. There is no notification page so we should
 *   have one… there is a notification eyeball and the modal that has just
 *   limited notifications. If I want to see all the notifications, I will click
 *   on the bottom of the modal and it will bring me to that notification page…
 *   When I click on some row, it will bring me to that specific task."*
 *
 * The bell holds twelve rows and no history. Anything older than a busy morning
 * was unreachable — not hidden behind a scroll, genuinely never fetched — so a
 * notification missed was a notification gone.
 *
 * ── ⚠️ CLICKING A ROW MARKS IT READ, AND DOES NOT WAIT ──────────────────────
 * The mark and the navigation are fired together rather than sequenced. Waiting
 * for the write would put a round trip to Singapore between a click and a page
 * change, on the one interaction in this product that should feel instant. If
 * the write loses the race the row stays unread, which is a cosmetic wrong that
 * corrects itself the next time anything marks it — the opposite trade would
 * make every click feel broken.
 *
 * ⚠️ AND THE ROW IS GREYED OPTIMISTICALLY, in local state. Without it the row
 * you just clicked is still gold when the back button returns you here, because
 * the server component behind it was rendered before the write landed.
 * ========================================================================= */

/** Day headings, so a long list reads as a history rather than a wall. */
function dayLabel(iso: string, todayIso: string, yesterdayIso: string): string {
  const day = iso.slice(0, 10);
  if (day === todayIso) return 'Today';
  if (day === yesterdayIso) return 'Yesterday';
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function NotificationList({
  notifications,
  unreadCount,
  /* ⚠️ BOTH DATES COME FROM THE SERVER, in the division's zone. Computing
     "today" in the browser makes a row filed at 1am Karachi read as yesterday
     for anybody whose laptop is still on UTC — the same five-hour trap that has
     bitten the reporting figures twice. */
  todayIso,
  yesterdayIso,
}: {
  notifications: readonly NotificationRow[];
  unreadCount: number;
  todayIso: string;
  yesterdayIso: string;
}) {
  const router = useRouter();
  const [readLocally, setReadLocally] = React.useState<ReadonlySet<string>>(new Set());

  const open = (row: NotificationRow) => {
    if (row.isRead || readLocally.has(row.id)) return;
    setReadLocally((prev) => new Set(prev).add(row.id));
    void markReadAction([row.id]);
  };

  if (notifications.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-6 py-16 text-center">
        <p className="text-h3 font-semibold text-text-primary">Nothing here yet</p>
        <p className="mx-auto mt-2 max-w-md text-body-sm text-text-secondary">
          You will hear about work assigned to you, tasks waiting on your review, and anything
          you raised being finished.
        </p>
      </div>
    );
  }

  /* Grouped in one pass. The list arrives newest-first from the database, so
     the groups come out in order without a sort. */
  const groups: Array<{ label: string; rows: NotificationRow[] }> = [];
  for (const row of notifications) {
    const label = dayLabel(row.createdAt, todayIso, yesterdayIso);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }

  return (
    <div className="space-y-6">
      {unreadCount > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-bg-surface px-3.5 py-2.5">
          <p className="text-body-sm text-text-secondary">
            <span className="font-semibold text-text-primary">{unreadCount}</span> unread
          </p>
          <button
            type="button"
            onClick={async () => {
              await markAllReadAction();
              router.refresh();
            }}
            className="inline-flex items-center gap-1.5 text-caption font-semibold text-text-brand hover:underline"
          >
            <CheckCheck className="size-3.5" strokeWidth={2} aria-hidden="true" />
            Mark all read
          </button>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.label} className="space-y-2">
          <h2 className="text-caption font-semibold tracking-wide text-text-tertiary uppercase">
            {group.label}
          </h2>

          <ul className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
            {group.rows.map((row, index) => {
              const unread = !row.isRead && !readLocally.has(row.id);
              return (
                <li key={row.id}>
                  <Link
                    href={notificationHref(row) as '/tasks'}
                    onClick={() => open(row)}
                    className={cn(
                      'flex items-start gap-3 px-4 py-3 transition-colors hover:bg-bg-surface-sunken',
                      index > 0 && 'border-t border-border-subtle',
                      unread && 'bg-bg-gold-subtle',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('mt-1.5 size-2 shrink-0 rounded-full', !unread && 'opacity-0')}
                      style={{ backgroundColor: 'var(--accent-gold)' }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-semibold text-text-primary">
                        {row.title}
                      </span>
                      {row.body && (
                        <span className="mt-0.5 block truncate text-caption text-text-secondary">
                          {row.body}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 pt-0.5 text-micro text-text-tertiary tabular-nums">
                      {clockTime(row.createdAt)}
                    </span>
                    {unread && <span className="sr-only">Unread</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
