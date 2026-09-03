'use client';

import * as React from 'react';
import { AlertTriangle, Ban, Bell, CheckCheck, Flame, Loader2, Trash2, X } from 'lucide-react';

import {
  bulkAssignAction,
  bulkChangeStatusAction,
  bulkDeleteAction,
  bulkWatchAction,
  type BulkResult,
} from '@/app/actions/task-relations';
import { purgeTasksAction } from '@/app/actions/tasks';
import { StepUpDialog } from '@/components/security/step-up-dialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { STATUS_META, TASK_STATUSES, type TaskStatus } from '@/lib/domain/constants';

import { useToast } from '@/components/ui/toast';

import { ImpactDialog, type ImpactMode } from './impact-dialog';

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
  canPurge = false,
}: {
  selectedIds: readonly string[];
  onClear: () => void;
  /** Refresh the list once the writes have landed. */
  onDone: () => void;
  people: readonly { id: string; name: string }[];
  /** Super Admin only. The server checks it again — this only hides a control
   *  that would always be refused, which is convenience, never security. */
  canPurge?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();
  const [result, setResult] = React.useState<BulkResult | null>(null);
  const [status, setStatus] = React.useState<TaskStatus | ''>('');
  const [assignee, setAssignee] = React.useState('');
  const [confirming, setConfirming] = React.useState<ImpactMode | null>(null);
  const [stepUpOpen, setStepUpOpen] = React.useState(false);

  const run = async (fn: () => Promise<BulkResult>) => {
    setBusy(true);
    setResult(null);
    const outcome = await fn();
    setResult(outcome);
    setBusy(false);

    /* ── ⚠️ THE HEADLINE GOES TO THE CORNER, THE DETAIL STAYS HERE ──────────
       Owner, 2026-09-03, wanted assignment and reassignment to announce
       themselves like everything else now does. This is the one place the
       inline panel was NOT retired with it: a bulk action can be refused for
       several different reasons at once, and the list below names each. A
       notice can carry the sentence but not the list.

       So the corner gets "4 assigned, 1 refused" and the panel keeps WHY. */
    toast({
      tone: outcome.failed > 0 ? 'warn' : outcome.ok ? 'ok' : 'error',
      text: outcome.note ?? outcome.error ?? 'Nothing changed.',
    });

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

        <span aria-hidden="true" className="h-5 w-px bg-border-subtle" />

        {/* ── CANCEL, AND WHY "CLEAR" WAS NOT REPURPOSED ────────────────────
            The owner asked for *"the clear button's functionality of deleting
            the selected task"*. Clear stays Clear. A control that means
            "deselect" today and "destroy" tomorrow is how work gets lost by
            muscle memory, and the two are one pixel apart on the same bar.

            Cancel is reversible and keeps everything attached to the task,
            which is what "remove this from my board" almost always means.
            Purge — permanent — is Super Admin only and sits behind the same
            dialog plus a typed confirmation. */}
        <Button
          variant="secondary"
          size="md"
          disabled={busy}
          onClick={() => setConfirming('cancel')}
        >
          <Ban className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Cancel work
        </Button>

        {/* ── ⚠️ DELETE AND PURGE ARE BOTH HERE, AND ARE NOT THE SAME THING ──
            Owner, 2026-08-23: *"there should also be a delete button where I can
            delete multiple tasks at once. Now we can move multiple tasks or I
            can change the status. In the same way I want to delete."*

            The bar could already move, assign, follow, cancel and PURGE — but
            purge is permanent, Super Admin only and behind a typed confirmation,
            so for everybody else the bar had no delete at all while the
            single-task menu did. Selecting six tasks and then deleting them one
            at a time from six menus is the gap this closes.

            They keep separate names on purpose. "Delete" is the reversible one
            every role already knows from the task menu — the row stays and
            reports keep working. "Purge" destroys. Two buttons a pixel apart
            called the same word is how the wrong one gets pressed. */}
        <Button
          variant="danger"
          size="md"
          disabled={busy}
          onClick={() => setConfirming('delete')}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Delete
        </Button>

        {canPurge && (
          <Button variant="danger" size="md" disabled={busy} onClick={() => setConfirming('purge')}>
            <Flame className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Purge
          </Button>
        )}

        <Button variant="ghost" size="md" disabled={busy} onClick={onClear}>
          <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Clear
        </Button>

        {busy && (
          <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" aria-hidden="true" />
        )}
      </div>

      <ImpactDialog
        open={confirming !== null}
        mode={confirming ?? 'cancel'}
        taskIds={selectedIds}
        busy={busy}
        onClose={() => setConfirming(null)}
        onConfirm={(reason) => {
          const mode = confirming;
          setConfirming(null);
          if (mode === 'cancel') {
            void run(() => bulkChangeStatusAction(selectedIds, 'cancelled', reason));
          } else if (mode === 'delete') {
            void run(async () => {
              const outcome = await bulkDeleteAction(selectedIds);
              /* A deleted task is off the board, so leaving it selected would
                 leave the bar acting on rows that are no longer there. */
              if (outcome.succeeded > 0) onClear();
              return outcome;
            });
          } else if (mode === 'purge') {
            void run(async () => {
              const outcome = await purgeTasksAction([...selectedIds]);
              if (outcome.stepUpRequired) {
                setStepUpOpen(true);
                return { ok: false, succeeded: 0, failed: 0, refusals: [], error: outcome.error };
              }
              /* Purged tasks cannot stay selected — they no longer exist. */
              if (outcome.ok) onClear();
              return {
                ok: outcome.ok,
                succeeded: outcome.ok ? selectedIds.length : 0,
                failed: outcome.ok ? 0 : selectedIds.length,
                refusals: outcome.error ? [outcome.error] : [],
                error: outcome.error,
                note: outcome.ok
                  ? `${selectedIds.length} destroyed permanently.`
                  : undefined,
              };
            });
          }
        }}
      />

      <StepUpDialog
        open={stepUpOpen}
        actionLabel="Destroying tasks permanently"
        onClose={() => setStepUpOpen(false)}
        onConfirmed={() => {
          setStepUpOpen(false);
          setConfirming('purge');
        }}
      />

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
