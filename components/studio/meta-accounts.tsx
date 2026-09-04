'use client';

import * as React from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Hash,
  History,
  Info,
  Link2,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';

import {
  discoverMetaPagesAction,
  linkMetaAccountAction,
  resyncAccountsAction,
  type ConnectablePage,
} from '@/app/actions/meta-accounts';
import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import type { AccountDetail } from '@/lib/db/queries/meta-studio';
import { compact } from '@/lib/domain/meta-studio';
import {
  accountHealth,
  fleetBanner,
  followerGrowth,
  syncHealthSummary,
} from '@/lib/domain/meta-content';
import { cn } from '@/lib/utils';

import { KpiCard, Panel, Sparkline } from './panels';
import { useInView } from './use-in-view';

/* ============================================================================
 * META ACCOUNTS
 * ----------------------------------------------------------------------------
 * Built to the owner's reference. Five figures across the left column, an
 * account card per connection, and a rail of totals, sync status, quick actions
 * and integration notes.
 *
 * ── ⚠️ THE TWO COLUMNS END ON THE SAME LINE, AND IT IS NOT PADDING ──────────
 * Owner, 2026-09-04: *"the right side and the left side should be equal."* The
 * left column is a flex column whose account grid is `flex-1`, and each card is
 * `h-full` with its detail rows in a `justify-between` block. So slack does not
 * pile up at the bottom of one column — it flows into the ROW SPACING inside the
 * cards, which is the same instruction the owner gave twice ("the items are very
 * congested with each other"). Hard-coding a taller card would break the moment
 * a third account appeared.
 *
 * ── ⚠️ WHERE THIS PAGE TELLS THE TRUTH INSTEAD OF DRAWING IT ────────────────
 *   `syncHealthSummary` lets the WORST account set the verdict, and
 *   `fleetBanner` is allowed to report bad news — both reference cards are fixed
 *   congratulatory text.
 *
 *   Instagram has no follower line because `followers_count` is a PROFILE
 *   FIELD, not an insight: Meta serves no history for it, so there is one
 *   reading. The card says so rather than drawing an empty box.
 *
 *   "Posts collected" counts what we HOLD, never `media_count` — that is how
 *   many exist on the account, a different fact, and it lives in View details.
 * ========================================================================= */

type Filter = 'all' | 'facebook' | 'instagram';

export function MetaAccounts({
  accounts,
  projectId,
  projectName,
  nowMs,
  postsThisPeriod,
  postsPreviousPeriod,
  canManage,
}: {
  accounts: readonly AccountDetail[];
  projectId: string;
  projectName: string;
  /** ⚠️ The server's clock, so "9 hours ago" is the same for every reader. */
  nowMs: number;
  postsThisPeriod: number;
  postsPreviousPeriod: number;
  canManage: boolean;
}) {
  const [filter, setFilter] = React.useState<Filter>('all');
  const [openDetail, setOpenDetail] = React.useState<string | null>(null);
  const [modal, setModal] = React.useState<'connect' | 'logs' | 'notes' | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [toast, setToast] = React.useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const say = (tone: 'ok' | 'bad', text: string) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 8000);
  };

  const shown = React.useMemo(
    () => (filter === 'all' ? accounts : accounts.filter((a) => a.platform === filter)),
    [accounts, filter],
  );

  const sync = React.useMemo(() => syncHealthSummary(accounts, nowMs), [accounts, nowMs]);
  const growth = React.useMemo(() => followerGrowth(accounts), [accounts]);

  const totals = React.useMemo(() => {
    const posts = accounts.reduce((n, a) => n + a.postCount, 0);
    const days = accounts.reduce((n, a) => Math.max(n, a.metricDays), 0);
    const postDelta =
      postsPreviousPeriod === 0
        ? null
        : ((postsThisPeriod - postsPreviousPeriod) / postsPreviousPeriod) * 100;
    return { posts, days, postDelta };
  }, [accounts, postsThisPeriod, postsPreviousPeriod]);

  const banner = React.useMemo(
    () =>
      fleetBanner({
        sync,
        followerDeltaPercent: growth.percent,
        postDeltaPercent: totals.postDelta,
      }),
    [sync, growth.percent, totals.postDelta],
  );

  const pct = (v: number | null) =>
    v === null ? null : `${v > 0 ? '+' : ''}${Math.abs(v) >= 10 ? Math.round(v) : v.toFixed(1)}%`;
  const dir = (v: number | null): 'up' | 'down' | 'flat' =>
    v === null ? 'flat' : v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';

  const resync = async () => {
    setSyncing(true);
    try {
      const r = await resyncAccountsAction();
      say(r.ok ? 'ok' : 'bad', r.ok ? (r.summary ?? 'Synced.') : (r.error ?? 'The sync failed.'));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_18.5rem]">
      {/* ══ LEFT ══════════════════════════════════════════════════════════ */}
      <div className="flex min-w-0 flex-col gap-3">
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
              value: compact(growth.total),
              icon: Users,
              token: 'chart-3',
              deltaText: pct(growth.percent),
              deltaDirection: dir(growth.percent),
              footnote: growth.note,
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
              footnote:
                totals.postDelta === null ? 'no earlier period yet' : 'vs the previous period',
            }}
          />
          <KpiCard
            index={3}
            data={{
              key: 'health',
              label: 'Sync health',
              value: sync.verdict,
              textValue: true,
              valueToken: sync.token,
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
              footnote: totals.days >= 29 ? 'max available from Meta' : 'of ~30 available',
            }}
          />
        </div>

        {toast && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border px-3 py-2"
            style={{
              borderColor: `color-mix(in oklab, var(--${toast.tone === 'ok' ? 'feedback-success' : 'feedback-error'}) 30%, transparent)`,
              backgroundColor: `color-mix(in oklab, var(--${toast.tone === 'ok' ? 'feedback-success' : 'feedback-error'}) 8%, transparent)`,
            }}
          >
            {toast.tone === 'ok' ? (
              <CheckCircle2
                className="mt-px size-3.5 shrink-0"
                style={{ color: 'var(--feedback-success)' }}
              />
            ) : (
              <AlertTriangle
                className="mt-px size-3.5 shrink-0"
                style={{ color: 'var(--feedback-error)' }}
              />
            )}
            <span className="min-w-0 flex-1 text-micro text-text-primary">{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
              className="text-text-tertiary hover:text-text-primary"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {accounts.length > 1 && (
          <div className="flex w-fit rounded-lg bg-bg-subtle p-0.5">
            {(
              [
                { key: 'all' as const, label: 'All accounts' },
                { key: 'facebook' as const, label: 'Facebook Pages' },
                { key: 'instagram' as const, label: 'Instagram' },
              ]
            ).map((f) => {
              const n =
                f.key === 'all'
                  ? accounts.length
                  : accounts.filter((a) => a.platform === f.key).length;
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
        )}

        {/* ⚠️ `flex-1` — THIS IS WHAT MAKES THE TWO COLUMNS END TOGETHER. The
            account grid absorbs the row's slack and each card passes it down to
            its detail rows. */}
        {shown.length === 0 ? (
          <div className="flex-1 rounded-xl border border-dashed border-border-default bg-bg-surface px-6 py-14 text-center">
            <p className="text-body-sm font-semibold text-text-primary">
              {accounts.length === 0
                ? `No Meta account is connected to ${projectName}`
                : 'No account of that kind'}
            </p>
            <p className="mx-auto mt-1.5 max-w-md text-caption text-text-secondary">
              {accounts.length === 0
                ? 'Projects that are internal tool development have no social presence. For the rest, use Connect account to link the Facebook Page and Instagram account.'
                : 'Try the other filter.'}
            </p>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
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

        {accounts.length > 0 && (
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
                <Sparkles
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
        )}
      </div>

      {/* ══ RIGHT: the rail ═══════════════════════════════════════════════ */}
      <aside className="flex flex-col gap-3">
        <Panel title="Across all accounts">
          <dl className="space-y-2.5">
            <Row icon={Users} label="Followers" value={compact(growth.total)} token="chart-3" />
            <Row
              icon={FileText}
              label="Posts collected"
              value={String(totals.posts)}
              token="chart-1"
            />
            <Row
              icon={Database}
              label="Days of history"
              value={String(totals.days)}
              token="chart-6"
            />
            <Row
              icon={Link2}
              label="Accounts connected"
              value={String(accounts.length)}
              token="chart-4"
            />
          </dl>
        </Panel>

        <Panel title="Sync status overview">
          {accounts.length === 0 ? (
            <p className="text-micro text-text-tertiary">Nothing connected.</p>
          ) : (
            <>
              <SyncRing
                healthy={sync.healthy}
                warning={sync.warning}
                issues={sync.issues}
                total={sync.total}
              />
              {/* ⚠️ NO DIVIDER AND NO TOP MARGIN. Owner: *"Move the View Sync
                  Logs button up. Remove that bottom line also and reduce their
                  height so that the Quick Action will move up."* A rule between
                  a chart and its own action was separating two things that
                  belong together, and buying 18px of height to do it. */}
              <button
                type="button"
                onClick={() => setModal('logs')}
                className="group mt-1.5 inline-flex w-full items-center justify-end gap-1 text-micro font-semibold text-text-brand"
              >
                View sync logs
                <span
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </button>
            </>
          )}
        </Panel>

        <Panel title="Quick actions">
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => void resync()}
              disabled={!canManage || accounts.length === 0 || syncing}
              title={
                canManage
                  ? 'Pull every connected account now, without waiting for the two-hourly schedule'
                  : 'Only a Coordinator and above can trigger a sync'
              }
              className={cn(
                'inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-micro font-semibold transition-opacity',
                canManage && accounts.length > 0
                  ? 'text-accent-foreground hover:opacity-90 disabled:opacity-60'
                  : 'cursor-not-allowed border border-dashed border-border-default text-text-tertiary',
              )}
              style={
                canManage && accounts.length > 0
                  ? { backgroundColor: 'var(--accent-primary)' }
                  : undefined
              }
            >
              {syncing ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              {syncing ? 'Pulling…' : 'Resync all accounts'}
            </button>

            <button
              type="button"
              onClick={() => setModal('connect')}
              disabled={!canManage}
              title={
                canManage
                  ? 'List the Pages and Instagram accounts this token can reach, and link one'
                  : 'Only a Coordinator and above can connect an account'
              }
              className={cn(
                'inline-flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-micro font-semibold transition-colors',
                canManage
                  ? 'border-border-subtle text-text-primary hover:bg-bg-subtle'
                  : 'cursor-not-allowed border-dashed border-border-default text-text-tertiary',
              )}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Connect account
            </button>

            <a
              href="https://business.facebook.com/settings"
              target="_blank"
              rel="noopener noreferrer"
              title="Permissions live on Meta's side, against the system-user token"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-subtle py-2 text-micro font-medium text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
            >
              <Lock className="size-3.5" aria-hidden="true" />
              Manage permissions
              <ExternalLink className="size-3 opacity-60" aria-hidden="true" />
            </a>
          </div>
        </Panel>

        {/* ── Integration notes: one line, the rest behind Learn more ────── */}
        <Panel title="Integration notes">
          <p className="text-[0.65rem] leading-relaxed text-text-secondary">
            Figures are pulled every{' '}
            <strong className="font-semibold text-text-primary">two hours</strong> into
            Taskly&rsquo;s own tables, so a slow Meta makes this stale rather than broken.
          </p>
          <button
            type="button"
            onClick={() => setModal('notes')}
            className="group mt-1.5 inline-flex items-center gap-1 text-micro font-semibold text-text-brand"
          >
            Learn more
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </button>
        </Panel>
      </aside>

      {modal === 'connect' && (
        <ConnectDialog
          projectId={projectId}
          projectName={projectName}
          onClose={() => setModal(null)}
          onDone={(tone, text) => {
            say(tone, text);
            if (tone === 'ok') setModal(null);
          }}
        />
      )}

      {modal === 'logs' && (
        <SyncLogsDialog
          accounts={accounts}
          sync={sync}
          nowMs={nowMs}
          onClose={() => setModal(null)}
          onResync={() => {
            setModal(null);
            void resync();
          }}
          canManage={canManage}
        />
      )}

      {modal === 'notes' && <NotesDialog onClose={() => setModal(null)} />}
    </div>
  );
}

function bannerToken(tone: 'good' | 'mixed' | 'bad'): string {
  return tone === 'good'
    ? 'feedback-success'
    : tone === 'mixed'
      ? 'feedback-warning'
      : 'feedback-error';
}

/* ---- The modal shell ---------------------------------------------------- */

/**
 * ⚠️ ESCAPE CLOSES IT AND THE BACKDROP CLOSES IT. Three dialogs on this page use
 * this, and a modal you can only leave by finding a small × is the kind of thing
 * that gets reported as the page having frozen.
 */
function Modal({
  title,
  subtitle,
  width = 'max-w-lg',
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  width?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgb(6_35_42_/_0.45)] p-4 motion-safe:animate-[studio-rise_240ms_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      /* The backdrop only closes when the backdrop ITSELF is clicked — a drag
         that ends outside the panel must not dismiss the work inside it. */
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          'w-full overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-[0_24px_60px_rgb(6_35_42_/_0.28)]',
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-text-primary">{title}</h2>
            {subtitle && <p className="mt-0.5 text-caption text-text-secondary">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="max-h-[62vh] overflow-y-auto px-4 py-3.5">{children}</div>

        {footer && (
          <div className="border-t border-border-subtle bg-bg-subtle px-4 py-2.5">{footer}</div>
        )}
      </div>
    </div>
  );
}

/* ---- Sync logs ---------------------------------------------------------- */

/**
 * Every account's sync record.
 *
 * ⚠️ NO NEW QUERY. Every figure here is already on the `AccountDetail` rows the
 * page fetched — last sync, run counts, failures, the dates that have data. A
 * modal that re-fetched what its own page is already holding would add latency
 * for nothing and could disagree with the card behind it.
 *
 * ⚠️ AND NOTHING HERE IS A PER-RUN LOG. `meta_sync_runs` records one row per run
 * and this shows a per-ACCOUNT summary, because that is what the page has. The
 * title says "activity" rather than "log" for that reason — a heading promising
 * a log of runs, over a summary of accounts, is the kind of small lie that makes
 * somebody think a run is missing.
 */
function SyncLogsDialog({
  accounts,
  sync,
  nowMs,
  onClose,
  onResync,
  canManage,
}: {
  accounts: readonly AccountDetail[];
  sync: { healthy: number; warning: number; issues: number; total: number; detail: string };
  nowMs: number;
  onClose: () => void;
  onResync: () => void;
  canManage: boolean;
}) {
  return (
    <Modal
      title="Sync activity"
      subtitle="Every connected account, and when it last answered."
      width="max-w-2xl"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-[0.62rem] text-text-tertiary">
            The scheduler pulls every two hours. Each account records its own outcome, so one
            failing never stops the others.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={onResync}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-micro font-semibold text-accent-foreground transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--accent-primary)' }}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Resync now
            </button>
          )}
        </div>
      }
    >
      {/* ── Three chips, zeros included ─────────────────────────────────── */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        {[
          { label: 'Healthy', value: sync.healthy, token: 'feedback-success', icon: CheckCircle2 },
          { label: 'Warning', value: sync.warning, token: 'feedback-warning', icon: Clock },
          { label: 'Issues', value: sync.issues, token: 'feedback-error', icon: TriangleAlert },
        ].map((c) => (
          <div
            key={c.label}
            className="flex items-center gap-2.5 rounded-xl border px-3 py-2"
            style={{
              borderColor: `color-mix(in oklab, var(--${c.token}) 26%, transparent)`,
              backgroundColor: `color-mix(in oklab, var(--${c.token}) 7%, transparent)`,
            }}
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-lg"
              style={{ backgroundColor: `color-mix(in oklab, var(--${c.token}) 16%, transparent)` }}
            >
              <c.icon className="size-4" style={{ color: `var(--${c.token})` }} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span
                className="block text-h3 font-bold leading-none tabular-nums"
                style={{ color: `var(--${c.token})` }}
              >
                {c.value}
              </span>
              <span className="block text-[0.6rem] text-text-secondary">{c.label}</span>
            </span>
          </div>
        ))}
      </div>

      {/* ── One block per account ───────────────────────────────────────── */}
      <ul className="space-y-2.5">
        {accounts.map((a) => {
          const health = accountHealth({
            lastSyncedAt: a.lastSyncedAt,
            lastError: a.lastError,
            metricDays: a.metricDays,
            nowMs,
          });
          const token = a.platform === 'instagram' ? 'chart-2' : 'chart-1';

          return (
            <li
              key={a.id}
              className="overflow-hidden rounded-xl border transition-shadow hover:shadow-[0_4px_14px_rgb(6_35_42_/_0.07)]"
              style={{ borderColor: `color-mix(in oklab, var(--${token}) 28%, transparent)` }}
            >
              <div
                className="flex flex-wrap items-center gap-2.5 px-3 py-2.5"
                style={{ backgroundColor: `color-mix(in oklab, var(--${token}) 7%, transparent)` }}
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full"
                  style={{ backgroundColor: `var(--${token}-wash)` }}
                >
                  <PlatformIcon slug={a.platform} size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-semibold text-text-primary">
                    {a.displayName ?? a.username ?? a.objectId}
                  </span>
                  <span className="block truncate text-[0.62rem] text-text-tertiary">
                    {PLATFORM_MARKS[a.platform]?.label ?? a.platform}
                    {a.username ? ` · @${a.username}` : ''}
                  </span>
                </span>
                <span
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.6rem] font-bold"
                  style={{
                    backgroundColor: `color-mix(in oklab, var(--${health.token}) 16%, transparent)`,
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

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 py-2.5 sm:grid-cols-4">
                <Fact
                  icon={RefreshCw}
                  label="Last sync"
                  value={a.lastSyncedAt ? relative(nowMs - Date.parse(a.lastSyncedAt)) : 'never'}
                />
                <Fact icon={Activity} label="Successful runs" value={String(a.syncRuns)} />
                <Fact
                  icon={AlertTriangle}
                  label="Failed runs"
                  value={String(a.failedRuns)}
                  token={a.failedRuns > 0 ? 'feedback-error' : undefined}
                />
                <Fact icon={Database} label="Days held" value={String(a.metricDays)} />
              </div>

              {/* ⚠️ THE COVERAGE STRIP WITH ITS DATES, which is the one thing
                  this modal shows that the card cannot fit: where the gaps are,
                  and over what range. */}
              {a.firstMetricDate && a.lastMetricDate && (
                <div className="px-3 pb-2.5">
                  <CoverageStrip dates={a.coveredDates} token={token} height={22} />
                  <div className="mt-1 flex justify-between text-[0.58rem] text-text-tertiary">
                    <span>{a.firstMetricDate}</span>
                    <span>{a.lastMetricDate}</span>
                  </div>
                </div>
              )}

              {a.lastError && (
                <p
                  className="border-t px-3 py-2 text-[0.62rem] leading-snug"
                  style={{
                    borderColor: 'color-mix(in oklab, var(--feedback-error) 20%, transparent)',
                    backgroundColor: 'color-mix(in oklab, var(--feedback-error) 6%, transparent)',
                    color: 'var(--feedback-error)',
                  }}
                >
                  {/* ⚠️ Meta's own message, verbatim — a guessed cause sends
                      somebody to the wrong place. */}
                  <strong className="font-bold">Last error: </strong>
                  {a.lastError}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  token,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
  token?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="inline-flex items-center gap-1 text-[0.58rem] uppercase tracking-wide text-text-tertiary">
        <Icon className="size-2.5" />
        <span className="truncate">{label}</span>
      </p>
      <p
        className="mt-0.5 truncate text-micro font-bold tabular-nums text-text-primary"
        style={token ? { color: `var(--${token})` } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

/* ---- Integration notes -------------------------------------------------- */

const NOTES: readonly { title: string; body: string; icon: typeof Info; token: string }[] = [
  {
    title: 'Pulled every two hours, into our own tables',
    body: 'A scheduler collects each account’s figures and writes them to Taskly. Every page in the Studio reads those tables and never calls Meta directly, so Meta being slow or down makes this page stale rather than broken — and the account card says exactly how stale.',
    icon: RefreshCw,
    token: 'chart-1',
  },
  {
    title: 'Meta serves about 30 days, and no more',
    body: 'That is a limit of the API, not a setting. Everything older than roughly a month exists only because we recorded it at the time, which means the range you can look back over widens on its own from here — without anybody doing anything.',
    icon: History,
    token: 'chart-6',
  },
  {
    title: 'One account failing never stops the others',
    body: 'Each account is pulled separately and records its own outcome. So a client who revokes access is named on this page with Meta’s own error message, instead of quietly freezing every figure for every project.',
    icon: ShieldCheck,
    token: 'chart-3',
  },
  {
    title: 'Followers behave differently on the two platforms',
    body: 'Facebook reports followers as a daily series, so its card draws a real line. Instagram’s follower count is a profile field rather than an insight — Meta serves no history for it at all — so there is one reading per day from the moment collection started, and that line builds up over time.',
    icon: Users,
    token: 'chart-2',
  },
];

function NotesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="How the Meta integration works"
      subtitle="Four things worth knowing about where these figures come from."
      onClose={onClose}
    >
      <ul className="space-y-2.5">
        {NOTES.map((n) => (
          <li
            key={n.title}
            className="flex gap-3 rounded-xl border border-border-subtle p-3 transition-colors hover:bg-bg-subtle"
          >
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg"
              style={{ backgroundColor: `var(--${n.token}-wash)` }}
            >
              <n.icon className="size-4" style={{ color: `var(--${n.token})` }} />
            </span>
            <span className="min-w-0">
              <span className="block text-body-sm font-semibold text-text-primary">{n.title}</span>
              <span className="mt-0.5 block text-caption leading-relaxed text-text-secondary">
                {n.body}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ---- The sync ring ------------------------------------------------------- */

/**
 * The sync ring.
 *
 * ⚠️ ONE ARRAY FEEDS THE RING AND THE LEGEND, AND ONLY THE RING IS FILTERED. A
 * zero-value slice draws nothing, so it has to leave the arc; but "Issues 0" is
 * the single most reassuring line on this card, and filtering once upstream
 * removed it from the legend too.
 *
 * ── ⚠️ WHY THE ARC IS NOT ANIMATED, AND WHY A FULL RING IS A PLAIN CIRCLE ───
 * At 100% healthy this drew NOTHING — the owner saw a grey ring over the words
 * "100% Healthy". Two causes, both removed:
 *
 *   1. A single arc covering the whole circle produced
 *      `stroke-dasharray: "301.6 0"` — a dash with a ZERO-LENGTH GAP, which
 *      renderers do not agree about. A ring with one state is now a plain
 *      circle with no dash pattern at all, which cannot be misread.
 *
 *   2. The dash array was gated on `inView`, starting at `0 circumference`.
 *      That is the THIRD time in this feature that an entrance animation has
 *      been the only thing standing between real data and being visible — the
 *      chart lines froze at frame 0 under `prefers-reduced-motion`, and the
 *      reveal gate hid a panel's contents. The rule earned here: an animation
 *      may change HOW data appears, never WHETHER it appears. The card's own
 *      panel already fades in; the figure inside it is just drawn.
 */
function SyncRing({
  healthy,
  warning,
  issues,
  total,
}: {
  healthy: number;
  warning: number;
  issues: number;
  total: number;
}) {
  const legend = [
    { label: 'Healthy', value: healthy, token: 'feedback-success' },
    { label: 'Warning', value: warning, token: 'feedback-warning' },
    { label: 'Issues', value: issues, token: 'feedback-error' },
  ];

  const SIZE = 96;
  const THICK = 12;
  const r = (SIZE - THICK) / 2;
  const circumference = 2 * Math.PI * r;
  const percent = total === 0 ? 0 : Math.round((healthy / total) * 100);

  const present = legend.filter((s) => s.value > 0);

  let offset = 0;
  const arcs = present.map((s) => {
    const length = total === 0 ? 0 : (s.value / total) * circumference;
    const arc = { ...s, length, offset: -offset };
    offset += length;
    return arc;
  });

  /* One state accounts for every connection — no dash pattern needed. */
  const whole = present.length === 1 ? present[0] : null;

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {/* ⚠️ ROTATED SO THE ARC STARTS AT TWELVE O'CLOCK. An SVG circle's dash
              begins at three o'clock, which reads as a ring that stopped short of
              the top even when it is complete. */}
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={r}
              fill="none"
              stroke="var(--chart-grid)"
              strokeWidth={THICK}
            />
            {whole ? (
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={r}
                fill="none"
                stroke={`var(--${whole.token})`}
                strokeWidth={THICK}
              />
            ) : (
              arcs.map((s) => (
                <circle
                  key={s.label}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={r}
                  fill="none"
                  stroke={`var(--${s.token})`}
                  strokeWidth={THICK}
                  strokeLinecap="butt"
                  strokeDasharray={`${s.length} ${circumference - s.length}`}
                  strokeDashoffset={s.offset}
                />
              ))
            )}
          </g>
        </svg>
        <span className="absolute inset-0 grid place-items-center text-center">
          <span>
            <span
              className="block text-body font-bold leading-none tabular-nums"
              /* The percentage takes the colour of the state it describes, so
                 "100%" over a red ring cannot read as good news. */
              style={{ color: `var(--${(whole ?? legend[0]).token})` }}
            >
              {percent}%
            </span>
            <span className="block text-[0.58rem] text-text-tertiary">Healthy</span>
          </span>
        </span>
      </div>

      <dl className="min-w-0 flex-1 space-y-1.5">
        {legend.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: `var(--${s.token})` }}
            />
            <dt className="min-w-0 flex-1 truncate text-micro text-text-secondary">{s.label}</dt>
            <dd className="shrink-0 text-micro font-bold tabular-nums text-text-primary">
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---- Coverage ----------------------------------------------------------- */

/**
 * Which days in the collected range actually have figures.
 *
 * ⚠️ NOT A SPARKLINE, and the reference draws one here. A day COUNT only ever
 * rises by one, so a line of it is a straight diagonal that says nothing. The
 * dates that have data say the thing somebody needs: where the gaps are.
 *
 * ⚠️ THE GAP BETWEEN BARS IS A REAL COLUMN, not a CSS `gap`. With `gap-px` and
 * thirty bars the whole strip rendered as one solid block on Instagram's card —
 * a 1px gap in a pink bar over a pink-tinted panel is invisible, and `zoom: 0.9`
 * can round it away entirely. Drawing each bar narrower than its slot leaves
 * daylight that cannot round to nothing.
 */
function CoverageStrip({
  dates,
  token,
  height,
}: {
  dates: readonly string[];
  token: string;
  height: number;
}) {
  const days = React.useMemo(() => {
    if (dates.length === 0) return [] as boolean[];
    const have = new Set(dates);
    const out: boolean[] = [];
    for (let d = dates[0]; d <= dates[dates.length - 1]; d = nextDay(d)) out.push(have.has(d));
    return out;
  }, [dates]);

  if (days.length === 0) return null;

  const W = 100;
  const slot = W / days.length;
  const bar = slot * 0.62;
  const missing = days.filter((d) => !d).length;

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={
        missing === 0
          ? `${days.length} days, all collected`
          : `${days.length} days, ${missing} with no figures`
      }
    >
      {days.map((has, i) => (
        <rect
          key={i}
          x={i * slot + (slot - bar) / 2}
          width={bar}
          y={has ? 0 : height * 0.72}
          /* ⚠️ DRAWN AT FULL HEIGHT, NOT GROWN FROM ZERO. The previous version
             set `height={inView ? … : 0}`, which meant an observer that never
             fired left the strip blank — the same class of bug as the grey ring
             above. An animation may change how data appears, never whether. */
          height={has ? height : height * 0.28}
          /* ⚠️ NO `rx`. `preserveAspectRatio="none"` stretches x and y by
             DIFFERENT factors, so a corner radius in user units comes out
             stretched into an ellipse — and on a single wide bar it swallowed
             the bar entirely and drew one pink oval. Owner: *"It should be in
             vertical lines like in the Facebook card."* Square ends cannot
             distort, whatever the day count. */
          fill={has ? `var(--${token})` : 'var(--chart-grid)'}
          opacity={has ? 0.8 : 1}
        />
      ))}
    </svg>
  );
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

  return (
    <div
      ref={ref}
      className={cn(
        /* ⚠️ `h-full` AND A FLEX COLUMN. This is the other half of the
           equal-columns mechanism at the top of the file: the card fills its
           grid cell, and the detail block below claims the slack. */
        'studio-reveal flex h-full flex-col overflow-hidden rounded-xl border bg-bg-surface shadow-[0_1px_2px_rgb(6_35_42_/_0.04)] transition-shadow hover:shadow-[0_6px_18px_rgb(6_35_42_/_0.08)]',
        'motion-safe:animate-[studio-rise_620ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
      style={{
        animationDelay: `${index * 90}ms`,
        borderColor: `color-mix(in oklab, var(--${token}) 28%, transparent)`,
      }}
    >
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3.5 p-4 pb-3.5">
        {/* ⚠️ THE BRAND MARK, NOT A PROFILE PICTURE. `profile_picture` is NULL on
            every row, deliberately: Meta serves avatars from a CDN with expiring
            URLs, so a stored one becomes a broken image within days, and
            re-fetching every two hours to keep a 56px circle alive is a poor
            trade. */}
        <span
          className="grid size-14 shrink-0 place-items-center rounded-full"
          style={{ backgroundColor: `var(--${token}-wash)` }}
        >
          <PlatformIcon slug={account.platform} size={30} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold leading-tight text-text-primary">
            {account.displayName ?? account.username ?? account.objectId}
          </p>
          <p className="mt-0.5 truncate text-caption text-text-tertiary">
            {account.username ? `@${account.username}` : `${brand?.label ?? account.platform} Page`}
          </p>
        </div>

        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.62rem] font-bold"
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
        className="mx-4 grid grid-cols-3 gap-4 rounded-xl px-3.5 py-3.5"
        style={{ backgroundColor: `color-mix(in oklab, var(--${token}) 6%, transparent)` }}
      >
        <Stat
          value={account.followers === null ? '—' : compact(account.followers)}
          label="Followers"
          series={account.followerSeries}
          token={token}
          /* ⚠️ THE ONE PLACE THIS PAGE EXPLAINS META RATHER THAN DRAWING IT.
             Instagram's `followers_count` is a PROFILE FIELD, not an insight —
             the `follower_count` insight returns nothing on a small account — so
             Meta serves no history and there is one reading per collected day.
             Facebook's `page_follows` IS a series, which is why one card has a
             line and the other does not. Unexplained, that reads as broken. */
          emptyNote={
            account.platform === 'instagram'
              ? 'Meta serves no follower history for Instagram — this line builds from today'
              : 'not enough history yet'
          }
        />
        <Stat
          value={String(account.postCount)}
          label="Posts collected"
          series={account.postSeries}
          token={token}
          emptyNote="no posts collected yet"
        />
        <div className="min-w-0">
          <p className="text-h2 font-bold leading-none tabular-nums text-text-primary">
            {account.metricDays}
          </p>
          <p className="mt-1 text-[0.62rem] text-text-tertiary">Days of history</p>
          <div className="mt-2.5">
            <CoverageStrip dates={account.coveredDates} token={token} height={30} />
          </div>
        </div>
      </div>

      {/* ── Sync detail ─ ⚠️ `flex-1` + `justify-between`: the slack the card
             absorbs from the column lands HERE, as row spacing. Owner: *"in the
             Last Sync Frequency row, the items are very congested with each
             other. Add some balanced spacing between them."* ─────────────── */}
      <dl className="mt-3.5 flex flex-1 flex-col justify-between gap-0.5 px-4">
        <Line icon={RefreshCw} term="Last sync">
          <span className="inline-flex items-center gap-1.5">
            {since}
            {health.state === 'healthy' ? (
              <CheckCircle2 className="size-3.5" style={{ color: 'var(--feedback-success)' }} />
            ) : (
              <TriangleAlert className="size-3.5" style={{ color: `var(--${health.token})` }} />
            )}
          </span>
        </Line>
        <Line icon={Clock} term="Sync frequency">
          Every 2 hours
        </Line>
        <Line icon={Hash} term="Account ID">
          <span className="font-mono text-[0.62rem]">{account.objectId}</span>
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

        {open && (
          <>
            <Line icon={CalendarDays} term="History held">
              {account.firstMetricDate && account.lastMetricDate
                ? `${account.firstMetricDate} → ${account.lastMetricDate}`
                : 'none yet'}
            </Line>
            <Line icon={Link2} term="Linked">
              {`${account.linkedAt.slice(0, 10)}${account.linkedBy ? ` by ${account.linkedBy}` : ''}`}
            </Line>
            {/* ⚠️ `media_count` BELONGS HERE, not over the sparkline. It is how
                many posts exist on the account — a different fact from how many
                we hold, and putting it above a line drawn from our own
                collection made one label describe two numbers. */}
            {account.mediaCount !== null && (
              <Line icon={FileText} term="Posts on Meta">
                {`${account.mediaCount} in total`}
              </Line>
            )}
            <Line icon={Info} term="Status">
              {health.detail}
            </Line>
          </>
        )}
      </dl>

      {/* ── Actions ─────────────────────────────────────────────────────── */}
      <div className="flex gap-2.5 p-4 pt-3.5">
        <a
          href={account.permalink ?? '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2.5 text-micro font-semibold transition-colors"
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
          className="inline-flex flex-1 items-center justify-center rounded-lg border border-border-subtle py-2.5 text-micro font-medium text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
        >
          {open ? 'Hide details' : 'View details'}
        </button>
      </div>
    </div>
  );
}

/* ---- Connecting --------------------------------------------------------- */

function ConnectDialog({
  projectId,
  projectName,
  onClose,
  onDone,
}: {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onDone: (tone: 'ok' | 'bad', text: string) => void;
}) {
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [pages, setPages] = React.useState<readonly ConnectablePage[]>([]);
  const [error, setError] = React.useState('');
  const [linking, setLinking] = React.useState<string | null>(null);

  /* ⚠️ ONE FETCH, ON OPEN, with an empty dependency array and a cancel flag.
     `discoverPages` is a live Graph API call against `me/accounts`; a dependency
     that changed on every render would hammer it, and a resolve after the dialog
     closes would set state on an unmounted tree. */
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await discoverMetaPagesAction();
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error ?? 'Meta did not answer.');
        setState('error');
        return;
      }
      setPages(r.pages ?? []);
      setState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Modal
      title="Connect a Meta account"
      subtitle={`What the system-user token can reach. Linking attaches it to ${projectName}.`}
      onClose={onClose}
      footer={
        <p className="flex items-start gap-1.5 text-[0.6rem] leading-snug text-text-tertiary">
          <Info className="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>
            There is no consent screen because there is nothing to authorise: the system-user
            token already covers the business&rsquo;s asset portfolio, so this is a list of what
            it can reach.
          </span>
        </p>
      }
    >
      {state === 'loading' && (
        <p className="flex items-center justify-center gap-2 py-10 text-micro text-text-tertiary">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Asking Meta which accounts this token can reach…
        </p>
      )}

      {state === 'error' && (
        <div className="rounded-lg border border-dashed border-border-default px-3 py-6 text-center">
          {/* ⚠️ META'S OWN WORDS. A guessed cause ("check your token") sends
              somebody to the wrong place; the API says whether it is permissions,
              a revoked asset or a bad token, and that is what solves it. */}
          <p className="text-micro font-semibold" style={{ color: 'var(--feedback-error)' }}>
            {error}
          </p>
        </div>
      )}

      {state === 'ready' && pages.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-default px-3 py-6 text-center">
          <p className="text-micro font-semibold text-text-primary">Meta returned no accounts</p>
          <p className="mx-auto mt-1 max-w-sm text-[0.62rem] leading-relaxed text-text-tertiary">
            A client&rsquo;s page has to be shared into the business account on Meta&rsquo;s side
            before it appears here. Nothing on this page can do that step.
          </p>
        </div>
      )}

      {state === 'ready' && pages.length > 0 && (
        <ul className="space-y-1.5">
          {pages.map((p) => (
            <li
              key={`${p.platform}-${p.objectId}`}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border px-2.5 py-2',
                p.alreadyLinked ? 'border-dashed border-border-default' : 'border-border-subtle',
              )}
            >
              <PlatformIcon slug={p.platform} size={18} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-micro font-semibold text-text-primary">
                  {p.name}
                </span>
                <span className="block truncate text-[0.6rem] text-text-tertiary">
                  {p.username ? `@${p.username} · ` : ''}
                  {p.followers === null ? 'followers unknown' : `${compact(p.followers)} followers`}
                  {' · '}
                  <span className="font-mono">{p.objectId}</span>
                </span>
              </span>

              {/* ⚠️ GREYED, NOT HIDDEN. 091 allows one Taskly row per real Meta
                  object, so an account linked elsewhere cannot be linked again —
                  and hiding it would leave somebody hunting for a page they can
                  plainly see on Meta and not here. */}
              {p.alreadyLinked ? (
                <span className="shrink-0 text-[0.6rem] text-text-tertiary">already linked</span>
              ) : (
                <button
                  type="button"
                  disabled={linking !== null}
                  onClick={async () => {
                    setLinking(p.objectId);
                    try {
                      const r = await linkMetaAccountAction({
                        projectId,
                        objectId: p.objectId,
                        platform: p.platform,
                        name: p.name,
                        username: p.username,
                        followers: p.followers,
                        mediaCount: p.mediaCount,
                        permalink: p.permalink,
                      });
                      onDone(
                        r.ok ? 'ok' : 'bad',
                        r.ok
                          ? `${p.name} linked. Press Resync to pull its figures.`
                          : (r.error ?? 'It could not be linked.'),
                      );
                    } finally {
                      setLinking(null);
                    }
                  }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-micro font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                >
                  {linking === p.objectId && (
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  )}
                  Link
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/* ---- Parts -------------------------------------------------------------- */

function Stat({
  value,
  label,
  series,
  token,
  emptyNote,
}: {
  value: string;
  label: string;
  series: readonly number[];
  token: string;
  emptyNote: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-h2 font-bold leading-none tabular-nums text-text-primary">{value}</p>
      <p className="mt-1 truncate text-[0.62rem] text-text-tertiary">{label}</p>
      {series.length > 1 ? (
        <div className="mt-2.5">
          <Sparkline points={series} token={token} />
        </div>
      ) : (
        /* ⚠️ A single reading is not a trend. One point drawn as a flat line
           would imply a stable series where there is no series at all — so the
           space says WHY instead, which is the difference between a card that
           looks broken and one that has told you something. */
        <p className="mt-2.5 min-h-[30px] text-[0.58rem] leading-snug text-text-tertiary">
          {emptyNote}
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
    <div className="flex items-center justify-between gap-3 border-b border-border-subtle py-2.5 last:border-0">
      <dt className="inline-flex min-w-0 items-center gap-2 text-caption text-text-secondary">
        <Icon className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
        <span className="truncate">{term}</span>
      </dt>
      <dd className="shrink-0 text-caption font-semibold tabular-nums text-text-primary">
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
