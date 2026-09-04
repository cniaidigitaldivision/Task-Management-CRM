'use client';

import * as React from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Hash,
  Info,
  Link2,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Users,
} from 'lucide-react';

import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import { DonutChart } from '@/components/ui/chart';
import type { AccountDetail } from '@/lib/db/queries/meta-studio';
import { compact } from '@/lib/domain/meta-studio';
import { accountHealth, fleetBanner, syncHealthSummary } from '@/lib/domain/meta-content';
import { cn } from '@/lib/utils';

import { KpiCard, Panel, Sparkline } from './panels';
import { useInView } from './use-in-view';

/* ============================================================================
 * META ACCOUNTS
 * ----------------------------------------------------------------------------
 * Built to the owner's reference, 2026-09-04: five figures, a card per account
 * with three sparklines and its sync detail, and a rail of totals, sync status,
 * quick actions and integration notes.
 *
 * ── ⚠️ TWO PLACES THE DRAWING WOULD HAVE LIED, AND WHAT THEY DO INSTEAD ─────
 *
 *   "Sync Health — Excellent · All systems operational"
 *       Fixed text in the reference. Here it is a verdict from
 *       `syncHealthSummary`, and ⚠️ THE WORST ACCOUNT SETS IT: nine healthy
 *       connections and one revoked is not "90% excellent", it is one client
 *       whose figures are frozen. It currently reads "Falling behind", which is
 *       true — the cron is registered but this branch is not deployed.
 *
 *   "Your accounts are performing great! 🎉"
 *       Also fixed text — a congratulation that keeps congratulating while
 *       followers fall and a connection dies. `fleetBanner` derives the tone and
 *       is allowed to report bad news. Tests pin both.
 *
 * Everything else is the reference.
 * ========================================================================= */

type Filter = 'all' | 'facebook' | 'instagram';

export function MetaAccounts({
  accounts,
  projectName,
  nowMs,
  postsThisPeriod,
  postsPreviousPeriod,
  onResync,
}: {
  accounts: readonly AccountDetail[];
  projectName: string;
  /** ⚠️ The server's clock, so "9 hours ago" is the same for every reader. */
  nowMs: number;
  postsThisPeriod: number;
  postsPreviousPeriod: number;
  onResync?: () => void;
}) {
  const [filter, setFilter] = React.useState<Filter>('all');
  const [openDetail, setOpenDetail] = React.useState<string | null>(null);

  const shown = React.useMemo(
    () => (filter === 'all' ? accounts : accounts.filter((a) => a.platform === filter)),
    [accounts, filter],
  );

  const sync = React.useMemo(() => syncHealthSummary(accounts, nowMs), [accounts, nowMs]);

  const totals = React.useMemo(() => {
    const followers = accounts.reduce((n, a) => n + (a.followers ?? 0), 0);
    const posts = accounts.reduce((n, a) => n + a.postCount, 0);
    const days = accounts.reduce((n, a) => Math.max(n, a.metricDays), 0);

    /* ⚠️ FOLLOWER GROWTH FROM EACH ACCOUNT'S OWN SERIES, first reading against
       last. There is no separate "followers 30 days ago" column, and inventing
       one would mean guessing; the collected history already holds the answer. */
    const firstSum = accounts.reduce((n, a) => n + (a.followerSeries[0] ?? 0), 0);
    const followerDelta =
      firstSum === 0 ? null : ((followers - firstSum) / firstSum) * 100;

    const postDelta =
      postsPreviousPeriod === 0
        ? null
        : ((postsThisPeriod - postsPreviousPeriod) / postsPreviousPeriod) * 100;

    return { followers, posts, days, followerDelta, postDelta };
  }, [accounts, postsThisPeriod, postsPreviousPeriod]);

  const banner = React.useMemo(
    () =>
      fleetBanner({
        sync,
        followerDeltaPercent: totals.followerDelta,
        postDeltaPercent: totals.postDelta,
      }),
    [sync, totals.followerDelta, totals.postDelta],
  );

  const pct = (v: number | null) =>
    v === null ? null : `${v > 0 ? '+' : ''}${Math.abs(v) >= 10 ? Math.round(v) : v.toFixed(1)}%`;
  const dir = (v: number | null): 'up' | 'down' | 'flat' =>
    v === null ? 'flat' : v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';

  return (
    <div className="space-y-3">
      {/* ══ The five figures ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard
          index={0}
          data={{
            key: 'accounts',
            label: 'Connected accounts',
            value: String(accounts.length),
            icon: Link2,
            token: 'chart-4',
            footnote: `${sync.healthy} syncing cleanly`,
          }}
        />
        <KpiCard
          index={1}
          data={{
            key: 'followers',
            label: 'Total followers',
            value: compact(totals.followers),
            icon: Users,
            token: 'chart-3',
            deltaText: pct(totals.followerDelta),
            deltaDirection: dir(totals.followerDelta),
            footnote: totals.followerDelta === null ? 'no history yet' : 'across the collected history',
          }}
        />
        <KpiCard
          index={2}
          data={{
            key: 'posts',
            label: 'Posts collected',
            value: compact(totals.posts),
            icon: FileText,
            token: 'chart-1',
            deltaText: pct(totals.postDelta),
            deltaDirection: dir(totals.postDelta),
            footnote: totals.postDelta === null ? 'no earlier period' : 'vs previous period',
          }}
        />
        <KpiCard
          index={3}
          data={{
            key: 'health',
            label: 'Sync health',
            /* ⚠️ A WORD, and a true one — see the header. */
            value: sync.verdict,
            textValue: true,
            icon: sync.issues > 0 ? TriangleAlert : ShieldCheck,
            token: sync.token,
            footnote: sync.detail,
          }}
        />
        <KpiCard
          index={4}
          data={{
            key: 'history',
            label: 'Days of history',
            value: String(totals.days),
            icon: CalendarDays,
            token: 'chart-6',
            /* Meta serves about 30 days and no more, so the ceiling is a fact
               about the platform rather than a target we chose. */
            progress: Math.min(1, totals.days / 30),
            progressNote: totals.days >= 29 ? 'the most Meta will give' : `of ~30 available`,
          }}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-3">
          {/* ── Filter ─────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg bg-bg-subtle p-0.5">
              {(
                [
                  { key: 'all' as const, label: 'All accounts' },
                  { key: 'facebook' as const, label: 'Facebook Pages' },
                  { key: 'instagram' as const, label: 'Instagram' },
                ]
              ).map((f) => {
                const n =
                  f.key === 'all' ? accounts.length : accounts.filter((a) => a.platform === f.key).length;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-micro transition-all duration-200',
                      filter === f.key
                        ? 'bg-bg-surface font-semibold text-text-primary shadow-[0_1px_2px_rgb(6_35_42_/_0.08)]'
                        : 'text-text-secondary hover:text-text-primary',
                    )}
                  >
                    {f.key !== 'all' && <PlatformIcon slug={f.key} size={12} />}
                    {f.label}
                    <span className="tabular-nums text-text-tertiary">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── The accounts ───────────────────────────────────────────── */}
          {shown.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-6 py-14 text-center">
              <p className="text-body-sm font-semibold text-text-primary">
                {accounts.length === 0
                  ? `No Meta account is connected to ${projectName}`
                  : 'No account of that kind'}
              </p>
              <p className="mx-auto mt-1.5 max-w-md text-caption text-text-secondary">
                {accounts.length === 0
                  ? 'Projects that are internal tool development have no social presence. For the rest, an administrator links the Facebook Page and Instagram account.'
                  : 'Try the other filter.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {shown.map((a, i) => (
                <AccountCard
                  key={a.id}
                  account={a}
                  index={i}
                  nowMs={nowMs}
                  open={openDetail === a.id}
                  onToggle={() => setOpenDetail(openDetail === a.id ? null : a.id)}
                />
              ))}
            </div>
          )}

          {/* ── The banner, whose tone is earned ───────────────────────── */}
          <div
            className="flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3"
            style={{
              borderColor: `color-mix(in oklab, var(--${bannerToken(banner.tone)}) 30%, transparent)`,
              backgroundColor: `color-mix(in oklab, var(--${bannerToken(banner.tone)}) 7%, transparent)`,
            }}
          >
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg"
              style={{
                backgroundColor: `color-mix(in oklab, var(--${bannerToken(banner.tone)}) 16%, transparent)`,
              }}
            >
              {banner.tone === 'good' ? (
                <CheckCircle2
                  className="size-4.5"
                  style={{ color: `var(--${bannerToken(banner.tone)})` }}
                />
              ) : (
                <TriangleAlert
                  className="size-4.5"
                  style={{ color: `var(--${bannerToken(banner.tone)})` }}
                />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body-sm font-semibold text-text-primary">
                {banner.title}
              </span>
              <span className="block text-caption text-text-secondary">{banner.detail}</span>
            </span>
          </div>
        </div>

        {/* ══ The rail ════════════════════════════════════════════════════ */}
        <aside className="space-y-3">
          <Panel title="Across all accounts">
            <dl className="space-y-2.5">
              <Row icon={Users} label="Followers" value={compact(totals.followers)} token="chart-3" />
              <Row icon={FileText} label="Posts collected" value={String(totals.posts)} token="chart-1" />
              <Row icon={Database} label="Days of history" value={String(totals.days)} token="chart-6" />
              <Row icon={Link2} label="Accounts connected" value={String(accounts.length)} token="chart-4" />
            </dl>
          </Panel>

          <Panel title="Sync status">
            {accounts.length === 0 ? (
              <p className="text-micro text-text-tertiary">Nothing connected.</p>
            ) : (
              <>
                <DonutChart
                  slices={[
                    { label: 'Healthy', value: sync.healthy, token: 'feedback-success' },
                    { label: 'Warning', value: sync.warning, token: 'feedback-warning' },
                    { label: 'Issues', value: sync.issues, token: 'feedback-error' },
                  ].filter((s) => s.value > 0)}
                  centreLabel={sync.verdict}
                  centreValue={`${Math.round((sync.healthy / sync.total) * 100)}%`}
                  size={112}
                  thickness={13}
                  animate
                  caption="Accounts by sync state"
                  className="w-full justify-between"
                />
                <p className="mt-2 border-t border-border-subtle pt-2 text-[0.62rem] leading-snug text-text-tertiary">
                  {sync.detail}
                </p>
              </>
            )}
          </Panel>

          <Panel title="Quick actions">
            <div className="space-y-1.5">
              {/* ⚠️ THE ONLY ONE THAT DOES ANYTHING IS THE ONE THAT CAN. Resync
                  runs the real pull; the other two need machinery that does not
                  exist — a Meta consent flow and a permissions editor — and a
                  button that looks ready and does nothing is worse than one that
                  explains itself. */}
              <button
                type="button"
                onClick={onResync}
                disabled={!onResync || accounts.length === 0}
                className={cn(
                  'inline-flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-micro font-semibold transition-colors',
                  onResync && accounts.length > 0
                    ? 'border-transparent text-accent-foreground hover:opacity-90'
                    : 'cursor-not-allowed border-dashed border-border-default text-text-tertiary',
                )}
                style={
                  onResync && accounts.length > 0
                    ? { backgroundColor: 'var(--accent-primary)' }
                    : undefined
                }
                title={
                  onResync
                    ? 'Pull every connected account now, without waiting for the schedule'
                    : 'Only an Admin can trigger a sync'
                }
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Resync all accounts
              </button>

              <button
                type="button"
                disabled
                title="Connecting a new account needs the Meta consent flow, which is not built yet. An administrator links accounts directly."
                className="inline-flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-default py-2 text-micro font-medium text-text-tertiary"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Connect account
              </button>

              <button
                type="button"
                disabled
                title="Permissions are held on Meta's side against the system user token. Change them in Meta Business Settings."
                className="inline-flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-default py-2 text-micro font-medium text-text-tertiary"
              >
                <Lock className="size-3.5" aria-hidden="true" />
                Manage permissions
              </button>
            </div>
          </Panel>

          <Panel title="Integration notes">
            <ul className="space-y-2 text-[0.65rem] leading-relaxed text-text-secondary">
              <li className="flex gap-2">
                <Info className="mt-0.5 size-3 shrink-0 text-text-tertiary" aria-hidden="true" />
                <span>
                  Figures are pulled every{' '}
                  <strong className="font-semibold text-text-primary">two hours</strong> into
                  Taskly&rsquo;s own tables. Every page in the Studio reads those, so Meta being
                  slow makes this stale rather than broken.
                </span>
              </li>
              <li className="flex gap-2">
                <Info className="mt-0.5 size-3 shrink-0 text-text-tertiary" aria-hidden="true" />
                <span>
                  Meta serves about{' '}
                  <strong className="font-semibold text-text-primary">30 days</strong> of history and
                  no more. Everything older than that is ours because we recorded it, so the range
                  you can look back over widens from here on its own.
                </span>
              </li>
              <li className="flex gap-2">
                <Info className="mt-0.5 size-3 shrink-0 text-text-tertiary" aria-hidden="true" />
                <span>
                  One account failing never stops the others — each records its own outcome, so a
                  client who revokes access is named here rather than quietly freezing every figure.
                </span>
              </li>
            </ul>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function bannerToken(tone: 'good' | 'mixed' | 'bad'): string {
  return tone === 'good' ? 'feedback-success' : tone === 'mixed' ? 'feedback-warning' : 'feedback-error';
}

/* ---- One account -------------------------------------------------------- */

function AccountCard({
  account,
  index,
  nowMs,
  open,
  onToggle,
}: {
  account: AccountDetail;
  index: number;
  nowMs: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const health = accountHealth({
    lastSyncedAt: account.lastSyncedAt,
    lastError: account.lastError,
    metricDays: account.metricDays,
    nowMs,
  });

  const brand = PLATFORM_MARKS[account.platform];
  const token = account.platform === 'instagram' ? 'chart-2' : 'chart-1';

  const since = account.lastSyncedAt
    ? relative(nowMs - Date.parse(account.lastSyncedAt))
    : 'never';

  /* ⚠️ THE COVERAGE STRIP, NOT A THIRD SPARKLINE. The reference draws one under
     "Days of History", which would be a straight rising line — a day count only
     ever goes up by one. The dates that actually HAVE data say something a line
     cannot: where the gaps are. */
  const coverage = React.useMemo(() => {
    if (account.coveredDates.length === 0) return [];
    const have = new Set(account.coveredDates);
    const first = account.coveredDates[0];
    const last = account.coveredDates[account.coveredDates.length - 1];
    const out: boolean[] = [];
    for (let d = first; d <= last; d = nextDay(d)) out.push(have.has(d));
    return out;
  }, [account.coveredDates]);

  return (
    <div
      ref={ref}
      className={cn(
        'studio-reveal overflow-hidden rounded-xl border border-border-subtle bg-bg-surface shadow-[0_1px_2px_rgb(6_35_42_/_0.04)] transition-shadow hover:shadow-[0_6px_18px_rgb(6_35_42_/_0.08)]',
        'motion-safe:animate-[studio-rise_620ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
      style={{ animationDelay: `${index * 90}ms` }}
    >
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 p-3.5 pb-3">
        {/* ⚠️ THE BRAND MARK, NOT A PROFILE PICTURE. `profile_picture` exists on
            the row and is NULL on every one — deliberately: Meta serves avatars
            from a CDN with expiring URLs, so a stored one becomes a broken image
            within days, and re-fetching every two hours to keep a 44px circle
            alive is a poor trade. */}
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full"
          style={{ backgroundColor: `var(--${token}-wash)` }}
        >
          <PlatformIcon slug={account.platform} size={24} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm font-semibold text-text-primary">
            {account.displayName ?? account.username ?? account.objectId}
          </p>
          <p className="truncate text-micro text-text-tertiary">
            {account.username ? `@${account.username}` : `${brand?.label ?? account.platform} Page`}
          </p>
        </div>

        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.6rem] font-bold"
          style={{
            backgroundColor: `color-mix(in oklab, var(--${health.token}) 14%, transparent)`,
            color: `var(--${health.token})`,
          }}
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full"
            style={{ backgroundColor: `var(--${health.token})` }}
          />
          {health.label}
        </span>
      </div>

      {/* ── Three figures, each with its own real series ─────────────────── */}
      <div
        className="mx-3.5 grid grid-cols-3 gap-3 rounded-xl px-3 py-2.5"
        style={{ backgroundColor: `color-mix(in oklab, var(--${token}) 6%, transparent)` }}
      >
        <Stat
          value={account.followers === null ? '—' : compact(account.followers)}
          label="Followers"
          series={account.followerSeries}
          token={token}
        />
        <Stat
          value={String(account.mediaCount ?? account.postCount)}
          label="Posts collected"
          series={account.postSeries}
          token={token}
        />
        <div className="min-w-0">
          <p className="text-h3 font-bold leading-none tabular-nums text-text-primary">
            {account.metricDays}
          </p>
          <p className="mt-0.5 text-[0.6rem] text-text-tertiary">Days of history</p>
          {coverage.length > 0 && (
            <div
              className="mt-2 flex h-[26px] items-end gap-px"
              title="Which days in the collected range have figures"
            >
              {coverage.map((has, i) => (
                <span
                  key={i}
                  className="min-w-px flex-1 rounded-[1px] motion-safe:animate-[studio-grow_800ms_cubic-bezier(0.16,1,0.3,1)_backwards]"
                  style={{
                    height: has ? '100%' : '22%',
                    backgroundColor: has ? `var(--${token})` : 'var(--chart-grid)',
                    opacity: has ? 0.75 : 1,
                    animationDelay: `${i * 12}ms`,
                    transformOrigin: 'bottom',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Sync detail ─────────────────────────────────────────────────── */}
      <dl className="mt-3 space-y-0 px-3.5">
        <Line icon={RefreshCw} term="Last sync">
          <span className="inline-flex items-center gap-1.5">
            {since}
            {health.state === 'healthy' ? (
              <CheckCircle2 className="size-3" style={{ color: 'var(--feedback-success)' }} />
            ) : (
              <TriangleAlert className="size-3" style={{ color: `var(--${health.token})` }} />
            )}
          </span>
        </Line>
        <Line icon={Clock} term="Sync frequency">
          Every 2 hours
        </Line>
        <Line icon={Hash} term="Account ID">
          <span className="font-mono text-[0.6rem]">{account.objectId}</span>
        </Line>
        <Line icon={Database} term="Sync runs">
          {account.failedRuns > 0 ? (
            <span style={{ color: 'var(--feedback-error)' }}>
              {account.syncRuns} · {account.failedRuns} failed
            </span>
          ) : (
            `${account.syncRuns} successful`
          )}
        </Line>
      </dl>

      {/* ── The detail the "View details" button reveals ─────────────────── */}
      {open && (
        <dl className="mt-1 space-y-0 border-t border-border-subtle px-3.5 pt-2">
          <Line icon={CalendarDays} term="History held">
            {account.firstMetricDate && account.lastMetricDate
              ? `${account.firstMetricDate} → ${account.lastMetricDate}`
              : 'none yet'}
          </Line>
          <Line icon={Link2} term="Linked">
            {`${account.linkedAt.slice(0, 10)}${account.linkedBy ? ` by ${account.linkedBy}` : ''}`}
          </Line>
          <Line icon={Info} term="Status">
            {health.detail}
          </Line>
        </dl>
      )}

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <div className="flex gap-2 p-3.5 pt-3">
        <a
          href={account.permalink ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-micro font-semibold transition-colors"
          style={{
            borderColor: `color-mix(in oklab, var(--${token}) 35%, transparent)`,
            color: `var(--${token})`,
          }}
        >
          Open {brand?.label ?? account.platform}
          <ExternalLink className="size-3 opacity-70" aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-border-subtle py-2 text-micro font-medium text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
        >
          {open ? 'Hide details' : 'View details'}
        </button>
      </div>
    </div>
  );
}

/* ---- Parts -------------------------------------------------------------- */

function Stat({
  value,
  label,
  series,
  token,
}: {
  value: string;
  label: string;
  series: readonly number[];
  token: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-h3 font-bold leading-none tabular-nums text-text-primary">{value}</p>
      <p className="mt-0.5 truncate text-[0.6rem] text-text-tertiary">{label}</p>
      {series.length > 1 ? (
        <Sparkline points={series} token={token} />
      ) : (
        /* ⚠️ A single reading is not a trend. One point drawn as a flat line
           would imply a stable series where there is no series at all. */
        <p className="mt-2 h-[26px] text-[0.58rem] leading-[26px] text-text-tertiary">
          not enough history
        </p>
      )}
    </div>
  );
}

function Line({
  icon: Icon,
  term,
  children,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-subtle py-1.5 last:border-0">
      <dt className="inline-flex min-w-0 items-center gap-1.5 text-micro text-text-secondary">
        <Icon className="size-3 shrink-0 text-text-tertiary" aria-hidden />
        <span className="truncate">{term}</span>
      </dt>
      <dd className="shrink-0 text-micro font-semibold tabular-nums text-text-primary">
        {children}
      </dd>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  token,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
  token: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid size-7 shrink-0 place-items-center rounded-lg"
        style={{ backgroundColor: `color-mix(in oklab, var(--${token}) 14%, transparent)` }}
      >
        <Icon className="size-3.5" style={{ color: `var(--${token})` }} />
      </span>
      <dt className="min-w-0 flex-1 truncate text-micro text-text-secondary">{label}</dt>
      <dd className="shrink-0 text-body-sm font-bold tabular-nums text-text-primary">{value}</dd>
    </div>
  );
}

/* ---- Helpers ------------------------------------------------------------ */

/** "9 hours ago" — the reference's phrasing. */
function relative(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
