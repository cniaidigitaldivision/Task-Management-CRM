'use client';

import * as React from 'react';
import {
  BarChart3,
  Eye,
  ExternalLink,
  FileText,
  Heart,
  Lightbulb,
  MessageCircle,
  Percent,
  Radio,
  Send,
  Sparkles,
} from 'lucide-react';

import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import { DonutChart } from '@/components/ui/chart';
import type { StudioPost } from '@/lib/domain/meta-studio';
import { compact, postEngagement } from '@/lib/domain/meta-studio';
import {
  type ContentDraft,
  type ContentTab,
  classifyPost,
  contentDistribution,
  contentInsights,
  contentKpis,
  contentTabs,
  filterPosts,
  rankPosts,
} from '@/lib/domain/meta-content';
import { cn } from '@/lib/utils';

import { KpiCard, MiniSelect, Panel, PanelEmpty } from './panels';
import { useInView } from './use-in-view';

/* ============================================================================
 * CONTENT & POSTS
 * ----------------------------------------------------------------------------
 * Owner's reference, 2026-09-04: *"I want the exact same UI for the content and
 * post page. The UI must be the same but implement it with the proper logic and
 * with proper real data."*
 *
 * ── ⚠️ WHERE THIS DEPARTS FROM THE DRAWING, AND WHY ─────────────────────────
 * Two panels in the reference cannot be filled from anything this system knows,
 * and both are recorded here rather than faked:
 *
 *   "Content Score 89"   No such measure exists. A weighted blend of reach and
 *                        engagement would put a number on a client's screen
 *                        meaning only whatever formula I chose that afternoon.
 *                        Replaced by AVERAGE REACH PER POST — real, and answers
 *                        a question somebody actually has.
 *
 *   "AI Suggestions"     Three cards: a best time to post, a content idea, a
 *                        repurposing tip. Only the FIRST is derivable from data
 *                        held here. A panel mixing one measured fact with two
 *                        invented ones teaches a reader to trust all three
 *                        equally. It is now "Insights", and every line in it is
 *                        computed from what this account published.
 *
 * Everything else is the reference: six figures, a tab strip with counts, a
 * platform filter, a card grid, and a right rail of top posts and distribution.
 *
 * ── EVERY FIGURE COMES FROM `meta_posts` / `meta_post_metrics` ──────────────
 * The tables the 2-hourly sync fills. Drafts are the exception and are Taskly's
 * own tasks, because Meta has no concept of a post that has not happened.
 * ========================================================================= */

const KPI_ICONS = {
  total: FileText,
  published: Send,
  reach: Radio,
  engagement: Heart,
  rate: Percent,
  avg_reach: BarChart3,
} as const;

const KPI_TOKENS = {
  total: 'chart-1',
  published: 'chart-3',
  reach: 'chart-8',
  engagement: 'chart-2',
  rate: 'chart-6',
  avg_reach: 'chart-4',
} as const;

const KIND_TOKENS: Record<string, string> = {
  Reel: 'chart-1',
  Post: 'chart-4',
  Story: 'chart-3',
  Video: 'chart-5',
  Image: 'chart-7',
  Carousel: 'chart-2',
};

export function ContentPosts({
  posts,
  previousPosts,
  drafts,
  platform,
  onPlatform,
  from,
  to,
}: {
  posts: readonly StudioPost[];
  previousPosts: readonly StudioPost[];
  drafts: readonly ContentDraft[];
  platform: 'all' | 'facebook' | 'instagram';
  onPlatform: (p: string) => void;
  from: string;
  to: string;
}) {
  const [tab, setTab] = React.useState<ContentTab>('all');
  const [sort, setSort] = React.useState<'engagement' | 'reach' | 'recent'>('recent');

  const tabs = React.useMemo(() => contentTabs(posts, drafts.length), [posts, drafts.length]);
  const kpis = React.useMemo(
    () => contentKpis({ posts, previousPosts, draftCount: drafts.length }),
    [posts, previousPosts, drafts.length],
  );
  const insights = React.useMemo(() => contentInsights(posts), [posts]);
  const distribution = React.useMemo(() => contentDistribution(posts), [posts]);

  const shown = React.useMemo(
    () => rankPosts(filterPosts(posts, tab, platform), sort, 24),
    [posts, tab, platform, sort],
  );

  const topPosts = React.useMemo(() => rankPosts(posts, 'engagement', 5), [posts]);

  return (
    <div className="space-y-3">
      {/* ══ The six figures ═══════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k, i) => (
          <KpiCard
            key={k.key}
            index={i}
            data={{
              key: k.key,
              label: k.label,
              value: k.kind === 'rate' ? `${k.value.toFixed(1)}%` : compact(k.value),
              icon: KPI_ICONS[k.key as keyof typeof KPI_ICONS] ?? FileText,
              token: KPI_TOKENS[k.key as keyof typeof KPI_TOKENS] ?? 'chart-1',
              deltaText:
                k.deltaPercent === null
                  ? null
                  : k.kind === 'rate'
                    ? `${k.deltaPercent > 0 ? '+' : ''}${k.deltaPercent.toFixed(2)}pp`
                    : `${k.deltaPercent > 0 ? '+' : ''}${k.deltaPercent.toFixed(0)}%`,
              deltaDirection:
                k.deltaPercent === null
                  ? 'flat'
                  : k.deltaPercent > 0.05
                    ? 'up'
                    : k.deltaPercent < -0.05
                      ? 'down'
                      : 'flat',
              footnote: k.hint ?? (k.deltaPercent === null ? 'no earlier period' : undefined),
            }}
          />
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ══ The grid ════════════════════════════════════════════════════ */}
        <div className="min-w-0 space-y-3">
          {/* Type tabs, with their real counts */}
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border-subtle">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  'relative inline-flex items-center gap-1.5 px-2.5 py-2 text-caption transition-colors',
                  tab === t.key
                    ? 'font-semibold text-text-primary'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {t.label}
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[0.6rem] font-bold tabular-nums',
                    tab === t.key ? 'text-text-primary' : 'text-text-tertiary',
                  )}
                  style={{
                    backgroundColor:
                      tab === t.key ? 'var(--chart-1-wash)' : 'var(--bg-subtle)',
                  }}
                >
                  {t.count}
                </span>
                {tab === t.key && (
                  <span className="absolute inset-x-1.5 -bottom-px h-0.5 rounded-full bg-accent-primary" />
                )}
              </button>
            ))}
          </div>

          {/* Platform filter and sort */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-bg-subtle p-0.5">
              {(['all', 'facebook', 'instagram'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPlatform(p)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-micro transition-all duration-200',
                    platform === p
                      ? 'bg-bg-surface font-semibold text-text-primary shadow-[0_1px_2px_rgb(6_35_42_/_0.08)]'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  {p !== 'all' && <PlatformIcon slug={p} size={12} />}
                  {p === 'all' ? 'All platforms' : (PLATFORM_MARKS[p]?.label ?? p)}
                </button>
              ))}
            </div>

            <MiniSelect
              label="Sort posts"
              value={sort}
              onChange={(v) => setSort(v as typeof sort)}
              options={[
                { value: 'recent', label: 'Most recent' },
                { value: 'engagement', label: 'By engagement' },
                { value: 'reach', label: 'By reach' },
              ]}
            />

            <span className="ml-auto text-micro tabular-nums text-text-tertiary">
              {from} → {to}
            </span>
          </div>

          {/* The cards, or the drafts list */}
          {tab === 'drafts' ? (
            <DraftList drafts={drafts} />
          ) : shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-6 py-14 text-center">
              <p className="text-body-sm font-semibold text-text-primary">
                Nothing of this kind in the period
              </p>
              <p className="mx-auto mt-1.5 max-w-sm text-caption text-text-secondary">
                {tab === 'stories'
                  ? 'Meta only reports a story for 24 hours after it is posted, so stories rarely appear in a historical window.'
                  : 'Try another kind, another platform, or a wider date range.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {shown.map((p, i) => (
                <PostCard key={p.id} post={p} index={i} />
              ))}
            </div>
          )}
        </div>

        {/* ══ The rail ════════════════════════════════════════════════════ */}
        <aside className="space-y-3">
          <Panel
            title="Insights"
            info="Computed from this account's own posting — no suggestions are generated."
          >
            {insights.length === 0 ? (
              <PanelEmpty>Nothing published in this period to learn from.</PanelEmpty>
            ) : (
              <ul className="space-y-2">
                {insights.map((it, i) => (
                  <li
                    key={it.key}
                    className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-bg-subtle px-2.5 py-2 motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
                    style={{ animationDelay: `${i * 90}ms` }}
                  >
                    <span
                      className="mt-px grid size-6 shrink-0 place-items-center rounded-md"
                      style={{ backgroundColor: 'var(--chart-4-wash)' }}
                    >
                      {it.key === 'best_time' ? (
                        <Sparkles className="size-3.5" style={{ color: 'var(--chart-4)' }} />
                      ) : (
                        <Lightbulb className="size-3.5" style={{ color: 'var(--chart-4)' }} />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-micro font-semibold text-text-primary">
                        {it.title}
                      </span>
                      <span className="mt-0.5 block text-[0.65rem] leading-snug text-text-tertiary">
                        {it.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Top performing posts">
            {topPosts.length === 0 ? (
              <PanelEmpty>No posts in this period.</PanelEmpty>
            ) : (
              <ol className="space-y-1.5">
                {topPosts.map((p, i) => (
                  <li key={p.id}>
                    <a
                      href={p.permalink ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg px-1 py-1 transition-colors hover:bg-bg-subtle"
                    >
                      <span className="w-3 shrink-0 text-center text-[0.65rem] font-bold tabular-nums text-text-tertiary">
                        {i + 1}
                      </span>
                      <Thumb post={p} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-1 text-[0.68rem] font-medium text-text-primary">
                          {p.caption?.trim() || 'No caption'}
                        </span>
                        <span className="block text-[0.62rem] text-text-tertiary">
                          {p.postedAt.slice(0, 10)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[0.68rem] font-bold tabular-nums text-text-primary">
                          {compact(postEngagement(p))}
                        </span>
                        <span className="block text-[0.58rem] text-text-tertiary">engagement</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </Panel>

          <Panel title="Content distribution">
            {distribution.length === 0 ? (
              <PanelEmpty>Nothing published in this period.</PanelEmpty>
            ) : (
              <DonutChart
                slices={distribution.map((d) => ({
                  label: `${d.kind}s`,
                  value: d.count,
                  token: KIND_TOKENS[d.kind] ?? 'chart-1',
                }))}
                centreLabel="Total"
                centreValue={String(posts.length)}
                size={124}
                thickness={14}
                animate
                caption="Posts by kind"
                className="w-full justify-between"
              />
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/* ---- One post ------------------------------------------------------------ */

function Thumb({ post, size = 40 }: { post: StudioPost; size?: number }) {
  if (!post.thumbnailUrl) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-md bg-bg-subtle"
        style={{ width: size, height: size }}
      >
        <PlatformIcon slug={post.platform} size={Math.round(size * 0.45)} />
      </span>
    );
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- a Meta CDN URL that
       expires; next/image would need the host allow-listed and would cache a
       link that dies. */
    <img
      src={post.thumbnailUrl}
      alt=""
      loading="lazy"
      className="shrink-0 rounded-md object-cover"
      style={{ width: size, height: size }}
    />
  );
}

function PostCard({ post, index }: { post: StudioPost; index: number }) {
  const kind = classifyPost(post);
  const { ref, inView } = useInView<HTMLDivElement>();
  const engagement = postEngagement(post);
  const rate = post.reach && post.reach > 0 ? (engagement / post.reach) * 100 : null;

  return (
    <div
      ref={ref}
      className={cn(
        'studio-reveal group overflow-hidden rounded-xl border border-border-subtle bg-bg-surface shadow-[0_1px_2px_rgb(6_35_42_/_0.04)] transition-all duration-300 hover:-translate-y-px hover:shadow-[0_6px_18px_rgb(6_35_42_/_0.1)]',
        'motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
      style={{ animationDelay: `${(index % 8) * 70}ms` }}
    >
      {/* ── The image ──────────────────────────────────────────────────── */}
      <a
        href={post.permalink ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="relative block aspect-[4/3] overflow-hidden bg-bg-subtle"
      >
        {post.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- see Thumb. */
          <img
            src={post.thumbnailUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <span className="grid size-full place-items-center">
            <PlatformIcon slug={post.platform} size={28} />
          </span>
        )}

        {/* The kind, as the reference badges it */}
        <span className="absolute left-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[0.58rem] font-bold uppercase tracking-wide text-white backdrop-blur-sm">
          {kind}
        </span>

        {/* ⚠️ A HOVER AFFORDANCE, NOT A PLAY BUTTON. The reference draws ▶ on
            videos, which promises playback this card cannot deliver — the
            thumbnail is a still and the link opens Meta. An "open" cue tells the
            truth about what clicking does. */}
        <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="grid size-9 place-items-center rounded-full bg-black/55 backdrop-blur-sm">
            <ExternalLink className="size-4 text-white" aria-hidden="true" />
          </span>
        </span>
      </a>

      {/* ── The facts ──────────────────────────────────────────────────── */}
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-center gap-1.5">
          <PlatformIcon slug={post.platform} size={13} />
          <span className="min-w-0 flex-1 truncate text-[0.68rem] text-text-secondary">
            {PLATFORM_MARKS[post.platform]?.label ?? post.platform}
          </span>
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.58rem] font-bold"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--feedback-success) 14%, transparent)',
              color: 'var(--feedback-success)',
            }}
          >
            Published
          </span>
        </div>

        <p className="line-clamp-2 min-h-[2.1em] text-[0.68rem] leading-snug text-text-primary">
          {post.caption?.trim() || 'No caption'}
        </p>

        <p className="text-[0.62rem] tabular-nums text-text-tertiary">
          {new Date(post.postedAt).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Karachi',
          })}
        </p>

        {/* ⚠️ A DASH WHERE THE PLATFORM REPORTS NOTHING, never a zero. Facebook
            returns no per-post reach or views, and "0 views" is a claim that
            nobody watched rather than that nobody counted. */}
        <div className="flex items-center gap-2.5 border-t border-border-subtle pt-1.5 text-[0.62rem] tabular-nums text-text-secondary">
          <span className="inline-flex items-center gap-1" title="Views">
            <Eye className="size-3 text-text-tertiary" aria-hidden="true" />
            {post.views === null ? '—' : compact(post.views)}
          </span>
          <span className="inline-flex items-center gap-1" title="Likes">
            <Heart className="size-3 text-text-tertiary" aria-hidden="true" />
            {post.likes === null ? '—' : compact(post.likes)}
          </span>
          <span className="inline-flex items-center gap-1" title="Comments">
            <MessageCircle className="size-3 text-text-tertiary" aria-hidden="true" />
            {post.comments === null ? '—' : compact(post.comments)}
          </span>
          {rate !== null && (
            <span className="ml-auto font-semibold text-text-primary" title="Engagement rate">
              {rate.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Drafts -------------------------------------------------------------- */

function DraftList({ drafts }: { drafts: readonly ContentDraft[] }) {
  if (drafts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-6 py-14 text-center">
        <p className="text-body-sm font-semibold text-text-primary">Nothing in draft</p>
        <p className="mx-auto mt-1.5 max-w-sm text-caption text-text-secondary">
          Every piece of content raised for this project has been published.
        </p>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <ul className="space-y-2">
      {drafts.map((d, i) => {
        const overdue = d.dueDate !== null && d.dueDate < today;
        return (
          <li
            key={d.id}
            className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-2.5 motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-lg"
              style={{ backgroundColor: 'var(--chart-6-wash)' }}
            >
              <FileText className="size-4" style={{ color: 'var(--chart-6)' }} aria-hidden="true" />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm font-medium text-text-primary">
                {d.title}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-micro text-text-tertiary">
                <span className="font-mono">{d.reference}</span>
                {d.kind && <span>· {d.kind}</span>}
                {d.assigneeName && <span>· {d.assigneeName}</span>}
              </span>
            </span>

            {/* ⚠️ An overdue draft is named as overdue. It is the one thing on
                this tab somebody has to act on today, and a date alone leaves
                the reader to do the arithmetic. */}
            {d.dueDate && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-micro font-semibold tabular-nums"
                style={
                  overdue
                    ? {
                        backgroundColor: 'color-mix(in oklab, var(--feedback-error) 14%, transparent)',
                        color: 'var(--feedback-error)',
                      }
                    : { backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }
                }
              >
                {overdue ? 'overdue · ' : 'due '}
                {d.dueDate}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
