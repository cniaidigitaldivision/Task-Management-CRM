'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, ShieldOff } from 'lucide-react';

import { assistantUsageAction, type UsageReport } from '@/app/actions/assistant';
import { AccessPanel, type AccessPerson } from '@/components/assistant/access-panel';
import { PersonActivity, type ActivityPerson } from '@/components/assistant/person-activity';
import { UsagePanel } from '@/components/assistant/usage-panel';
import { Select } from '@/components/ui/select';
import type { AssistantAccessRow } from '@/lib/domain/assistant-access';

/* ============================================================================
 * ASSISTANT ACTIVITY — the screen behind the corner button
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"make a button on the top right of this page where I can
 * see who is asking, the spend, our views, and all these types of things [...]
 * when I click on someone's specific chat or something like activity, I can see
 * more and every detail."*
 *
 * ── ⚠️ WHY THIS IS ONE CLIENT COMPONENT AND NOT THREE ──────────────────────
 * Because both panels open the SAME drill-down. Two panels each owning their
 * own drawer means two drawers can be open at once — briefly, on a fast double
 * click, which is exactly when somebody is comparing two people. Hoisting the
 * selection here makes that unrepresentable, and it costs one prop.
 *
 * ── ⚠️ THE PERIOD IS REFETCHED, NOT FILTERED IN THE BROWSER ────────────────
 * The obvious shortcut is to load a long window once and slice it here. It
 * cannot be done: the spend figures come from `app.assistant_spend`, which
 * aggregates in the DATABASE across rows this browser is never allowed to hold.
 * There is no per-message data here to re-total, which is the point of that
 * design rather than a limitation of it.
 * ========================================================================= */

export interface Period {
  readonly value: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

export function ActivityWorkspace({
  report,
  periods,
  initialPeriod,
  people,
  overrides,
  currentUserId,
  canManageAccess,
  mayAsk,
}: {
  report: UsageReport;
  periods: readonly Period[];
  initialPeriod: string;
  people: readonly AccessPerson[];
  overrides: readonly AssistantAccessRow[];
  currentUserId: string;
  canManageAccess: boolean;
  /** False for an administrator who has been switched off by name — they may
   *  manage the feature but not use it. See `app/(app)/assistant/layout.tsx`. */
  mayAsk: boolean;
}) {
  const [period, setPeriod] = React.useState(initialPeriod);
  const [data, setData] = React.useState<UsageReport>(report);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [inspecting, setInspecting] = React.useState<ActivityPerson | null>(null);

  const current = periods.find((p) => p.value === period) ?? periods[0];

  const choose = async (value: string) => {
    const next = periods.find((p) => p.value === value);
    if (!next) return;

    setPeriod(value);
    setLoading(true);
    setError(null);

    const result = await assistantUsageAction(next.from, next.to);
    setLoading(false);

    /* ⚠️ `'ok' in result` and nothing else. The failure shape is the only
       member of the union that carries `ok`, so the `in` narrows on its own;
       adding `=== false` turns the line into an ordinary boolean and the
       success branch is left holding the union, which then needs a cast to
       compile — a cast that would silently pass an error object to the panels. */
    if ('ok' in result) {
      setError(result.error);
      return;
    }
    setData(result);
  };

  /* ⚠️ The counts the roster shows come from the SAME period as the panels
     beside it. Recomputed on every change rather than fetched separately, so
     the table can never sit at last month's numbers while the cards move. */
  const asksByPerson = React.useMemo(() => {
    const map: Record<string, number> = {};
    for (const line of data.asks) map[line.userId] = line.asks;
    return map;
  }, [data.asks]);

  return (
    <div className="space-y-5 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* ⚠️ Not offered to somebody who cannot use the chat. `/assistant`
            would send them straight back here, and a link that returns you to
            the page you clicked it on reads as a broken screen rather than as a
            permission. The banner below says what is actually going on. */}
        {mayAsk ? (
          <Link
            href="/assistant"
            className="inline-flex items-center gap-1.5 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to the assistant
          </Link>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-2">
          {loading && (
            <Loader2
              className="h-4 w-4 animate-spin text-text-tertiary"
              aria-label="Loading"
            />
          )}
          <Select
            label="Period"
            size="sm"
            value={period}
            onChange={(event) => void choose(event.target.value)}
            options={periods.map((p) => ({ value: p.value, label: p.label }))}
          />
        </div>
      </div>

      {error !== null && (
        <p role="alert" className="text-caption" style={{ color: 'var(--feedback-error)' }}>
          {error}
        </p>
      )}

      {/* ⚠️ Says which of two things happened, because they feel identical from
          here: you have not been given the assistant, or somebody took it away.
          Either way the roster below is still yours to change — including the
          row with your own name on it, which is the whole reason this screen
          stays reachable when the chat does not. */}
      {!mayAsk && (
        <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface-sunken px-3.5 py-2.5 text-caption text-text-secondary">
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <span>
            The assistant is switched off for your account, so the chat is not open to you.
            You can still see what it is being used for
            {canManageAccess ? ', and change who may use it — including yourself.' : '.'}
          </span>
        </p>
      )}

      <UsagePanel
        asks={data.asks}
        spend={data.spend}
        mine={data.mine}
        questions={data.questions}
        rangeLabel={current.label}
        onInspect={setInspecting}
      />

      {/* ⚠️ Rendered only for somebody who may actually change it. `view_usage`
          and `manage_access` are separate permissions and this is the half that
          writes — a read-only visitor gets the panels above and no switches,
          rather than switches that fail. */}
      {canManageAccess && (
        <AccessPanel
          people={people}
          overrides={overrides}
          currentUserId={currentUserId}
          asksByPerson={asksByPerson}
          rangeLabel={current.label.toLowerCase()}
          onInspect={setInspecting}
        />
      )}

      <PersonActivity person={inspecting} onClose={() => setInspecting(null)} />
    </div>
  );
}
