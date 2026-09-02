'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CalendarCheck, Film, Image as ImageIcon, Loader2, Plus } from 'lucide-react';

import { claimOwedContentAction } from '@/app/actions/tasks';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHAT YOUR PROJECTS STILL OWE TODAY
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03, on the flow that replaces pre-creating the month:
 *
 *   *"you will just set a tracker… on the basis of tracker, we will assess how
 *   much task daily of a static should be or a reel should be"*, and
 *   *"everyone will create his or her task by himself."*
 *
 * ── ⚠️ WHY THIS EXISTS AT ALL, AND WHY IT IS ON MY WORK ─────────────────────
 * Removing the generated month removed the thing that told people what to do.
 * Before this, a Member opening Taskly would have seen an empty board and no
 * way to learn that Daniyal Marketing was owed a static post — the rhythm was
 * agreed with the client and recorded on the project, and invisible to the
 * person expected to deliver it.
 *
 * So the tracker's answer is put where the day starts: their own page. One line
 * per outstanding post, one press to take it on. It is not a task list — nothing
 * here exists in the database yet, which is the whole point.
 *
 * ── ⚠️ A ROW DISAPPEARING IS THE SUCCESS CASE ───────────────────────────────
 * Whoever presses first settles the day for the project, so somebody else's
 * click can empty a row a moment before yours. The refusal that produces is
 * shown rather than swallowed, and it names who took it — otherwise the button
 * would look broken at the exact moment the system worked.
 * ========================================================================= */

export interface OwedItem {
  readonly projectId: string;
  readonly projectName: string;
  readonly kind: 'static' | 'reel';
  /** How many are outstanding — a project on two a day can owe two. */
  readonly count: number;
  /** For a reel: where the week stands, so the row says why it is owed. */
  readonly note: string | null;
}

export function OwedToday({ items }: { items: readonly OwedItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  /* Rows already taken on in this session are hidden immediately, so the list
     shortens as somebody works down it rather than waiting on a refresh. */
  const [taken, setTaken] = React.useState<readonly string[]>([]);
  const visible = items.filter((item) => !taken.includes(`${item.projectId}:${item.kind}`));

  if (visible.length === 0) {
    /* ⚠️ Deliberately not silence. "Nothing owed" is a real answer and the one
       people most want at the end of a day; an empty space reads as a section
       that failed to load. */
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border-default bg-bg-surface px-3.5 py-3">
        <CalendarCheck
          className="size-4 shrink-0"
          style={{ color: 'var(--feedback-success)' }}
          strokeWidth={2.25}
          aria-hidden="true"
        />
        <p className="text-body-sm text-text-secondary">
          Nothing outstanding today — every project you are on has its posts accounted for.
        </p>
      </div>
    );
  }

  const claim = (item: OwedItem) => {
    const key = `${item.projectId}:${item.kind}`;
    setBusy(key);
    setError(null);
    void (async () => {
      const result = await claimOwedContentAction(item.projectId, item.kind);
      setBusy(null);
      if (!result.ok) {
        setError(result.error ?? 'That could not be created.');
        /* Refresh even on failure: the usual cause is somebody else taking it,
           and the list should now agree with them. */
        router.refresh();
        return;
      }
      setTaken((previous) => [...previous, key]);
      router.refresh();
    })();
  };

  return (
    <div className="space-y-2">
      {error && (
        <p
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-warning)' }}
          role="status"
        >
          <AlertTriangle className="mt-px size-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface">
        {visible.map((item, index) => {
          const key = `${item.projectId}:${item.kind}`;
          const Icon = item.kind === 'reel' ? Film : ImageIcon;

          return (
            <div
              key={key}
              className={cn(
                'flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-2.5',
                index > 0 && 'border-t border-border-subtle',
              )}
            >
              <Icon
                className="size-4 shrink-0 text-text-tertiary"
                strokeWidth={2.25}
                aria-hidden="true"
              />

              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm font-medium text-text-primary">
                  {item.projectName}
                </p>
                <p className="text-micro text-text-secondary">
                  {item.count > 1 ? `${item.count} ` : ''}
                  {item.kind === 'reel' ? 'reel' : 'static post'}
                  {item.count > 1 ? 's' : ''} not yet created
                  {item.note ? ` · ${item.note}` : ''}
                </p>
              </div>

              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => claim(item)}
              >
                {busy === key ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-4" strokeWidth={2.5} aria-hidden="true" />
                )}
                Take it on
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
