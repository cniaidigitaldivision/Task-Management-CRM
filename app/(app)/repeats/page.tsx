import type { Metadata } from 'next';

import { RepeatsBoard } from '@/components/task/repeats-board';
import { PageHeader } from '@/components/ui/page-header';
import { requireNotExecutive } from '@/lib/auth/current-user';
import { listTaskSeries } from '@/lib/db/queries/task-series';
import { isoDateIn } from '@/lib/now';

export const metadata: Metadata = { title: 'Repeating tasks' };

/* ============================================================================
 * REPEATING TASKS
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-22: *"Can you please exactly tell me where Najmulah, in his
 * dashboard, will go to turn off this repeating task or where he can see which
 * tasks are repeating?"*
 *
 * Here. Every repeat a person is part of, what it is called, how often it comes,
 * whose it is, how many copies are open, when the next one arrives — and Stop on
 * each one.
 *
 * ── ⚠️ WHY THIS PAGE HAD TO EXIST ─────────────────────────────────────────
 * Until it did, the only way to find a repeat was to spot the ↻ mark on a card.
 * Najamullah had NINE live repeats and not one open copy that day — every copy
 * was finished — so there was no card to spot and no way in at all.
 *
 * ── ⚠️ ONE WAVE, AND THE READ IS THE PERMISSION ───────────────────────────
 * `app.task_series_board()` returns a series only to whoever raised it, is
 * assigned it, or sees all work. Nothing on this page branches on role, because
 * the read already did — the same property `/tasks` relies on.
 * ========================================================================= */

export default async function RepeatsPage() {
  const [user, today] = await Promise.all([requireNotExecutive(), Promise.resolve(isoDateIn())]);
  const series = await listTaskSeries(user.id);

  const live = series.filter((s) => !s.stoppedAt).length;
  const copies = series.reduce((n, s) => n + (s.stoppedAt ? 0 : s.openCopies), 0);

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-5">
      <PageHeader
        eyebrow="Work"
        title="Repeating tasks"
        description={
          live === 0 ? (
            'Nothing is repeating. A task repeats when somebody chooses Daily, Weekly or Monthly on it.'
          ) : (
            <>
              <span className="tabular font-semibold text-text-primary">{live}</span>{' '}
              {live === 1 ? 'task repeats' : 'tasks repeat'} — a copy is created automatically at
              midnight, and {copies === 0 ? 'none is open right now' : `${copies} ${copies === 1 ? 'copy is' : 'copies are'} open`}.
              Stopping one is permanent: no copy is created again.
            </>
          )
        }
      />
      <RepeatsBoard series={series} viewerId={user.id} today={today} />
    </div>
  );
}
