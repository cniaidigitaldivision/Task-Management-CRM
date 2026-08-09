'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  KeyRound,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Send,
  ShieldAlert,
  UserMinus,
  UserPlus,
} from 'lucide-react';

import {
  changeRoleAction,
  forceResetAction,
  resendInvitationAction,
  setActiveAction,
  type TeamActionResult,
} from '@/app/actions/team';
import { Button, IconButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import type { PersonRow } from '@/lib/db/queries/types';
import { ROLE_LABEL, type Role } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

/* ============================================================================
 * PER-PERSON ACTIONS
 * ----------------------------------------------------------------------------
 * Deactivate, restore, change role, force a password reset, re-send an
 * invitation. Every one of them can be refused, and the refusal is shown —
 * "an Admin cannot appoint another Admin" is a designed rule (FR-141), so the
 * interface has to be able to say it rather than greying a control out.
 *
 * ── THE SUPER ADMIN ROW OFFERS NOTHING, AND EXPLAINS WHY ─────────────────────
 * Not because the menu is hidden — the database trigger refuses any foreign
 * write to that row, so every option would fail (BR-027). A menu of buttons that
 * all error is worse than a sentence saying they would.
 *
 * ── DESTRUCTIVE-ISH THINGS CONFIRM; REVERSIBLE ONES DO NOT ───────────────────
 * Deactivating signs somebody out everywhere and a role change alters what they
 * can see, so both confirm. Re-sending an invitation costs nothing and does not.
 * ========================================================================= */

type Pending = null | { kind: 'deactivate' | 'restore' | 'role' | 'reset'; role?: Role };

export function PersonActions({
  person,
  currentUser,
  assignableRoles,
  isPendingActivation,
}: {
  person: PersonRow;
  currentUser: { id: string; role: Role };
  assignableRoles: readonly Role[];
  isPendingActivation: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<TeamActionResult | null>(null);
  const [confirm, setConfirm] = React.useState<Pending>(null);
  const [nextRole, setNextRole] = React.useState<Role>(person.role);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const isSelf = person.id === currentUser.id;
  const isSuperAdmin = person.role === 'super_admin';

  if (isSuperAdmin) {
    return (
      <span className="text-micro text-text-tertiary" title="BR-027, FR-140">
        Cannot be altered
      </span>
    );
  }

  /* ── WHY THIS CATCHES, AND WHY IT NO LONGER REFRESHES HERE ─────────────────
     Owner report, Session 20: the password reset left the page "stuck… going
     black… I don't see what happens". Two of the three causes were in the Dialog
     primitive and are fixed there. The other two were here.

     1. THERE WAS NO try/catch. A server action that throws — a dropped
        connection is enough — left `busy` true and the confirmation dialog open
        with a spinner, forever. Nothing in the interface could recover it. That
        alone is the whole "stuck" report, and it applied to every action on this
        menu, not just the reset.

     2. THE REFRESH RAN WHILE THE RESULT WAS BEING SHOWN. `router.refresh()`
        re-renders the server tree; React reconciles; this component can be
        unmounted or its <dialog> node recreated, and the outcome the person was
        meant to read went with it. The refresh now waits until they dismiss the
        result — the data on screen is a few seconds stale in exchange for the
        answer actually being readable, which is the right trade. */
  const run = async (fn: () => Promise<TeamActionResult>) => {
    setBusy(true);
    try {
      const outcome = await fn();
      setResult(outcome);
    } catch {
      setResult({
        ok: false,
        error: 'That could not be completed — the server did not answer. Nothing was changed.',
      });
    } finally {
      setConfirm(null);
      setOpen(false);
      setBusy(false);
    }
  };

  /** Dismiss the result, and only then pick up the server's new state. */
  const dismissResult = () => {
    const wasOk = result?.ok === true;
    setResult(null);
    if (wasOk) router.refresh();
  };

  const item =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text-primary ' +
    'transition-colors hover:bg-bg-hover disabled:opacity-45 focus-visible:outline-none';

  return (
    <>
      <div ref={menuRef} className="relative inline-flex">
        <IconButton
          label={`Actions for ${person.fullName}`}
          icon={MoreHorizontal}
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        />

        {open && (
          <div
            role="menu"
            className="absolute top-[calc(100%+6px)] right-0 z-50 w-[15rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[var(--shadow-xl)]"
          >
            {isPendingActivation && (
              <button
                type="button"
                className={item}
                disabled={busy}
                onClick={() => void run(() => resendInvitationAction(person.id))}
              >
                <Send className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                Re-send the invitation
              </button>
            )}

            {assignableRoles.length > 0 && !isSelf && (
              <button
                type="button"
                className={item}
                disabled={busy}
                onClick={() => {
                  setNextRole(person.role);
                  setConfirm({ kind: 'role' });
                  setOpen(false);
                }}
              >
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                Change their role
              </button>
            )}

            {!isPendingActivation && (
              <button
                type="button"
                className={item}
                disabled={busy}
                onClick={() => {
                  setConfirm({ kind: 'reset' });
                  setOpen(false);
                }}
              >
                <KeyRound className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                Force a password reset
              </button>
            )}

            <div className="my-1 h-px bg-border-subtle" aria-hidden="true" />

            {person.isActive ? (
              <button
                type="button"
                className={cn(item, isSelf && 'cursor-not-allowed')}
                disabled={busy || isSelf}
                title={isSelf ? 'You cannot deactivate your own account' : undefined}
                onClick={() => {
                  setConfirm({ kind: 'deactivate' });
                  setOpen(false);
                }}
              >
                <UserMinus
                  className="h-3.5 w-3.5 shrink-0"
                  strokeWidth={2}
                  aria-hidden="true"
                  style={{ color: 'var(--feedback-error)' }}
                />
                Deactivate
              </button>
            ) : (
              <button
                type="button"
                className={item}
                disabled={busy}
                onClick={() => void run(() => setActiveAction(person.id, true))}
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                Restore access
              </button>
            )}
          </div>
        )}
      </div>

      {/* ---- Confirmations ---- */}
      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        size="sm"
        title={
          confirm?.kind === 'deactivate'
            ? `Deactivate ${person.fullName}?`
            : confirm?.kind === 'role'
              ? `Change ${person.fullName}'s role`
              : confirm?.kind === 'reset'
                ? `Force a password reset for ${person.fullName}?`
                : ''
        }
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={confirm?.kind === 'deactivate' ? 'danger' : 'primary'}
              size="md"
              disabled={busy || (confirm?.kind === 'role' && nextRole === person.role)}
              onClick={() => {
                if (confirm?.kind === 'deactivate') return void run(() => setActiveAction(person.id, false));
                if (confirm?.kind === 'reset') return void run(() => forceResetAction(person.id));
                if (confirm?.kind === 'role') return void run(() => changeRoleAction(person.id, nextRole));
              }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {confirm?.kind === 'deactivate'
                ? 'Deactivate'
                : confirm?.kind === 'reset'
                  ? 'Force the reset'
                  : 'Change the role'}
            </Button>
          </>
        }
      >
        {confirm?.kind === 'deactivate' && (
          <p className="text-caption text-text-secondary">
            They are signed out everywhere immediately and cannot sign back in.{' '}
            <span className="font-semibold text-text-primary">
              Their tasks, comments and history stay exactly as they are
            </span>{' '}
            — accounts are deactivated, never deleted, so nothing they worked on loses its author
            (BR-007). You can restore them at any time.
          </p>
        )}

        {confirm?.kind === 'reset' && (
          <p className="text-caption text-text-secondary">
            They are signed out everywhere and must set a new password before getting back in.{' '}
            <span className="font-semibold text-text-primary">No password is generated</span> — send
            them to &ldquo;Forgot your password?&rdquo; and they choose their own, as always.
          </p>
        )}

        {confirm?.kind === 'role' && (
          <div className="space-y-3">
            <p className="text-caption text-text-secondary">
              Currently <span className="font-semibold text-text-primary">{ROLE_LABEL[person.role]}</span>.
              A role decides what they can see, not just what they can press — a Member sees only
              their own work.
            </p>
            <Select
              size="md"
              label={`New role for ${person.fullName}`}
              value={nextRole}
              onChange={(event) => setNextRole(event.target.value as Role)}
              className="w-full"
            >
              {assignableRoles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>
            <p className="text-micro text-text-tertiary">
              It applies on their very next page load. The role is read fresh on every request and
              never cached in their session (FR-005).
            </p>
          </div>
        )}
      </Dialog>

      {/* ---- Outcome ----
           Dismissing this is what triggers the refresh, not the action finishing.
           See `dismissResult` above for why. */}
      <Dialog
        open={result !== null}
        onClose={dismissResult}
        size="sm"
        title={result?.ok ? 'Done' : 'That was refused'}
        footer={
          <Button variant="primary" size="md" onClick={dismissResult}>
            Close
          </Button>
        }
      >
        <div className="flex items-start gap-2.5">
          {!result?.ok && (
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
          )}
          <div className="space-y-2">
            <p className="text-caption text-text-primary">
              {result?.error ?? result?.warning ?? 'Saved.'}
            </p>
            {result?.ok && result.activationUrl && (
              <>
                <p className="text-micro text-text-secondary">{result.emailNote}</p>
                <code className="block rounded-lg border border-border-default bg-bg-surface-sunken px-3 py-2 font-mono text-micro break-all text-text-secondary">
                  {result.activationUrl}
                </code>
              </>
            )}
          </div>
        </div>
      </Dialog>
    </>
  );
}

export { UserPlus };
