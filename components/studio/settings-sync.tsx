'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Gauge,
  KeyRound,
  Link2,
  Loader2,
  Package,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Webhook,
  X,
  Zap,
} from 'lucide-react';

import {
  createSyncRuleAction,
  deleteSyncRuleAction,
  saveSyncSettingsAction,
  setSyncRuleActiveAction,
} from '@/app/actions/meta-sync-settings';
import { resyncAccountsAction } from '@/app/actions/meta-accounts';
import { PLATFORM_MARKS, PlatformIcon } from '@/components/brand/platform-icon';
import type { AccountDetail } from '@/lib/db/queries/meta-studio';
import type { PermissionEvent } from '@/lib/db/queries/meta-sync-settings';
import {
  CATEGORY_DETAIL,
  CRON_INTERVAL_HOURS,
  FREQUENCY_LABEL,
  SYNC_CATEGORIES,
  SYNC_FREQUENCIES,
  clockLabel,
  effectiveFrequency,
  ruleState,
  schedulerKpis,
  successRate,
  systemHealth,
  weekEntries,
  type SyncCategory,
  type SyncFrequency,
  type SyncRule,
  type SyncRun,
  type SyncSettings,
} from '@/lib/domain/meta-sync-settings';
import { cn } from '@/lib/utils';

import { Panel, PanelEmpty } from './panels';
import { useInView } from './use-in-view';

/* ============================================================================
 * SETTINGS & SYNC — the owner's two references, 2026-09-04
 * ----------------------------------------------------------------------------
 * *"Make it all work according to my own system and our live data… Make sure the
 * left and right sides of the cards are equal. Make sure it is beautifully and
 * interactively designed and that the icons, colors, and color combinations used
 * in these screenshots are all the same."*
 *
 * Five sub-tabs. Every figure comes from the database or the environment; there
 * is no sample data on this tab.
 *
 * ── ⚠️ FOUR PLACES THE REFERENCE STATES SOMETHING AS FIXED TEXT ────────────
 *
 *   "System Health · Healthy" with five green ticks
 *       Each line is CHECKED here and each can come back bad — which is the
 *       entire value of a health panel. `systemHealth` in the domain layer, with
 *       tests. Today it reports Last sync amber, correctly, because this branch
 *       is not deployed and the cron is not reaching the project.
 *
 *   "Refresh Token"
 *       ⚠️ NOT BUILT, AND DELIBERATELY SO. `META_SYSTEM_USER_TOKEN` is a
 *       SYSTEM_USER token that NEVER EXPIRES — verified against the live API on
 *       2026-09-04. There is nothing to refresh, so a button doing it would be
 *       theatre. The card says the expiry is "Never" and why.
 *
 *   "98.6% Successful Sync Rate"
 *       Computed over `meta_sync_runs` in the window. Null before anything has
 *       run, never 100% — a rule created a minute ago has not succeeded at
 *       anything.
 *
 *   "Hourly" as a frequency
 *       Offered, and labelled with what it actually delivers: `vercel.json`
 *       wakes the runner every two hours, so hourly runs two-hourly. The page
 *       says that at the point of choosing rather than letting somebody discover
 *       it from a Last Run column a week later.
 * ========================================================================= */

type SubTab = 'settings' | 'schedule' | 'permissions' | 'activity' | 'webhooks';

const SUB_TABS: readonly { key: SubTab; label: string; badge?: string }[] = [
  { key: 'settings', label: 'Settings' },
  { key: 'schedule', label: 'Sync Schedule Manager', badge: 'New' },
  { key: 'permissions', label: 'Permission Log' },
  { key: 'activity', label: 'Activity Log' },
  { key: 'webhooks', label: 'Webhooks' },
];

export function SettingsSync({
  projectId,
  projectName,
  accounts,
  settings,
  rules,
  runs,
  permissions,
  tokenConfigured,
  metaAppId,
  nowMs,
  canConfigure,
  canManageRules,
}: {
  projectId: string;
  projectName: string;
  accounts: readonly AccountDetail[];
  settings: SyncSettings;
  rules: readonly SyncRule[];
  runs: readonly SyncRun[];
  permissions: readonly PermissionEvent[];
  /** Whether META_SYSTEM_USER_TOKEN is set — never the token itself. */
  tokenConfigured: boolean;
  metaAppId: string | null;
  nowMs: number;
  canConfigure: boolean;
  canManageRules: boolean;
}) {
  const [tab, setTab] = React.useState<SubTab>('settings');
  const [toast, setToast] = React.useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const say = (tone: 'ok' | 'bad', text: string) => {
    setToast({ tone, text });
    window.setTimeout(() => setToast(null), 7000);
  };

  return (
    <div className="space-y-3">
      {/* ── Sub-tabs ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border-subtle">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'relative inline-flex items-center gap-1.5 px-3 py-2.5 text-caption transition-colors',
              tab === t.key
                ? 'font-semibold text-text-primary'
                : 'text-text-secondary hover:text-text-primary',
            )}
          >
            {t.label}
            {t.badge && (
              <span
                className="rounded-full px-1.5 py-px text-[0.55rem] font-bold"
                style={{
                  backgroundColor: 'color-mix(in oklab, var(--feedback-success) 14%, transparent)',
                  color: 'var(--feedback-success)',
                }}
              >
                {t.badge}
              </span>
            )}
            {tab === t.key && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent-primary" />
            )}
          </button>
        ))}
      </div>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {tab === 'settings' ? (
        <SettingsTab
          projectId={projectId}
          projectName={projectName}
          accounts={accounts}
          settings={settings}
          tokenConfigured={tokenConfigured}
          metaAppId={metaAppId}
          nowMs={nowMs}
          canConfigure={canConfigure}
          onSay={say}
          onSchedule={() => setTab('schedule')}
        />
      ) : tab === 'schedule' ? (
        <ScheduleTab
          projectId={projectId}
          rules={rules}
          runs={runs}
          nowMs={nowMs}
          canManageRules={canManageRules}
          onSay={say}
        />
      ) : tab === 'permissions' ? (
        <PermissionLog events={permissions} nowMs={nowMs} />
      ) : tab === 'activity' ? (
        <ActivityLog runs={runs} nowMs={nowMs} />
      ) : (
        <WebhooksTab />
      )}
    </div>
  );
}

function Toast({
  toast,
  onClose,
}: {
  toast: { tone: 'ok' | 'bad'; text: string };
  onClose: () => void;
}) {
  const token = toast.tone === 'ok' ? 'feedback-success' : 'feedback-error';
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border px-3 py-2"
      style={{
        borderColor: `color-mix(in oklab, var(--${token}) 30%, transparent)`,
        backgroundColor: `color-mix(in oklab, var(--${token}) 8%, transparent)`,
      }}
    >
      {toast.tone === 'ok' ? (
        <CheckCircle2 className="mt-px size-3.5 shrink-0" style={{ color: `var(--${token})` }} />
      ) : (
        <AlertTriangle className="mt-px size-3.5 shrink-0" style={{ color: `var(--${token})` }} />
      )}
      <span className="min-w-0 flex-1 text-micro text-text-primary">{toast.text}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        className="text-text-tertiary hover:text-text-primary"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/* ============================================================================
 * SETTINGS
 * ========================================================================= */

function SettingsTab({
  projectId,
  projectName,
  accounts,
  settings,
  tokenConfigured,
  metaAppId,
  nowMs,
  canConfigure,
  onSay,
  onSchedule,
}: {
  projectId: string;
  projectName: string;
  accounts: readonly AccountDetail[];
  settings: SyncSettings;
  tokenConfigured: boolean;
  metaAppId: string | null;
  nowMs: number;
  canConfigure: boolean;
  onSay: (tone: 'ok' | 'bad', text: string) => void;
  onSchedule: () => void;
}) {
  const [autoSync, setAutoSync] = React.useState(settings.autoSyncEnabled);
  const [interval, setIntervalHours] = React.useState(settings.intervalHours);
  const [retention, setRetention] = React.useState(settings.retentionMonths);
  const [saving, setSaving] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [confirmPause, setConfirmPause] = React.useState(false);

  const lastSyncedAt =
    accounts
      .map((a) => a.lastSyncedAt)
      .filter((d): d is string => Boolean(d))
      .sort()
      .pop() ?? null;

  const health = React.useMemo(
    () =>
      systemHealth({
        tokenConfigured,
        accountCount: accounts.length,
        failingAccounts: accounts.filter((a) => a.lastError !== null).length,
        lastSyncedAt,
        autoSyncEnabled: settings.autoSyncEnabled,
        nowMs,
      }),
    [tokenConfigured, accounts, lastSyncedAt, settings.autoSyncEnabled, nowMs],
  );

  const dirty =
    autoSync !== settings.autoSyncEnabled ||
    interval !== settings.intervalHours ||
    retention !== settings.retentionMonths;

  const save = async (nextAuto = autoSync) => {
    setSaving(true);
    try {
      const r = await saveSyncSettingsAction({
        projectId,
        autoSyncEnabled: nextAuto,
        intervalHours: interval,
        retentionMonths: retention,
      });
      onSay(r.ok ? 'ok' : 'bad', r.ok ? 'Sync settings saved.' : (r.error ?? 'Could not save.'));
      if (!r.ok) setAutoSync(settings.autoSyncEnabled);
    } finally {
      setSaving(false);
      setConfirmPause(false);
    }
  };

  const resync = async () => {
    setSyncing(true);
    try {
      const r = await resyncAccountsAction();
      onSay(r.ok ? 'ok' : 'bad', r.ok ? (r.summary ?? 'Synced.') : (r.error ?? 'The sync failed.'));
    } finally {
      setSyncing(false);
    }
  };

  return (
    /* ⚠️ ONE GRID ROW, so both columns end together — the owner's standing note
       on every screen in this feature. */
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-3">
        {/* ── Token status ─────────────────────────────────────────────── */}
        <Card icon={ShieldCheck} title="Token Status" token="chart-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
                System user token
                <Pill token={tokenConfigured ? 'feedback-success' : 'feedback-error'}>
                  {tokenConfigured ? 'Active' : 'Missing'}
                </Pill>
              </p>
              <p className="mt-1 text-[0.65rem] text-text-tertiary">
                Expires: <strong className="font-semibold text-text-primary">Never</strong>
              </p>
            </div>

            {/* ⚠️ NOT A BUTTON, AND THAT IS THE HONEST ANSWER. The reference has
                "Refresh Token"; this token is of type SYSTEM_USER and never
                expires — verified against the live API on 2026-09-04 — so there
                is nothing to refresh and a button would be theatre. Facebook
                Page tokens ARE derived per request from it, which is the part
                people are usually thinking of, and that happens on every run. */}
            <p className="max-w-[19rem] rounded-lg border border-dashed border-border-default px-2.5 py-2 text-[0.62rem] leading-snug text-text-tertiary">
              Nothing to refresh: a system-user token does not expire. Page tokens are derived
              from it on every run and never stored.
            </p>
          </div>
        </Card>

        {/* ── App status ───────────────────────────────────────────────── */}
        <Card icon={Package} title="App Status" token="chart-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
                App ID
                <Pill token={metaAppId ? 'chart-4' : 'feedback-error'}>
                  {metaAppId ? 'Configured' : 'Not set'}
                </Pill>
              </p>
              {metaAppId && (
                <p className="mt-1 font-mono text-[0.62rem] text-text-tertiary">{metaAppId}</p>
              )}
            </div>
            <a
              href={
                metaAppId
                  ? `https://developers.facebook.com/apps/${metaAppId}/dashboard/`
                  : 'https://developers.facebook.com/apps/'
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-micro font-medium text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
            >
              View in Meta Developers
              <ExternalLink className="size-3 opacity-70" aria-hidden="true" />
            </a>
          </div>
        </Card>

        {/* ── Sync configuration ───────────────────────────────────────── */}
        <Card icon={RefreshCw} title="Sync Configuration" token="chart-1">
          <Setting
            label="Auto sync"
            info="When off, nothing is collected for this project at all — including any sync rules."
          >
            <Toggle
              checked={autoSync}
              disabled={!canConfigure || saving}
              label="Auto sync"
              onChange={(next) => {
                /* ⚠️ SWITCHING OFF ASKS FIRST. It is the one control on this
                   page that destroys something: Meta serves ~30 days and no
                   more, so a project left off for five weeks has a gap nothing
                   can ever fill. Switching ON is harmless and saves at once. */
                if (!next) {
                  setConfirmPause(true);
                  return;
                }
                setAutoSync(true);
                void save(true);
              }}
            />
          </Setting>

          <Setting
            label="Sync frequency"
            info={`How often the scheduler pulls. It wakes every ${CRON_INTERVAL_HOURS} hours, so anything finer than that runs two-hourly.`}
          >
            <Select
              value={String(interval)}
              onChange={(v) => setIntervalHours(Number(v))}
              disabled={!canConfigure}
              options={[1, 2, 4, 6, 12, 24].map((h) => ({
                value: String(h),
                label: h === 24 ? 'Daily' : `Every ${h} ${h === 1 ? 'hour' : 'hours'}`,
              }))}
            />
          </Setting>

          <Setting
            label="Data retention"
            info="How long the division intends to keep collected figures."
            last
          >
            <Select
              value={String(retention)}
              onChange={(v) => setRetention(Number(v))}
              disabled={!canConfigure}
              options={[6, 12, 24, 36, 60, 120].map((m) => ({
                value: String(m),
                label: m < 12 ? `${m} months` : `${m / 12} ${m === 12 ? 'year' : 'years'}`,
              }))}
            />
          </Setting>

          {/* ⚠️ SAID PLAINLY RATHER THAN IMPLIED. Nothing deletes on the
              retention setting yet — it records the intention. A setting that
              silently did nothing would be bad; one that silently DID delete a
              client's history would be far worse. */}
          <p className="mt-2 rounded-lg bg-bg-subtle px-2.5 py-2 text-[0.6rem] leading-snug text-text-tertiary">
            Retention records the intention. Nothing is deleted automatically yet — figures
            older than this are kept until a sweeper is built and reviewed.
          </p>

          {canConfigure && dirty && (
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-micro font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: 'var(--accent-primary)' }}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Save changes
            </button>
          )}
          {!canConfigure && (
            <p className="mt-2 text-[0.62rem] text-text-tertiary">
              Only an Admin can change these — switching collection off loses history that Meta
              will not serve again.
            </p>
          )}
        </Card>

        {/* ── Connected platforms ──────────────────────────────────────── */}
        <Card icon={Link2} title="Connected Platforms" token="chart-2" className="flex-1">
          <p className="text-caption text-text-secondary">
            Meta accounts linked to {projectName}.
          </p>
          {accounts.length === 0 ? (
            <p className="mt-2 rounded-lg border border-dashed border-border-default px-3 py-4 text-center text-micro text-text-tertiary">
              Nothing connected. Link an account from the Meta Accounts tab.
            </p>
          ) : (
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              {accounts.map((a) => {
                const token = a.platform === 'instagram' ? 'chart-2' : 'chart-1';
                const failing = a.lastError !== null;
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
                    style={{
                      borderColor: `color-mix(in oklab, var(--${token}) 28%, transparent)`,
                    }}
                  >
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-full"
                      style={{ backgroundColor: `var(--${token}-wash)` }}
                    >
                      <PlatformIcon slug={a.platform} size={20} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-micro font-semibold text-text-primary">
                        {PLATFORM_MARKS[a.platform]?.label ?? a.platform}
                      </span>
                      <span
                        className="block truncate text-[0.62rem] font-medium"
                        style={{
                          color: failing
                            ? 'var(--feedback-error)'
                            : 'var(--feedback-success)',
                        }}
                      >
                        {failing ? 'Failing' : 'Connected'}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* ══ RIGHT RAIL ═══════════════════════════════════════════════════ */}
      <aside className="flex flex-col gap-3">
        <Panel
          title="System Health"
          action={<Pill token={health.token}>{health.verdict}</Pill>}
        >
          <ul className="space-y-2">
            {health.lines.map((l) => (
              <li key={l.key} className="flex items-center gap-2" title={l.detail}>
                {l.ok ? (
                  <CheckCircle2
                    className="size-4 shrink-0"
                    style={{ color: 'var(--feedback-success)' }}
                    aria-hidden="true"
                  />
                ) : (
                  <TriangleAlert
                    className="size-4 shrink-0"
                    style={{ color: 'var(--feedback-warning)' }}
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-micro text-text-secondary">
                  {l.label}
                </span>
                <span
                  className="shrink-0 text-micro font-semibold"
                  style={{ color: l.ok ? 'var(--text-primary)' : 'var(--feedback-warning)' }}
                >
                  {l.value}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Quick Actions">
          <div className="space-y-1">
            <ActionRow
              icon={RefreshCw}
              label={syncing ? 'Pulling…' : 'Run manual sync'}
              onClick={() => void resync()}
              disabled={syncing || accounts.length === 0}
              busy={syncing}
            />
            <ActionRow icon={CalendarClock} label="View sync schedule" onClick={onSchedule} />
            <ActionRow
              icon={KeyRound}
              label="Manage permissions"
              href="https://business.facebook.com/settings"
            />
          </div>
        </Panel>

        {settings.pausedAt && (
          <Panel title="Collection is paused">
            <p className="text-[0.65rem] leading-relaxed text-text-secondary">
              Paused {settings.pausedAt.slice(0, 10)}
              {settings.pausedByName ? ` by ${settings.pausedByName}` : ''}. Meta serves about
              thirty days of history, so anything missed beyond that cannot be recovered.
            </p>
          </Panel>
        )}

        <Panel title="Need help?" className="flex-1">
          <p className="text-[0.65rem] leading-relaxed text-text-secondary">
            The integration&rsquo;s design notes, verified API facts and phase tracker live in
            the repository under <code className="font-mono">docs/meta-integration/</code>.
          </p>
          <a
            href="https://developers.facebook.com/docs/graph-api/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border-subtle py-2 text-micro font-medium text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            Graph API reference
            <ExternalLink className="size-3 opacity-70" aria-hidden="true" />
          </a>
        </Panel>
      </aside>

      {confirmPause && (
        <ConfirmPause
          projectName={projectName}
          saving={saving}
          onCancel={() => setConfirmPause(false)}
          onConfirm={() => {
            setAutoSync(false);
            void save(false);
          }}
        />
      )}
    </div>
  );
}

function ConfirmPause({
  projectName,
  saving,
  onCancel,
  onConfirm,
}: {
  projectName: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgb(6_35_42_/_0.45)] p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Pause collection"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border-subtle bg-bg-surface p-4 shadow-[0_20px_50px_rgb(6_35_42_/_0.25)]">
        <div className="flex items-start gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-lg"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--feedback-warning) 16%, transparent)',
            }}
          >
            <TriangleAlert className="size-5" style={{ color: 'var(--feedback-warning)' }} />
          </span>
          <div className="min-w-0">
            <h2 className="text-body font-semibold text-text-primary">
              Pause collection for {projectName}?
            </h2>
            {/* ⚠️ THE CONSEQUENCE, STATED PLAINLY. This is the only control on
                the page that destroys something, and what it destroys is not
                obvious from the switch. */}
            <p className="mt-1.5 text-caption leading-relaxed text-text-secondary">
              Meta serves about <strong className="font-semibold text-text-primary">thirty
              days</strong> of history and no more. Anything not collected while this is off is
              gone for good — it cannot be backfilled later, however soon you switch it back on.
            </p>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-border-subtle py-2 text-micro font-medium text-text-secondary transition-colors hover:bg-bg-subtle"
          >
            Keep collecting
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-micro font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{ backgroundColor: 'var(--feedback-warning)' }}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            Pause anyway
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * SYNC SCHEDULE MANAGER
 * ========================================================================= */

function ScheduleTab({
  projectId,
  rules,
  runs,
  nowMs,
  canManageRules,
  onSay,
}: {
  projectId: string;
  rules: readonly SyncRule[];
  runs: readonly SyncRun[];
  nowMs: number;
  canManageRules: boolean;
  onSay: (tone: 'ok' | 'bad', text: string) => void;
}) {
  const [creating, setCreating] = React.useState(false);
  const kpis = React.useMemo(() => schedulerKpis({ rules, runs, nowMs }), [rules, runs, nowMs]);

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="flex min-w-0 flex-col gap-3">
        {/* ── Four figures ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <SchedulerKpi
            index={0}
            label="Active sync rules"
            value={String(kpis.activeRules)}
            footnote={
              kpis.activeRules === 0
                ? 'Using the default pull'
                : `Across ${kpis.platformsCovered || 'all'} ${kpis.platformsCovered === 1 ? 'platform' : 'platforms'}`
            }
            icon={CalendarDays}
            token="chart-4"
          />
          <SchedulerKpi
            index={1}
            label="Successful sync rate"
            /* ⚠️ NULL BEFORE ANYTHING HAS RUN, never 100%. */
            value={
              kpis.successRatePercent === null
                ? '—'
                : `${kpis.successRatePercent.toFixed(1)}%`
            }
            footnote={
              kpis.runsCounted === 0
                ? 'Nothing has run yet'
                : `${kpis.runsCounted} runs, last 30 days`
            }
            icon={CheckCircle2}
            token="feedback-success"
          />
          <SchedulerKpi
            index={2}
            label="Failed sync jobs"
            value={String(kpis.failedRuns)}
            footnote="Last 30 days"
            icon={kpis.failedRuns > 0 ? TriangleAlert : CheckCircle2}
            token={kpis.failedRuns > 0 ? 'feedback-error' : 'chart-3'}
          />
          <SchedulerKpi
            index={3}
            label="Next scheduled sync"
            value={kpis.nextRun ? whenShort(Date.parse(kpis.nextRun.at), nowMs) : '—'}
            footnote={kpis.nextRun?.name ?? 'Nothing scheduled'}
            icon={Clock}
            token="chart-6"
            small
          />
        </div>

        {/* ── The calendar ─────────────────────────────────────────────── */}
        <SyncCalendar rules={rules} />

        {/* ── The table ────────────────────────────────────────────────── */}
        <Panel
          title="Sync schedules"
          className="flex-1"
          action={
            canManageRules ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-micro font-semibold text-accent-foreground transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--accent-primary)' }}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                New schedule
              </button>
            ) : undefined
          }
        >
          {rules.length === 0 ? (
            <div className="grid place-items-center rounded-lg border border-dashed border-border-subtle px-4 py-10 text-center">
              <p className="text-body-sm font-semibold text-text-primary">No sync rules</p>
              {/* ⚠️ THE EMPTY STATE SAYS WHAT IS HAPPENING INSTEAD, which is not
                  nothing: the project is on the default two-hourly pull. An
                  empty table that implied no collection would be alarming and
                  wrong. */}
              <p className="mt-1 max-w-md text-caption text-text-secondary">
                This project is on the default pull — every linked account, every{' '}
                {CRON_INTERVAL_HOURS} hours. Add a rule to collect on your own schedule or to
                narrow what is collected.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border-default">
                    {['Schedule name', 'Platform', 'Frequency', 'Next run', 'Last run', 'Success', 'Status', ''].map(
                      (h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-2 pb-1.5 text-[0.58rem] font-bold uppercase tracking-wide text-text-tertiary first:pl-0"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <RuleRow
                      key={r.id}
                      rule={r}
                      nowMs={nowMs}
                      canManage={canManageRules}
                      onSay={onSay}
                    />
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[0.62rem] text-text-tertiary">
                Showing {rules.length} of {rules.length} schedules
              </p>
            </div>
          )}
        </Panel>
      </div>

      {/* ══ The create drawer ════════════════════════════════════════════ */}
      <aside className="min-w-0">
        {creating ? (
          <CreateRule
            projectId={projectId}
            onClose={() => setCreating(false)}
            onDone={(tone, text) => {
              onSay(tone, text);
              if (tone === 'ok') setCreating(false);
            }}
          />
        ) : (
          <div className="flex h-full flex-col rounded-xl border border-border-subtle bg-bg-surface p-4">
            <h3 className="text-body-sm font-semibold text-text-primary">How rules work</h3>
            <ul className="mt-2.5 space-y-2.5 text-[0.65rem] leading-relaxed text-text-secondary">
              <li className="flex gap-2">
                <Zap className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--chart-6)' }} />
                <span>
                  With <strong className="font-semibold text-text-primary">no rules</strong>, the
                  project is pulled every {CRON_INTERVAL_HOURS} hours — every account, everything.
                  That is the default and it works.
                </span>
              </li>
              <li className="flex gap-2">
                <CalendarClock
                  className="mt-0.5 size-3.5 shrink-0"
                  style={{ color: 'var(--chart-4)' }}
                />
                <span>
                  Add a rule and the default stops. From then on{' '}
                  <strong className="font-semibold text-text-primary">only your rules</strong>{' '}
                  collect, on their own schedules and scoped to what they name.
                </span>
              </li>
              <li className="flex gap-2">
                <Clock className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--chart-1)' }} />
                <span>
                  The scheduler wakes every {CRON_INTERVAL_HOURS} hours, so that is the finest
                  interval anything can really run at — an hourly rule runs two-hourly.
                </span>
              </li>
            </ul>

            {canManageRules && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="mt-auto inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-2.5 text-micro font-semibold text-accent-foreground transition-opacity hover:opacity-90"
                style={{ backgroundColor: 'var(--accent-primary)' }}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Create a sync rule
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function RuleRow({
  rule,
  nowMs,
  canManage,
  onSay,
}: {
  rule: SyncRule;
  nowMs: number;
  canManage: boolean;
  onSay: (tone: 'ok' | 'bad', text: string) => void;
}) {
  const state = ruleState(rule, nowMs);
  const rate = successRate(rule);

  return (
    <tr className="border-b border-border-subtle last:border-0">
      <td className="max-w-[13rem] px-2 py-2.5 pl-0">
        <span className="block truncate text-micro font-semibold text-text-primary">
          {rule.name}
        </span>
        <span className="block truncate text-[0.6rem] text-text-tertiary">
          {rule.categories.map((c) => CATEGORY_DETAIL[c as SyncCategory]?.label ?? c).join(', ')}
        </span>
      </td>
      <td className="px-2 py-2.5">
        <span className="flex items-center gap-1">
          {/* An empty platform list means every linked platform. */}
          {(rule.platforms.length === 0 ? ['facebook', 'instagram'] : rule.platforms).map((p) => (
            <PlatformIcon key={p} slug={p} size={15} />
          ))}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-2.5">
        <span className="block text-micro text-text-primary">
          {FREQUENCY_LABEL[rule.frequency]}
        </span>
        <span className="block text-[0.6rem] text-text-tertiary">{clockLabel(rule.runAt)}</span>
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 text-micro text-text-secondary">
        {whenShort(Date.parse(rule.nextRunAt), nowMs)}
      </td>
      <td className="whitespace-nowrap px-2 py-2.5">
        {rule.lastRunAt ? (
          <>
            <span className="block text-micro text-text-secondary">
              {whenShort(Date.parse(rule.lastRunAt), nowMs)}
            </span>
            <span
              className="block text-[0.6rem] font-medium"
              style={{
                color:
                  rule.lastOutcome === 'failed'
                    ? 'var(--feedback-error)'
                    : 'var(--feedback-success)',
              }}
            >
              {rule.lastOutcome === 'failed' ? 'Failed' : 'Successful'}
            </span>
          </>
        ) : (
          <span className="text-micro text-text-tertiary">Never</span>
        )}
      </td>
      <td className="px-2 py-2.5 text-micro tabular-nums text-text-secondary">
        {/* ⚠️ A DASH, NOT 100%, before it has run — see `successRate`. */}
        {rate === null ? '—' : `${rate.toFixed(1)}%`}
      </td>
      <td className="px-2 py-2.5">
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[0.6rem] font-bold"
          style={{
            backgroundColor: `color-mix(in oklab, var(--${state.token}) 14%, transparent)`,
            color: `var(--${state.token})`,
          }}
          title={state.detail}
        >
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full"
            style={{ backgroundColor: `var(--${state.token})` }}
          />
          {state.label}
        </span>
      </td>
      <td className="px-2 py-2.5 text-right">
        {canManage && (
          <span className="inline-flex gap-1">
            <button
              type="button"
              onClick={async () => {
                const r = await setSyncRuleActiveAction(rule.id, !rule.isActive);
                if (!r.ok) onSay('bad', r.error ?? '');
              }}
              aria-label={rule.isActive ? 'Pause rule' : 'Resume rule'}
              title={rule.isActive ? 'Pause' : 'Resume'}
              className="rounded-md border border-border-subtle p-1.5 text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
            >
              {rule.isActive ? <Pause className="size-3" /> : <Play className="size-3" />}
            </button>
            <button
              type="button"
              onClick={async () => {
                const r = await deleteSyncRuleAction(rule.id);
                if (!r.ok) onSay('bad', r.error ?? '');
              }}
              aria-label="Delete rule"
              className="rounded-md border border-border-subtle p-1.5 transition-colors hover:bg-bg-subtle"
              style={{ color: 'var(--feedback-error)' }}
            >
              <Trash2 className="size-3" />
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

/* ---- The calendar -------------------------------------------------------- */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The reference's week grid.
 *
 * ⚠️ IT DRAWS THE SCHEDULE, NOT THE HISTORY. Every block is a rule's planned
 * time, which is why a rule that has never run still appears — the calendar
 * answers "when will this collect?", and the Activity Log answers "when did it?".
 * Mixing the two into one grid would make a planned block indistinguishable from
 * a completed one.
 */
function SyncCalendar({ rules }: { rules: readonly SyncRule[] }) {
  const entries = React.useMemo(() => weekEntries(rules), [rules]);
  const active = rules.filter((r) => r.isActive);

  /* Six rows of four hours, as the reference labels them. */
  const ROWS = [0, 4, 8, 12, 16, 20];

  return (
    <Panel
      title="Sync calendar"
      info="Each rule's planned run times across a week. Times are shown in each rule's own timezone."
    >
      {active.length === 0 ? (
        <PanelEmpty>No active rules, so nothing is scheduled to draw.</PanelEmpty>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-[38rem]">
              {/* Head */}
              <div className="grid grid-cols-[3.2rem_repeat(7,minmax(0,1fr))] gap-px">
                <span />
                {DAY_LABELS.map((d) => (
                  <span
                    key={d}
                    className="pb-1 text-center text-[0.6rem] font-semibold text-text-secondary"
                  >
                    {d}
                  </span>
                ))}
              </div>

              {/* Rows */}
              {ROWS.map((startHour) => (
                <div
                  key={startHour}
                  className="grid grid-cols-[3.2rem_repeat(7,minmax(0,1fr))] gap-px"
                >
                  <span className="pr-2 pt-1 text-right text-[0.58rem] tabular-nums text-text-tertiary">
                    {clockLabel(`${String(startHour).padStart(2, '0')}:00`)}
                  </span>
                  {DAY_LABELS.map((_, day) => {
                    const inCell = entries.filter(
                      (e) =>
                        e.weekday === day &&
                        e.minutes >= startHour * 60 &&
                        e.minutes < (startHour + 4) * 60,
                    );
                    return (
                      <div
                        key={day}
                        className="min-h-[2.4rem] space-y-px border-b border-l border-border-subtle p-px last:border-r"
                      >
                        {inCell.map((e) => (
                          <span
                            key={`${e.ruleId}-${day}`}
                            title={`${e.name} · ${clockLabel(minutesToClock(e.minutes))}`}
                            className="block truncate rounded px-1 py-0.5 text-[0.54rem] font-semibold leading-tight"
                            style={{
                              backgroundColor: `color-mix(in oklab, var(--${e.token}) 16%, transparent)`,
                              color: `var(--${e.token})`,
                            }}
                          >
                            {e.name}
                          </span>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-border-subtle pt-2">
            {active.map((r, i) => (
              <span key={r.id} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: `var(--chart-${(i % 8) + 1})` }}
                />
                <span className="text-[0.6rem] text-text-secondary">{r.name}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/* ---- Creating a rule ----------------------------------------------------- */

const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

function CreateRule({
  projectId,
  onClose,
  onDone,
}: {
  projectId: string;
  onClose: () => void;
  onDone: (tone: 'ok' | 'bad', text: string) => void;
}) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [platforms, setPlatforms] = React.useState<string[]>(['facebook', 'instagram']);
  const [categories, setCategories] = React.useState<string[]>([...SYNC_CATEGORIES]);
  const [frequency, setFrequency] = React.useState<SyncFrequency>('daily');
  const [runAt, setRunAt] = React.useState('02:00');
  const [weekday, setWeekday] = React.useState(1);
  const [retryMinutes, setRetryMinutes] = React.useState(15);
  const [maxRetries, setMaxRetries] = React.useState(3);
  const [saving, setSaving] = React.useState(false);

  const effective = effectiveFrequency(frequency);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-border-subtle bg-bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-body font-semibold text-text-primary">Create new schedule</h3>
          <p className="mt-0.5 text-caption text-text-secondary">Set up a new sync rule.</p>
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

      <div className="mt-3 space-y-3">
        <Section label="Basic information">
          <Field label="Schedule name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="e.g. Hourly Content Sync"
              className="w-full rounded-lg border border-border-subtle bg-bg-base px-2.5 py-2 text-micro text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
            />
          </Field>
          <Field label="Description (optional)">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              placeholder="What data will this sync?"
              className="w-full rounded-lg border border-border-subtle bg-bg-base px-2.5 py-2 text-micro text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
            />
          </Field>
        </Section>

        <Section label="Platform">
          <div className="flex flex-wrap gap-2">
            {(['facebook', 'instagram'] as const).map((p) => {
              const on = platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => toggle(platforms, setPlatforms, p)}
                  aria-pressed={on}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg border px-2.5 py-2 text-micro font-medium transition-colors',
                    on
                      ? 'border-accent-primary bg-bg-subtle text-text-primary'
                      : 'border-border-subtle text-text-secondary hover:bg-bg-subtle',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-4 place-items-center rounded border',
                      on ? 'border-transparent' : 'border-border-default',
                    )}
                    style={on ? { backgroundColor: 'var(--accent-primary)' } : undefined}
                  >
                    {on && <Check className="size-3 text-accent-foreground" />}
                  </span>
                  <PlatformIcon slug={p} size={15} />
                  {PLATFORM_MARKS[p]?.label ?? p}
                </button>
              );
            })}
          </div>
          {platforms.length === 0 && (
            <p className="mt-1 text-[0.6rem] text-text-tertiary">
              With none selected the rule covers every linked platform.
            </p>
          )}
        </Section>

        <Section label="Data to sync">
          <div className="space-y-1.5">
            {SYNC_CATEGORIES.map((c) => {
              const on = categories.includes(c);
              const d = CATEGORY_DETAIL[c];
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggle(categories, setCategories, c)}
                  aria-pressed={on}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors',
                    on
                      ? 'border-accent-primary bg-bg-subtle'
                      : 'border-border-subtle hover:bg-bg-subtle',
                  )}
                >
                  <span
                    className={cn(
                      'mt-px grid size-4 shrink-0 place-items-center rounded border',
                      on ? 'border-transparent' : 'border-border-default',
                    )}
                    style={on ? { backgroundColor: `var(--${d.token})` } : undefined}
                  >
                    {on && <Check className="size-3 text-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-micro font-semibold text-text-primary">
                      {d.label}
                    </span>
                    <span className="block text-[0.6rem] leading-snug text-text-tertiary">
                      {d.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {/* ⚠️ A rule with no categories collects nothing while reporting
              success — refused by the action and by 099's check constraint. */}
          {categories.length === 0 && (
            <p
              className="mt-1 text-[0.6rem] font-semibold"
              style={{ color: 'var(--feedback-error)' }}
            >
              Choose at least one, or the rule would collect nothing.
            </p>
          )}
        </Section>

        <Section label="Sync configuration">
          <Field label="Frequency">
            <div className="flex flex-wrap gap-1.5">
              {SYNC_FREQUENCIES.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFrequency(f)}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-micro font-semibold transition-colors',
                    frequency === f
                      ? 'text-accent-foreground'
                      : 'border border-border-subtle text-text-secondary hover:bg-bg-subtle',
                  )}
                  style={frequency === f ? { backgroundColor: 'var(--accent-primary)' } : undefined}
                >
                  {FREQUENCY_LABEL[f]}
                </button>
              ))}
            </div>
            {/* ⚠️ SAID AT THE POINT OF CHOOSING. The cron wakes every two hours,
                so "Hourly" delivers two-hourly — better learnt here than from a
                Last Run column a week later. */}
            {!effective.honoured && (
              <p
                className="mt-1.5 text-[0.6rem] leading-snug"
                style={{ color: 'var(--feedback-warning)' }}
              >
                {effective.note}
              </p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Time">
              <input
                type="time"
                value={runAt}
                onChange={(e) => setRunAt(e.target.value)}
                className="w-full rounded-lg border border-border-subtle bg-bg-base px-2.5 py-2 text-micro text-text-primary focus:border-accent-primary focus:outline-none"
              />
            </Field>
            {frequency === 'weekly' ? (
              <Field label="Day">
                <select
                  value={weekday}
                  onChange={(e) => setWeekday(Number(e.target.value))}
                  className="w-full rounded-lg border border-border-subtle bg-bg-base px-2.5 py-2 text-micro text-text-primary focus:border-accent-primary focus:outline-none"
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Timezone">
                {/* ⚠️ ONE ZONE, AND IT IS NOT A DROPDOWN. Every date boundary in
                    this system is Asia/Karachi; offering a choice would let a
                    rule's day disagree with every report's day. */}
                <p className="rounded-lg border border-border-subtle bg-bg-subtle px-2.5 py-2 text-micro text-text-secondary">
                  Asia/Karachi
                </p>
              </Field>
            )}
          </div>
        </Section>

        <Section label="Advanced options">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Retry after">
              <select
                value={retryMinutes}
                onChange={(e) => setRetryMinutes(Number(e.target.value))}
                className="w-full rounded-lg border border-border-subtle bg-bg-base px-2.5 py-2 text-micro text-text-primary focus:border-accent-primary focus:outline-none"
              >
                {[5, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} minutes
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Max attempts">
              <select
                value={maxRetries}
                onChange={(e) => setMaxRetries(Number(e.target.value))}
                className="w-full rounded-lg border border-border-subtle bg-bg-base px-2.5 py-2 text-micro text-text-primary focus:border-accent-primary focus:outline-none"
              >
                {[0, 1, 3, 5, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'attempt' : 'attempts'}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {/* ⚠️ THE RETRY SETTINGS ARE STORED AND NOT YET ACTED ON, and saying so
              is the whole point. The scheduler wakes two-hourly, so a "retry in
              15 minutes" cannot happen without a second job. A failed rule
              retries on its next natural cycle. */}
          <p className="mt-1.5 rounded-lg bg-bg-subtle px-2.5 py-2 text-[0.6rem] leading-snug text-text-tertiary">
            Recorded for a future finer-grained retry. Today a failed rule tries again on its
            next scheduled run — the scheduler only wakes every {CRON_INTERVAL_HOURS} hours.
          </p>
        </Section>

        <Section label="Schedule preview">
          <p className="rounded-lg border border-border-subtle bg-bg-subtle px-2.5 py-2 text-[0.65rem] leading-relaxed text-text-secondary">
            {name.trim() ? <strong className="font-semibold text-text-primary">{name.trim()}</strong> : 'This rule'}{' '}
            will collect{' '}
            {categories.length === SYNC_CATEGORIES.length
              ? 'everything'
              : categories.map((c) => CATEGORY_DETAIL[c as SyncCategory]?.label ?? c).join(' and ')}{' '}
            from{' '}
            {platforms.length === 0 || platforms.length === 2
              ? 'both platforms'
              : (PLATFORM_MARKS[platforms[0]]?.label ?? platforms[0])}
            , {FREQUENCY_LABEL[frequency].toLowerCase()}
            {frequency === 'weekly'
              ? ` on ${WEEKDAYS.find((d) => d.value === weekday)?.label}`
              : ''}{' '}
            at {clockLabel(runAt)} Karachi time.
          </p>
        </Section>
      </div>

      <div className="mt-auto flex gap-2 pt-3">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded-lg border border-border-subtle py-2.5 text-micro font-medium text-text-secondary transition-colors hover:bg-bg-subtle"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || name.trim().length < 2 || categories.length === 0}
          onClick={async () => {
            setSaving(true);
            try {
              const r = await createSyncRuleAction({
                projectId,
                name,
                description,
                platforms,
                categories,
                frequency,
                runAt,
                timezone: 'Asia/Karachi',
                runOnWeekday: frequency === 'weekly' ? weekday : null,
                retryMinutes,
                maxRetries,
              });
              onDone(
                r.ok ? 'ok' : 'bad',
                r.ok
                  ? `${name.trim()} created. The default pull stops for this project.`
                  : (r.error ?? 'Could not create it.'),
              );
            } finally {
              setSaving(false);
            }
          }}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-micro font-semibold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent-primary)' }}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          Create schedule
        </button>
      </div>
    </div>
  );
}

/* ============================================================================
 * THE LOGS
 * ========================================================================= */

function PermissionLog({
  events,
  nowMs,
}: {
  events: readonly PermissionEvent[];
  nowMs: number;
}) {
  return (
    <Panel
      title="Permission log"
      info="Access, credential and role changes across the division, from the audit trail."
    >
      {/* ⚠️ NOT SCOPED TO THE PROJECT, AND IT SAYS SO. Granting a role is not an
          act on a project; filtering these by the selected project would show an
          empty table and imply nothing had happened. */}
      <p className="mb-2 text-[0.62rem] text-text-tertiary">
        Division-wide — these are account-level acts, not per-project ones.
      </p>

      {events.length === 0 ? (
        <PanelEmpty>Nothing recorded yet.</PanelEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-border-default">
                {['Action', 'Who', 'Role', 'Area', 'Outcome', 'When'].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-2 pb-1.5 text-[0.58rem] font-bold uppercase tracking-wide text-text-tertiary first:pl-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-border-subtle last:border-0">
                  <td className="max-w-[14rem] truncate px-2 py-2 pl-0 text-micro font-medium text-text-primary">
                    {e.action}
                  </td>
                  <td className="max-w-[10rem] truncate px-2 py-2 text-micro text-text-secondary">
                    {e.actorName ?? e.actorEmail}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-micro text-text-tertiary">
                    {e.actorRole.replace(/_/g, ' ')}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-micro text-text-tertiary">
                    {e.entityType}
                  </td>
                  <td className="px-2 py-2">
                    <Pill token={e.outcome === 'success' ? 'feedback-success' : 'feedback-error'}>
                      {e.outcome}
                    </Pill>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-micro text-text-tertiary">
                    {whenShort(Date.parse(e.createdAt), nowMs)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ActivityLog({ runs, nowMs }: { runs: readonly SyncRun[]; nowMs: number }) {
  return (
    <Panel
      title="Activity log"
      info="Every sync run for this project's accounts, with what each one wrote."
    >
      {runs.length === 0 ? (
        <PanelEmpty>No sync has run for this project yet.</PanelEmpty>
      ) : (
        <ul className="space-y-1.5">
          {runs.map((r) => {
            const ok = r.outcome === 'ok';
            const token = ok ? 'feedback-success' : 'feedback-error';
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border-subtle px-3 py-2"
              >
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-lg"
                  style={{
                    backgroundColor: `color-mix(in oklab, var(--${token}) 14%, transparent)`,
                  }}
                >
                  {ok ? (
                    <CheckCircle2 className="size-4" style={{ color: `var(--${token})` }} />
                  ) : (
                    <AlertTriangle className="size-4" style={{ color: `var(--${token})` }} />
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <PlatformIcon slug={r.platform} size={13} />
                    <span className="truncate text-micro font-semibold text-text-primary">
                      {r.accountName}
                    </span>
                  </span>
                  <span className="block text-[0.62rem] text-text-tertiary">
                    {/* ⚠️ "0 days, 0 posts" IS A REAL AND USEFUL OUTCOME — a run
                        that succeeded and found nothing new. It is not the same
                        as a failure, and collapsing the two would hide a sync
                        that is running but collecting nothing. */}
                    {ok
                      ? `${r.daysWritten} metric ${r.daysWritten === 1 ? 'day' : 'days'}, ${r.postsWritten} ${r.postsWritten === 1 ? 'post' : 'posts'}`
                      : (r.error ?? 'Failed')}
                  </span>
                </span>

                <span className="shrink-0 whitespace-nowrap text-[0.62rem] text-text-tertiary">
                  {whenShort(Date.parse(r.startedAt), nowMs)}
                  {r.finishedAt && (
                    <span className="ml-1.5 opacity-70">
                      {Math.max(
                        1,
                        Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000),
                      )}
                      s
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/**
 * ⚠️ AN EMPTY STATE, AND IT IS THE HONEST ONE. Nothing in this system receives a
 * Meta webhook: there is no endpoint, no verify token and no subscription. The
 * reference has the tab, so the tab exists and says exactly what it would take —
 * rather than drawing a table of webhooks that do not exist.
 */
function WebhooksTab() {
  return (
    <Panel title="Webhooks">
      <div className="grid place-items-center rounded-lg border border-dashed border-border-subtle px-4 py-10 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-bg-subtle">
          <Webhook className="size-5 text-text-secondary" aria-hidden="true" />
        </span>
        <p className="mt-2.5 text-body-sm font-semibold text-text-primary">
          No webhooks are configured
        </p>
        <p className="mx-auto mt-1 max-w-lg text-caption leading-relaxed text-text-secondary">
          Taskly currently <strong className="font-semibold text-text-primary">pulls</strong> from
          Meta every {CRON_INTERVAL_HOURS} hours rather than being pushed to. Webhooks would make
          a new post appear within seconds instead — they need a public endpoint, a verify token
          and a subscription on the Meta app, none of which exist yet.
        </p>
        <p className="mt-2 text-[0.62rem] text-text-tertiary">
          Nothing is lost without them: pulling collects the same figures, just later.
        </p>
      </div>
    </Panel>
  );
}

/* ---- Small parts --------------------------------------------------------- */

function Card({
  icon: Icon,
  title,
  token,
  className,
  children,
}: {
  icon: typeof RefreshCw;
  title: string;
  token: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <section
      ref={ref}
      className={cn(
        'studio-reveal rounded-xl border border-border-subtle bg-bg-surface p-4',
        'motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
        className,
      )}
    >
      <h3 className="mb-3 flex items-center gap-2 text-body-sm font-semibold text-text-primary">
        <Icon className="size-4" style={{ color: `var(--${token})` }} aria-hidden="true" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Setting({
  label,
  info,
  last,
  children,
}: {
  label: string;
  info: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 py-2.5',
        last ? '' : 'border-b border-border-subtle',
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-caption text-text-secondary">
        {label}
        <span
          title={info}
          aria-label={info}
          className="grid size-3.5 shrink-0 cursor-help place-items-center rounded-full border border-border-default text-[0.55rem] font-bold text-text-tertiary"
        >
          i
        </span>
      </span>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-[8rem] rounded-lg border border-border-subtle bg-bg-surface px-2.5 py-1.5 text-micro font-medium text-text-primary transition-colors hover:border-border-default focus:border-accent-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The auto-sync switch.
 *
 * ── ⚠️ THE KNOB IS POSITIONED WITH `left`, NEVER WITH A BARE `translate-x` ──
 * The first version set `absolute top-0.5` with no `left` and moved the knob
 * with `translate-x-[1.4rem]`. An absolutely positioned box with `left: auto`
 * and `right: auto` falls back to its STATIC position — and a `<button>` is
 * `text-align: center` by default, so the static position of that empty inline
 * box is the MIDDLE of the track. Adding 22px of translate to a 22px starting
 * offset put the knob at 44px in a 44px track: entirely off the right edge,
 * which rendered as a solid green pill with no knob at all. It is the kind of
 * bug that looks like a colour problem and is really a layout one.
 *
 * `left-0.5` / `left-[1.375rem]` positions it explicitly from the track's own
 * left edge, so it cannot depend on text alignment, direction, or what else is
 * inside the button.
 */
function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="text-micro font-semibold"
        style={{ color: checked ? 'var(--feedback-success)' : 'var(--text-tertiary)' }}
      >
        {checked ? 'Enabled' : 'Paused'}
      </span>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'border-transparent' : 'border-border-default bg-bg-subtle',
        )}
        style={checked ? { backgroundColor: 'var(--feedback-success)' } : undefined}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1/2 size-5 -translate-y-1/2 rounded-full bg-white transition-[left] duration-200',
            'shadow-[0_1px_3px_rgb(6_35_42_/_0.28)]',
            /* ⚠️ 20px AND 2px, WHICH IS SYMMETRIC AND NOT OBVIOUS. The track is
               44px with a 1px border on both states (transparent when on), so
               absolute positioning resolves against a 42px padding box. A 20px
               knob at left:2 leaves 20px to its right; at left:20 it leaves 2px.
               The intuitive 22px would have pressed it flat against the edge. */
            checked ? 'left-5' : 'left-0.5',
          )}
        />
      </button>
    </div>
  );
}

function Pill({ token, children }: { token: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[0.6rem] font-bold"
      style={{
        backgroundColor: `color-mix(in oklab, var(--${token}) 14%, transparent)`,
        color: `var(--${token})`,
      }}
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full"
        style={{ backgroundColor: `var(--${token})` }}
      />
      {children}
    </span>
  );
}

function ActionRow({
  icon: Icon,
  label,
  onClick,
  href,
  disabled,
  busy,
}: {
  icon: typeof RefreshCw;
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  const inner = (
    <>
      {busy ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-text-secondary" />
      ) : (
        <Icon className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-micro text-text-primary">{label}</span>
      {href ? (
        <ExternalLink className="size-3 shrink-0 text-text-tertiary" aria-hidden="true" />
      ) : (
        <ChevronRight className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
      )}
    </>
  );

  const cls =
    'flex w-full items-center gap-2.5 rounded-lg border border-border-subtle px-2.5 py-2 transition-colors hover:bg-bg-subtle disabled:cursor-not-allowed disabled:opacity-50';

  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {inner}
    </button>
  );
}

function SchedulerKpi({
  index,
  label,
  value,
  footnote,
  icon: Icon,
  token,
  small,
}: {
  index: number;
  label: string;
  value: string;
  footnote: string;
  icon: typeof Gauge;
  token: string;
  small?: boolean;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={cn(
        'studio-reveal rounded-xl border border-border-subtle bg-bg-surface p-3.5 transition-all duration-300 hover:-translate-y-px hover:shadow-[0_6px_18px_rgb(6_35_42_/_0.08)]',
        'motion-safe:animate-[studio-rise_560ms_cubic-bezier(0.16,1,0.3,1)_backwards]',
        inView && 'is-visible',
      )}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[0.65rem] font-medium leading-tight text-text-secondary">
          {label}
        </p>
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg"
          style={{ backgroundColor: `color-mix(in oklab, var(--${token}) 14%, transparent)` }}
        >
          <Icon className="size-3.5" style={{ color: `var(--${token})` }} aria-hidden="true" />
        </span>
      </div>
      <p
        className={cn(
          'mt-1.5 font-bold leading-none text-text-primary',
          small ? 'text-body' : 'text-h2 tabular-nums',
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 truncate text-[0.6rem] text-text-tertiary">{footnote}</p>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[0.62rem] font-bold uppercase tracking-wide text-text-tertiary">
        {label}
      </h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.6rem] font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

/* ---- Helpers ------------------------------------------------------------- */

/** "Today, 2:00 PM" / "in 3h" / "2d ago" — the reference's phrasing. */
function whenShort(atMs: number, nowMs: number): string {
  const diff = atMs - nowMs;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);

  if (minutes < 2) return 'Just now';
  if (minutes < 60) return diff > 0 ? `in ${minutes}m` : `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return diff > 0 ? `in ${hours}h` : `${hours}h ago`;

  const days = Math.round(hours / 24);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
}
