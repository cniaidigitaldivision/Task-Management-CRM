'use client';

import * as React from 'react';
import {
  Activity,
  ArrowRight,
  Download,
  CalendarDays,
  Eye,
  Gauge,
  Heart,
  MoreVertical,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';

import { DonutChart } from '@/components/ui/chart';
import type { MetricPoint, StudioPost } from '@/lib/domain/meta-studio';
import { compact, previousPeriod } from '@/lib/domain/meta-studio';
import { KIND_TOKENS, contentDistribution } from '@/lib/domain/meta-content';
import {
  FB,
  GRANULARITIES,
  IG,
  MEASURE_LABEL,
  POST_MEASURES,
  POST_MEASURE_LABEL,
  SCATTER_MEASURES,
  bucketCount,
  bucketSeries,
  byWeekday,
  correlation,
  correlationWord,
  dateRange,
  engagementFunnel,
  insights as buildInsights,
  interactionMix,
  periodDeltas,
  platformRadar,
  reachVsEngagement,
  series,
  sumOf,
  type Granularity,
  type PostMeasure,
  type ScatterMeasure,
} from '@/lib/domain/meta-analytics';
import { cn } from '@/lib/utils';

import { Funnel, PlatformRadar, ScatterChart, StackedArea, WeekdayBars } from './analytics-charts';
import { EngagementHeatmap } from './heatmap';
import { Panel, PanelEmpty } from './panels';
import { MultiSeriesChart } from './studio-charts';
import { useInView } from './use-in-view';

/* ============================================================================
 * ANALYTICS & INSIGHTS — the owner's reference, 2026-09-04
 * ----------------------------------------------------------------------------
 * *"Each and every thing in a very beautiful multicoloured design… Make sure
 * that the left and right sides should be equal, with no extra white spaces."*
 *
 * Nine shapes, every one fed by collected data:
 *
 *   line (multi-series)   · reach, views and video plays over the period
 *   funnel                · reached → views → engaged → interactions → profile
 *   stacked area          · what the interactions were made of, day by day
 *   radar                 · Facebook against Instagram, on comparable axes only
 *   scatter               · one point per post, reach against interactions
 *   donut                 · the content mix
 *   vertical bars         · posting and performance by day of week
 *   heatmap               · when engagement actually lands
 *   bar strip             · under each of the six metric tiles
 *
 * ── ⚠️ EVERY ROW IS A GRID ROW, WHICH IS WHAT MAKES THE SIDES EQUAL ────────
 * Owner, on every screen in this feature: *"the left and right sides should be
 * equal, with no extra white spaces."* A grid row stretches its children to the
 * height of the tallest by default, so each `Panel` carries `h-full` and its
 * body grows. Matching heights by hand breaks the first time a chart's legend
 * wraps onto a second line.
 *
 * ── ⚠️ THE PAGE REFUSES TO COMPARE TWO THINGS THAT ARE NOT COMPARABLE ──────
 * Facebook and Instagram barely share a metric name. The radar goes through
 * `COMPARABLE`, which pairs only metrics meaning the same thing; Facebook's
 * absent reach is absent rather than zero. See `lib/domain/meta-analytics.ts`.
 * ========================================================================= */

export function AnalyticsInsights({
  metrics,
  previous,
  posts,
  from,
  to,
  projectName,
}: {
  metrics: readonly MetricPoint[];
  /** The same-length window before this one, for every delta on the page. */
  previous: readonly MetricPoint[];
  posts: readonly StudioPost[];
  from: string;
  to: string;
  projectName: string;
}) {
  const dates = React.useMemo(() => dateRange(from, to), [from, to]);

  /* Which quantity sizes the scatter's bubbles. */
  const [measure, setMeasure] = React.useState<ScatterMeasure>('interactions');
  /* ...and what the weekday bars and the heatmap are each counting. */
  const [dayMeasure, setDayMeasure] = React.useState<PostMeasure>('posts');
  const [heatMeasure, setHeatMeasure] = React.useState<PostMeasure>('engagements');

  const found = React.useMemo(
    () => buildInsights({ metrics, posts, dates }),
    [metrics, posts, dates],
  );

  const deltas = React.useMemo(
    () => periodDeltas({ current: metrics, previous }),
    [metrics, previous],
  );

  /* ⚠️ THE ACTUAL DATES, NOT "vs previous period". The reference prints
     "vs May 8 – May 21", and naming the window is what makes the percentage
     checkable — a reader can go and look at those days. It is derived from the
     same `previousPeriod` the page used to FETCH that window, so the label and
     the figures can never describe different ranges. */
  const againstLabel = React.useMemo(() => {
    const p = previousPeriod(from, to);
    return `vs ${shortDate(p.from)} – ${shortDate(p.to)}`;
  }, [from, to]);

  const mix = React.useMemo(() => interactionMix(metrics, dates), [metrics, dates]);
  const radar = React.useMemo(() => platformRadar(metrics), [metrics]);
  const funnel = React.useMemo(() => engagementFunnel(metrics), [metrics]);
  const scatter = React.useMemo(() => reachVsEngagement(posts), [posts]);
  const weekdays = React.useMemo(() => byWeekday(posts), [posts]);
  const distribution = React.useMemo(() => contentDistribution(posts), [posts]);

  const trendSeries = React.useMemo(
    () => [
      {
        key: 'reach',
        label: 'Reach',
        token: 'chart-1',
        points: series(metrics, IG.reach, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'views',
        label: 'Views',
        token: 'chart-4',
        points: series(metrics, IG.views, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'video',
        label: 'Video plays',
        token: 'chart-3',
        points: series(metrics, FB.videoViews, 'facebook', dates).map((p) => p.value),
      },
    ],
    [metrics, dates],
  );

  const r = React.useMemo(
    () =>
      correlation(
        series(metrics, IG.reach, 'instagram', dates),
        series(metrics, IG.interactions, 'instagram', dates),
      ),
    [metrics, dates],
  );

  /* The six tiles. Each pairs its own total with its own daily series, so the
     figure and the strip beneath it always describe the same thing. */
  const board = React.useMemo(() => {
    const delta = (key: string) => deltas.find((d) => d.key === key)?.percent ?? null;

    return [
      {
        key: 'reach',
        label: 'Total reach',
        value: compact(sumOf(metrics, IG.reach, 'instagram')),
        percent: delta('reach'),
        icon: Eye,
        token: 'chart-1',
        spark: series(metrics, IG.reach, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'followers',
        label: 'Followers',
        value: compact(deltas.find((d) => d.key === 'followers')?.value ?? 0),
        percent: delta('followers'),
        icon: Users,
        token: 'chart-5',
        spark: series(metrics, IG.followers, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'engagements',
        label: 'Engagements',
        value: compact(
          sumOf(metrics, IG.interactions, 'instagram') + sumOf(metrics, FB.engagements, 'facebook'),
        ),
        percent: delta('engagements'),
        icon: Heart,
        token: 'chart-2',
        spark: series(metrics, IG.interactions, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'engaged',
        label: 'Accounts engaged',
        value: compact(sumOf(metrics, IG.accountsEngaged, 'instagram')),
        percent: delta('engaged'),
        icon: Activity,
        token: 'chart-3',
        spark: series(metrics, IG.accountsEngaged, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'profile',
        label: 'Profile visits',
        value: compact(
          sumOf(metrics, IG.profileViews, 'instagram') + sumOf(metrics, FB.pageViews, 'facebook'),
        ),
        percent: delta('profile'),
        icon: Gauge,
        token: 'chart-6',
        spark: series(metrics, IG.profileViews, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'posts',
        label: 'Posts published',
        value: String(posts.length),
        /* ⚠️ NO DELTA HERE. Posts are counted from what we have COLLECTED, and
           the previous window's collection is shallower — Meta serves about
           thirty days, so an older period genuinely holds fewer posts for
           reasons that have nothing to do with how much was published. A
           percentage there would measure our retention, not their output. */
        percent: null,
        icon: CalendarDays,
        token: 'chart-7',
        spark: null,
      },
    ];
  }, [metrics, deltas, dates, posts.length]);

  if (metrics.length === 0) {
    return (
      <PanelEmpty>
        Nothing has been collected for {projectName} yet, so there is nothing to analyse.
      </PanelEmpty>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── The metric board ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {board.map((b, i) => (
          <MetricTile
            key={b.key}
            label={b.label}
            value={b.value}
            percent={b.percent}
            against={againstLabel}
            icon={b.icon}
            token={b.token}
            spark={b.spark}
            index={i}
          />
        ))}
      </div>

      {/* ── The observations ───────────────────────────────────────────── */}
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <LeadTile count={found.length} />
        {found.slice(0, 3).map((ins, i) => (
          <InsightCard key={ins.key} insight={ins} index={i + 1} />
        ))}
        {/* Nothing is padded: a slot with no earned insight simply is not there,
            and the grid closes over it. */}
      </div>

      {/* ── Row 1 · the trend, and the funnel ──────────────────────────── */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <TrendPanel series={trendSeries} dates={dates} />

        <Panel
          title="From reach to engagement"
          className="h-full"
          bodyClassName="flex flex-col justify-center"
          info="Instagram only — Facebook reports no reach figure at all, so it cannot enter this funnel."
        >
          <Funnel stages={funnel} />
        </Panel>
      </div>

      {/* ── Row 2 · three across, equal by construction ────────────────── */}
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel
          title="Content interactions over time"
          className="h-full"
          bodyClassName="flex flex-col justify-center"
          info="Instagram only: Facebook reports one combined engagement figure with no breakdown to stack."
        >
          <StackedArea data={mix} labels={dates.map(axisDate)} height={152} />
        </Panel>

        <Panel
          title="Facebook vs Instagram"
          className="h-full"
          bodyClassName="flex flex-col justify-center"
          info="Five axes. Reach is Instagram only — Facebook retired its unique-reach metric and offers no replacement, so its shape breaks there rather than sitting at zero."
        >
          <PlatformRadar axes={radar} size={162} />
        </Panel>

        <Panel
          title="Reach vs engagement by post"
          className="h-full"
          bodyClassName="flex flex-col justify-center"
          info="One bubble per post. Reach across, engagements up, area by the chosen measure."
          action={
            <select
              aria-label="Size bubbles by"
              value={measure}
              onChange={(e) => setMeasure(e.target.value as ScatterMeasure)}
              className="rounded-lg border border-border-subtle bg-bg-surface px-2 py-1 text-[0.6rem] font-medium text-text-secondary transition-colors hover:border-border-default focus:border-accent-primary focus:outline-none"
            >
              {SCATTER_MEASURES.map((m) => (
                <option key={m} value={m}>
                  {MEASURE_LABEL[m]}
                </option>
              ))}
            </select>
          }
        >
          <ScatterChart data={scatter} measure={measure} height={158} />
          <p className="mt-1 flex items-start gap-1.5 border-t border-border-subtle pt-1.5 text-[0.58rem] leading-snug text-text-secondary">
            <Sparkles
              className="mt-px size-3 shrink-0"
              style={{ color: 'var(--chart-4)' }}
              aria-hidden="true"
            />
            <span>
              Daily reach and interactions are{' '}
              <strong className="font-semibold text-text-primary">{correlationWord(r)}</strong>
              {r !== null && ` (r = ${r.toFixed(2)})`}.
            </span>
          </p>
        </Panel>
      </div>

      {/* ── Row 3 · donut, weekday bars, heatmap ───────────────────────── */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <Panel
          title="Content mix"
          className="h-full"
          bodyClassName="flex flex-col justify-center"
          info="Every collected post by what it is."
        >
          {distribution.length === 0 ? (
            <PanelEmpty>No posts collected.</PanelEmpty>
          ) : (
            <DonutChart
              slices={distribution.map((d) => ({
                label: `${d.kind}s`,
                value: d.count,
                token: KIND_TOKENS[d.kind] ?? 'chart-1',
              }))}
              centreLabel="Posts"
              centreValue={String(posts.length)}
              size={112}
              thickness={15}
              animate
              caption="Posts by content type"
              className="w-full"
            />
          )}
        </Panel>

        <Panel
          title="Content output by day"
          className="h-full"
          bodyClassName="flex flex-col justify-center"
          info="Days are Karachi's, not UTC's — a post at 1am Karachi is the previous day in UTC."
          action={
            <MeasureSelect value={dayMeasure} onChange={setDayMeasure} label="Show" />
          }
        >
          <WeekdayBars bars={weekdays} measure={dayMeasure} height={150} />
        </Panel>

        <Panel
          title="Best engagement time"
          className="h-full"
          bodyClassName="flex flex-col justify-center"
          info="Every collected post placed by the hour and day it was published. It measures publishing time, not when the audience is online — Meta reports engagement daily, with no hour attached."
          action={
            <MeasureSelect value={heatMeasure} onChange={setHeatMeasure} label="Shade by" />
          }
        >
          <EngagementHeatmap posts={posts} measure={heatMeasure} />
        </Panel>
      </div>

      {/* ── Row 4 · the period comparison and its verdict ──────────────── */}
      <PeriodFooter deltas={deltas} />
    </div>
  );
}

/**
 * The measure control both post-shaped charts use.
 *
 * ⚠️ ONE COMPONENT, SO THE TWO DROPDOWNS OFFER THE SAME WORDS. The weekday bars
 * and the heatmap sit side by side; "Engagements" meaning one thing in one and
 * something else in the other is the kind of quiet inconsistency nobody reports
 * and everybody misreads. Both resolve through `measureOf`.
 */
function MeasureSelect({
  value,
  onChange,
  label,
}: {
  value: PostMeasure;
  onChange: (v: PostMeasure) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as PostMeasure)}
      className="rounded-lg border border-border-subtle bg-bg-surface px-2 py-1 text-[0.6rem] font-medium text-text-secondary transition-colors hover:border-border-default focus:border-accent-primary focus:outline-none"
    >
      {POST_MEASURES.map((m) => (
        <option key={m} value={m}>
          {POST_MEASURE_LABEL[m]}
        </option>
      ))}
    </select>
  );
}

/* ---- The footer ---------------------------------------------------------- */

/**
 * Every headline metric against the previous period, and one sentence on it.
 *
 * ⚠️ THE SENTENCE IS EARNED, NOT DECORATIVE. The reference's banner reads
 * "You're outperforming!" as fixed text. Here the verdict is derived from how
 * many metrics actually rose, and it is allowed to say the period was worse —
 * a banner that congratulates through a decline teaches the reader to ignore it,
 * which costs the one time it matters.
 */
function PeriodFooter({ deltas }: { deltas: readonly { key: string; label: string; percent: number | null; token: string }[] }) {
  const measured = deltas.filter((d) => d.percent !== null);
  const up = measured.filter((d) => (d.percent ?? 0) > 0).length;

  const verdict =
    measured.length === 0
      ? {
          tone: 'chart-4',
          title: 'No earlier period to compare against',
          detail: 'Comparisons begin once a second window of the same length has been collected.',
        }
      : up === measured.length
        ? {
            tone: 'feedback-success',
            title: 'Every measured metric is up',
            detail: `All ${measured.length} improved against the previous period.`,
          }
        : up === 0
          ? {
              tone: 'feedback-error',
              title: 'Every measured metric is down',
              detail: `All ${measured.length} fell against the previous period.`,
            }
          : {
              tone: up * 2 >= measured.length ? 'feedback-success' : 'feedback-warning',
              title: `${up} of ${measured.length} metrics improved`,
              detail: 'The rest fell against the previous period of the same length.',
            };

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Panel title="Performance vs previous period" className="h-full">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {deltas.map((d) => (
            <div
              key={d.key}
              className="rounded-lg border px-2.5 py-2"
              style={{
                borderColor: `color-mix(in oklab, var(--${d.token}) 26%, transparent)`,
                backgroundColor: `color-mix(in oklab, var(--${d.token}) 6%, transparent)`,
              }}
            >
              <p className="truncate text-[0.58rem] font-medium text-text-secondary">{d.label}</p>
              <p className="mt-1 flex items-center gap-1 text-micro font-bold tabular-nums">
                {d.percent === null ? (
                  <span className="text-text-tertiary">—</span>
                ) : (
                  <>
                    <span
                      aria-hidden="true"
                      className="text-[0.55rem]"
                      style={{
                        color:
                          d.percent >= 0 ? 'var(--feedback-success)' : 'var(--feedback-error)',
                      }}
                    >
                      {d.percent >= 0 ? '▲' : '▼'}
                    </span>
                    <span
                      style={{
                        color:
                          d.percent >= 0 ? 'var(--feedback-success)' : 'var(--feedback-error)',
                      }}
                    >
                      {Math.abs(d.percent) >= 10
                        ? Math.round(Math.abs(d.percent))
                        : Math.abs(d.percent).toFixed(1)}
                      %
                    </span>
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
      </Panel>

      <div
        className="flex h-full flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
        style={{
          borderColor: `color-mix(in oklab, var(--${verdict.tone}) 30%, transparent)`,
          backgroundColor: `color-mix(in oklab, var(--${verdict.tone}) 7%, transparent)`,
        }}
      >
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl"
          style={{ backgroundColor: `color-mix(in oklab, var(--${verdict.tone}) 16%, transparent)` }}
        >
          <Trophy className="size-5" style={{ color: `var(--${verdict.tone})` }} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body-sm font-semibold text-text-primary">
            {verdict.title}
          </span>
          <span className="block text-caption leading-snug text-text-secondary">
            {verdict.detail}
          </span>
        </span>
      </div>
    </div>
  );
}

/* ---- Parts --------------------------------------------------------------- */

/**
 * The trend chart, with the reference's granularity control and overflow menu.
 *
 * ⚠️ A GRANULARITY THAT WOULD DRAW ONE POINT IS DISABLED, NOT HIDDEN, and it
 * says why on hover. A seven-day window contains one week and one month, and a
 * line through a single point is a dot — letting somebody pick that would empty
 * the panel and look like a bug. Hiding the option instead would make the
 * control change shape as the date range moves, which is worse.
 */
function TrendPanel({
  series: input,
  dates,
}: {
  series: readonly { key: string; label: string; token: string; points: readonly (number | null)[] }[];
  dates: readonly string[];
}) {
  const [grain, setGrain] = React.useState<Granularity>('daily');
  const [menu, setMenu] = React.useState(false);

  const bucketed = React.useMemo(
    () => bucketSeries(dates, input.map((s) => s.points), grain),
    [dates, input, grain],
  );

  const shown = React.useMemo(
    () => input.map((s, i) => ({ ...s, points: bucketed.series[i] })),
    [input, bucketed],
  );

  /* ⚠️ THE CSV IS BUILT FROM WHAT IS ON SCREEN, bucketing included. A menu item
     that silently exported the daily figures while the chart showed weeks would
     hand somebody a file that disagrees with the picture they were looking at. */
  const download = () => {
    const header = ['Date', ...input.map((s) => s.label)].join(',');
    const rows = bucketed.tooltips.map((t, i) =>
      [t, ...shown.map((s) => (s.points[i] === null ? '' : s.points[i]))].join(','),
    );
    const url = URL.createObjectURL(
      new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `reach-views-video-${grain}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setMenu(false);
  };

  return (
    <Panel
      title="Reach, views and video plays over time"
      className="h-full"
      bodyClassName="flex flex-col justify-center"
      info="Instagram reach and views against Facebook video plays. Each line lifts on a day with no collected figure rather than dropping to zero."
      action={
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg bg-bg-subtle p-0.5">
            {GRANULARITIES.map((g) => {
              const buckets = bucketCount(dates, g);
              const usable = buckets >= 2;
              return (
                <button
                  key={g}
                  type="button"
                  disabled={!usable}
                  onClick={() => setGrain(g)}
                  title={
                    usable
                      ? `${buckets} ${g === 'daily' ? 'days' : g === 'weekly' ? 'weeks' : 'months'} in this range`
                      : `This range covers only one ${g === 'weekly' ? 'week' : 'month'}, so there is nothing to plot`
                  }
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[0.62rem] capitalize transition-all duration-200',
                    grain === g
                      ? 'bg-bg-surface font-semibold text-text-primary shadow-[0_1px_2px_rgb(6_35_42_/_0.08)]'
                      : usable
                        ? 'text-text-secondary hover:text-text-primary'
                        : 'cursor-not-allowed text-text-disabled',
                  )}
                >
                  {g}
                </button>
              );
            })}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              aria-label="Chart actions"
              aria-expanded={menu}
              className="grid size-6 place-items-center rounded-md text-text-tertiary transition-colors hover:bg-bg-subtle hover:text-text-primary"
            >
              <MoreVertical className="size-3.5" />
            </button>

            {menu && (
              <>
                <span className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-border-subtle bg-bg-surface py-1 shadow-[0_8px_24px_rgb(6_35_42_/_0.16)]">
                  {/* ⚠️ ONE ITEM, AND IT WORKS. The reference's ⋮ implies a menu
                      of options; inventing three that do nothing would be worse
                      than offering the one thing this chart can genuinely do. */}
                  <button
                    type="button"
                    onClick={download}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-micro text-text-primary transition-colors hover:bg-bg-subtle"
                  >
                    <Download className="size-3.5 shrink-0" aria-hidden="true" />
                    Download as CSV
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      }
    >
      {/* ⚠️ THE AXIS LABELS CARRY A MONTH AND NO YEAR. Owner: *"definitely
          mention the month also… don't mention the year."* A bare day number is
          ambiguous the moment a window crosses a month boundary, which the
          default thirty-day window always does; the year is redundant on a chart
          whose range is a month. The TOOLTIP still gets the full date — hovering
          is when somebody is pinning down exactly which day they mean. */}
      <MultiSeriesChart
        series={shown}
        labels={bucketed.labels.map(axisDate)}
        tooltipLabels={bucketed.tooltips.map((t) =>
          t.includes('→')
            ? t.split(' → ').map(fullDate).join(' → ')
            : fullDate(t),
        )}
        height={172}
      />
    </Panel>
  );
}

function MetricTile({
  label,
  value,
  percent,
  against,
  icon: Icon,
  token,
  spark,
  index,
}: {
  label: string;
  value: string;
  percent: number | null;
  against: string;
  icon: typeof Eye;
  token: string;
  spark: readonly (number | null)[] | null;
  index: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={cn(
        'studio-reveal flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-surface p-3 transition-all duration-300 hover:-translate-y-px hover:shadow-[0_6px_18px_rgb(6_35_42_/_0.09)]',
        'motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg"
          style={{ backgroundColor: `var(--${token}-wash)` }}
        >
          <Icon className="size-3.5" style={{ color: `var(--${token})` }} aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[0.65rem] font-medium text-text-secondary">
          {label}
        </p>
      </div>

      <p className="mt-2 text-[1.55rem] font-bold leading-none tracking-tight tabular-nums text-text-primary">
        {value}
      </p>

      {/* The row is always present, even with no delta, so six tiles share one
          baseline. Letting it collapse made the row ragged. */}
      <p className="mt-1.5 flex min-h-[0.85rem] items-center gap-1 text-[0.58rem]">
        {percent === null ? (
          <span className="truncate text-text-tertiary">
            {/* ⚠️ "0%" WOULD BE A MEASUREMENT. A window with no earlier figures
                has no percentage at all — the reference's own "0% vs …" on Posts
                Published is precisely the claim not to copy. */}
            No comparison · {against}
          </span>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="text-[0.5rem]"
              style={{
                color: percent >= 0 ? 'var(--feedback-success)' : 'var(--feedback-error)',
              }}
            >
              {percent >= 0 ? '▲' : '▼'}
            </span>
            <span
              className="font-bold tabular-nums"
              style={{
                color: percent >= 0 ? 'var(--feedback-success)' : 'var(--feedback-error)',
              }}
            >
              {Math.abs(percent) >= 10
                ? Math.round(Math.abs(percent))
                : Math.abs(percent).toFixed(1)}
              %
            </span>
            <span className="truncate text-text-tertiary">{against}</span>
          </>
        )}
      </p>

      {spark && spark.filter((v) => v !== null).length > 1 ? (
        <TileSpark points={spark} token={token} />
      ) : (
        <span
          className="mt-2 block h-[34px] rounded-md"
          style={{ backgroundColor: `color-mix(in oklab, var(--${token}) 5%, transparent)` }}
        />
      )}
    </div>
  );
}

/**
 * The card's own series, as a line with a dot on every reading.
 *
 * ⚠️ A LINE WITH DOTS, NOT BARS — the reference draws it that way and it is the
 * better call for a further reason: these tiles sit in a row, and six bar strips
 * read as six separate charts while six lines read as one row of trends. It sits
 * on a faint band of its own colour so the strip has an edge.
 *
 * ⚠️ THE PEN LIFTS ON A NULL DAY. A day with no collected figure is a gap, and
 * bridging it would draw a trend through a day nobody measured. The dots make
 * that visible at no extra cost: there is simply no dot there.
 *
 * ⚠️ AND A FLAT SERIES IS CENTRED, NOT PINNED TO THE FLOOR. When every reading
 * is identical the span is zero, and dividing by it would put the line on the
 * baseline — which reads as "it fell to nothing" rather than "it did not move".
 */
function TileSpark({ points, token }: { points: readonly (number | null)[]; token: string }) {
  const { ref, inView } = useInView<HTMLDivElement>();

  const real = points.filter((p): p is number => p !== null);
  const max = Math.max(...real);
  const min = Math.min(...real);
  const span = max - min;

  const W = 100;
  const H = 30;
  const PAD = 4;

  const x = (i: number) =>
    points.length <= 1 ? W / 2 : (i / (points.length - 1)) * (W - 2) + 1;
  const y = (v: number) =>
    span === 0 ? H / 2 : H - PAD - ((v - min) / span) * (H - PAD * 2);

  /* Segments, so the pen lifts across a gap rather than bridging it. */
  const segments: string[] = [];
  let current = '';
  points.forEach((p, i) => {
    if (p === null) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    current += `${current ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)} `;
  });
  if (current) segments.push(current);

  return (
    <div
      ref={ref}
      className="mt-2 overflow-hidden rounded-md"
      style={{ backgroundColor: `color-mix(in oklab, var(--${token}) 7%, transparent)` }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-[34px] w-full"
        aria-hidden="true"
      >
        {segments.map((d, i) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={`var(--${token})`}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            /* ⚠️ Without this the stroke is stretched by `preserveAspectRatio`
               into a wedge — thick horizontally, hairline vertically. */
            vectorEffect="non-scaling-stroke"
            style={{ opacity: inView ? 1 : 0, transition: 'opacity 500ms ease-out' }}
          />
        ))}

        {points.map((p, i) =>
          p === null ? null : (
            <circle
              key={i}
              cx={x(i)}
              cy={y(p)}
              r="1.6"
              fill={`var(--${token})`}
              vectorEffect="non-scaling-stroke"
              style={{
                opacity: inView ? 1 : 0,
                transition: `opacity 400ms ease-out ${Math.min(i * 18, 420)}ms`,
              }}
            />
          ),
        )}
      </svg>
    </div>
  );
}

/**
 * The card that leads the insight row.
 *
 * ⚠️ IT SAYS "FINDINGS", NOT "AI INSIGHTS". The reference labels this slot "AI
 * Insights · Smart takeaways from your data", and nothing on this page is
 * written by a model — every sentence beside it is computed from columns, which
 * is the whole reason they can be trusted. The one AI pass this feature ever had
 * returned a client name as "NAYA MARKITING". Borrowing the label would claim a
 * capability precisely where the value is that it was not used.
 */
function LeadTile({ count }: { count: number }) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={cn(
        'studio-reveal flex items-center gap-2.5 rounded-xl border border-border-subtle bg-bg-surface p-3',
        'motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg"
        style={{ backgroundColor: 'var(--chart-4-wash)' }}
      >
        <Sparkles className="size-4" style={{ color: 'var(--chart-4)' }} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-micro font-semibold text-text-primary">
          {count === 0 ? 'No findings yet' : `${count} finding${count === 1 ? '' : 's'}`}
        </span>
        <span className="block text-[0.6rem] leading-snug text-text-tertiary">
          {count === 0
            ? 'Nothing stands out far enough to report.'
            : 'Computed from your figures — nothing here is written by a model.'}
        </span>
      </span>
    </div>
  );
}

/**
 * One finding.
 *
 * ⚠️ THE TITLE TAKES THE CARD COLOUR ONLY WHEN THE FINDING IS GOOD NEWS. The
 * reference colours its first title green and leaves the rest black, which reads
 * as a style choice until you notice the green one is the title saying "up
 * 18.4%". A decline printed in the same confident green as a rise is the kind of
 * small dishonesty that accumulates, so the tone comes from `insights`, which
 * already picks a warning token for a fall.
 */
function InsightCard({
  insight,
  index,
}: {
  insight: { key: string; title: string; detail: string; token: string };
  index: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  /* `insights` uses chart-8 (red) for a decline and chart-6 for a weak signal. */
  const goodNews = insight.token !== 'chart-8';

  return (
    <div
      ref={ref}
      className={cn(
        'studio-reveal flex items-center gap-3 rounded-xl border p-3',
        'motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
      style={{
        animationDelay: `${index * 70}ms`,
        borderColor: `color-mix(in oklab, var(--${insight.token}) 26%, transparent)`,
        backgroundColor: `color-mix(in oklab, var(--${insight.token}) 8%, transparent)`,
      }}
    >
      {/* A solid filled circle with a white glyph, as the reference draws it. */}
      <span
        className="grid size-9 shrink-0 place-items-center rounded-full"
        style={{ backgroundColor: `var(--${insight.token})` }}
      >
        <ArrowRight className="size-4 -rotate-45 text-white" aria-hidden="true" />
      </span>

      <span className="min-w-0">
        <span
          className="block text-micro font-semibold leading-tight"
          style={{ color: goodNews ? `var(--${insight.token})` : 'var(--text-primary)' }}
        >
          {insight.title}
        </span>
        <span className="mt-0.5 block text-[0.6rem] leading-snug text-text-secondary">
          {insight.detail}
        </span>
      </span>
    </div>
  );
}

/* ---- Helpers ------------------------------------------------------------- */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** "Sep 4" — the x-axis label. Month named, year omitted. */
function axisDate(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** "Thu, 4 Sep" — the tooltip, where the extra words are worth their room. */
function fullDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${d} ${MONTHS[m - 1]}`;
}

/** "22 Aug" — short enough to sit beside a percentage on a narrow tile. */
function shortDate(iso: string): string {
  /* ⚠️ Parsed by hand rather than through `new Date(iso)`. A bare "YYYY-MM-DD"
     is read as UTC midnight and then FORMATTED in the reader's zone — the same
     day in Karachi, the day before west of Greenwich — so the label would
     disagree with the window it names. */
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}
