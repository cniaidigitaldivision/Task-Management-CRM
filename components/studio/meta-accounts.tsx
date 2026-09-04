'use client';

import * as React from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Database,
  ExternalLink,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  TriangleAlert,
  Users,
} from 'lucide-react';

import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import type { AccountDetail } from '@/lib/db/queries/meta-studio';
import { compact } from '@/lib/domain/meta-studio';
import { accountHealth } from '@/lib/domain/meta-content';
import { cn } from '@/lib/utils';

import { Panel } from './panels';
import { useInView } from './use-in-view';

/* ============================================================================
 * META ACCOUNTS
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-04: *"I want that Meta Account tab to be designed properly to
 * show which meta accounts are connected, with their proper icons in a proper
 * way."*
 *
 * ── ⚠️ IT REPORTS THE COLLECTION, NOT JUST THE CONNECTION ───────────────────
 * The reference shows a list of accounts with an "Insights Available" badge, and
 * a list is the easy half. The question somebody actually opens this tab with is
 * *"is data still arriving?"* — and a row that only says "connected" cannot
 * answer it. An account linked cleanly in August that has failed every sync
 * since looks identical to a healthy one.
 *
 * So each card carries what has been collected and when it last succeeded, and
 * the badge is a real verdict from `accountHealth` rather than a decoration.
 *
 * ── ⚠️ THE PLATFORM MARK, NOT A PROFILE PICTURE ─────────────────────────────
 * `meta_accounts.profile_picture` exists and is NULL on every row — the sync
 * does not fetch it, deliberately: Meta serves avatars from a CDN with expiring
 * URLs, so a stored one becomes a broken image within days, and re-fetching it
 * every two hours to keep a 40px circle alive is not a good trade. The brand
 * mark plus the account's own name identifies it unambiguously and never breaks.
 * ========================================================================= */

type Filter = 'all' | 'facebook' | 'instagram';

export function MetaAccounts({
  accounts,
  projectName,
  nowMs,
}: {
  accounts: readonly AccountDetail[];
  projectName: string;
  /** ⚠️ The server's clock, so "6 hours ago" is the same for everyone. */
  nowMs: number;
}) {
  const [filter, setFilter] = React.useState<Filter>('all');

  const shown = React.useMemo(
    () => (filter === 'all' ? accounts : accounts.filter((a) => a.platform === filter)),
    [accounts, filter],
  );

  const counts = React.useMemo(
    () => ({
      all: accounts.length,
      facebook: accounts.filter((a) => a.platform === 'facebook').length,
      instagram: accounts.filter((a) => a.platform === 'instagram').length,
    }),
    [accounts],
  );

  const totals = React.useMemo(
    () => ({
      followers: accounts.reduce((n, a) => n + (a.followers ?? 0), 0),
      posts: accounts.reduce((n, a) => n + a.postCount, 0),
      days: accounts.reduce((n, a) => Math.max(n, a.metricDays), 0),
      failing: accounts.filter((a) => a.lastError).length,
    }),
    [accounts],
  );

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0 space-y-3">
        {/* ── Filter, as the reference's sub-tabs ────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-bg-subtle p-0.5">
            {(
              [
                { key: 'all' as const, label: 'All accounts', count: counts.all },
                { key: 'facebook' as const, label: 'Facebook Pages', count: counts.facebook },
                { key: 'instagram' as const, label: 'Instagram', count: counts.instagram },
              ]
            ).map((f) => (
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
                <span className="tabular-nums text-text-tertiary">{f.count}</span>
              </button>
            ))}
          </div>

          {/* ⚠️ DISABLED, AND IT SAYS WHY. Connecting an account needs an OAuth
              consent flow that does not exist yet — the two live accounts were
              linked directly. A button that looked ready and did nothing would
              be worse than one that explains itself. */}
          <button
            type="button"
            disabled
            title="Connecting a new account needs the Meta consent flow, which is not built yet. Ask an administrator to link one."
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border-default px-2.5 py-1.5 text-micro font-medium text-text-tertiary"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Connect account
          </button>
        </div>

        {/* ── The accounts ──────────────────────────────────────────────── */}
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
              <AccountCard key={a.id} account={a} index={i} nowMs={nowMs} />
            ))}
          </div>
        )}
      </div>

      {/* ── The rail ─────────────────────────────────────────────────────── */}
      <aside className="space-y-3">
        <Panel title="Across all accounts">
          <dl className="space-y-2.5">
            <Row icon={Users} label="Followers" value={compact(totals.followers)} token="chart-4" />
            <Row icon={ImageIcon} label="Posts collected" value={String(totals.posts)} token="chart-1" />
            <Row
              icon={Database}
              label="Days of history"
              value={String(totals.days)}
              token="chart-3"
            />
            <Row
              icon={totals.failing > 0 ? TriangleAlert : CheckCircle2}
              label={totals.failing > 0 ? 'Accounts failing' : 'All syncing'}
              value={totals.failing > 0 ? String(totals.failing) : String(accounts.length)}
              token={totals.failing > 0 ? 'feedback-error' : 'feedback-success'}
            />
          </dl>
        </Panel>

        <Panel title="How the sync works">
          <ul className="space-y-2 text-[0.65rem] leading-relaxed text-text-secondary">
            <li className="flex gap-2">
              <RefreshCw className="mt-0.5 size-3 shrink-0 text-text-tertiary" aria-hidden="true" />
              <span>
                Every <strong className="font-semibold text-text-primary">two hours</strong>, a
                scheduled job pulls each account&rsquo;s figures into Taskly&rsquo;s own tables. The
                Studio reads only those, so Meta being slow makes this page stale rather than
                broken.
              </span>
            </li>
            <li className="flex gap-2">
              <CalendarClock className="mt-0.5 size-3 shrink-0 text-text-tertiary" aria-hidden="true" />
              <span>
                Meta keeps roughly <strong className="font-semibold text-text-primary">30 days</strong>{' '}
                of history. Everything before that is ours because we recorded it — so the range you
                can look back over widens on its own from here.
              </span>
            </li>
            <li className="flex gap-2">
              <TriangleAlert className="mt-0.5 size-3 shrink-0 text-text-tertiary" aria-hidden="true" />
              <span>
                One account failing never stops the others. Each records its own outcome, so a
                client who revokes access is named here rather than quietly freezing every figure.
              </span>
            </li>
          </ul>
        </Panel>
      </aside>
    </div>
  );
}

/* ---- One account -------------------------------------------------------- */

function AccountCard({
  account,
  index,
  nowMs,
}: {
  account: AccountDetail;
  index: number;
  nowMs: number;
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
      {/* The platform's own hue along the top, as the KPI cards do. */}
      <span
        aria-hidden="true"
        className="block h-[3px]"
        style={{
          background: `linear-gradient(90deg, var(--${token}), color-mix(in oklab, var(--${token}) 20%, transparent))`,
        }}
      />

      <div className="space-y-3 p-3.5">
        {/* ── Identity ─────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3">
          {/* ⚠️ The brand mark at a size that reads as an identity rather than a
              decoration — the owner asked for "proper icons in a proper way". */}
          <span
            className="grid size-11 shrink-0 place-items-center rounded-xl"
            style={{ backgroundColor: `var(--${token}-wash)` }}
          >
            <PlatformIcon slug={account.platform} size={24} />
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-body-sm font-semibold text-text-primary">
              {account.displayName ?? account.username ?? account.objectId}
            </p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-micro text-text-tertiary">
              <span>{brand?.label ?? account.platform}</span>
              {account.username && <span>· @{account.username}</span>}
            </p>
          </div>

          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[0.6rem] font-bold"
            style={{
              backgroundColor: `color-mix(in oklab, var(--${health.token}) 14%, transparent)`,
              color: `var(--${health.token})`,
            }}
          >
            {health.label}
          </span>
        </div>

        {/* ── What Meta reports about it ────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Followers" value={account.followers === null ? '—' : compact(account.followers)} />
          <Stat
            label="Posts"
            /* ⚠️ `media_count` is Instagram-only; Facebook returns none, so the
               locally-collected post count stands in rather than a dash that
               would read as "no posts". */
            value={String(account.mediaCount ?? account.postCount)}
          />
          <Stat label="Days held" value={String(account.metricDays)} />
        </div>

        {/* ── The verdict, spelled out ──────────────────────────────────── */}
        <p
          className="rounded-lg px-2.5 py-2 text-[0.65rem] leading-snug"
          style={{
            backgroundColor: `color-mix(in oklab, var(--${health.token}) 8%, transparent)`,
            color: 'var(--text-secondary)',
          }}
        >
          {health.detail}
        </p>

        {/* ── Provenance ───────────────────────────────────────────────── */}
        <dl className="space-y-1 border-t border-border-subtle pt-2.5 text-[0.62rem] text-text-tertiary">
          <Line term="Meta ID" detail={<span className="font-mono">{account.objectId}</span>} />
          {account.firstMetricDate && account.lastMetricDate && (
            <Line
              term="History"
              detail={`${account.firstMetricDate} → ${account.lastMetricDate}`}
            />
          )}
          <Line
            term="Last sync"
            detail={
              account.lastSyncedAt
                ? `${new Date(account.lastSyncedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`
                : 'never'
            }
          />
          <Line
            term="Linked"
            detail={`${account.linkedAt.slice(0, 10)}${account.linkedBy ? ` by ${account.linkedBy}` : ''}`}
          />
          <Line
            term="Sync runs"
            detail={
              account.failedRuns > 0 ? (
                <span style={{ color: 'var(--feedback-error)' }}>
                  {account.syncRuns} · {account.failedRuns} failed
                </span>
              ) : (
                `${account.syncRuns} · all succeeded`
              )
            }
          />
        </dl>

        {account.permalink && (
          <a
            href={account.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-subtle py-1.5 text-micro font-medium text-text-brand transition-colors hover:bg-bg-subtle"
          >
            Open on {brand?.label ?? account.platform}
            <ExternalLink className="size-3 opacity-70" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}

/* ---- Parts -------------------------------------------------------------- */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-subtle px-2 py-1.5 text-center">
      <p className="text-body-sm font-bold leading-none tabular-nums text-text-primary">{value}</p>
      <p className="mt-1 text-[0.6rem] text-text-tertiary">{label}</p>
    </div>
  );
}

function Line({ term, detail }: { term: string; detail: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0">{term}</dt>
      <dd className="min-w-0 truncate text-right text-text-secondary">{detail}</dd>
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
