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
import type {
  MetricPoint,
  ProjectPromise,
  StudioAccount,
  StudioPost,
} from '@/lib/domain/meta-studio';
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
import { EngagementHeatmap } from './heatmap';
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

/* Each platform's own hue, so a row is recognisable before its label is read.
   Approximations from the chart palette rather than exact brand colours —
   Instagram's is a gradient and YouTube's red is `feedback-error`, which means
   "something is wrong" everywhere else in this application. */
const PLATFORM_TOKENS: Record<string, string> = {
  instagram: 'chart-2',
  facebook: 'chart-1',
  linkedin: 'chart-7',
  youtube: 'chart-8',
  tiktok: 'chart-4',
};

const CONTENT_TOKENS: Record<string, string> = {
  Reels: 'chart-1',
  Posts: 'chart-4',
  Stories: 'chart-3',
  Videos: 'chart-5',
  Others: 'chart-6',
  Ads: 'chart-2',
};

/* ── ⚠️ REAL WHERE WE HAVE IT, SAMPLE WHERE WE DO NOT, AND MARKED ─────────
   Owner: *"Facebook and Instagram should have real values but LinkedIn,
   YouTube, and TikTok should have dummy values."*

   Facebook and Instagram are measured — they are the two accounts the sync
   actually pulls. The other three are placeholders so the card has the
   reference's five rows, and each carries `sample: true` so the row itself can
   say so. A percentage sitting in a column of real percentages with nothing
   to distinguish it is the one thing this page must never do.

   ⚠️ THE SHARES ARE COMPUTED OVER THE REAL TWO ONLY. Folding invented numbers
   into the denominator would move Facebook's and Instagram's percentages —
   making the placeholders silently change a measured figure, which is far
   worse than showing them separately. */


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
  cadence: ProjectPromise;
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

  /* ── ⚠️ TEMPORARY SAMPLE — REMOVE ON REQUEST ─────────────────────────────
     Owner, 2026-09-04: *"can you show me just some dummy value in the last
     month, in the dotted lines… I just want to see whether it will load
     correctly or not. After that, when I tell you, you will just remove that."*

     There is genuinely no previous-period data — nothing in the tables predates
     2026-08-06 — so the dashed series has nothing to draw and the owner cannot
     see whether it renders. This is a shaped curve at roughly 78% of each day's
     real value, which is what a plausible previous month looks like.

     ⚠️ DELETE THIS BLOCK AND THE `?? ` FALLBACK BELOW when asked. It is the only
     invented series on the page that is NOT visually marked, because a dashed
     "Last Month" line is exactly what it will look like when real — which is
     the point of showing it, and the reason it must not be left here. */
  const prevHasData = prevFollowers.some((d) => d.combined > 0);
  const sampleLastMonth = followers.map((d, i) =>
    d.combined > 0
      ? Math.round(d.combined * (0.72 + Math.sin(i / 3) * 0.06))
      : null,
  );

  /* ── Content and platform breakdowns ──────────────────────────────────── */
  /* ⚠️ EVERY KIND, INCLUDING THE ONES AT ZERO. Owner: *"Videos and Stories are
     not posted but please mention them in their respective colors. Also add
     them."*

     Right, and it is more useful than it looks: a legend that lists only what
     was published cannot say "no stories went out this month", which is exactly
     the gap a coordinator needs to see. The donut still draws only non-zero
     slices — a zero-width arc is invisible anyway — so the list is the honest
     record and the ring stays readable. */
  const CONTENT_ORDER = ['Reels', 'Posts', 'Stories', 'Videos', 'Others'] as const;
  const counted = contentMix(posts);
  const mixTotal = counted.reduce((n, m) => n + m.count, 0);
  const mix = CONTENT_ORDER.map((label) => ({
    label,
    count: counted.find((m) => m.label === label)?.count ?? 0,
  }));
  /* ⚠️ FIXED PER CONTENT KIND, so a colour means the same thing every time the
     page is opened. The five the owner named — *"reels, posts, stories, videos,
     other"* — plus a fallback for anything Meta invents later. */
  const byPlatform = React.useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of posts) totals.set(p.platform, (totals.get(p.platform) ?? 0) + postEngagement(p));

    const real = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const sum = real.reduce((n, [, v]) => n + v, 0);

    const rows = real.map(([slug, value]) => ({
      key: slug,
      label: PLATFORM_MARKS[slug]?.label ?? slug,
      lead: <PlatformIcon slug={slug} size={15} />,
      share: sum > 0 ? value / sum : 0,
      value: compact(value),
      token: PLATFORM_TOKENS[slug] ?? 'chart-1',
      sample: false,
    }));

    /* The three the division does not manage yet, in the reference's order. */
    const placeholders = [
      { slug: 'linkedin', share: 0.16 },
      { slug: 'youtube', share: 0.06 },
      { slug: 'tiktok', share: 0.04 },
    ].filter((x) => !totals.has(x.slug));

    return [
      ...rows,
      ...placeholders.map((x) => ({
        key: x.slug,
        label: PLATFORM_MARKS[x.slug]?.label ?? x.slug,
        lead: <PlatformIcon slug={x.slug} size={15} />,
        share: x.share,
        value: '—',
        token: PLATFORM_TOKENS[x.slug] ?? 'chart-1',
        sample: true,
      })),
    ];
  }, [posts]);

  const ranked = React.useMemo(() => {
    const list = [...posts];
    if (postSort === 'reach') list.sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
    else if (postSort === 'recent') list.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
    else list.sort((a, b) => postEngagement(b) - postEngagement(a));
    return list.slice(0, 5);
  }, [posts, postSort]);

  /* ── Delivery against the promise ─────────────────────────────────────── */
  const days = daysBetween(from, to);

  /* ⚠️ THE PROMISE ARITHMETIC WENT WITH THE DELIVERY CARD, 2026-09-04. It
     computed asset and reel targets scaled to the window, from
     `assets_target_min` / `reels_target_min` on the project. That work is not
     lost — `buildKpis` still derives the Monthly Target card from the same
     columns, which is where the owner looks for "are we on track". Nothing here
     needs the two-ring breakdown any more, and leaving unused arithmetic beside
     live figures is how a later reader comes to trust a number nothing draws.

     ⚠️ THE TOTAL STAYS, because the three KPI cards at the top of the page —
     Monthly Target, Achieved, Remaining — are computed from it. Cutting it with
     the card broke those, which is what typecheck caught. It comes from the
     PROMISE (`assets_target_min` + `reels_target_min`, scaled to the window)
     rather than from the daily rhythm, so the number on screen is the one the
     client was actually sold. */
  const monthScale = days / 30;
  const target =
    Math.round((cadence.assetsMin ?? 0) * monthScale) +
    Math.round((cadence.reelsMin ?? 0) * monthScale);

  const delivered = posts.length;

  const rateKpi = kpi('engagement_rate');
  const engagementRate = rateKpi?.value ?? 0;
  const rateDelta = rateKpi ? formatDelta(rateKpi) : null;

  return (
    <div className="space-y-3">
      {/* ══ ROW 1 · the seven cards ══════════════════════════════════════
          ⚠️ `gap-2.5`, and the cards themselves are shorter — owner: *"the
          heights of all these cards are a bit extra, with a lot of white space.
          Reduce the height."* */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
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
            /* ⚠️ THE CARD'S OWN SERIES, not a decorative squiggle. Owner: *"is
               there any way to add a small graph which will move upward?"* It is
               the same daily followers data the big chart draws, so the shape a
               reader sees here is true and agrees with the panel below. */
            spark: followers.map((d) => d.combined),
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
            spark: engagement.map((d) => d.combined),
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
            spark: views.map((d) => d.combined),
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
            spark: reach.map((d) => d.combined),
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
          /* ⚠️ THE FORMULA IS ON THE PANEL, because the owner had to ask what the
             number was: *"let me know how you put this figure."* A rate whose
             derivation is invisible is a rate nobody can argue with, which is
             the wrong kind of confidence for something a client may see. */
          info={
            'Instagram interactions ÷ Instagram reach, over the selected period. ' +
            'Facebook is excluded because Graph API v26.0 no longer reports page reach, ' +
            'so there is no denominator for it.'
          }
        >
          <div className="flex h-full flex-col items-center justify-center pb-1">
            <SegmentedGauge
              value={engagementRate}
              max={10}
              verdict={verdictFor(engagementRate)}
              /* ⚠️ ALWAYS A LINE, even with nothing to compare against. Owner:
                 *"whether I have no data, show 0 or no figure but mention the
                 text 'versus last 30 days'."* An absent line reads as a missing
                 feature; a line saying there is no earlier period reads as a
                 fact about the data, which is what it is. */
              hint={
                rateDelta
                  ? `${rateDelta} vs previous ${days} days`
                  : `No earlier period yet · vs previous ${days} days`
              }
              size={210}
            />
          </div>
        </Panel>

        {/* Top Locations sits here in the reference, and the owner asked for it
            even though Meta will not report it yet. See the panel itself. */}
        <TopLocations accounts={accounts} />
      </div>

      {/* ══ ROW 3 · growth · content mix · platform split ═══════════════ */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,6fr)_minmax(0,4fr)_minmax(0,3fr)]">
        <Panel
          title="Followers Growth"
          info="This period against the one before it."
        >
          <MultiSeriesChart
            labels={growthLabels}
            tooltipLabels={growthTooltips}
            height={180}
            /* One axis: both series are the same quantity, so a second scale
               would let a smaller previous month look larger than this one. */
            dualAxis={false}
            animationKey={`growth-${platform}-${from}`}
            series={[
              {
                /* ⚠️ "This Month" / "Last Month", the reference's own words.
                   Owner: *"instead of 'in this period' you should write 'this
                   month' and instead of 'a previous' write 'last month'."* The
                   window is usually a month and these are the words a reader
                   thinks in; the exact dates are on the toolbar above. */
                label: 'This Month',
                token: 'chart-1',
                points: followers.map((d) => (d.combined > 0 ? d.combined : null)),
              },
              {
                label: 'Last Month',
                /* The sample stands in only while there is no real previous
                   period — see the note above. */
                /* ⚠️ THE SAME TOKEN AS THIS MONTH, not a second hue. The
                   reference draws both in one blue and lets the DASH carry the
                   difference — which is what makes it read as the same quantity
                   at two times rather than as two different measures. A separate
                   colour said "another metric". */
                token: 'chart-1',
                dashed: true,
                points: prevHasData
                  ? prevFollowers.map((d) => (d.combined > 0 ? d.combined : null))
                  : sampleLastMonth,
              },
            ]}
          />
        </Panel>

        <Panel title="Content Type Share">
          {mixTotal === 0 ? (
            <PanelEmpty>Nothing was published in this period.</PanelEmpty>
          ) : (
            <div className="flex items-center gap-4">
              <DonutChart
                slices={mix
                  .filter((m) => m.count > 0)
                  .map((m) => ({
                  label: m.label,
                  value: m.count,
                  /* ⚠️ COLOUR BY KIND, NOT BY POSITION. Indexing into a token
                     list meant Reels were blue in one period and green in the
                     next, purely because their rank changed — so a colour a
                     reader had learned stopped meaning anything. */
                  token: CONTENT_TOKENS[m.label] ?? 'chart-1',
                }))}
                centreLabel="Total"
                centreValue={String(mixTotal)}
                size={132}
                thickness={15}
                legend={false}
                caption="Posts by kind"
              />
              {/* ⚠️ ONE LEGEND, AND IT IS THIS ONE. `DonutChart` renders its own —
                  which is what printed every percentage twice on the Audience
                  card — so it is suppressed here with `legend={false}` and this
                  list is the single source. The reference's shape is
                  `● Label   42% (521)`, percentage then count. */}
              <ul className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                {mix.map((m) => (
                  <li key={m.label} className="flex items-center gap-2 text-micro">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: `var(--${CONTENT_TOKENS[m.label] ?? 'chart-1'})` }}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate ${m.count === 0 ? 'text-text-tertiary' : 'text-text-secondary'}`}
                    >
                      {m.label}
                    </span>
                    <span
                      className={`shrink-0 font-semibold tabular-nums ${m.count === 0 ? 'text-text-tertiary' : 'text-text-primary'}`}
                    >
                      {mixTotal > 0 ? Math.round((m.count / mixTotal) * 100) : 0}%
                    </span>
                    <span className="w-9 shrink-0 text-right tabular-nums text-text-tertiary">
                      ({m.count})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        {/* ⚠️ KEPT, THOUGH THE REFERENCE'S LAST ROW HAS NO SUCH PANEL. It is one
            of the few things on this page that is measured, per-platform and
            immediately actionable — dropping it to match a drawing would trade
            real information for symmetry. */}
        <Panel
          title="Platform Distribution"
          info="Share of engagement by platform. Facebook and Instagram are measured; the other three are placeholders until those accounts are connected."
        >
          <RankedBars rows={byPlatform} emptyText="No posts in this period." />
        </Panel>
      </div>

      {/* ══ ROW 4 · heatmap · delivery · top posts · activity ════════════
          ⚠️ FOUR TRACKS AT THE REFERENCE'S OWN PROPORTIONS — roughly
          26/19/28/27. Owner: *"the top-performing posts card… is very wide… I
          want this width"*, and Recent Activity level with it. */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,26fr)_minmax(0,19fr)_minmax(0,28fr)_minmax(0,27fr)]">
        <Panel
          title="Engagement Heatmap"
          bodyClassName="flex flex-col"
          /* ⚠️ The tooltip says what this actually measures. See heatmap.tsx —
             Meta gives no hourly engagement, so these are posts' PUBLISHING
             times weighted by what they earned. */
          info={
            'Engagement earned by posts published in each two-hour slot, Karachi time. ' +
            'Meta reports engagement daily with no hour attached, so this is by publishing ' +
            'time rather than by when the audience was active.'
          }
          action={
            <span className="inline-flex items-center gap-1 rounded-lg border border-border-subtle px-2 py-1 text-micro text-text-secondary">
              {days} days
            </span>
          }
        >
          <EngagementHeatmap posts={posts} />
        </Panel>

        {/* ⚠️ DELIVERY PROGRESS WAS HERE AND IS GONE, on the owner's instruction:
            *"It's not looking good. Remove this whole Delivery Progress card from
            here and add the Audience card."*

            Two rings against a monthly promise needed more width than a quarter
            of a row gives, and the numbers were competing with the heatmap and
            the post list either side of it. The promise itself is not lost — it
            is on the Monthly Target card at the top of the page, which is where
            somebody looks for "are we on track". This slot now holds the
            Audience card, which is a shape that fits it. */}
        <AudienceSample accounts={accounts} />

        <Panel
          title="Top-Performing Posts"
          bodyClassName="flex flex-col"
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
            <div className="flex h-full flex-col">
              {/* The reference's two column headings, so the pair of numbers on
                  each row is not left to be guessed at. */}
              <div className="mb-1 flex shrink-0 items-center gap-2.5 pl-[3.1rem] text-[0.6rem] text-text-tertiary">
                <span className="min-w-0 flex-1" />
                <span className="w-12 shrink-0 text-right">Engagement</span>
                <span className="w-10 shrink-0 text-right">Rate</span>
              </div>
              {/* Distributed, for the same reason as Recent Activity. */}
              <ul className="flex flex-1 flex-col justify-between gap-0.5">
                {ranked.map((p, i) => (
                  <PostRow key={p.id} post={p} index={i} />
                ))}
              </ul>
              <PanelLink>View all posts</PanelLink>
            </div>
          )}
        </Panel>

        <Panel title="Recent Activity" bodyClassName="flex flex-col">
          <RecentActivity posts={posts} accounts={accounts} lastSynced={lastSynced} />
        </Panel>
      </div>

      {/* ⚠️ The reference says "your local timezone". That would be a guess about
          the reader's machine; every date boundary in this system is the
          division's own day, so it says which one rather than implying it
          follows whoever is looking. */}
      <p className="pt-1 text-center text-[0.62rem] text-text-tertiary">
        All dates are Karachi time (PKT, UTC+5).
      </p>
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
  /* ⚠️ SIX, NOT FOUR. Owner: *"in the recent activity there are only 4
     activities you have shown so add 1 or 2 more activities so this card will
     look fuller."* Six is what fits beside the heatmap without the rows having
     to shrink, and there are 50 posts to draw from, so this is more real data
     rather than padding. */
  const items = [
    ...posts.slice(0, 6).map((p) => ({
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
  ].slice(0, 6);

  if (items.length === 0) return <PanelEmpty>Nothing has happened in this period.</PanelEmpty>;

  return (
    <div className="flex h-full flex-col">
      {/* ⚠️ `justify-between` ON A FULL-HEIGHT LIST, not a fixed gap. Owner: *"for
          the activity add some space between each activity so that this will be
          equal to every card."* A fixed `space-y` leaves whatever the panel is
          taller than the list as dead space at the bottom — which is exactly the
          white space in the screenshot. Distributing the rows means the spacing
          adapts to however tall the row happens to be, and the card is full
          whether it holds three items or five. */}
      <ul className="flex flex-1 flex-col justify-between gap-2">
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
        <p className="mt-2.5 shrink-0 border-t border-border-subtle pt-2 text-center text-[0.62rem] text-text-tertiary">
          Synced {new Date(lastSynced).toISOString().slice(0, 16).replace('T', ' ')} UTC
        </p>
      )}
    </div>
  );
}

/* ---- Helpers ------------------------------------------------------------- */

/**
 * The word beside the engagement rate.
 *
 * ⚠️ THE THRESHOLDS LINE UP WITH THE GAUGE'S OWN BANDS — fifths of the 0–10%
 * scale — so the word always names the colour the needle is resting on. They are
 * industry rules of thumb rather than anything Meta publishes: below 1% is poor
 * for an account of any size, 1–3% is the ordinary range, and above 6% is
 * genuinely unusual.
 */
function verdictFor(rate: number): string {
  if (rate >= 8) return 'Exceptional';
  if (rate >= 6) return 'Excellent';
  if (rate >= 4) return 'Good';
  if (rate >= 2) return 'Fair';
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
