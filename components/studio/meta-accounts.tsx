'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Hash,
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
 * Built to the owner's reference, 2026-09-04: five figures across the left
 * column, an account card per connection with three sparkline stats, and a rail
 * of totals, sync status, quick actions and integration notes.
 *
 * ── ⚠️ FOUR THINGS THE OWNER REPORTED AS "NOT SHOWING PROPERLY" ─────────────
 *
 *   Sync Health's icon was invisible.
 *       `KpiCard` painted its chip with `var(--<token>-wash)`, and `-wash` is
 *       declared ONLY for the chart tokens. This card passes a FEEDBACK token,
 *       so it asked for `--feedback-success-wash` — undeclared, therefore
 *       transparent, so the icon sat on nothing. Fixed in panels.tsx with a
 *       `var(x, fallback)`.
 *
 *   Sync Status Overview showed one legend row.
 *       The slices were filtered to `value > 0`, which is right for the ARC (a
 *       zero slice draws nothing) and wrong for the legend beside it: the
 *       reference always lists Healthy / Warning / Issues, and "Issues 0" is the
 *       most reassuring line on the card. One array now feeds both and only the
 *       arc is filtered.
 *
 *   Instagram's follower line was missing.
 *       Correct, and it needed EXPLAINING rather than fixing.
 *       `followers_count` is a PROFILE FIELD, not an insight, so Meta serves no
 *       history for it — one reading, today, against Facebook's twenty-nine. The
 *       card now says that in words instead of showing an empty box.
 *
 *   Quick Actions did nothing.
 *       All three now do. Resync runs the real pull; Connect Account lists what
 *       `discoverPages()` says the token can reach and links one; Manage
 *       Permissions goes to Meta, because that is where permissions live.
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
  const [connecting, setConnecting] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [showLogs, setShowLogs] = React.useState(false);
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
    /* ⚠️ `postCount`, NOT `media_count`. They are different facts: one is what
       we have collected, the other is how many posts exist on the account. The
       first draft showed Instagram's 49 above a sparkline built from the 25
       posts actually collected — a figure and its own line measuring two
       different things under one label. */
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
      {/* ══ LEFT: the figures, the accounts, the banner ══════════════════════
          ⚠️ THE KPI ROW IS INSIDE THIS COLUMN, not spanning the page above it.
          In the owner's reference the five cards line up with the account cards
          beneath them and the rail starts at the same top edge — so the rail is
          a sibling of the whole left STACK, not of the account grid. Spanning
          them across the full width above both columns is what left the rail
          hanging below its own heading. */}
      <div className="min-w-0 space-y-3">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            index={0}
            data={{
              key: 'accounts',
              label: 'Connected accounts',
              value: String(accounts.length),
              icon: Link2,
              token: 'chart-4',
              /* ⚠️ NO DELTA, though the reference shows "↑100% vs last 30 days".
                 One account becoming two is +100%; zero becoming two has no
                 percentage at all, and both of these were linked the same
                 afternoon. How many are actually working is the useful fact. */
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
              /* With no baseline this reads "+20 since collection began, across
                 1 of 2 accounts" — see `followerGrowth` for why. */
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
              /* ⚠️ The word carries the colour — see `valueToken` in panels.tsx.
                 It is the only thing distinguishing a healthy fleet from a broken
                 one at a glance, because both read as one short phrase. */
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
              /* Meta serves about 30 days and no more, so the ceiling is a fact
                 about the platform rather than a target we chose. */
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

        {/* ── Filter, only when there is something to filter ─────────────── */}
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

        {/* ── The accounts ───────────────────────────────────────────────── */}
        {shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-6 py-14 text-center">
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

        {/* ── The banner, whose tone is earned ───────────────────────────── */}
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

      {/* ══ RIGHT: the rail ════════════════════════════════════════════════ */}
      <aside className="space-y-3">
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

              <button
                type="button"
                onClick={() => setShowLogs((v) => !v)}
                aria-expanded={showLogs}
                className="group mt-2.5 inline-flex w-full items-center justify-end gap-1 border-t border-border-subtle pt-2 text-micro font-medium text-text-brand"
              >
                {showLogs ? 'Hide sync logs' : 'View sync logs'}
                <span
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </button>

              {/* ⚠️ AN INLINE DISCLOSURE, NOT A LINK. The reference's "View sync
                  logs →" points at a Settings & Sync tab that is not built, and a
                  link to nowhere is worse than no link. Every figure below is
                  already on the account rows this page fetched, so it costs no
                  query — and it is the answer somebody wants from that link. */}
              {showLogs && (
                <ul className="mt-1.5 space-y-1.5">
                  {accounts.map((a) => {
                    const h = accountHealth({
                      lastSyncedAt: a.lastSyncedAt,
                      lastError: a.lastError,
                      metricDays: a.metricDays,
                      nowMs,
                    });
                    return (
                      <li
                        key={a.id}
                        className="flex items-start gap-2 rounded-lg bg-bg-subtle px-2 py-1.5"
                      >
                        <span className="mt-px shrink-0">
                          <PlatformIcon slug={a.platform} size={12} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[0.62rem] font-semibold text-text-primary">
                            {a.lastSyncedAt
                              ? relative(nowMs - Date.parse(a.lastSyncedAt))
                              : 'never pulled'}
                            {' · '}
                            {a.syncRuns} {a.syncRuns === 1 ? 'run' : 'runs'}
                            {a.failedRuns > 0 ? `, ${a.failedRuns} failed` : ''}
                          </span>
                          <span
                            className="block text-[0.58rem] leading-snug"
                            style={{ color: `var(--${h.token})` }}
                          >
                            {a.lastError ?? h.detail}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </Panel>

        <Panel title="Quick actions">
          <div className="space-y-1.5">
            {/* ⚠️ RESYNC IS THE PRIMARY, NOT CONNECT. The reference fills
                "Connect Account" as the mint button, but the action somebody
                reaches for on this page is the pull — a primary button should be
                the thing most likely to be pressed. Both work; say the word and
                they swap. */}
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
              onClick={() => setConnecting(true)}
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

            {/* ⚠️ A LINK OUT, BECAUSE PERMISSIONS ARE NOT OURS TO EDIT. They are
                held on Meta's side against the system-user token; a form here
                would be a form that cannot save. So the button goes where the
                setting actually is. */}
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
                <strong className="font-semibold text-text-primary">30 days</strong> of history
                and no more. Everything older is ours because we recorded it, so the range you
                can look back over widens from here on its own.
              </span>
            </li>
            <li className="flex gap-2">
              <Info className="mt-0.5 size-3 shrink-0 text-text-tertiary" aria-hidden="true" />
              <span>
                One account failing never stops the others — each records its own outcome, so a
                client who revokes access is named here rather than quietly freezing every
                figure.
              </span>
            </li>
          </ul>
        </Panel>
      </aside>

      {connecting && (
        <ConnectDialog
          projectId={projectId}
          projectName={projectName}
          onClose={() => setConnecting(false)}
          onDone={(tone, text) => {
            say(tone, text);
            if (tone === 'ok') setConnecting(false);
          }}
        />
      )}
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

/* ---- The sync ring ------------------------------------------------------- */

/**
 * The reference's thick ring with its three-row legend.
 *
 * ⚠️ ONE ARRAY FEEDS BOTH, AND ONLY THE ARC IS FILTERED. A zero-value slice
 * draws nothing on a donut, so it has to go from the ring; but "Issues 0" is the
 * single most reassuring line on this card, and filtering once upstream removed
 * it from the LEGEND too. That was the bug the owner reported.
 *
 * ⚠️ Drawn here rather than with `DonutChart` because the legend the reference
 * wants is `Healthy 2` — a label and a COUNT. `DonutChart`'s built-in legend
 * prints `42% (521)`, which is right for a content mix and wrong for three
 * accounts, and it drops zero rows for the same reason the arc does.
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
  const { ref, inView } = useInView<HTMLDivElement>();

  const legend = [
    { label: 'Healthy', value: healthy, token: 'feedback-success' },
    { label: 'Warning', value: warning, token: 'feedback-warning' },
    { label: 'Issues', value: issues, token: 'feedback-error' },
  ];

  const SIZE = 104;
  const THICK = 13;
  const r = (SIZE - THICK) / 2;
  const circumference = 2 * Math.PI * r;
  const percent = total === 0 ? 0 : Math.round((healthy / total) * 100);

  let offset = 0;
  const arcs = legend
    .filter((s) => s.value > 0)
    .map((s) => {
      const length = total === 0 ? 0 : (s.value / total) * circumference;
      const arc = { ...s, length, offset: -offset };
      offset += length;
      return arc;
    });

  return (
    <div ref={ref} className="flex items-center gap-3">
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
            {arcs.map((s) => (
              <circle
                key={s.label}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={r}
                fill="none"
                stroke={`var(--${s.token})`}
                strokeWidth={THICK}
                strokeLinecap="butt"
                strokeDashoffset={s.offset}
                style={{
                  /* Sweeps clockwise on first sight, like the Studio's other
                     donuts, and gated on `inView` so it happens when the card is
                     actually looked at. */
                  transition: 'stroke-dasharray 900ms cubic-bezier(0.16,1,0.3,1)',
                  strokeDasharray: inView
                    ? `${s.length} ${circumference - s.length}`
                    : `0 ${circumference}`,
                }}
              />
            ))}
          </g>
        </svg>
        <span className="absolute inset-0 grid place-items-center text-center">
          <span>
            <span className="block text-body font-bold leading-none tabular-nums text-text-primary">
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

  /* ⚠️ THE COVERAGE STRIP, NOT A THIRD SPARKLINE. The reference draws a line
     under "Days of History", which would be a straight rising diagonal — a day
     count only ever goes up by one. The dates that actually HAVE data say
     something a line cannot: where the gaps are. */
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
        'studio-reveal overflow-hidden rounded-xl border bg-bg-surface shadow-[0_1px_2px_rgb(6_35_42_/_0.04)] transition-shadow hover:shadow-[0_6px_18px_rgb(6_35_42_/_0.08)]',
        'motion-safe:animate-[studio-rise_620ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
      /* The reference tints each card's border to its own platform. */
      style={{
        animationDelay: `${index * 90}ms`,
        borderColor: `color-mix(in oklab, var(--${token}) 28%, transparent)`,
      }}
    >
      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 p-3.5 pb-3">
        {/* ⚠️ THE BRAND MARK, NOT A PROFILE PICTURE. `profile_picture` exists on
            the row and is NULL on every one, deliberately: Meta serves avatars
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
          /* ⚠️ THE ONE PLACE THIS PAGE HAS TO EXPLAIN META RATHER THAN DRAW IT.
             Instagram's `followers_count` is a PROFILE FIELD, not an insight —
             the `follower_count` insight returns nothing on a small account — so
             Meta serves no history and there is exactly one reading, taken
             today. Facebook's `page_follows` IS a series, which is why one card
             has a line and the other does not. Unexplained, that reads as a
             broken chart, which is what the owner reported. */
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
          <p className="text-h3 font-bold leading-none tabular-nums text-text-primary">
            {account.metricDays}
          </p>
          <p className="mt-0.5 text-[0.6rem] text-text-tertiary">Days of history</p>
          {coverage.length > 0 ? (
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
          ) : (
            <p className="mt-2 min-h-[26px] text-[0.58rem] leading-snug text-text-tertiary">
              nothing collected yet
            </p>
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

      {/* ── What "View details" reveals ─────────────────────────────────── */}
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
          {/* ⚠️ `media_count` BELONGS HERE, not above the sparkline. It is how
              many posts exist on the account, which is a different fact from how
              many we hold — putting it over a line drawn from our own collection
              made one label describe two numbers. */}
          {account.mediaCount !== null && (
            <Line icon={FileText} term="Posts on Meta">
              {`${account.mediaCount} in total`}
            </Line>
          )}
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
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgb(6_35_42_/_0.45)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Connect a Meta account"
    >
      <div className="w-full max-w-lg rounded-xl border border-border-subtle bg-bg-surface p-4 shadow-[0_20px_50px_rgb(6_35_42_/_0.25)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-text-primary">Connect a Meta account</h2>
            <p className="mt-0.5 text-caption text-text-secondary">
              What the system-user token can reach. Linking attaches it to{' '}
              <strong className="font-semibold text-text-primary">{projectName}</strong>.
            </p>
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

        <div className="mt-3 max-h-[22rem] overflow-y-auto">
          {state === 'loading' && (
            <p className="flex items-center justify-center gap-2 py-10 text-micro text-text-tertiary">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Asking Meta which accounts this token can reach…
            </p>
          )}

          {state === 'error' && (
            <div className="rounded-lg border border-dashed border-border-default px-3 py-6 text-center">
              {/* ⚠️ META'S OWN WORDS. A guessed cause ("check your token") sends
                  somebody to the wrong place; the API says whether it is
                  permissions, a revoked asset or a bad token, and that sentence
                  is the one that solves it. */}
              <p className="text-micro font-semibold" style={{ color: 'var(--feedback-error)' }}>
                {error}
              </p>
            </div>
          )}

          {state === 'ready' && pages.length === 0 && (
            <div className="rounded-lg border border-dashed border-border-default px-3 py-6 text-center">
              <p className="text-micro font-semibold text-text-primary">
                Meta returned no accounts
              </p>
              <p className="mx-auto mt-1 max-w-sm text-[0.62rem] leading-relaxed text-text-tertiary">
                A client&rsquo;s page has to be shared into the business account on Meta&rsquo;s
                side before it appears here. Nothing on this page can do that step.
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
                    p.alreadyLinked
                      ? 'border-dashed border-border-default'
                      : 'border-border-subtle',
                  )}
                >
                  <PlatformIcon slug={p.platform} size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-micro font-semibold text-text-primary">
                      {p.name}
                    </span>
                    <span className="block truncate text-[0.6rem] text-text-tertiary">
                      {p.username ? `@${p.username} · ` : ''}
                      {p.followers === null
                        ? 'followers unknown'
                        : `${compact(p.followers)} followers`}
                      {' · '}
                      <span className="font-mono">{p.objectId}</span>
                    </span>
                  </span>

                  {/* ⚠️ GREYED, NOT HIDDEN. 091 allows one Taskly row per real
                      Meta object, so an account linked elsewhere cannot be linked
                      again — and hiding it would leave somebody hunting for a page
                      they can plainly see on Meta and not here. */}
                  {p.alreadyLinked ? (
                    <span className="shrink-0 text-[0.6rem] text-text-tertiary">
                      already linked
                    </span>
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
        </div>

        <p className="mt-3 flex items-start gap-1.5 border-t border-border-subtle pt-2.5 text-[0.6rem] leading-snug text-text-tertiary">
          <Info className="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>
            There is no consent screen here because there is nothing to authorise: the
            system-user token already covers the business&rsquo;s asset portfolio, so this is a
            list of what it can reach.
          </span>
        </p>
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
      <p className="text-h3 font-bold leading-none tabular-nums text-text-primary">{value}</p>
      <p className="mt-0.5 truncate text-[0.6rem] text-text-tertiary">{label}</p>
      {series.length > 1 ? (
        <Sparkline points={series} token={token} />
      ) : (
        /* ⚠️ A single reading is not a trend. One point drawn as a flat line
           would imply a stable series where there is no series at all — so the
           space says WHY instead, which is the difference between a card that
           looks broken and one that has told you something. */
        <p className="mt-2 min-h-[26px] text-[0.58rem] leading-snug text-text-tertiary">
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
