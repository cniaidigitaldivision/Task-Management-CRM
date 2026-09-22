'use client';

import * as React from 'react';
import { Repeat, Square } from 'lucide-react';

import { stopTaskSeriesAction, taskSeriesAction } from '@/app/actions/tasks';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { describeRecurrence, parseRecurrence } from '@/lib/domain/recurrence';
import type { TaskSeries } from '@/lib/db/queries/task-series';

/* ============================================================================
 * THE BUTTON THAT STOPS IT
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-22: *"if someone accidentally creates a task and doesn't notice
 * that it's a daily creation, there's no button to stop that daily creation of
 * tasks."* And the report behind it: *"he daily creates that task and assigns it
 * to me … they have 128 tasks from the last 20 days … their capacity is getting
 * full."*
 *
 * ── ⚠️ IT IS ON THE TASK, NOT IN A SETTINGS PAGE ───────────────────────────
 * The person drowning in copies is looking at one of the copies. That is where
 * the control has to be — not three clicks into an edit form whose "Does not
 * repeat" option used to do nothing at all (migration 250).
 *
 * ── ⚠️ THE TIDY-UP IS OFFERED, NEVER ASSUMED ───────────────────────────────
 * Stopping leaves the copies already made. The box offers to remove the ones
 * NOBODY HAS TOUCHED — still as created, nothing logged, nothing said — and
 * names the number before it does. Anything anybody started, finished or
 * commented on is their record of that day and is never touched.
 *
 * ── RULE ZERO ──────────────────────────────────────────────────────────────
 * The series is read once when the panel opens, from a row the page already
 * knows repeats; the confirmation is client state; stopping reports in the
 * frame it is pressed and reconciles underneath.
 * ========================================================================= */

export function RepeatPanel({
  taskId,
  /** From the task row — so the panel only appears for a task that repeats. */
  rule,
  onChanged,
}: {
  taskId: string;
  rule: string;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [series, setSeries] = React.useState<TaskSeries | null>(null);
  const [asking, setAsking] = React.useState(false);
  const [alsoRemove, setAlsoRemove] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  /* Stopped in this browser, before the server's rows catch up. */
  const [stopped, setStopped] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    void taskSeriesAction(taskId).then((r) => {
      if (live) setSeries(r.series);
    });
    return () => {
      live = false;
    };
  }, [taskId]);

  const parsed = parseRecurrence(rule);
  const said = parsed.ok ? describeRecurrence(parsed.rule) : 'Repeats';
  const isStopped = stopped || Boolean(series?.stoppedAt);

  const stop = async () => {
    if (!series) return;
    setBusy(true);
    setStopped(true);
    setAsking(false);
    const r = await stopTaskSeriesAction(series.id, { removeUntouched: alsoRemove });
    setBusy(false);
    if (!r.ok) {
      setStopped(false);
      toast({ tone: 'error', text: r.error ?? 'That repeating task could not be stopped.' });
      return;
    }
    toast({
      tone: 'ok',
      strong: series.title,
      text: r.removed
        ? `Stopped repeating. ${r.removed} copy nobody had started ${r.removed === 1 ? 'was' : 'were'} removed.`
        : 'Stopped repeating. No new copies will be created.',
    });
    onChanged?.();
  };

  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{
        backgroundColor: 'color-mix(in oklab, var(--accent-primary) var(--tint-soft), var(--bg-surface))',
        border: '1px solid color-mix(in oklab, var(--accent-primary) 28%, transparent)',
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Repeat className="size-3.5 shrink-0 text-text-brand" aria-hidden="true" />
        <p className="flex-1 text-micro font-semibold text-text-secondary">
          {isStopped ? 'Stopped repeating' : said}
        </p>
        {!isStopped && series?.canManage !== false && (
          /* ⚠️ NOT disabled while the series loads (Rule Zero). The rule is
             already on the row, so the question can be asked in this frame; only
             the "how many copies nobody started" line waits, and it appears
             underneath when the answer arrives. */
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(true)}>
            <Square className="size-3.5" aria-hidden="true" /> Stop repeating
          </Button>
        )}
      </div>

      <p className="mt-1 text-caption text-text-primary">
        {isStopped ? (
          <>
            No new copies will be created
            {series?.stoppedByName ? ` — stopped by ${series.stoppedByName}` : ''}.
          </>
        ) : (
          <>
            A fresh copy is created automatically at midnight
            {series?.assigneeName ? ` for ${series.assigneeName}` : ''}
            {series && series.openCopies > 1 ? `. ${series.openCopies} copies are open now` : ''}
            {series?.oneOpenCopy ? ' — one at a time, so it waits while the last one is open' : ''}.
          </>
        )}
      </p>

      {asking && (
        <div className="mt-2.5 rounded-lg border border-border-default bg-bg-surface px-3 py-2.5">
          <p className="text-caption text-text-primary">
            Stop {series ? `“${series.title}”` : 'this task'} repeating? No copy will be created again, and
            the ones already here stay where they are.
          </p>
          {series && series.untouchedCopies > 0 && (
            <label className="mt-2 flex items-start gap-2 text-caption text-text-primary">
              <input
                type="checkbox"
                checked={alsoRemove}
                onChange={(event) => setAlsoRemove(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Also remove the {series.untouchedCopies}{' '}
                {series.untouchedCopies === 1 ? 'copy' : 'copies'} nobody has started.{' '}
                <span className="text-text-secondary">
                  Anything started, finished or commented on is left alone.
                </span>
              </span>
            </label>
          )}
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" variant="danger" disabled={busy || !series} onClick={() => void stop()}>
              {series ? 'Stop repeating' : 'Reading this repeat…'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
