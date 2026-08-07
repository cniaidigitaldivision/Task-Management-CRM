'use client';

import * as React from 'react';
import { AlertTriangle, Bell, CheckCheck, Loader2, X } from 'lucide-react';

import {
  bulkAssignAction,
  bulkChangeStatusAction,
  bulkWatchAction,
  type BulkResult,
} from '@/app/actions/task-relations';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { STATUS_META, TASK_STATUSES, type TaskStatus } from '@/lib/domain/constants';

/* ============================================================================
 * BULK ACTIONS
 * ----------------------------------------------------------------------------
 * ── PARTIAL SUCCESS IS REPORTED, NOT HIDDEN ──────────────────────────────────
 * Selecting eight tasks and moving them to In Review will legitimately move
 * some and refuse others — BR-002 stops anybody approving their own work, so
 * the ones assigned to the person doing the selecting are refused, and that is
 * the rule working. The bar reports "6 moved, 2 refused" with the reasons, and
 * keeps the selection so they can see which.
 *
 * The alternative most tools choose — one error toast, everything rolled back —
 * throws away six legitimate changes to report two expected refusals.
 *
 * ── IT APPEARS ONLY WHEN SOMETHING IS SELECTED ───────────────────────────────
 * A permanently docked toolbar with everything greyed out takes up the same
 * space whether it is usable or not.
 * ========================================================================= */

export function BulkBar({
  selectedIds,
  onClear,
  onDone,
  people,
}: {
  selectedIds: readonly string[];
  onClear: () => void;
  /** Refresh the list once the writes have landed. */
  onDone: () => void;
  people: readonly { id: string; name: string }[];
}) {
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<BulkResult | null>(null);
  const [status, setStatus] = React.useState<TaskStatus | ''>('');
  const [assignee, setAssignee] = React.useState('');

  const run = async (fn: () => Promise<BulkResult>) => {
    setBusy(true);
    setResult(null);
    const outcome = await fn();
    setResult(outcome);
    setBusy(false);
    onDone();
  };

  if (selectedIds.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky bottom-4 z-30 mx-auto w-fit max-w-full"
    >
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-strong bg-bg-surface px-3 py-2.5 shadow-lg">
        <span className="tabular shrink-0 text-caption font-semibold text-text-primary">
          {selectedIds.length} selected
        </span>

        <span aria-hidden="true" className="h-5 w-px bg-border-subtle" />

        <Select
          size="md"
          value={status}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value as TaskStatus | '';
            setStatus(next);
            if (next) void run(() => bulkChangeStatusAction(selectedIds, next));
          }}
          className="w-44"
        >
          <option value="">Move to…</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </Select>

        <Select
          size="md"
          value={assignee}
          disabled={busy}
          onChange={(event) => {
            const next = event.target.value;
            setAssignee(next);
            if (next) void run(() => bulkAssignAction(selectedIds, next));
          }}
          className="w-44"
        >
          <option value="">Assign to…</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>

        <Button
          variant="secondary"
          size="md"
          disabled={busy}
          onClick={() => void run(() => bulkWatchAction(selectedIds, true))}
        >
          <Bell className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Follow
        </Button>

        <Button variant="ghost" size="md" disabled={busy} onClick={onClear}>
          <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Clear
        </Button>

        {busy && (
          <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" aria-hidden="true" />
        )}
      </div>

      {result && (
        <div
          role="status"
          className="mt-2 space-y-1 rounded-xl border px-3 py-2.5 shadow-md"
          style={
            result.failed === 0
              ? {
                  borderColor: 'color-mix(in oklab, var(--feedback-success) 35%, transparent)',
                  backgroundColor:
                    'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
                }
              : {
                  borderColor: 'color-mix(in oklab, var(--feedback-warning) 35%, transparent)',
                  backgroundColor:
                    'color-mix(in oklab, var(--feedback-warning) var(--tint-soft), var(--bg-surface))',
                }
          }
        >
          <p className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
            {result.failed === 0 ? (
              <CheckCheck
                className="h-3.5 w-3.5"
                style={{ color: 'var(--feedback-success)' }}
                strokeWidth={2}
                aria-hidden="true"
              />
            ) : (
              <AlertTriangle
                className="h-3.5 w-3.5"
                style={{ color: 'var(--feedback-warning)' }}
                strokeWidth={2}
                aria-hidden="true"
              />
            )}
            {result.note ?? result.error}
          </p>
          {/* The reasons, deduplicated — twelve identical refusals is one fact. */}
          {result.refusals.map((reason) => (
            <p key={reason} className="text-micro text-text-secondary">
              · {reason}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
