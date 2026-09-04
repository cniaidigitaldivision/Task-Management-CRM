'use client';

import * as React from 'react';
import {
  Activity,
  CalendarDays,
  Eye,
  Gauge,
  Heart,
  Lightbulb,
  Sparkles,
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
 * ANALYTICS & INSIGHTS — owner, 2026-09-04
 * ----------------------------------------------------------------------------
 * *"A proper sleek way to present all the graphs using many colors… proper
 * graphs, donuts, vertical bars, and all these things but very beautifully. Also
 * add any other type of graph and make this page wonderful."*
 *
 * Nine shapes, every one fed by the collected data:
 *
 *   line (multi-series)   · reach, views and interactions over the period
 *   stacked area          · what the interactions were made of, day by day
 *   radar                 · Facebook against Instagram, on comparable axes only
 *   funnel                · reached → engaged → interactions → profile views
 *   scatter               · one point per post, reach against interactions
 *   vertical bars         · posting and performance by day of week
 *   donut                 · the content mix
 *   heatmap               · when engagement actually lands
 *   sparkline strip       · the metric board along the top
 *
 * ── ⚠️ THE PAGE REFUSES TO COMPARE TWO THINGS THAT ARE NOT COMPARABLE ──────
 * Facebook and Instagram barely share a metric name. The radar goes through
 * `COMPARABLE`, which pairs only metrics meaning the same thing; Facebook's
 * absent reach is absent rather than zero. The reasoning and its tests are in
 * `lib/domain/meta-analytics.ts`, and that file exists mostly to hold this line.
 * ========================================================================= */

export function AnalyticsInsights({
  metrics,
  posts,
  from,
  to,
  projectName,
}: {
  metrics: readonly MetricPoint[];
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

  const mix = React.useMemo(() => interactionMix(metrics, dates), [metrics, dates]);
  const radar = React.useMemo(() => platformRadar(metrics), [metrics]);
  const funnel = React.useMemo(() => engagementFunnel(metrics), [metrics]);
  const scatter = React.useMemo(() => reachVsEngagement(posts), [posts]);
  const weekdays = React.useMemo(() => byWeekday(posts), [posts]);
  const distribution = React.useMemo(() => contentDistribution(posts), [posts]);

  /* The three trends that share a scale well enough to sit on one chart. */
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
        label: 'FB video views',
        token: 'chart-6',
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

  const board = React.useMemo(
    () => [
      {
        key: 'reach',
        label: 'Total reach',
        value: compact(sumOf(metrics, IG.reach, 'instagram')),
        icon: Eye,
        token: 'chart-1',
        spark: series(metrics, IG.reach, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'views',
        label: 'Total views',
        value: compact(
          sumOf(metrics, IG.views, 'instagram') + sumOf(metrics, FB.videoViews, 'facebook'),
        ),
        icon: Activity,
        token: 'chart-4',
        spark: series(metrics, IG.views, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'interactions',
        label: 'Interactions',
        value: compact(
          sumOf(metrics, IG.interactions, 'instagram') +
            sumOf(metrics, FB.engagements, 'facebook'),
        ),
        icon: Heart,
        token: 'chart-2',
        spark: series(metrics, IG.interactions, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'engaged',
        label: 'Accounts engaged',
        value: compact(sumOf(metrics, IG.accountsEngaged, 'instagram')),
        icon: Users,
        token: 'chart-3',
        spark: series(metrics, IG.accountsEngaged, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'profile',
        label: 'Profile views',
        value: compact(
          sumOf(metrics, IG.profileViews, 'instagram') + sumOf(metrics, FB.pageViews, 'facebook'),
        ),
        icon: Gauge,
        token: 'chart-5',
        spark: series(metrics, IG.profileViews, 'instagram', dates).map((p) => p.value),
      },
      {
        key: 'posts',
        label: 'Posts published',
        value: String(posts.length),
        icon: CalendarDays,
        token: 'chart-6',
        spark: null,
      },
    ],
    [metrics, dates, posts.length],
  );

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
            icon={b.icon}
            token={b.token}
            spark={b.spark}
            index={i}
          />
        ))}
      </div>

      {/* ── The written observations ───────────────────────────────────── */}
      {found.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {found.map((ins, i) => (
            <InsightCard key={ins.key} insight={ins} index={i} />
          ))}
        </div>
      )}

      {/* ── Row 1 · the big trend, and the funnel beside it ────────────── */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Panel
          title="Reach, views and video, day by day"
          info="Instagram reach and views against Facebook video views. Each line lifts on a day with no collected figure rather than dropping to zero."
        >
          <MultiSeriesChart series={trendSeries} labels={dates} height={230} />
        </Panel>

        <Panel
          title="From reached to engaged"
          info="Instagram only — Facebook reports no reach figure at all, so it cannot enter this funnel."
        >
          <Funnel stages={funnel} />
        </Panel>
      </div>

      {/* ── Row 2 · the interaction mix, and the radar ─────────────────── */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Panel
          title="What the interactions were made of"
          info="Instagram only: Facebook reports one combined engagement figure with no breakdown to stack."
        >
          <StackedArea data={mix} height={210} />
        </Panel>

        <Panel
          title="Facebook against Instagram"
          info="Only metrics that mean the same thing on both platforms. Views are deliberately absent — Facebook counts video plays, Instagram counts everything."
        >
          <PlatformRadar axes={radar} />
        </Panel>
      </div>

      {/* ── Row 3 · scatter, weekday bars, donut ───────────────────────── */}
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel
          title="Does reach buy engagement?"
          className="xl:col-span-2"
          info="One point per post. Reach across, interactions up."
        >
          <ScatterChart data={scatter} height={230} />
          {/* ⚠️ THE ANSWER IN WORDS, and it is allowed to be "no". A correlation
              figure with no sentence beside it gets read as whatever the reader
              hoped for. */}
          <p className="mt-1.5 flex items-start gap-1.5 border-t border-border-subtle pt-2 text-[0.62rem] leading-snug text-text-secondary">
            <Sparkles
              className="mt-px size-3 shrink-0"
              style={{ color: 'var(--chart-4)' }}
              aria-hidden="true"
            />
            <span>
              Across the period, daily reach and daily interactions are{' '}
              <strong className="font-semibold text-text-primary">{correlationWord(r)}</strong>
              {r !== null && ` (r = ${r.toFixed(2)})`}.
            </span>
          </p>
        </Panel>

        <Panel title="Content mix" info="Every collected post by what it is.">
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
              size={140}
              thickness={17}
              animate
              caption="Posts by content type"
              className="w-full"
            />
          )}
        </Panel>
      </div>

      {/* ── Row 4 · weekday bars, and the heatmap ──────────────────────── */}
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel
          title="By day of week"
          info="Bars are posts published; the dot is that day's engagement rate on its own scale. Days are Karachi's, not UTC's."
        >
          <WeekdayBars bars={weekdays} height={190} />
        </Panel>

        <Panel
          title="When engagement lands"
          info="Every collected post placed by the hour and day it was published, shaded by the engagement it earned."
        >
          <EngagementHeatmap posts={posts} />
        </Panel>
      </div>
    </div>
  );
}

/* ---- Parts --------------------------------------------------------------- */

function MetricTile({
  label,
  value,
  icon: Icon,
  token,
  spark,
  index,
}: {
  label: string;
  value: string;
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
        'studio-reveal relative overflow-hidden rounded-xl border border-border-subtle bg-bg-surface p-3 transition-all duration-300 hover:-translate-y-px hover:shadow-[0_6px_18px_rgb(6_35_42_/_0.09)]',
        'motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{
          background: `linear-gradient(90deg, var(--${token}), color-mix(in oklab, var(--${token}) 25%, transparent))`,
        }}
      />

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
 * ⚠️ AND A NULL DAY IS A GAP, not a zero-height bar sitting on the floor next to
 * a genuine zero. It is drawn as a faint tick so the absence is visible.
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
        backgroundColor: `color-mix(in oklab, var(--${insight.token}) 6%, transparent)`,
      }}
    >
      <span
        className="grid size-8 shrink-0 place-items-center rounded-lg"
        style={{
          backgroundColor: `color-mix(in oklab, var(--${insight.token}) 16%, transparent)`,
        }}
      >
        <Lightbulb className="size-4" style={{ color: `var(--${insight.token})` }} />
      </span>
      <span className="min-w-0">
        <span className="block text-micro font-semibold leading-tight text-text-primary">
          {insight.title}
        </span>
        <span className="mt-0.5 block text-[0.62rem] leading-snug text-text-secondary">
          {insight.detail}
        </span>
      </span>
    </div>
  );
}
