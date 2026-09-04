'use client';

import * as React from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Eye,
  Percent,
  Radio,
  Target,
  Users,
} from 'lucide-react';

import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import { DonutChart } from '@/components/ui/chart';
import type { MetricPoint, StudioAccount, StudioPost } from '@/lib/domain/meta-studio';
import {
  buildKpis,
  compact,
  contentMix,
  dailySeries,
  daysBetween,
  formatDelta,
  postEngagement,
} from '@/lib/domain/meta-studio';

import { AudienceSample, TopLocations } from './audience-sample';
import { KpiCard, MiniSelect, Panel, PanelEmpty, PanelLink, SegmentedControl } from './panels';
import { MultiSeriesChart, RankedBars, SegmentedGauge, shortNumber } from './studio-charts';

/* ============================================================================
 * THE OVERVIEW TAB, BUILT TO THE OWNER'S REFERENCE
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-04, with the reference design open: *"I need this UI to be
 * exactly the same: same colors, same positions, same sleekness… use the same
 * icons, the same coloring, and make everything very interactive."*
 *
 * The first build was rejected — *"this overview tab is very ugly"* — and the
 * two named faults were the layout and the colour. Both are addressed here:
 *
 *   COLOUR   The system had NO categorical palette, only teal and gold, so four
 *            lines on one axis drew in two brand hues. `--chart-1…8` were added
 *            to styles/tokens.css for this, tuned separately for light and dark.
 *   LAYOUT   Four rows of the reference's own proportions — 7 cards, then a
 *            6/3/3 split, then 4/4/4, then 3/4/3/3 — rather than the uniform
 *            two-column grid the first attempt used.
 *
 * ── ⚠️ WHAT IS REAL AND WHAT IS NOT ────────────────────────────────────────
 * Every figure on this page comes from `meta_metric_days`, `meta_posts` and
 * `meta_post_metrics` — the tables the 2-hourly sync fills. The ONE exception is
 * the audience panel, which Meta will not report below 100 followers and which
 * is marked as a sample five separate ways. See `audience-sample.tsx`.
 *
 * Panels with nothing to draw say so. On the first day after linking an account
 * EVERY panel is empty, and a page of blank cards reads as broken.
 * ========================================================================= */

type Grain = 'daily' | 'weekly' | 'monthly';

export function StudioOverview({
  accounts,
  current,
  previous,
  posts,
  cadence,
  from,
  to,
  platform,
  lastSynced,
}: {
  accounts: readonly StudioAccount[];
  current: readonly MetricPoint[];
  previous: readonly MetricPoint[];
  posts: readonly StudioPost[];
  cadence: { staticPerDay: number | null; reelsPerWeek: number | null };
  from: string;
  to: string;
  platform: 'all' | 'facebook' | 'instagram';
  lastSynced: string | null;
}) {
  const [grain, setGrain] = React.useState<Grain>('daily');
  const [postSort, setPostSort] = React.useState('engagement');

  const wantFb = platform !== 'instagram';
  const wantIg = platform !== 'facebook';

  const kpis = React.useMemo(
    () =>
      buildKpis({
        current,
        previous,
        accounts,
        postsInPeriod: posts.length,
        cadence,
        from,
        to,
        platform,
      }),
    [current, previous, accounts, posts.length, cadence, from, to, platform],
  );

  const kpi = (key: string) => kpis.find((k) => k.key === key);

  /* ── The four series of the reference's Performance Overview ──────────── */
  const reach = dailySeries(current, { instagram: wantIg ? 'reach' : undefined }, from, to);
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

  const rolled = rollUp([reach, engagement, followers, views], grain);
  const labels = rolled.labels;

  /* ⚠️ VIEWS IS DRAWN AS BARS, not a fourth line. Owner, describing the
     reference: *"the impressions have some horizontal and some vertical lines,
     basically drawn from down to up, from bottom to up."* It also does real work
     beyond matching the drawing — a bar and a line are different marks, so the
     eye stops trying to compare them directly, which is exactly right when they
     sit on different axes. */
  const performance = [
    { label: 'Views', token: 'chart-4', points: rolled.series[3], kind: 'bar' as const },
    { label: 'Reach', token: 'chart-1', points: rolled.series[0] },
    { label: 'Engagement', token: 'chart-2', points: rolled.series[1] },
    { label: 'Followers', token: 'chart-3', points: rolled.series[2] },
  ];

  /* ── Followers growth: this period against the one before ─────────────── */
  const prevFollowers = dailySeries(
    previous,
    { instagram: wantIg ? 'followers_count' : undefined, facebook: wantFb ? 'page_follows' : undefined },
    from,
    to,
  );
  const growthLabels = followers.map((d) => shortDate(d.date));
  const growthTooltips = followers.map((d) => longDate(d.date));

  /* ── Content and platform breakdowns ──────────────────────────────────── */
  const mix = contentMix(posts);
  const mixTotal = mix.reduce((n, m) => n + m.count, 0);
  const MIX_TOKENS = ['chart-1', 'chart-4', 'chart-3', 'chart-5', 'chart-2'];

  const byPlatform = React.useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of posts) totals.set(p.platform, (totals.get(p.platform) ?? 0) + postEngagement(p));
    const sum = [...totals.values()].reduce((a, b) => a + b, 0);
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([slug, value], i) => ({
        key: slug,
        label: PLATFORM_MARKS[slug]?.label ?? slug,
        lead: <PlatformIcon slug={slug} size={14} />,
        share: sum > 0 ? value / sum : 0,
        value: compact(value),
        token: ['chart-2', 'chart-1', 'chart-4', 'chart-8', 'chart-3'][i % 5],
      }));
  }, [posts]);

  const ranked = React.useMemo(() => {
    const list = [...posts];
    if (postSort === 'reach') list.sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
    else if (postSort === 'recent') list.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    else list.sort((a, b) => postEngagement(b) - postEngagement(a));
    return list.slice(0, 4);
  }, [posts, postSort]);

  /* ── Delivery against the promise ─────────────────────────────────────── */
  const days = daysBetween(from, to);
  const target =
    (cadence.staticPerDay ?? 0) * days + Math.round(((cadence.reelsPerWeek ?? 0) * days) / 7);
  const delivered = posts.length;

  const rateKpi = kpi('engagement_rate');
  const engagementRate = rateKpi?.value ?? 0;

  return (
    <div className="space-y-3">
      {/* ══ ROW 1 · the seven cards ══════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {target > 0 && (
          <KpiCard
            index={0}
            data={{
              key: 'target',
              /* ⚠️ "Monthly Target", not "Period target". Owner, against the
                 reference: *"Monthly target, not the period target."* The window
                 is a chosen range rather than strictly a calendar month, but the
                 agreed rhythm this measures against IS monthly — it is the
                 package the client bought — so the reference's word is the one
                 that names the thing correctly. The day count says what window
                 it was scaled to. */
              label: 'Monthly Target',
              value: compact(target),
              unit: 'posts',
              icon: Target,
              token: 'chart-1',
              progress: target > 0 ? delivered / target : 0,
              progressNote: `${Math.round((delivered / Math.max(1, target)) * 100)}% of target`,
              footnote: `${days} days in this window`,
            }}
          />
        )}
        <KpiCard
          index={1}
          data={{
            key: 'achieved',
            /* Owner: *"Achieved, not published."* */
            label: 'Achieved',
            value: String(delivered),
            unit: 'posts',
            icon: CheckCircle2,
            token: 'chart-3',
            footnote: target > 0 ? `of ${target} planned` : 'no rhythm agreed',
          }}
        />
        <KpiCard
          index={2}
          data={{
            key: 'remaining',
            label: 'Remaining',
            value: String(Math.max(0, target - delivered)),
            unit: 'posts',
            icon: Clock,
            token: 'chart-5',
            footnote:
              target > delivered
                ? `Needed per day: ${((target - delivered) / Math.max(1, days)).toFixed(1)}`
                : 'Target met',
          }}
        />
        <KpiCard
          index={3}
          data={{
            key: 'followers',
            label: 'Total followers',
            value: compact(kpi('followers')?.value ?? 0),
            icon: Users,
            token: 'chart-4',
            deltaText: formatDelta(kpi('followers') ?? ({} as never)),
            deltaDirection: kpi('followers')?.delta?.direction,
          }}
        />
        <KpiCard
          index={4}
          data={{
            key: 'rate',
            label: 'Engagement rate',
            value: `${engagementRate.toFixed(2)}%`,
            icon: Percent,
            token: 'chart-2',
            deltaText: rateKpi ? formatDelta(rateKpi) : null,
            deltaDirection: rateKpi?.delta?.direction,
          }}
        />
        <KpiCard
          index={5}
          data={{
            key: 'views',
            label: 'Total views',
            value: compact(kpi('views')?.value ?? 0),
            icon: Eye,
            token: 'chart-7',
            deltaText: formatDelta(kpi('views') ?? ({} as never)),
            deltaDirection: kpi('views')?.delta?.direction,
          }}
        />
        <KpiCard
          index={6}
          data={{
            key: 'reach',
            label: 'Total reach',
            value: compact(kpi('reach')?.value ?? 0),
            icon: Radio,
            token: 'chart-8',
            deltaText: formatDelta(kpi('reach') ?? ({} as never)),
            deltaDirection: kpi('reach')?.delta?.direction,
            /* ⚠️ Says Instagram-only rather than quietly meaning it. Facebook has
               no working page-reach metric in v26.0. */
            footnote: wantIg ? 'Instagram' : 'not reported',
          }}
        />
      </div>

      {/* ══ ROW 2 · performance · gauge · locations ══════════════════════
          ⚠️ EXPLICIT TRACKS, NOT A 12-COLUMN SPAN. Owner: *"Increase the width of
          the performance overview, make the engagement rate and top location
          cards both have the same width."* Twelve columns cannot express
          62/19/19 — the nearest is 8/2/2, which starves both side panels, or
          6/3/3, which gives the gauge as much room as a chart carrying four
          series. `minmax(0, …)` on every track because a bare `fr` refuses to
          shrink below its content and would push the row wider than the page. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,10fr)_minmax(0,3fr)_minmax(0,3fr)]">
        {/* ⚠️ 7 / 2 / 3, measured off the reference. Owner: *"the performance
            view is taking more space width-wise… Engagement rate card: make it
            small. Location card: make it small and horizontally longer."* The
            first build gave all three 6/3/3, which made the gauge as important
            as the chart carrying four series. */}
        <Panel
          title="Performance Overview"
          info="Reach, engagement, followers and views on one scale."
          action={
            <SegmentedControl
              value={grain}
              onChange={setGrain}
              options={[
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
              ]}
            />
          }
        >
          <MultiSeriesChart
            series={performance}
            labels={labels}
            tooltipLabels={rolled.tooltipLabels}
            height={196}
            animationKey={`${grain}-${platform}-${from}`}
          />
        </Panel>

        <Panel
          title="Engagement Rate"
          info="Interactions per person reached, Instagram."
        >
          <div className="flex h-full flex-col items-center justify-center pb-1">
            <SegmentedGauge
              value={engagementRate}
              max={10}
              verdict={verdictFor(engagementRate)}
              hint={rateKpi ? (formatDelta(rateKpi) ?? undefined) : undefined}
              size={160}
            />
          </div>
        </Panel>

        {/* Top Locations sits here in the reference, and the owner asked for it
            even though Meta will not report it yet. See the panel itself. */}
        <TopLocations accounts={accounts} />
      </div>

      {/* ══ ROW 3 · growth · content mix · delivery ══════════════════════ */}
      <div className="grid gap-3 lg:grid-cols-12">
        <Panel
          className="lg:col-span-5"
          title="Followers Growth"
          info="This period against the one before it."
        >
          <MultiSeriesChart
            labels={growthLabels}
            tooltipLabels={growthTooltips}
            height={190}
            /* One axis: both series are the same quantity, so a second scale
               would let a smaller previous month look larger than this one. */
            dualAxis={false}
            animationKey={`growth-${platform}-${from}`}
            series={[
              {
                label: 'This period',
                token: 'chart-1',
                points: followers.map((d) => (d.combined > 0 ? d.combined : null)),
              },
              {
                label: 'Previous',
                token: 'chart-4',
                dashed: true,
                points: prevFollowers.map((d) => (d.combined > 0 ? d.combined : null)),
              },
            ]}
          />
        </Panel>

        <Panel className="lg:col-span-4" title="Content Type Share">
          {mixTotal === 0 ? (
            <PanelEmpty>Nothing was published in this period.</PanelEmpty>
          ) : (
            <div className="flex items-center gap-3">
              <DonutChart
                slices={mix.map((m, i) => ({
                  label: m.label,
                  value: m.count,
                  token: MIX_TOKENS[i % MIX_TOKENS.length],
                }))}
                centreLabel="Total"
                centreValue={String(mixTotal)}
                size={132}
                thickness={13}
                caption="Posts by kind"
              />
              <ul className="min-w-0 flex-1 space-y-1.5">
                {mix.map((m, i) => (
                  <li key={m.label} className="flex items-center gap-2 text-micro">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: `var(--${MIX_TOKENS[i % MIX_TOKENS.length]})` }}
                    />
                    <span className="min-w-0 flex-1 truncate text-text-secondary">{m.label}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-text-primary">
                      {Math.round((m.count / mixTotal) * 100)}%
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums text-text-tertiary">
                      ({m.count})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel className="lg:col-span-3" title="Delivery Progress">
          {target === 0 ? (
            <PanelEmpty>No posting rhythm is agreed for this project.</PanelEmpty>
          ) : (
            <div className="flex flex-col items-center">
              <DonutChart
                slices={[
                  { label: 'Published', value: Math.min(delivered, target), token: 'chart-3' },
                  { label: 'Remaining', value: Math.max(0, target - delivered), token: 'chart-grid' },
                ]}
                centreLabel="Delivered"
                centreValue={`${Math.round((delivered / target) * 100)}%`}
                size={124}
                thickness={13}
                caption="Delivery against target"
              />
              <p className="mt-2 text-micro text-text-tertiary">
                Target: <strong className="text-text-secondary">{target} posts</strong>
              </p>
            </div>
          )}
        </Panel>
      </div>

      {/* ══ ROW 4 · top content · audience · activity ════════════════════ */}
      <div className="grid gap-3 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7"
          title="Top Performing Content"
          action={
            <MiniSelect
              label="Sort posts by"
              value={postSort}
              onChange={setPostSort}
              options={[
                { value: 'engagement', label: 'By Engagement' },
                { value: 'reach', label: 'By Reach' },
                { value: 'recent', label: 'Most recent' },
              ]}
            />
          }
        >
          {ranked.length === 0 ? (
            <PanelEmpty>No posts in this period.</PanelEmpty>
          ) : (
            <>
              <ul className="space-y-1.5">
                {ranked.map((p, i) => (
                  <PostRow key={p.id} post={p} index={i} />
                ))}
              </ul>
              <PanelLink>View all posts</PanelLink>
            </>
          )}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Platform Distribution"
          info="Share of engagement by platform."
        >
          <RankedBars rows={byPlatform} emptyText="No posts in this period." />
        </Panel>

        <Panel className="lg:col-span-3" title="Recent Activity">
          <RecentActivity posts={posts} accounts={accounts} lastSynced={lastSynced} />
        </Panel>
      </div>

      {/* ══ ROW 5 · the sample audience ═════════════════════════════════ */}
      <AudienceSample accounts={accounts} />
    </div>
  );
}

/* ---- Rows ---------------------------------------------------------------- */

function PostRow({ post, index }: { post: StudioPost; index: number }) {
  const engagement = postEngagement(post);
  const rate = post.reach && post.reach > 0 ? (engagement / post.reach) * 100 : null;

  return (
    <li
      className="motion-safe:animate-[studio-rise_380ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <a
        href={post.permalink ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-bg-subtle"
      >
        {post.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a Meta CDN URL
             that expires; next/image would need the host allow-listed and would
             cache a link that dies. */
          <img src={post.thumbnailUrl} alt="" loading="lazy" className="size-9 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-bg-subtle">
            <PlatformIcon slug={post.platform} size={14} />
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-micro font-medium text-text-primary">
            {post.caption?.trim() || 'No caption'}
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[0.65rem] text-text-tertiary">
            <PlatformIcon slug={post.platform} size={10} />
            {post.postedAt.slice(0, 10)}
            {post.mediaProductType && ` · ${post.mediaProductType.toLowerCase()}`}
          </span>
        </span>

        <span className="w-12 shrink-0 text-right text-micro font-semibold tabular-nums text-text-primary">
          {shortNumber(engagement)}
        </span>
        <span className="w-10 shrink-0 text-right text-micro tabular-nums text-text-secondary">
          {rate === null ? '—' : `${rate.toFixed(2)}%`}
        </span>
      </a>
    </li>
  );
}

function RecentActivity({
  posts,
  accounts,
  lastSynced,
}: {
  posts: readonly StudioPost[];
  accounts: readonly StudioAccount[];
  lastSynced: string | null;
}) {
  /* ⚠️ REAL EVENTS ONLY — the newest posts and the sync itself. The reference
     also shows "content scheduled" and "performance alert"; neither exists in
     this system, and inventing them would put fiction beside six panels of
     measured figures. */
  const items = [
    ...posts.slice(0, 4).map((p) => ({
      key: p.id,
      icon: <PlatformIcon slug={p.platform} size={14} />,
      title: `${p.mediaProductType?.toLowerCase() === 'reels' ? 'Reel' : 'Post'} published`,
      detail: p.caption?.trim().slice(0, 42) || 'No caption',
      when: p.postedAt,
    })),
    ...accounts
      .filter((a) => a.lastError)
      .map((a) => ({
        key: `err-${a.id}`,
        icon: <Activity className="size-3.5" style={{ color: 'var(--feedback-error)' }} />,
        title: `${PLATFORM_MARKS[a.platform]?.label ?? a.platform} sync failed`,
        detail: a.lastError ?? '',
        when: a.lastError ? (a.lastSyncedAt ?? '') : '',
      })),
  ].slice(0, 5);

  if (items.length === 0) return <PanelEmpty>Nothing has happened in this period.</PanelEmpty>;

  return (
    <>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li
            key={it.key}
            className="flex items-start gap-2.5 motion-safe:animate-[studio-rise_380ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-bg-subtle">
              {it.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-micro font-medium text-text-primary">
                {it.title}
              </span>
              <span className="block truncate text-[0.65rem] text-text-tertiary">{it.detail}</span>
            </span>
            <span className="shrink-0 text-[0.65rem] tabular-nums text-text-tertiary">
              {it.when ? it.when.slice(5, 10) : ''}
            </span>
          </li>
        ))}
      </ul>
      {lastSynced && (
        <p className="mt-2.5 text-center text-[0.65rem] text-text-tertiary">
          Synced {new Date(lastSynced).toISOString().slice(0, 16).replace('T', ' ')} UTC
        </p>
      )}
    </>
  );
}

/* ---- Helpers ------------------------------------------------------------- */

function verdictFor(rate: number): string {
  if (rate >= 6) return 'Excellent';
  if (rate >= 3) return 'Good';
  if (rate >= 1) return 'Fair';
  return 'Low';
}

/**
 * Collapse daily points into weeks or months.
 *
 * ⚠️ SUMS RATHER THAN AVERAGES, which is right for counts and wrong for the
 * follower LEVEL — so the follower series is handled by taking the last value in
 * each bucket. Summing a running total across a week is the "464 followers" bug
 * the domain tests already pin.
 */
function rollUp(
  seriesList: readonly { date: string; combined: number }[][],
  grain: Grain,
): { labels: string[]; tooltipLabels: string[]; series: (number | null)[][] } {
  const dates = seriesList[0]?.map((d) => d.date) ?? [];

  if (grain === 'daily') {
    return {
      /* ⚠️ "Aug 22", not "08-22". Owner: *"Instead of an A, mention the month
         name… like you can see in the screenshot: May 22, May 26, May 30."* A
         numeric month is a code the reader has to decode, and at a glance
         "08-22" and "22-08" are the same string in two conventions. */
      labels: dates.map(shortDate),
      tooltipLabels: dates.map(longDate),
      series: seriesList.map((s) => s.map((d) => (d.combined > 0 ? d.combined : null))),
    };
  }

  const bucketOf = (iso: string) => {
    if (grain === 'monthly') return iso.slice(0, 7);
    const d = new Date(`${iso}T00:00:00Z`);
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1)); // Monday
    return d.toISOString().slice(0, 10);
  };

  const buckets: string[] = [];
  for (const d of dates) {
    const b = bucketOf(d);
    if (buckets[buckets.length - 1] !== b) buckets.push(b);
  }

  const series = seriesList.map((s, si) =>
    buckets.map((b) => {
      const inBucket = s.filter((d) => bucketOf(d.date) === b && d.combined > 0);
      if (inBucket.length === 0) return null;
      /* Index 2 is Followers — a level, so the bucket's LAST reading. */
      return si === 2
        ? inBucket[inBucket.length - 1].combined
        : inBucket.reduce((n, d) => n + d.combined, 0);
    }),
  );

  return {
    labels: buckets.map((b) => (grain === 'monthly' ? monthShort(b) : shortDate(b))),
    /* A bucket is a range, so the readout says which — "Week of 1 Sep 2026" is
       answerable, "09-01" is a riddle. */
    tooltipLabels: buckets.map((b) =>
      grain === 'monthly' ? monthName(b) : `Week of ${longDate(b)}`,
    ),
    series,
  };
}

/** "Aug 22" — the x axis, where thirty labels share one line. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** "Sep 2026", from a `yyyy-mm` bucket. */
function monthShort(bucket: string): string {
  return new Date(`${bucket}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "4 September 2026" — unambiguous, and what the tooltip shows. */
function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "September 2026", from a `yyyy-mm` bucket. */
function monthName(bucket: string): string {
  return new Date(`${bucket}-01T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
