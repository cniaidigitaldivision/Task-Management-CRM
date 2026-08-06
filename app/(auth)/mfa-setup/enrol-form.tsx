'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Loader2, Printer, ShieldCheck } from 'lucide-react';

import { confirmMfaEnrolment, type MfaBeginResult, type MfaConfirmResult } from '@/app/actions/mfa';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

/* ============================================================================
 * ENROL AN AUTHENTICATOR
 * ----------------------------------------------------------------------------
 * ── THE SETUP KEY IS AS PROMINENT AS THE QR CODE, NOT HIDDEN BEHIND A LINK ───
 * Most apps bury manual entry under "can't scan?". That is the wrong way round
 * here for a specific reason: the person most likely to be doing this is signing
 * in on the same device that holds their authenticator, so there is no second
 * camera to point at the screen. Making them hunt for the key in that situation
 * is the difference between thirty seconds and giving up.
 *
 * ── THE SECRET RIDES IN A HIDDEN FIELD ───────────────────────────────────────
 * Deliberate, and explained in app/actions/mfa.ts: nothing is written until a
 * code proves the secret, so the secret has to survive the round trip somewhere.
 * The consequence to know is that RELOADING THIS PAGE MINTS A NEW ONE — so the
 * form submits the secret it is showing rather than letting the server guess.
 * ========================================================================= */

const EMPTY: MfaConfirmResult = { ok: false };

export function EnrolForm({ enrolment }: { enrolment: MfaBeginResult }) {
  const [state, formAction, pending] = React.useActionState(confirmMfaEnrolment, EMPTY);
  const [copied, setCopied] = React.useState(false);

  /* ---- Done: the recovery codes, if this account had none ---------------- */
  if (state.ok) {
    return (
      <div className="space-y-5">
        <div
          className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
            border: '1px solid color-mix(in oklab, var(--feedback-success) 32%, transparent)',
          }}
        >
          <ShieldCheck
            className="mt-px h-4 w-4 shrink-0"
            style={{ color: 'var(--feedback-success)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="text-caption text-text-secondary">
            <span className="font-semibold text-text-primary">Authenticator confirmed.</span> From
            now on your sign-in asks for a code from that app.
          </p>
        </div>

        {state.recoveryCodes && state.recoveryCodes.length > 0 && (
          <>
            <div>
              <h2 className="text-h3 text-text-primary">Your recovery codes</h2>
              <p className="mt-1 text-caption text-text-secondary">
                <span className="font-semibold text-text-primary">
                  Shown once and never again.
                </span>{' '}
                Only their fingerprints are stored, so nobody — including this system — can produce
                them for you later. These are what get you in if you lose the phone, and{' '}
                <span className="font-semibold text-text-primary">
                  nobody else can reset your account
                </span>
                .
              </p>
            </div>

            <ul className="grid grid-cols-2 gap-2">
              {state.recoveryCodes.map((code) => (
                <li
                  key={code}
                  className="tabular rounded-lg border border-border-default bg-bg-surface-sunken px-3 py-2 text-center font-mono text-body-sm font-semibold tracking-wider text-text-primary"
                >
                  {code}
                </li>
              ))}
            </ul>

            <Button type="button" variant="secondary" size="md" onClick={() => window.print()}>
              <Printer className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              Print them
            </Button>
          </>
        )}

        {!state.recoveryCodes && (
          <p className="text-caption text-text-secondary">
            Your existing recovery codes still work — the set issued when the account was created.
            A new authenticator does not invalidate them.
          </p>
        )}

        <Link
          href="/dashboard"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[image:var(--gradient-brand)] px-4 text-body font-semibold text-text-on-brand shadow-[var(--shadow-brand-glow)] focus-visible:outline-none"
        >
          Go to the CRM
        </Link>
      </div>
    );
  }

  /* ---- Enrolling ---------------------------------------------------------- */
  return (
    <div className="space-y-5">
      {state.error && (
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
          <p className="text-caption text-text-primary">{state.error}</p>
        </div>
      )}

      {/* ---- 1 · Scan ---- */}
      <section className="space-y-2.5">
        <h2 className="text-caption font-semibold text-text-primary">
          1 · Scan this with your authenticator app
        </h2>
        <p className="text-micro text-text-secondary">
          Google Authenticator, Authy, Microsoft Authenticator or 1Password all work.
        </p>

        <div className="flex justify-center rounded-xl border border-border-default bg-white p-4">
          {/* ── Injecting HTML, safely, and why it is safe ──────────────────────
              The SVG is generated on the server by `uqr` from an `otpauth://` URI
              this application built. No user input reaches it: the only variable
              parts are a secret we minted from random bytes and the signed-in
              account's own email. Nothing here is attacker-controlled, so there
              is nothing to sanitise.
              Rendering on the server also keeps the QR library out of the browser
              bundle entirely. */}
          <div
            className="h-[200px] w-[200px] [&>svg]:h-full [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: enrolment.qrSvg }}
            role="img"
            aria-label="QR code for enrolling your authenticator app"
          />
        </div>
      </section>

      {/* ---- 2 · Or type it ---- */}
      <section className="space-y-2">
        <h2 className="text-caption font-semibold text-text-primary">
          Or type the key in by hand
        </h2>
        <p className="text-micro text-text-secondary">
          Choose <span className="font-semibold text-text-primary">enter a setup key</span> in the
          app. Use this if you are signing in on the same phone that holds the authenticator, so
          there is no second screen to scan.
        </p>

        <div className="flex items-stretch gap-2">
          <code className="tabular flex-1 rounded-lg border border-border-default bg-bg-surface-sunken px-3 py-2.5 font-mono text-body-sm font-semibold tracking-wider break-all text-text-primary">
            {enrolment.readableSecret}
          </code>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(enrolment.secret);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2500);
              } catch {
                /* Clipboard access can be refused. The key is on screen either
                   way, so there is nothing to recover from. */
              }
            }}
          >
            {copied ? (
              <CheckCircle2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        <p className="text-micro text-text-tertiary">
          Spaces are for reading only — paste it without them. The account name will show as your
          email address.
        </p>
      </section>

      {/* ---- 3 · Prove it ---- */}
      <form action={formAction} className="space-y-4 border-t border-border-subtle pt-4">
        {/* See the header: the secret is not stored until this code proves it, so
            it travels with the form. Reloading the page mints a different one. */}
        <input type="hidden" name="secret" value={enrolment.secret} />

        <h2 className="text-caption font-semibold text-text-primary">
          2 · Enter the six digits the app is showing
        </h2>

        <Field
          label="Code from your authenticator"
          htmlFor="code"
          hint="It changes every 30 seconds. If it is about to change, wait for the next one."
        >
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            placeholder="123456"
            className="tabular text-center font-mono text-h3 tracking-[0.3em]"
            required
            autoFocus
          />
        </Field>

        <Field label="Name this device" htmlFor="label" hint="So you can tell it apart later.">
          <Input id="label" name="label" defaultValue="My phone" maxLength={80} />
        </Field>

        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
          ) : (
            <KeyRound className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
          )}
          {pending ? 'Checking the code…' : 'Confirm and finish'}
        </Button>
      </form>

      <p className="text-micro text-text-tertiary">
        Nothing is saved until that code checks out. If you close this page now, no authenticator is
        recorded and you can start again — which is deliberate: an app that stored the key first
        could demand codes your phone never had.
      </p>
    </div>
  );
}
