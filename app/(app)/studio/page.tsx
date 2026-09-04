import type { Metadata } from 'next';

import { StudioWorkspace } from '@/components/studio/studio-workspace';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/current-user';
import {
  accountsForProject,
  cadenceForProject,
  listStudioProjects,
  metricsForProject,
  postsForProject,
} from '@/lib/db/queries/meta-studio';
import { previousPeriod } from '@/lib/domain/meta-studio';
import { DIVISION_NAME } from '@/lib/domain/constants';
import { isoDateIn, nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Trend & Engagement Studio' };

/* ============================================================================
 * TREND & ENGAGEMENT STUDIO
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-04. A SEPARATE PAGE, not a project tab: *"I don't want that to
 * change anything inside of the project. I want to create a separate page… in a
 * left sidebar below the project."* Nothing under app/(app)/projects/ was
 * touched to build this.
 *
 * ── ⚠️ IT READS TASKLY'S TABLES AND NEVER CALLS META ────────────────────────
 * *"I will not fetch live things… I will set a cron job… We will fetch data from
 * the database and show and draw a graph there."* So a slow or failing Graph API
 * makes this page STALE, never slow and never broken — and the account's
 * `last_error` says which client is affected and why.
 *
 * ── THE PERIOD IS RESOLVED HERE, ON THE SERVER ──────────────────────────────
 * Both the current window and the one before it, so the "vs previous" deltas on
 * every card compare the same number of elapsed days. Doing it in the client
 * would put the reader's clock in charge of a client-facing figure.
 * ========================================================================= */

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; from?: string; to?: string; platform?: string }>;
}) {
  const user = await requireRole('team_coordinator');
  const params = await searchParams;

  const projects = await listStudioProjects(user.id);

  /* Default to the first project that actually has linked accounts — the list is
     already ordered with those first, so this lands somewhere useful rather than
     on an alphabetical "coming soon". */
  const selected =
    projects.find((p) => p.id === params.project) ?? projects.find((p) => p.hasAccounts) ?? null;

  const today = isoDateIn(nowMs());
  /* ⚠️ 29 days back, not 90. Meta gives roughly a month of history and the
     backfill collected 29 days — offering a range the tables cannot fill draws
     an honest-looking empty graph. This widens on its own as the daily snapshots
     accumulate; see docs/meta-integration/. */
  const from = params.from ?? addDays(today, -29);
  const to = params.to ?? today;
  const previous = previousPeriod(from, to);

  const platform =
    params.platform === 'facebook' || params.platform === 'instagram' ? params.platform : 'all';

  if (!selected) {
    return (
      <div className="mx-auto max-w-[var(--content-max)] space-y-8">
        <PageHeader
          eyebrow={DIVISION_NAME}
          title="Trend & Engagement Studio"
          description="No projects are visible to you yet."
        />
      </div>
    );
  }

  /* Nothing to fetch for a project with no linked account — the workspace shows
     the "coming soon" state instead, and six empty queries would be wasted. */
  const data = selected.hasAccounts
    ? await Promise.all([
        accountsForProject(user.id, selected.id),
        metricsForProject(user.id, selected.id, from, to),
        metricsForProject(user.id, selected.id, previous.from, previous.to),
        postsForProject(user.id, selected.id, from, to),
        cadenceForProject(user.id, selected.id),
      ])
    : null;

  return (
    <StudioWorkspace
      projects={projects}
      selected={selected}
      from={from}
      to={to}
      platform={platform}
      accounts={data?.[0] ?? []}
      current={data?.[1] ?? []}
      previous={data?.[2] ?? []}
      posts={data?.[3] ?? []}
      cadence={
        data?.[4] ?? {
          staticPerDay: null,
          reelsPerWeek: null,
          assetsMin: null,
          assetsMax: null,
          reelsMin: null,
        }
      }
    />
  );
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
