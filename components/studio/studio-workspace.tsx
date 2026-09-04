'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';

import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import { PageHeader } from '@/components/ui/page-header';
import { DIVISION_NAME } from '@/lib/domain/constants';
import type {
  AccountDetail,
  ContentDraft,
  MetricPoint,
  StudioAccount,
  StudioPost,
  StudioProject,
} from '@/lib/db/queries/meta-studio';
import type { ProjectPromise } from '@/lib/domain/meta-studio';
import type {
  ExportRecord,
  ReportSchedule,
  ReportTemplate,
} from '@/lib/domain/report-templates';
import type {
  SyncRule,
  SyncRun,
  SyncSettings,
} from '@/lib/domain/meta-sync-settings';
import type { PermissionEvent } from '@/lib/db/queries/meta-sync-settings';
import { compact } from '@/lib/domain/meta-studio';
import { cn } from '@/lib/utils';

import { AnalyticsInsights } from './analytics-insights';
import { ContentPosts } from './content-posts';
import { ReportsExports, type GeneratedReport } from './reports-exports';
import { SettingsSync } from './settings-sync';
import { MetaAccounts } from './meta-accounts';
import { StudioOverview } from './overview';
import { StudioToolbar } from './studio-toolbar';

/* ============================================================================
 * THE STUDIO SHELL
 * ----------------------------------------------------------------------------
 * Project selector, connected accounts, platform filter and the tab strip. The
 * Overview tab's contents live in `overview.tsx`; this file is only the frame.
 *
 * ── ⚠️ ALL SIX TABS ARE NOW LIVE ────────────────────────────────────────────
 * Overview, Content & Posts, Meta Accounts, Analytics & Insights, Reports &
 * Exports and Settings & Sync. They were drawn greyed with a "soon" pill from
 * the first day on purpose — it made the information architecture legible
 * immediately, so each tab arrived where people already expected it rather than
 * as a surprise reorganisation. `live` is kept because the next tab, whatever it
 * is, should be added the same way.
 *
 * ⚠️ THE ORDER OF THE ARMS BELOW IS BEHAVIOUR, NOT STYLE. Two of them sit above
 * the `hasData` gate on purpose, and each says why.
 * ========================================================================= */

const TABS = [
  { key: 'overview', label: 'Overview', live: true },
  { key: 'content', label: 'Content & Posts', live: true },
  { key: 'accounts', label: 'Meta Accounts', live: true },
  { key: 'analytics', label: 'Analytics & Insights', live: true },
  { key: 'reports', label: 'Reports & Exports', live: true },
  { key: 'settings', label: 'Settings & Sync', live: true },
] as const;

export function StudioWorkspace({
  projects,
  selected,
  from,
  to,
  platform,
  accounts,
  current,
  previous,
  posts,
  previousPosts,
  drafts,
  accountDetails,
  cadence,
  nowMs,
  templates,
  schedules,
  exports: exportRows,
  reports,
  todayKarachi,
  canSchedule,
  syncSettings,
  syncRules,
  syncRuns,
  permissionEvents,
  tokenConfigured,
  metaAppId,
  canConfigureSync,
}: {
  projects: readonly StudioProject[];
  selected: StudioProject;
  from: string;
  to: string;
  platform: 'all' | 'facebook' | 'instagram';
  accounts: readonly StudioAccount[];
  current: readonly MetricPoint[];
  previous: readonly MetricPoint[];
  posts: readonly StudioPost[];
  /** The previous period's posts, for the Content tab's deltas. */
  previousPosts: readonly StudioPost[];
  drafts: readonly ContentDraft[];
  accountDetails: readonly AccountDetail[];
  cadence: ProjectPromise;
  /** The server's clock — see the note at the call site. */
  nowMs: number;
  templates: readonly ReportTemplate[];
  schedules: readonly ReportSchedule[];
  exports: readonly ExportRecord[];
  reports: readonly GeneratedReport[];
  /** Today in Karachi, from the server — so "Overdue" cannot disagree. */
  todayKarachi: string;
  canSchedule: boolean;
  syncSettings: SyncSettings;
  syncRules: readonly SyncRule[];
  syncRuns: readonly SyncRun[];
  permissionEvents: readonly PermissionEvent[];
  /** ⚠️ Whether the token is set, never the token — see the call site. */
  tokenConfigured: boolean;
  metaAppId: string | null;
  canConfigureSync: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = React.useState<string>('overview');

  /* One helper for every control, so changing a filter keeps the others. */
  const setParam = React.useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(search.toString());
      if (value === null) next.delete(key);
      else next.set(key, value);
      router.push(`/studio?${next.toString()}`);
    },
    [router, search],
  );

  const shownPosts = React.useMemo(
    () => (platform === 'all' ? posts : posts.filter((p) => p.platform === platform)),
    [posts, platform],
  );

  const hasData = current.length > 0;

  /* The most recent successful pull across the linked accounts. */
  const newestSync =
    accounts
      .map((a) => a.lastSyncedAt)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop() ?? null;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      <PageHeader
        eyebrow={DIVISION_NAME}
        title="Trend & Engagement Studio"
        description="How the posting is actually performing — reach, views, engagement and follower growth, beside the work that produced it."
      />

      {/* ── Project, connected accounts, filters ─────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-2.5">
        <select
          aria-label="Project"
          value={selected.id}
          onChange={(e) => setParam('project', e.target.value)}
          className="min-w-[13rem] rounded-lg border border-border-subtle bg-bg-surface px-2.5 py-1.5 text-body-sm font-medium text-text-primary transition-colors hover:border-border-default"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.hasAccounts ? '' : ' — not connected'}
            </option>
          ))}
        </select>

        {/* The connected accounts, as the owner asked: the marks, with a way to
            add another once the Meta Accounts tab exists. */}
        <div className="flex items-center gap-1.5">
          {accounts.map((a) => (
            <a
              key={a.id}
              href={a.permalink ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              title={`${PLATFORM_MARKS[a.platform]?.label ?? a.platform}${a.username ? ` — @${a.username}` : ''}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-bg-subtle px-2 py-1.5 transition-colors hover:border-border-default"
            >
              <PlatformIcon slug={a.platform} size={16} />
              <span className="text-micro font-semibold tabular-nums text-text-secondary">
                {compact(a.followers ?? 0)}
              </span>
            </a>
          ))}
          <button
            type="button"
            disabled
            title="Connecting more accounts arrives with the Meta Accounts tab"
            className="grid size-8 place-items-center rounded-lg border border-dashed border-border-default text-text-tertiary opacity-60"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="ml-auto">
          <StudioToolbar
            from={from}
            to={to}
            platform={platform}
            onRange={(days) => {
              /* The window is expressed as explicit dates rather than a "days"
                 parameter so a shared link keeps showing the same period. */
              const end = new Date(`${to}T00:00:00Z`);
              const start = new Date(end);
              start.setUTCDate(start.getUTCDate() - (days - 1));
              const next = new URLSearchParams(search.toString());
              next.set('from', start.toISOString().slice(0, 10));
              next.set('to', to);
              router.push(`/studio?${next.toString()}`);
            }}
            onPlatform={(v) => setParam('platform', v === 'all' ? null : v)}
            onExport={() => window.print()}
          />
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 border-b border-border-subtle">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            disabled={!t.live}
            onClick={() => t.live && setTab(t.key)}
            className={cn(
              'relative px-3 py-2 text-body-sm transition-colors',
              t.live
                ? tab === t.key
                  ? 'font-semibold text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
                : 'cursor-not-allowed text-text-disabled',
            )}
          >
            {t.label}
            {!t.live && (
              <span className="ml-1.5 rounded-full bg-bg-subtle px-1.5 py-0.5 text-micro text-text-tertiary">
                soon
              </span>
            )}
            {tab === t.key && t.live && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-primary" />
            )}
          </button>
        ))}
      </div>

      {!selected.hasAccounts ? (
        <NotConnected name={selected.name} />
      ) : tab === 'accounts' ? (
        /* ⚠️ BEFORE THE `hasData` GATE, AND THE ORDER IS THE POINT. An account
           that has collected nothing is precisely the one somebody opens this
           tab to diagnose — sending them to "No figures collected yet" instead
           would hide the very card explaining why. A first draft had this arm
           below the gate and the comment claiming otherwise; the ordering is the
           behaviour, not the comment. */
        <MetaAccounts
          accounts={accountDetails}
          projectId={selected.id}
          projectName={selected.name}
          nowMs={nowMs}
          /* Connect and Resync are the same authority as scheduling a report. */
          canManage={canSchedule}
          /* ⚠️ THE UNFILTERED COUNTS, not `shownPosts`. This tab is about the
             connections themselves; narrowing "posts collected" by the platform
             filter would make the fleet figure disagree with the per-account
             cards sitting right beside it. */
          postsThisPeriod={posts.length}
          postsPreviousPeriod={previousPosts.length}
        />
      ) : tab === 'settings' ? (
        /* ⚠️ ALSO ABOVE THE `hasData` GATE. This is the tab somebody opens to
           find out WHY nothing is arriving — sending them to "No figures
           collected yet" would hide the health panel that explains it. */
        <SettingsSync
          projectId={selected.id}
          projectName={selected.name}
          accounts={accountDetails}
          settings={syncSettings}
          rules={syncRules}
          runs={syncRuns}
          permissions={permissionEvents}
          tokenConfigured={tokenConfigured}
          metaAppId={metaAppId}
          nowMs={nowMs}
          canConfigure={canConfigureSync}
          canManageRules={canSchedule}
        />
      ) : tab === 'reports' ? (
        /* ⚠️ ALSO ABOVE THE `hasData` GATE, for a different reason than the
           Accounts tab. Reports and exports do not depend on Meta figures at
           all — the task CSV and the drawn project PDF come from Taskly's own
           tables and work on a project that has collected nothing from Meta. A
           project whose sync has not run yet can still send a client a monthly
           sheet, and sending them to "No figures collected yet" would refuse a
           report the system is perfectly able to produce. */
        <ReportsExports
          projectId={selected.id}
          projectName={selected.name}
          templates={templates}
          schedules={schedules}
          exports={exportRows}
          reports={reports}
          todayKarachi={todayKarachi}
          nowMs={nowMs}
          canSchedule={canSchedule}
        />
      ) : !hasData ? (
        <NoDataYet accounts={accounts} />
      ) : tab === 'analytics' ? (
        /* ⚠️ BELOW the `hasData` gate, unlike Accounts, Reports and Settings.
           Those three answer "why is nothing arriving?"; this one has nothing to
           say without figures, and nine empty charts would be worse than one
           sentence explaining there is nothing yet. */
        <AnalyticsInsights
          /* ⚠️ THE UNFILTERED METRICS. Every cross-platform chart here — the
             radar most of all — needs both platforms present; handing it a
             Facebook-filtered set would draw Instagram at zero and turn the
             comparison into a false claim. The platform filter belongs to the
             tabs that show one platform's posts. */
          metrics={current}
          posts={posts}
          from={from}
          to={to}
          projectName={selected.name}
        />
      ) : tab === 'content' ? (
        /* ⚠️ The Content tab gets the UNFILTERED posts and does its own
           filtering, because its tab strip counts every kind — a strip built
           from posts already narrowed to one platform would report "Reels 0"
           whenever Facebook was selected. It calls back to change the platform
           so the two tabs stay in step. */
        <ContentPosts
          posts={posts}
          previousPosts={previousPosts}
          drafts={drafts}
          platform={platform}
          onPlatform={(v) => setParam('platform', v === 'all' ? null : v)}
          from={from}
          to={to}
        />
      ) : (
        <StudioOverview
          accounts={accounts}
          current={current}
          previous={previous}
          posts={shownPosts}
          cadence={cadence}
          from={from}
          to={to}
          platform={platform}
          lastSynced={newestSync}
        />
      )}
    </div>
  );
}

/* ---- The two states before there is anything to draw --------------------- */

function NotConnected({ name }: { name: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-6 py-14 text-center">
      <p className="text-h3 font-semibold text-text-primary">Coming soon for {name}</p>
      <p className="mx-auto mt-2 max-w-md text-body-sm text-text-secondary">
        No Facebook Page or Instagram account is connected to this project yet. Projects that are
        internal tool development have no social presence and will stay this way; for the rest,
        connecting an account is the next step.
      </p>
    </div>
  );
}

function NoDataYet({ accounts }: { accounts: readonly StudioAccount[] }) {
  const failing = accounts.filter((a) => a.lastError);
  return (
    <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-6 py-14 text-center">
      <p className="text-h3 font-semibold text-text-primary">No figures collected yet</p>
      <p className="mx-auto mt-2 max-w-md text-body-sm text-text-secondary">
        {failing.length > 0
          ? 'The last sync did not succeed for every account.'
          : 'The accounts are connected and the first sync has not run. Figures arrive within two hours.'}
      </p>
      {failing.map((a) => (
        <p key={a.id} className="mt-2 text-caption" style={{ color: 'var(--feedback-error)' }}>
          {PLATFORM_MARKS[a.platform]?.label ?? a.platform}: {a.lastError}
        </p>
      ))}
    </div>
  );
}
