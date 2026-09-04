'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, Plus, RefreshCw, TriangleAlert } from 'lucide-react';

import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import { BarChart, DonutChart, TrendChart } from '@/components/ui/chart';
import { PageHeader } from '@/components/ui/page-header';
import { DIVISION_NAME } from '@/lib/domain/constants';
import type {
  MetricPoint,
  StudioAccount,
  StudioPost,
  StudioProject,
} from '@/lib/db/queries/meta-studio';
import {
  buildKpis,
  compact,
  contentMix,
  dailySeries,
  formatDelta,
  formatKpi,
  postEngagement,
  topPosts,
} from '@/lib/domain/meta-studio';
import { cn } from '@/lib/utils';

import { AudienceSample } from './audience-sample';

/* ============================================================================
 * THE STUDIO WORKSPACE
 * ----------------------------------------------------------------------------
 * The whole Overview tab. Owner's screenshots, 2026-09-04.
 *
 * ── ⚠️ ONLY THE OVERVIEW TAB IS BUILT ───────────────────────────────────────
 * The others are drawn but disabled, on purpose: *"Don't create other pages,
 * just the overview page."* Showing them greyed makes the information
 * architecture legible from day one, so the later tabs arrive where people
 * already expect them rather than as a surprise reorganisation.
 *
 * ── EVERY PANEL HAS AN EMPTY STATE, AND THAT IS NOT OPTIONAL ────────────────
 * On the first day after linking an account, before the first sync, EVERY panel
 * is empty. A page of blank cards reads as broken. Each one says what is missing
 * and when it will arrive.
 * ========================================================================= */

const TABS = [
  { key: 'overview', label: 'Overview', live: true },
  { key: 'content', label: 'Content & Posts', live: false },
  { key: 'accounts', label: 'Meta Accounts', live: false },
  { key: 'analytics', label: 'Analytics & Insights', live: false },
  { key: 'reports', label: 'Reports & Exports', live: false },
  { key: 'settings', label: 'Settings & Sync', live: false },
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
  cadence,
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
  cadence: { staticPerDay: number | null; reelsPerWeek: number | null };
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [tab, setTab] = React.useState<string>('overview');

  /* One helper for every control, so a filter change keeps the others. */
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

  const kpis = React.useMemo(
    () =>
      buildKpis({
        current,
        previous,
        accounts,
        postsInPeriod: shownPosts.length,
        cadence,
        from,
        to,
        platform,
      }),
    [current, previous, accounts, shownPosts.length, cadence, from, to, platform],
  );

  const hasData = current.length > 0;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-5">
      <PageHeader
        eyebrow={DIVISION_NAME}
        title="Trend & Engagement Studio"
        description="How the posting is actually performing — reach, views, engagement and follower growth, beside the work that produced it."
      />

      {/* ── Project, connected accounts, period ─────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-default bg-bg-surface px-4 py-3">
        <label className="flex min-w-0 items-center gap-2">
          <span className="text-micro font-semibold uppercase tracking-wide text-text-tertiary">
            Project
          </span>
          <select
            value={selected.id}
            onChange={(e) => setParam('project', e.target.value)}
            className="min-w-[13rem] rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 text-body-sm text-text-primary"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.hasAccounts ? '' : ' — not connected'}
              </option>
            ))}
          </select>
        </label>

        {/* The connected accounts, as the owner asked: large marks, plus a way to
            add another. */}
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
              <PlatformIcon slug={a.platform} size={18} />
              <span className="text-caption font-medium text-text-secondary">
                {compact(a.followers ?? 0)}
              </span>
            </a>
          ))}
          <button
            type="button"
            disabled
            title="Connecting more accounts arrives with the Meta Accounts tab"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-dashed border-border-default text-text-tertiary opacity-60"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <PlatformFilter value={platform} onChange={(v) => setParam('platform', v === 'all' ? null : v)} />
          <span className="rounded-lg border border-border-default px-2.5 py-1.5 text-caption text-text-secondary">
            {from} → {to}
          </span>
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 border-b border-border-default">
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

      {/* ── The project has no Meta account ──────────────────────────────── */}
      {!selected.hasAccounts ? (
        <NotConnected name={selected.name} />
      ) : !hasData ? (
        <NoDataYet accounts={accounts} />
      ) : (
        <Overview
          kpis={kpis}
          current={current}
          posts={shownPosts}
          accounts={accounts}
          from={from}
          to={to}
          platform={platform}
        />
      )}
    </div>
  );
}

/* ---- The overview itself ------------------------------------------------- */

function Overview({
  kpis,
  current,
  posts,
  accounts,
  from,
  to,
  platform,
}: {
  kpis: ReturnType<typeof buildKpis>;
  current: readonly MetricPoint[];
  posts: readonly StudioPost[];
  accounts: readonly StudioAccount[];
  from: string;
  to: string;
  platform: 'all' | 'facebook' | 'instagram';
}) {
  const wantFb = platform !== 'instagram';
  const wantIg = platform !== 'facebook';

  const engagement = dailySeries(
    current,
    {
      instagram: wantIg ? 'total_interactions' : undefined,
      facebook: wantFb ? 'page_post_engagements' : undefined,
    },
    from,
    to,
  );

  const followers = dailySeries(
    current,
    { instagram: wantIg ? 'followers_count' : undefined, facebook: wantFb ? 'page_follows' : undefined },
    from,
    to,
  );

  const views = dailySeries(
    current,
    { instagram: wantIg ? 'views' : undefined, facebook: wantFb ? 'page_views_total' : undefined },
    from,
    to,
  );

  const mix = contentMix(posts);
  const best = topPosts(posts, 5);

  /* ⚠️ `?? 0` for the chart, but the SERIES keeps its nulls above. The chart
     component wants numbers; the distinction between "zero that day" and "never
     collected" is preserved in the data and in the empty states, not here. */
  const nums = (s: ReturnType<typeof dailySeries>, k: 'facebook' | 'instagram') =>
    s.map((d) => d[k] ?? 0);

  const labels = engagement.map((d) => d.date.slice(5));

  const series = (s: ReturnType<typeof dailySeries>) =>
    [
      wantIg ? { label: 'Instagram', token: 'accent-primary', points: nums(s, 'instagram') } : null,
      wantFb ? { label: 'Facebook', token: 'chart-2', points: nums(s, 'facebook') } : null,
    ].filter((x): x is { label: string; token: string; points: number[] } => x !== null);

  return (
    <div className="space-y-4">
      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <KpiCard key={k.key} kpi={k} />
        ))}
      </div>

      {/* ── Trends ───────────────────────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Followers growth" hint="Where the account actually stands">
          <TrendChart
            series={series(followers)}
            labels={labels}
            caption="Followers per day"
            height={200}
            fill
            includeZero={false}
          />
        </Panel>

        <Panel title="Engagement" hint="Interactions per day">
          <TrendChart
            series={series(engagement)}
            labels={labels}
            caption="Engagement per day"
            height={200}
            fill={false}
          />
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Views" className="lg:col-span-2">
          <TrendChart
            series={series(views)}
            labels={labels}
            caption="Views per day"
            height={190}
            fill
          />
        </Panel>

        <Panel title="Content mix" hint={`${posts.length} posts in this period`}>
          {mix.length === 0 ? (
            <Empty>Nothing was published in this period.</Empty>
          ) : (
            <DonutChart
              slices={mix.map((m, i) => ({
                label: m.label,
                value: m.count,
                token: ['accent-primary', 'chart-2', 'chart-3', 'chart-4'][i % 4],
              }))}
              centreLabel="Posts"
              centreValue={String(posts.length)}
              caption="Posts by kind"
            />
          )}
        </Panel>
      </div>

      {/* ── Posts and platforms ──────────────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Top-performing posts" className="lg:col-span-2">
          {best.length === 0 ? (
            <Empty>No posts in this period.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {best.map((p) => (
                <PostRow key={p.id} post={p} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="By platform">
          <BarChart
            caption="Engagement by platform"
            bars={accounts
              .filter((a) => platform === 'all' || a.platform === platform)
              .map((a) => ({
                label: PLATFORM_MARKS[a.platform]?.label ?? a.platform,
                value: posts
                  .filter((p) => p.platform === a.platform)
                  .reduce((n, p) => n + postEngagement(p), 0),
                token: a.platform === 'instagram' ? 'accent-primary' : 'chart-2',
                note: `${compact(a.followers ?? 0)} followers`,
              }))}
          />
        </Panel>
      </div>

      {/* ── Audience — the sub-100-follower case ─────────────────────────── */}
      <AudienceSample accounts={accounts} />

      <SyncFooter accounts={accounts} />
    </div>
  );
}

/* ---- Parts --------------------------------------------------------------- */

function KpiCard({ kpi }: { kpi: ReturnType<typeof buildKpis>[number] }) {
  const delta = formatDelta(kpi);
  const dir = kpi.delta?.direction ?? 'flat';

  return (
    <div className="rounded-xl border border-border-default bg-bg-surface px-3.5 py-3">
      <p className="truncate text-micro font-semibold uppercase tracking-wide text-text-tertiary">
        {kpi.label}
      </p>
      <p className="mt-1.5 text-h2 font-semibold leading-none tabular-nums text-text-primary">
        {formatKpi(kpi)}
      </p>
      <div className="mt-1.5 flex min-h-[1.1rem] flex-wrap items-center gap-1.5">
        {delta && (
          <span
            className="text-micro font-semibold"
            style={{
              color:
                dir === 'up'
                  ? 'var(--feedback-success)'
                  : dir === 'down'
                    ? 'var(--feedback-error)'
                    : 'var(--text-tertiary)',
            }}
          >
            {delta}
          </span>
        )}
        {kpi.hint && <span className="truncate text-micro text-text-tertiary">{kpi.hint}</span>}
      </div>
    </div>
  );
}

function Panel({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('rounded-2xl border border-border-default bg-bg-surface p-4', className)}>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-body-sm font-semibold text-text-primary">{title}</h2>
        {hint && <span className="text-micro text-text-tertiary">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function PostRow({ post }: { post: StudioPost }) {
  const engagement = postEngagement(post);

  return (
    <li>
      {/* ⚠️ The whole row links to the post on Meta. Owner: *"If I want to see
          some post, I will just click it and it will bring me to that post."*
          The permalink comes straight from Meta with the post, so there is no
          URL matching to get wrong. */}
      <a
        href={post.permalink ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-xl border border-border-subtle bg-bg-surface px-3 py-2 transition-colors hover:border-border-default hover:bg-bg-subtle"
      >
        {post.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a Meta CDN URL
             that expires; next/image would need the host allow-listed and would
             cache a link that dies. */
          <img
            src={post.thumbnailUrl}
            alt=""
            className="size-10 shrink-0 rounded-lg object-cover"
            loading="lazy"
          />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-bg-subtle">
            <PlatformIcon slug={post.platform} size={16} />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-body-sm text-text-primary">
            {post.caption?.trim() || 'No caption'}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-micro text-text-tertiary">
            <PlatformIcon slug={post.platform} size={11} />
            {post.postedAt.slice(0, 10)}
            {post.mediaProductType && ` · ${post.mediaProductType.toLowerCase()}`}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="block text-body-sm font-semibold tabular-nums text-text-primary">
            {compact(engagement)}
          </span>
          <span className="block text-micro text-text-tertiary">
            {post.reach !== null ? `${compact(post.reach)} reach` : 'engagements'}
          </span>
        </span>

        <ExternalLink className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
      </a>
    </li>
  );
}

function PlatformFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-lg border border-border-default p-0.5">
      {(['all', 'facebook', 'instagram'] as const).map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-caption transition-colors',
            value === p
              ? 'bg-bg-subtle font-semibold text-text-primary'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {p !== 'all' && <PlatformIcon slug={p} size={13} />}
          {p === 'all' ? 'All' : PLATFORM_MARKS[p]?.label ?? p}
        </button>
      ))}
    </div>
  );
}

function SyncFooter({ accounts }: { accounts: readonly StudioAccount[] }) {
  const failing = accounts.filter((a) => a.lastError);
  const newest = accounts
    .map((a) => a.lastSyncedAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop();

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-subtle bg-bg-subtle px-3.5 py-2.5">
      <RefreshCw className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
      <span className="text-micro text-text-secondary">
        {newest
          ? `Figures last pulled from Meta ${new Date(newest).toISOString().slice(0, 16).replace('T', ' ')} UTC. Refreshed every 2 hours.`
          : 'Not yet synced.'}
      </span>

      {/* ⚠️ A failing account is named here rather than left as staleness. A
          client whose access was revoked would otherwise just look quiet. */}
      {failing.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-micro"
          style={{
            backgroundColor: 'color-mix(in oklab, var(--feedback-error) 12%, transparent)',
            color: 'var(--feedback-error)',
          }}
        >
          <TriangleAlert className="size-3" aria-hidden="true" />
          {PLATFORM_MARKS[a.platform]?.label ?? a.platform}: {a.lastError}
        </span>
      ))}
    </div>
  );
}

/* ---- Empty states -------------------------------------------------------- */

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border-subtle px-3 py-6 text-center text-caption text-text-tertiary">
      {children}
    </p>
  );
}

function NotConnected({ name }: { name: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border-default bg-bg-surface px-6 py-12 text-center">
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
    <div className="rounded-2xl border border-dashed border-border-default bg-bg-surface px-6 py-12 text-center">
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
