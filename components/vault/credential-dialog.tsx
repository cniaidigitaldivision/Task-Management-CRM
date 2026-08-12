'use client';

import * as React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { saveCredentialAction, type VaultResult } from '@/app/actions/credentials';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { CredentialRow } from '@/lib/db/queries/credentials';

/* ============================================================================
 * ADD OR EDIT A CREDENTIAL
 * ----------------------------------------------------------------------------
 * ── THE EXISTING SECRET IS NEVER RENDERED BACK INTO THE FORM ──────────────────
 * Editing a label must not require a round trip that decrypts the password, and
 * a password sitting in a form field is a password in the page source. So the
 * field is always empty when editing, and **an empty field means "leave it
 * alone"** rather than "clear it" — otherwise renaming an entry would silently
 * destroy the credential.
 *
 * Clearing is its own explicit act, from the reveal dialog, where somebody has
 * already proven who they are.
 * ========================================================================= */

export const KINDS = [
  'client',
  'hosting',
  'social',
  'advertising',
  'analytics',
  'email',
  'api',
  'software',
  'other',
] as const;

export const KIND_LABEL: Record<string, string> = {
  client: 'Client account',
  hosting: 'Hosting / domain',
  social: 'Social media',
  advertising: 'Ad manager',
  analytics: 'Analytics',
  email: 'Email / mailbox',
  api: 'API key',
  software: 'Software / licence',
  other: 'Other',
};

const EMPTY: VaultResult = { ok: false };

export function CredentialDialog({
  open,
  onClose,
  onSaved,
  projects,
  people,
  credential,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  projects: ReadonlyArray<{ id: string; name: string }>;
  people: ReadonlyArray<{ id: string; name: string }>;
  /** Present when editing. */
  credential?: CredentialRow;
}) {
  const [state, formAction, pending] = React.useActionState(saveCredentialAction, EMPTY);
  const isEdit = Boolean(credential);

  /* Closes on success. Watched here rather than returned to a callback because
     `useActionState` is the only thing that knows the attempt finished. */
  const sawOk = React.useRef(false);
  React.useEffect(() => {
    if (state.ok && !sawOk.current) {
      sawOk.current = true;
      onSaved();
    }
  }, [state.ok, onSaved]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title={isEdit ? `Edit ${credential?.label}` : 'Add a credential'}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" size="md" type="submit" form="credential-form" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isEdit ? 'Save' : 'Store it'}
          </Button>
        </>
      }
    >
      <form id="credential-form" action={formAction} className="space-y-4">
        {credential && <input type="hidden" name="id" value={credential.id} />}

        {!state.ok && state.error && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
          >
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {state.error}
          </p>
        )}

        <Field label="Name" htmlFor="label" hint="What somebody would call it when asking for it">
          <Input
            id="label"
            name="label"
            defaultValue={credential?.label ?? ''}
            placeholder="ABC Traders portal"
            required
            autoFocus
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind" htmlFor="kind">
            <Select
              id="kind"
              name="kind"
              defaultValue={credential?.kind ?? 'client'}
              options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
          </Field>

          <Field
            label="Project"
            htmlFor="projectId"
            hint="Tying it to a project is what lets its owner reach it."
          >
            <Select
              id="projectId"
              name="projectId"
              defaultValue={credential?.projectId ?? ''}
              options={[
                { value: '', label: 'Not tied to a project' },
                ...projects.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </Field>

          <Field
            label="Issued to"
            htmlFor="issuedToId"
            hint="They can see it — and it is what you check when they leave."
          >
            <Select
              id="issuedToId"
              name="issuedToId"
              defaultValue={credential?.issuedToId ?? ''}
              options={[
                { value: '', label: 'Nobody in particular' },
                ...people.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </Field>

          <Field label="Username or email" htmlFor="username">
            <Input
              id="username"
              name="username"
              defaultValue={credential?.username ?? ''}
              autoComplete="off"
            />
          </Field>

          <Field
            label={isEdit ? 'New password' : 'Password or key'}
            htmlFor="secret"
            hint={
              isEdit
                ? credential?.hasSecret
                  ? 'Leave empty to keep the one already stored.'
                  : 'Nothing is stored for this one yet.'
                : 'Leave empty to record only where the account lives.'
            }
          >
            <Input
              id="secret"
              name="secret"
              type="password"
              /* Never pre-filled, even when editing — see the header. */
              defaultValue=""
              autoComplete="new-password"
            />
          </Field>

          <Field label="Link" htmlFor="url" hint="Where it is used.">
            <Input
              id="url"
              name="url"
              type="url"
              defaultValue={credential?.url ?? ''}
              placeholder="https://"
            />
          </Field>

          <Field
            label="Expires"
            htmlFor="expiresAt"
            hint="Optional. Flagged on the list when it falls due."
          >
            <Input
              id="expiresAt"
              name="expiresAt"
              type="date"
              defaultValue={credential?.expiresAt ?? ''}
            />
          </Field>
        </div>

        <Field
          label="Notes"
          htmlFor="notes"
          hint="Anything the next person needs — which account it sits under, who to ask."
        >
          <Input id="notes" name="notes" defaultValue={credential?.notes ?? ''} />
        </Field>

        <p className="text-micro text-text-tertiary">
          The password is encrypted before it is stored, and reading it later needs your password
          and authenticator again. Every reveal is written to the security log.
        </p>
      </form>
    </Dialog>
  );
}
