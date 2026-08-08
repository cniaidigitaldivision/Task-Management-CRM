'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2, Mail } from 'lucide-react';

import { changeEmailAction, type PeopleActionResult } from '@/app/actions/people';
import { StepUpDialog } from '@/components/security/step-up-dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

/* ============================================================================
 * YOUR SIGN-IN ADDRESS — REDESIGN-PLAN §2
 * ----------------------------------------------------------------------------
 * ── WHY IT ASKS TWICE ────────────────────────────────────────────────────────
 * This is not a label, it is the identity the account is looked up by. The
 * change applies immediately — a link to the new address would prove it exists
 * first, but that needs a verified sending domain the owner has deferred.
 *
 * So the dangerous case here is not an attacker. It is a typo: a mistyped
 * address saves cleanly, looks right, and there is no way back, because
 * "forgot password" would send the recovery code to the address that does not
 * exist. Two fields catch a transposition, and the copy says outright what is
 * at stake rather than leaving somebody to discover it.
 *
 * ── THE REFUSAL FOR STEP-UP IS NOT AN ERROR ──────────────────────────────────
 * Same shape as the settings workspace: the server answers `stepUpRequired`, the
 * challenge opens, and the same submission is replayed on success. Typing an
 * address twice and then being made to type it twice again would be its own
 * argument for not bothering.
 *
 * ── NOT A `useActionState` FORM ──────────────────────────────────────────────
 * The other profile forms are. This one holds the submitted values across the
 * challenge so it can replay them, which means it owns its own state anyway —
 * and a form whose action can be re-dispatched from a dialog is clearer read as
 * an ordinary async submit than as an action queue with a hidden second entry.
 * ========================================================================= */

export function EmailForm({ currentEmail, isSuperAdmin }: {
  currentEmail: string;
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);

  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<PeopleActionResult | null>(null);
  /* Held only while the challenge is open, so the change can be replayed. */
  const [held, setHeld] = React.useState<FormData | null>(null);

  const submit = React.useCallback(
    async (data: FormData) => {
      setPending(true);
      const outcome = await changeEmailAction({ ok: false }, data);

      if (outcome.stepUpRequired) {
        setHeld(data);
        setResult(null);
        setPending(false);
        return;
      }

      setHeld(null);
      setResult(outcome);
      setPending(false);

      if (outcome.ok) {
        formRef.current?.reset();
        /* The address is in the top bar and on the card above this one. */
        router.refresh();
      }
    },
    [router],
  );

  return (
    <>
      <form
        ref={formRef}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(new FormData(event.currentTarget));
        }}
      >
        {result?.error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
              border: '1px solid color-mix(in oklab, var(--feedback-error) 32%, transparent)',
            }}
          >
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-error)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-caption text-text-primary">{result.error}</p>
          </div>
        )}

        {result?.ok && (
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
              border: '1px solid color-mix(in oklab, var(--feedback-success) 32%, transparent)',
            }}
          >
            <CheckCircle2
              className="mt-px h-4 w-4 shrink-0"
              style={{ color: 'var(--feedback-success)' }}
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="text-caption text-text-primary">{result.note}</p>
          </div>
        )}

        <div>
          <p className="text-micro text-text-tertiary">You sign in as</p>
          <p className="text-body-sm font-semibold text-text-primary">{currentEmail}</p>
        </div>

        {/* Phase 4's rule: short fields pair into two columns of identical width. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New email address" htmlFor="newEmail">
            <Input
              id="newEmail"
              name="newEmail"
              type="email"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </Field>

          <Field
            label="Confirm the new address"
            htmlFor="confirmEmail"
            hint="Typed twice on purpose — see below."
          >
            <Input
              id="confirmEmail"
              name="confirmEmail"
              type="email"
              autoComplete="off"
              spellCheck={false}
              /* Pasting the first field into the second defeats the entire
                 check, and the check is the only thing standing between a
                 transposed character and a permanent lockout. */
              onPaste={(event) => event.preventDefault()}
              required
            />
          </Field>
        </div>

        <Button type="submit" variant="primary" size="md" disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Mail className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          )}
          {pending ? 'Changing…' : 'Change my sign-in address'}
        </Button>

        {/* Capped at a readable measure. The card is full width so the fields can
            pair evenly, but running 12px prose across 1300px is a wall nobody
            reads — and this is the one paragraph here that has to be read. */}
        <div className="max-w-[80ch] space-y-1.5">
          <p className="text-micro text-text-tertiary">
            This is the address the system looks your account up by, so the change applies at once
            and you will sign in with the new one from the next time. Check it carefully:{' '}
            <strong className="font-semibold text-text-primary">
              if you mistype it you cannot sign in, and the recovery email goes to an address that
              does not exist.
            </strong>{' '}
            {isSuperAdmin
              ? 'For the Super Admin there is no one above you to put it right — restoring it would need direct database access.'
              : 'Your Super Admin can put it right, but only they can.'}
          </p>
          <p className="text-micro text-text-tertiary">
            You will be asked for your password
            {/* Everyone with a verified authenticator is asked for the code too;
                for an Admin or Super Admin that is not optional (FR-145). */}
            {isSuperAdmin ? ' and a code from your authenticator' : ' and, if you have one set up, a code from your authenticator'}
            . An alert goes to your old address afterwards, so a change you did not make does not
            happen quietly.
          </p>
        </div>
      </form>

      <StepUpDialog
        open={held !== null}
        actionLabel="Changing your sign-in email address"
        onClose={() => setHeld(null)}
        onConfirmed={() => {
          const data = held;
          setHeld(null);
          if (data) void submit(data);
        }}
      />
    </>
  );
}
