'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, Wand2 } from 'lucide-react';

import { saveCredentialAction, type VaultResult } from '@/app/actions/credentials';
import { BRAND_CHOICES, brandMark } from '@/lib/brand/service-marks';
import { BrandTile } from '@/components/brand/platform-icon';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Select } from '@/components/ui/select';
import { PeoplePicker } from '@/components/ui/people-picker';
import type { CredentialRow } from '@/lib/db/queries/credentials';
import { cn } from '@/lib/utils';

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
  /** `avatarUrl` is passed through to the picker, which draws faces when it has
   *  them and initials when it does not. */
  people: ReadonlyArray<{ id: string; name: string; avatarUrl?: string | null }>;
  /** Present when editing. */
  credential?: CredentialRow;
}) {
  const [state, formAction, pending] = React.useActionState(saveCredentialAction, EMPTY);
  const isEdit = Boolean(credential);

  /* ⚠️ Keyed on the credential's id so switching which row is being edited resets
     the selection. Without the key React keeps the previous row's holders, and the
     form would silently reassign one credential's people to another. `useState`
     with an initialiser cannot do this on its own — the initialiser runs once. */
  const [holders, setHolders] = React.useState<string[]>(credential?.holders.map((h) => h.id) ?? []);
  const lastId = React.useRef(credential?.id ?? null);
  if (lastId.current !== (credential?.id ?? null)) {
    lastId.current = credential?.id ?? null;
    setHolders(credential?.holders.map((h) => h.id) ?? []);
  }

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

        <ServicePicker initial={credential?.service ?? null} />

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

          {/* ── ⚠️ SEVERAL PEOPLE, AND THE HINT NO LONGER CLAIMS ACCESS ──────────
              Owner, 2026-08-25: *"I have to assign only Kashif and Larip so how can
              I select them? I want that dropdown to show the team names with
              checkboxes so I can select multiple team members and select 'Nobody'
              instead of using 'Everyone'."*

              ⚠️ THE OLD HINT SAID "They can see it", AND THAT WAS FALSE. Migration
              047 removed issued-to as a read route precisely because it granted
              access as a side effect of a custody field. The form was telling
              people that naming somebody here restricted who could read the
              password; it never did, and that is exactly the confusion the owner
              arrived with — *"nobody is particularly selected. That means everybody
              can do it."*

              So the field records custody, the hint says so, and it points at the
              control that does decide access. A field people believe restricts
              access while it does not is worse than no field at all. */}
          <Field
            label="Issued to"
            hint="Whose account this is. It does not decide who can read the password — rank and “Who can see this” do that."
          >
            <PeoplePicker
              name="issuedToIds"
              people={people}
              selected={holders}
              onChange={setHolders}
              emptyLabel="Nobody in particular"
              placeholder="Search the team…"
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
            <PasswordInput
              id="secret"
              name="secret"
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

/* ----------------------------------------------------------------------------
 * WHICH SERVICE IS THIS FOR
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24: *"during the time of creation, it should be selected whether
 * the credentials are Gmail, Facebook, TikTok, or anything like that, so select
 * the image respectively."*
 *
 * ── ⚠️ A GRID OF TILES, NOT A `<select>` OF NAMES ────────────────────────────
 * The thing being chosen IS a picture. A dropdown listing "Gmail, Facebook,
 * TikTok…" makes somebody read thirty-two words to pick the logo they can already
 * see, and gives no confirmation that the one they chose is the one they wanted.
 * Tiles show the answer.
 *
 * ── WHY THE FIRST OPTION IS "WORK IT OUT" AND WHY IT IS THE DEFAULT ──────────
 * Every credential stored before today has no choice recorded, and the URL-based
 * derivation gets most of them right. Making "detect" the default means:
 *
 *   · editing an old credential to fix its username does not silently freeze
 *     whatever icon it happens to show today into a stored value;
 *   · a new credential with a recognisable URL still gets its logo with no extra
 *     work, which is what makes the picker optional rather than a chore;
 *   · the fallback stays exercised rather than becoming dead code nobody notices
 *     has broken.
 *
 * ⚠️ RADIOS, not buttons with state. The value has to reach the server in the
 * form post like every other field here, and a real radio group gets keyboard
 * navigation and screen-reader semantics from the browser. `sr-only` on the input
 * rather than `hidden` — a hidden input is not focusable, which would make the
 * whole grid unreachable by keyboard.
 * ------------------------------------------------------------------------- */
function ServicePicker({ initial }: { initial: string | null }) {
  const [chosen, setChosen] = React.useState(initial ?? '');

  /* The tile shown beside the heading, so the current answer is legible without
     hunting for the highlighted cell in a grid of thirty-two. */
  const current = chosen === '' ? null : brandMark(chosen);

  return (
    <fieldset className="space-y-2">
      {/* A `legend`, not a `Field` label: this is a radio group, and a
          `<label for>` pointing at one of thirty-two inputs would announce the
          group's name as belonging to whichever came first. */}
      <legend className="flex items-center gap-2 text-caption font-semibold text-text-primary">
        Service
        {current ? (
          <span className="inline-flex items-center gap-1.5 font-normal text-text-tertiary">
            <BrandTile mark={current} markKey={chosen} size={18} />
            {current.label}
          </span>
        ) : (
          <span className="font-normal text-text-tertiary">from the link</span>
        )}
      </legend>

      {/* ⚠️ Scrolls rather than growing. Thirty-two tiles at four columns is eight
          rows, which would push the password field off a laptop screen — and this
          is the optional field on a form whose point is the password. */}
      <div className="max-h-[11.5rem] overflow-y-auto rounded-lg border border-border-default p-2">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1.5">
          {/* ── DETECT ─────────────────────────────────────────────────────── */}
          <label
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-2 text-center',
              'transition-[border-color,background-color] duration-[120ms]',
              chosen === ''
                ? 'border-border-brand bg-bg-selected'
                : 'border-transparent hover:bg-bg-hover',
            )}
          >
            <input
              type="radio"
              name="service"
              value=""
              checked={chosen === ''}
              onChange={() => setChosen('')}
              className="sr-only"
            />
            <Wand2
              className={cn('size-[18px]', chosen === '' ? 'text-text-brand' : 'text-text-tertiary')}
              strokeWidth={2}
              aria-hidden="true"
            />
            <span className="text-micro font-medium text-text-secondary">Detect</span>
          </label>

          {BRAND_CHOICES.map((choice) => {
            const mark = brandMark(choice.key);
            if (!mark) return null;
            const active = chosen === choice.key;

            return (
              <label
                key={choice.key}
                className={cn(
                  'flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-2 text-center',
                  'transition-[border-color,background-color] duration-[120ms]',
                  active
                    ? 'border-border-brand bg-bg-selected'
                    : 'border-transparent hover:bg-bg-hover',
                )}
              >
                <input
                  type="radio"
                  name="service"
                  value={choice.key}
                  checked={active}
                  onChange={() => setChosen(choice.key)}
                  className="sr-only"
                />
                <BrandTile mark={mark} markKey={choice.key} size={18} />
                {/* `break-all` off, `truncate` on: "Google Search Console" has to
                    lose its tail rather than reflow the cell and break the grid's
                    row height. The tile above it is the real identifier. */}
                <span className="w-full truncate text-micro font-medium text-text-secondary">
                  {choice.label}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <p className="text-micro text-text-tertiary">
        Only decides the logo. <span className="font-medium">Detect</span> reads it from the link,
        which is right for most — pick one when the link does not say, like a Gmail account on{' '}
        <code className="font-mono">google.com/login</code>.
      </p>
    </fieldset>
  );
}
