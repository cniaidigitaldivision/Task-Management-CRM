'use client';

import * as React from 'react';
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Eye,
  Gauge,
  Heart,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';

import { DonutChart } from '@/components/ui/chart';
import type { MetricPoint, StudioPost } from '@/lib/domain/meta-studio';
import { compact } from '@/lib/domain/meta-studio';
import { KIND_TOKENS, contentDistribution } from '@/lib/domain/meta-content';
import {
  FB,
  IG,
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

  const found = React.useMemo(
    () => buildInsights({ metrics, posts, dates }),
    [metrics, posts, dates],
  );

  const deltas = React.useMemo(
    () => periodDeltas({ current: metrics, previous }),
    [metrics, previous],
  );

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
        <Panel
          title="Reach, views and video plays over time"
          className="h-full"
          bodyClassName="flex flex-col"
          info="Instagram reach and views against Facebook video plays. Each line lifts on a day with no collected figure rather than dropping to zero."
        >
          <MultiSeriesChart series={trendSeries} labels={dates} height={250} />
        </Panel>

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
          bodyClassName="flex flex-col justify-between"
          info="Instagram only: Facebook reports one combined engagement figure with no breakdown to stack."
        >
          <StackedArea data={mix} height={200} />
        </Panel>

        <Panel
          title="Facebook vs Instagram"
          className="h-full"
          bodyClassName="flex flex-col justify-center"
          info="Only metrics that mean the same thing on both platforms. Views are deliberately absent — Facebook counts video plays, Instagram counts everything."
        >
          <PlatformRadar axes={radar} size={190} />
        </Panel>

        <Panel
          title="Reach vs engagement by post"
          className="h-full"
          bodyClassName="flex flex-col justify-between"
          info="One point per post. Reach across, interactions up."
        >
          <ScatterChart data={scatter} height={200} />
          <p className="mt-1.5 flex items-start gap-1.5 border-t border-border-subtle pt-2 text-[0.6rem] leading-snug text-text-secondary">
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
      <div className="grid gap-3 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.35fr)]">
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
              size={132}
              thickness={16}
              animate
              caption="Posts by content type"
              className="w-full"
            />
          )}
        </Panel>

        <Panel
          title="Content output by day"
          className="h-full"
          bodyClassName="flex flex-col justify-between"
          info="Bars are posts published; the dot is that day's engagement rate on its own scale. Days are Karachi's, not UTC's."
        >
          <WeekdayBars bars={weekdays} height={186} />
        </Panel>

        <Panel
          title="Best engagement time"
          className="h-full"
          bodyClassName="flex flex-col justify-center"
          info="Every collected post placed by the hour and day it was published, shaded by the engagement it earned."
        >
          <EngagementHeatmap posts={posts} />
        </Panel>
      </div>

      {/* ── Row 4 · the period comparison and its verdict ──────────────── */}
      <PeriodFooter deltas={deltas} />
    </div>
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

function MetricTile({
  label,
  value,
  percent,
  icon: Icon,
  token,
  spark,
  index,
}: {
  label: string;
  value: string;
  percent: number | null;
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
        'studio-reveal relative flex flex-col overflow-hidden rounded-xl border bg-bg-surface p-3 transition-all duration-300 hover:-translate-y-px hover:shadow-[0_6px_18px_rgb(6_35_42_/_0.09)]',
        'motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
      style={{
        animationDelay: `${index * 60}ms`,
        borderColor: `color-mix(in oklab, var(--${token}) 24%, transparent)`,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg"
          style={{ backgroundColor: `var(--${token}-wash)` }}
        >
          <Icon className="size-3.5" style={{ color: `var(--${token})` }} aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[0.6rem] font-medium text-text-secondary">
          {label}
        </p>
      </div>

      <p className="mt-1.5 text-h2 font-bold leading-none tabular-nums text-text-primary">
        {value}
      </p>

      {/* ⚠️ THE ROW IS ALWAYS PRESENT, even with no delta to show, so six tiles
          share one baseline. Letting it collapse made the tiles ragged. */}
      <p className="mt-1 flex min-h-[0.9rem] items-center gap-1 text-[0.58rem]">
        {percent === null ? (
          <span className="text-text-tertiary">vs previous period</span>
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
            <span className="truncate text-text-tertiary">vs previous</span>
          </>
        )}
      </p>

      {spark && spark.filter((v) => v !== null).length > 1 ? (
        <TileSpark points={spark} token={token} />
      ) : (
        <span className="mt-2 block h-[22px]" />
      )}
    </div>
  );
}

/**
 * A tiny bar strip under a tile.
 *
 * ⚠️ BARS, NOT A LINE, and deliberately different from the Meta Accounts cards'
 * sparkline. These series are spiky — reach swings between 0 and 54,000 — and a
 * line through that is a scribble, while bars read as a rhythm. Same data,
 * different shape, because the shape has to suit what it is drawing.
 *
 * ⚠️ AND A NULL DAY IS A GAP, not a zero-height bar sitting on the floor beside
 * a genuine zero. It is drawn as a faint tick so the absence stays visible.
 */
function TileSpark({ points, token }: { points: readonly (number | null)[]; token: string }) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const real = points.filter((p): p is number => p !== null);
  const max = Math.max(1, ...real);

  return (
    <div ref={ref} className="mt-2 flex h-[22px] items-end gap-px">
      {points.map((p, i) => (
        <span
          key={i}
          className="min-w-px flex-1 rounded-[1px]"
          style={{
            height: p === null ? '12%' : `${Math.max(6, (p / max) * 100)}%`,
            backgroundColor: p === null ? 'var(--chart-grid)' : `var(--${token})`,
            opacity: p === null ? 1 : 0.78,
            transform: inView ? 'scaleY(1)' : 'scaleY(0.05)',
            transformOrigin: 'bottom',
            transition: `transform 500ms cubic-bezier(0.16,1,0.3,1) ${i * 10}ms`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * The card that leads the insight row.
 *
 * ⚠️ IT SAYS "DERIVED", NOT "AI". The reference labels this slot "AI Insights ·
 * Smart takeaways from your data", and nothing on this page is written by a
 * model — every sentence beside it is computed from columns, which is the whole
 * reason they can be trusted. The one AI pass this feature ever had returned a
 * client's name as "NAYA MARKITING". Borrowing the label would be claiming a
 * capability precisely where the product's value is that it has not been used.
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
            ? 'Nothing in the data stands out far enough to report.'
            : 'Computed from your figures — nothing here is written by a model.'}
        </span>
      </span>
    </div>
  );
}

function InsightCard({
  insight,
  index,
}: {
  insight: { key: string; title: string; detail: string; token: string };
  index: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={cn(
        'studio-reveal flex gap-2.5 rounded-xl border p-3',
        'motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
      style={{
        animationDelay: `${index * 70}ms`,
        borderColor: `color-mix(in oklab, var(--${insight.token}) 28%, transparent)`,
        backgroundColor: `color-mix(in oklab, var(--${insight.token}) 7%, transparent)`,
      }}
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg"
        style={{
          backgroundColor: `color-mix(in oklab, var(--${insight.token}) 18%, transparent)`,
        }}
      >
        <ArrowRight
          className="size-4 -rotate-45"
          style={{ color: `var(--${insight.token})` }}
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-micro font-semibold leading-tight text-text-primary">
          {insight.title}
        </span>
        <span className="mt-0.5 block text-[0.6rem] leading-snug text-text-secondary">
          {insight.detail}
        </span>
      </span>
    </div>
  );
}
