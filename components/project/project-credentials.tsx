'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Eye, KeyRound, Pencil, Plus, ShieldAlert } from 'lucide-react';

import { revealCredentialAction } from '@/app/actions/credentials';
import type { CredentialRow } from '@/lib/db/queries/credentials';
import { StepUpDialog } from '@/components/security/step-up-dialog';
import { CredentialDialog } from '@/components/vault/credential-dialog';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/* ============================================================================
 * CREDENTIALS, ON THE PROJECT — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * *"On the credential page I have seen that there is no option to add credentials on
 * this page. It is saying that they are added in a world. This is not the way. If I
 * am not credentialled it should must show the credentials. Credentials should be in
 * a proper format, like a domain credential, like Gmail credentials, or some Facebook
 * or social media platform credentials… their URL, their username, and email.
 * Passwords should be shown in encrypted form. When I click on it, it will decrypt and
 * when I hide it and then again click on the eye button, it will hide it."*
 *
 * The tab used to say "None recorded against this project. They are added in the
 * Vault" and link away — a dead end that told you where the feature wasn't.
 *
 * ── ⚠️ WHAT THIS DOES NOT DO: WEAKEN THE REVEAL ───────────────────────────────
 * The eye button calls the SAME `revealCredentialAction` the Vault does, which:
 *   · refuses without `credential.reveal`;
 *   · demands a fresh step-up (FR-149) BEFORE the row is fetched, so a refusal
 *     cannot even confirm the id exists;
 *   · writes an audit entry and a `critical` security event on every success.
 *
 * None of that is bypassed to make this convenient. Putting the button on the
 * project page changes where you press it, not what it costs. If the step-up has
 * gone stale the challenge opens and the reveal resumes afterwards — the same flow
 * `vault-workspace.tsx` uses, deliberately reused rather than re-implemented.
 *
 * ── AND WHY THE PLAINTEXT IS NOT KEPT ────────────────────────────────────────
 * One secret is held at a time and cleared when the panel closes it. A page that
 * accumulated every revealed password in React state would be one screenshot away
 * from being the thing the Vault exists to prevent.
 * ========================================================================= */

export function ProjectCredentials({
  credentials,
  projectId,
  projectName,
  people,
  canManage,
}: {
  credentials: readonly CredentialRow[];
  projectId: string;
  projectName: string;
  people: ReadonlyArray<{ id: string; name: string }>;
  /** `project.edit`. Storing a credential also needs `credential.manage`, which the
   *  action checks — this only decides whether offering the button is a dead end. */
  canManage: boolean;
}) {
  const router = useRouter();

  const [editing, setEditing] = React.useState<CredentialRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  /* One at a time — see the header. `pendingId` remembers which reveal to resume
     after a step-up challenge. */
  const [shown, setShown] = React.useState<{ id: string; secret: string } | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const reveal = async (id: string) => {
    /* A second press on the same row hides it, which is what the owner described:
       *"when I hide it and then again click on the eye button, it will hide it."* */
    if (shown?.id === id) {
      setShown(null);
      return;
    }

    setBusy(id);
    setNote(null);
    try {
      const result = await revealCredentialAction(id);
      /* ⚠️ `secret` is optional on `RevealResult` even when `ok` is true, so it is
         checked rather than asserted. An `ok` with no secret would otherwise render
         an empty box that looks like a blank password. */
      if (result.ok && typeof result.secret === 'string') {
        setShown({ id, secret: result.secret });
        return;
      }
      if (result.stepUpRequired) {
        setPendingId(id);
        return;
      }
      setNote(result.error ?? 'That could not be shown.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm font-semibold text-text-primary">
          Credentials
          {credentials.length > 0 && (
            <span className="ml-2 font-normal text-text-tertiary">{credentials.length}</span>
          )}
        </p>
        {canManage && (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            Add credential
          </Button>
        )}
      </div>

      {note && (
        <p
          className="flex items-start gap-2 text-caption"
          style={{ color: 'var(--feedback-error)' }}
        >
          <ShieldAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          {note}
        </p>
      )}

      {credentials.length === 0 ? (
        <Card>
          <CardBody className="px-6 py-10 text-center">
            <KeyRound
              className="mx-auto h-5 w-5 text-text-tertiary"
              strokeWidth={2}
              aria-hidden="true"
            />
            <p className="mt-2 text-body-sm font-semibold text-text-primary">
              Nothing stored for {projectName} yet
            </p>
            <p className="mx-auto mt-1 max-w-[34rem] text-caption text-text-secondary">
              A domain login, the client&rsquo;s Gmail, a Facebook page, a CRM — anything the team
              needs to do this work. The secret is sealed before it reaches the database and
              revealing one is audited.
            </p>
            {canManage && (
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                Add the first one
              </Button>
            )}
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {credentials.map((credential) => {
            const isShown = shown?.id === credential.id;
            return (
              <Card key={credential.id}>
                <CardBody className="space-y-2 p-3.5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-semibold text-text-primary">
                        {credential.label}
                      </p>
                      <p className="text-micro text-text-tertiary">
                        {/* The kind, which is the "proper format" the owner asked for —
                            it comes from the credential's own enum, so a Gmail and a
                            domain login are distinguishable at a glance. */}
                        {credential.kind.replace(/_/g, ' ')}
                      </p>
                    </div>

                    {canManage && (
                      <IconButton
                        label={`Edit ${credential.label}`}
                        icon={Pencil}
                        size="sm"
                        onClick={() => setEditing(credential)}
                      />
                    )}
                  </div>

                  <dl className="space-y-1">
                    {credential.url && (
                      <Row label="URL">
                        {/* `rel="noreferrer"` as well as noopener: a client's admin
                            panel should not receive this CRM's URL as a referrer. */}
                        <a
                          href={credential.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate font-mono text-micro text-text-brand hover:underline"
                        >
                          {credential.url}
                        </a>
                      </Row>
                    )}
                    {credential.username && (
                      <Row label="User">
                        <span className="truncate font-mono text-micro text-text-secondary">
                          {credential.username}
                        </span>
                      </Row>
                    )}

                    <Row label="Secret">
                      {credential.hasSecret ? (
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate rounded px-1.5 py-0.5 font-mono text-micro',
                              isShown ? 'bg-bg-active text-text-primary' : 'text-text-tertiary',
                            )}
                          >
                            {isShown ? shown.secret : '••••••••••••'}
                          </span>
                          <IconButton
                            label={isShown ? `Hide ${credential.label}` : `Show ${credential.label}`}
                            icon={Eye}
                            size="sm"
                            onClick={() => void reveal(credential.id)}
                            disabled={busy === credential.id}
                            className={isShown ? 'text-text-brand' : undefined}
                          />
                        </span>
                      ) : (
                        <span className="text-micro text-text-tertiary">none stored</span>
                      )}
                    </Row>
                  </dl>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* ⚠️ The Vault's own dialog, not a copy. It owns the kind list, the field
          validation and the sealing, and a second form would drift from it — most
          likely by omitting a field the database requires. `projects` is limited to
          THIS project so the credential cannot be filed against another one from
          here by accident. */}
      {(creating || editing) && (
        <CredentialDialog
          open
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            /* `router.refresh()` rather than local state: the server decides what is
               visible, and a newly stored credential must arrive the same way the
               rest of the list did. */
            router.refresh();
          }}
          projects={[{ id: projectId, name: projectName }]}
          people={people}
          credential={editing ?? undefined}
        />
      )}

      <StepUpDialog
        open={pendingId !== null}
        onClose={() => setPendingId(null)}
        /* Names the act being confirmed, so the challenge does not read as a random
           re-authentication. */
        actionLabel="show this credential"
        onConfirmed={() => {
          const id = pendingId;
          setPendingId(null);
          /* Resume the exact reveal they asked for. Anything else would make them
             hunt for the row again after proving who they are. */
          if (id) void reveal(id);
        }}
      />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-11 shrink-0 text-micro text-text-tertiary">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center">{children}</dd>
    </div>
  );
}
