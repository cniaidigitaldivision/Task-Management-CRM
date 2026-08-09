'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, Link2, ListTree, Trash2 } from 'lucide-react';

import { describeImpactAction } from '@/app/actions/tasks';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { STATUS_META } from '@/lib/domain/constants';
import type { TaskImpact } from '@/lib/db/queries/tasks';

/* ============================================================================
 * "WHAT WILL THIS ACTUALLY BREAK?"
 * ----------------------------------------------------------------------------
 * Owner instruction, Session 20: *"if I'm deleting, it should tell me a
 * confirmation message before deletion — that these things will be affected by
 * this deletion, and what the dependencies will be, and how I would have to
 * rearrange them."*
 *
 * Three actions share this dialog, because the question is the same for all
 * three and only the consequence differs:
 *
 *   cancel  reversible. The task stays on the board, in Cancelled, with its
 *           reason. Everything attached to it survives.
 *   delete  FR-095's soft delete. Hidden, recoverable for 30 days.
 *   purge   permanent. Super Admin only, and it asks for the reference to be
 *           typed before it will proceed.
 *
 * ── WHY THE IMPACT IS FETCHED WHEN THE DIALOG OPENS, NOT BEFORE ──────────────
 * It is a database round trip and the answer is only interesting once somebody
 * has actually asked to remove something. Loading it for every selection would
 * mean querying on every checkbox click, for a dialog most of those clicks
 * never open.
 *
 * ── THE DANGEROUS PART IS THE `blocks` LIST ──────────────────────────────────
 * Counts of comments and attachments are reassurance — they are kept, and
 * saying so stops people hesitating. The list of tasks WAITING on this one is
 * the opposite: those become startable early, and somebody's plan changes. That
 * is why it is the only part rendered with a warning colour and the only part
 * never collapsed.
 * ========================================================================= */

export type ImpactMode = 'cancel' | 'delete' | 'purge';

const COPY: Record<
  ImpactMode,
  { verb: string; button: string; variant: 'primary' | 'danger'; consequence: string }
> = {
  cancel: {
    verb: 'Cancel',
    button: 'Cancel the work',
    variant: 'primary',
    consequence:
      'The task stays on the board in Cancelled with your reason attached. Comments, attachments, checklists and logged time are all kept, and it still appears in reports. This can be undone by moving it back.',
  },
  delete: {
    verb: 'Delete',
    button: 'Delete',
    variant: 'danger',
    consequence:
      'Hidden everywhere and recoverable for 30 days (FR-095). Nothing attached to it is destroyed during that window.',
  },
  purge: {
    verb: 'Purge',
    button: 'Purge permanently',
    variant: 'danger',
    consequence:
      'Gone for good, immediately. Comments, attachments, checklists, logged time, subtasks and every dependency link are destroyed with it. There is no undo and no recovery window — use Delete unless this must not exist.',
  },
};

export function ImpactDialog({
  open,
  mode,
  taskIds,
  onClose,
  onConfirm,
  busy = false,
}: {
  open: boolean;
  mode: ImpactMode;
  taskIds: readonly string[];
  onClose: () => void;
  /** `reason` is only supplied for cancel, which requires one (FR-043). */
  onConfirm: (reason: string) => void;
  busy?: boolean;
}) {
  const [impact, setImpact] = React.useState<readonly TaskImpact[] | null>(null);
  const [reason, setReason] = React.useState('');
  const [typed, setTyped] = React.useState('');

  const key = taskIds.join(',');

  /* `loading` is DERIVED from which selection the payload belongs to, not held
     as its own flag. Setting a flag in the effect body is the cascading render
     `react-hooks/set-state-in-effect` exists to stop — and deriving it also
     removes the possibility of the flag and the data disagreeing, which is the
     same reasoning as task-detail.tsx. */
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  const loading = open && loadedFor !== key;

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    describeImpactAction([...taskIds])
      .then((rows) => {
        if (cancelled) return;
        setImpact(rows);
        setLoadedFor(key);
      })
      .catch(() => {
        /* The dialog still works without the detail — it just cannot show what
           would be disturbed, and says so rather than silently claiming there
           is nothing. */
        if (cancelled) return;
        setImpact([]);
        setLoadedFor(key);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  /* Clearing on close is a state ADJUSTMENT, not a synchronisation, so it
     happens during render rather than in an effect — in an effect it would
     paint the previous reason once more on the way out. */
  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setReason('');
      setTyped('');
    }
  }

  const copy = COPY[mode];
  const count = taskIds.length;
  const blocked = (impact ?? []).flatMap((row) => row.blocks);

  /* Purge asks for the reference to be typed. Not theatre: it is the only
     action here with no way back, and a confirm button alone is one misplaced
     click. Only for a single task — nobody types twenty references, and a bulk
     purge is deliberately awkward. */
  const purgeGuard = mode === 'purge' && count === 1 ? (impact?.[0]?.reference ?? '') : null;
  const guardSatisfied = purgeGuard === null || typed.trim().toUpperCase() === purgeGuard;
  const reasonNeeded = mode === 'cancel';
  const canProceed =
    !busy && !loading && guardSatisfied && (!reasonNeeded || reason.trim().length > 0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={`${copy.verb} ${count} ${count === 1 ? 'task' : 'tasks'}?`}
      description={copy.consequence}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            Keep them
          </Button>
          <Button
            variant={copy.variant}
            size="md"
            disabled={!canProceed}
            onClick={() => onConfirm(reason.trim())}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            )}
            {busy ? 'Working…' : copy.button}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {loading && (
          <p className="flex items-center gap-2 text-caption text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Checking what depends on {count === 1 ? 'it' : 'them'}…
          </p>
        )}

        {/* ---- The part that actually changes somebody's plan ---- */}
        {!loading && blocked.length > 0 && (
          <div
            className="rounded-lg px-3 py-2.5"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-warning) var(--tint-soft), var(--bg-surface))',
              border: '1px solid color-mix(in oklab, var(--feedback-warning) 34%, transparent)',
            }}
          >
            <p className="flex items-start gap-2 text-caption font-semibold text-text-primary">
              <AlertTriangle
                className="mt-px h-4 w-4 shrink-0"
                style={{ color: 'var(--feedback-warning)' }}
                strokeWidth={2}
                aria-hidden="true"
              />
              {blocked.length} {blocked.length === 1 ? 'task is' : 'tasks are'} waiting on{' '}
              {count === 1 ? 'this' : 'these'}
            </p>
            <p className="mt-1 text-micro text-text-secondary">
              {mode === 'cancel'
                ? 'They become startable as soon as this is cancelled — the thing holding them up will be gone. Check whether that is what you want before the work begins early.'
                : 'The blocked-by links pointing at these tasks are removed, so this work becomes startable. Re-plan it if that is not the intention.'}
            </p>
            <ul className="mt-2 space-y-1">
              {blocked.map((item) => (
                <li key={item.reference} className="flex items-start gap-2 text-micro">
                  <Link2
                    className="mt-0.5 h-3 w-3 shrink-0 text-text-tertiary"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <span className="tabular font-semibold text-text-brand">{item.reference}</span>
                  <span className="min-w-0 flex-1 truncate text-text-secondary">{item.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ---- Per task ---- */}
        {!loading && impact && impact.length > 0 && (
          <ul className="space-y-2.5">
            {impact.map((row) => {
              const kept: string[] = [];
              if (row.commentCount > 0) kept.push(`${row.commentCount} comment${row.commentCount === 1 ? '' : 's'}`);
              if (row.attachmentCount > 0) kept.push(`${row.attachmentCount} attachment${row.attachmentCount === 1 ? '' : 's'}`);
              if (row.checklistCount > 0) kept.push(`${row.checklistCount} checklist item${row.checklistCount === 1 ? '' : 's'}`);
              if (row.minutesLogged > 0) {
                const hours = Math.floor(row.minutesLogged / 60);
                const mins = row.minutesLogged % 60;
                kept.push(`${hours > 0 ? `${hours}h ` : ''}${mins}m logged`);
              }

              return (
                <li
                  key={row.taskId}
                  className="rounded-lg border border-border-subtle bg-bg-surface-sunken px-3 py-2.5"
                >
                  <p className="flex items-baseline gap-2">
                    <span className="tabular text-micro font-semibold text-text-brand">
                      {row.reference}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-caption text-text-primary">
                      {row.title}
                    </span>
                    <span className="shrink-0 text-micro text-text-tertiary">
                      {STATUS_META[row.status].label}
                    </span>
                  </p>

                  {row.subtaskCount > 0 && (
                    <p className="mt-1 flex items-center gap-1.5 text-micro font-medium text-text-primary">
                      <ListTree className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
                      {row.subtaskCount} subtask{row.subtaskCount === 1 ? '' : 's'} —{' '}
                      {mode === 'purge'
                        ? 'destroyed with it'
                        : mode === 'delete'
                          ? 'hidden with it'
                          : 'not cancelled automatically; deal with them separately'}
                    </p>
                  )}

                  {kept.length > 0 && (
                    <p className="mt-0.5 text-micro text-text-tertiary">
                      {kept.join(' · ')} — {mode === 'purge' ? 'destroyed' : 'kept'}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {!loading && impact && impact.length === 0 && (
          <p className="text-caption text-text-secondary">
            Could not read the detail for {count === 1 ? 'this task' : 'these tasks'}. The action
            will still run, but check afterwards what it affected.
          </p>
        )}

        {/* ---- Reason (FR-043) ---- */}
        {reasonNeeded && (
          <Field
            label="Why is it being cancelled?"
            htmlFor="impact-reason"
            hint="Required. Cancelled work stays on the record, and a cancellation with no reason is a gap somebody has to chase later."
          >
            <Textarea
              id="impact-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Client pulled the campaign — nothing to deliver."
            />
          </Field>
        )}

        {/* ---- Purge guard ---- */}
        {purgeGuard && (
          <Field
            label={`Type ${purgeGuard} to confirm`}
            htmlFor="impact-guard"
            hint="This one cannot be undone, so it asks you to name what you are destroying."
          >
            <input
              id="impact-guard"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="w-full rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 font-mono text-caption text-text-primary outline-none focus:border-border-brand"
            />
          </Field>
        )}

        {mode === 'purge' && count > 1 && (
          <p
            className="rounded-lg px-3 py-2 text-micro font-medium"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
              color: 'color-mix(in oklab, var(--feedback-error) 74%, var(--text-primary))',
            }}
          >
            {count} tasks will be destroyed permanently, along with everything attached to them.
          </p>
        )}
      </div>
    </Dialog>
  );
}
