'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  clearSecretAction,
  deleteCredentialAction,
  revealCredentialAction,
  setCredentialStatusAction,
  type VaultResult,
} from '@/app/actions/credentials';
import { StepUpDialog } from '@/components/security/step-up-dialog';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import type { CredentialRow } from '@/lib/db/queries/credentials';

import { CredentialDialog } from './credential-dialog';
import { VaultTable } from './vault-table';
import { CredentialDetails } from './credential-details';
import { CredentialAccessDialog } from './credential-access-dialog';

/* ============================================================================
 * THE VAULT — owner request 2026-08-12
 * ----------------------------------------------------------------------------
 * The third-party logins the division holds for clients and projects.
 *
 * ── WHAT IS NOT HERE, STATED ON THE SCREEN ───────────────────────────────────
 * Nobody's CRM password. Those are one-way digests and cannot be read by anyone,
 * including the Super Admin. The page says so, because somebody who came here
 * looking for a member's password needs to be told where to go instead (force a
 * reset) rather than left to conclude the feature is broken.
 *
 * ── A SECRET IS NEVER IN THE PAGE UNTIL IT IS ASKED FOR ──────────────────────
 * The list carries `hasSecret`, a boolean. Revealing calls the server, which
 * demands re-authentication and writes a CRITICAL security event. So a secret
 * exists in the browser only for as long as somebody is looking at it, and never
 * in the initial HTML — which would have put every password in the page source
 * of anybody who opened the vault.
 *
 * `revealed` is deliberately NOT keyed by row and kept: one at a time, cleared
 * when the dialog closes. A screen with eight passwords showing is a screenshot
 * waiting to happen.
 * ========================================================================= */

export function VaultWorkspace({
  credentials,
  projects,
  people,
  readers,
  canManage,
  canDelete,
  canGrant,
  canOversee,
  nowMs,
}: {
  credentials: readonly CredentialRow[];
  projects: ReadonlyArray<{ id: string; name: string }>;
  /** Who a credential can be ISSUED to — the assignable list, so it stops at the
   *  viewer's own rank. Custody, not access. */
  people: ReadonlyArray<{ id: string; name: string; avatarUrl?: string | null }>;
  /** ⚠️ Everybody, WITH their rank — the access dialogue works out who can open a
   *  credential from it, and read access does not stop at the viewer's rank. Two
   *  lists on purpose; see the note in app/(app)/vault/page.tsx. */
  readers: ReadonlyArray<{
    id: string;
    name: string;
    role?: string | null;
    avatarUrl?: string | null;
  }>;
  canManage: boolean;
  canDelete: boolean;
  /** `credential.grant` — Admin and above only, since 2026-08-25. Gates changing
   *  who can see a credential, and the Share history tab. */
  canGrant: boolean;
  /**
   * `credential.view` — Coordinator and above.
   *
   * ⚠️ NOT the same question as "can they see this row". A Member reaches the vault
   * when an Admin names them on one credential (migration 050), and RLS shows them
   * that row — but they are not an overseer of it. Owner, 2026-08-25: *"all this
   * information is for the admin, or you can say, the coordinator… The things will
   * be different for the team members."*
   */
  canOversee: boolean;
  /** The server's clock, for every age on the page. See lib/now.ts. */
  nowMs: number;
}) {
  const router = useRouter();
  /* ⚠️ The type, project, status and search filters now live inside `VaultTable`,
     next to the counters they narrow. They were here only so a `visible` array
     could be derived beside them, and nothing else in this file read them. */
  const [editing, setEditing] = React.useState<CredentialRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<CredentialRow | null>(null);
  /** ⚠️ Separate from `confirmDelete`. Forgetting the password keeps the account
   *  record; deleting destroys both. Sharing one dialogue would mean one wrong
   *  click does the larger of the two. */
  const [confirmClear, setConfirmClear] = React.useState<CredentialRow | null>(null);
  /** The credential whose details panel is open. Separate from `revealed`: a panel
   *  can be open with nothing revealed, and revealing does not open a panel. */
  const [openCredential, setOpenCredential] = React.useState<CredentialRow | null>(null);
  /**
   * Bumped whenever the access dialogue changes who can read a credential.
   *
   * ⚠️ A counter rather than shared grant state. Both the dialogue and the view
   * modal read the grants for themselves — the dialogue because it must work from
   * the project page too, the modal because its row of faces is derived from them —
   * so this is the smallest thing that can tell the modal "yours is out of date".
   * `router.refresh()` alone would not: the grants are not part of the page's
   * server-rendered props.
   */
  const [accessToken, setAccessToken] = React.useState(0);

  /** Whose access list is open. Admin-only — see `canGrant`. */
  const [accessFor, setAccessFor] = React.useState<CredentialRow | null>(null);
  const [note, setNote] = React.useState<VaultResult | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  /* The reveal, and the step-up it may demand. `pendingReveal` remembers what
     they were trying to see so the dialog can resume it rather than making them
     find the row again. */
  const [revealed, setRevealed] = React.useState<
    { id: string; label: string; username: string | null; secret: string } | null
  >(null);
  const [pendingReveal, setPendingReveal] = React.useState<string | null>(null);


  const reveal = async (id: string) => {
    setBusy(id);
    setNote(null);
    try {
      const result = await revealCredentialAction(id);
      /* ⚠️ No `stepUpRequired` branch any more. The action no longer asks —
         owner, 2026-08-25: *"don't require confirming the password again."* The
         field is still on the result type because other actions use it, and it is
         simply never set for a reveal. */
      if (!result.ok) {
        setNote({ ok: false, error: result.error });
        return;
      }
      setRevealed({
        id,
        label: result.label ?? '',
        username: result.username ?? null,
        secret: result.secret ?? '',
      });
    } catch {
      setNote({ ok: false, error: 'That could not be read — the server did not answer.' });
    } finally {
      setBusy(null);
    }
  };

  const run = async (id: string, fn: () => Promise<VaultResult>) => {
    setBusy(id);
    try {
      setNote(await fn());
      router.refresh();
    } catch {
      setNote({ ok: false, error: 'That could not be completed.' });
    } finally {
      setBusy(null);
      setConfirmDelete(null);
    }
  };


  return (
    <div className="space-y-4">
      {/* ── ⚠️ THE TOOLBAR AND THE CARD LIST ARE GONE ───────────────────────────
          What was here was a `Toolbar` of two Selects above a list of cards. The
          owner supplied a design for this page and it is five counters, four
          filters, a sort, a view toggle and a table — which `VaultTable` is, in
          full.

          What stayed in this file is everything that talks to the server: the
          reveal round trip, the status changes, the save and delete dialogues, and
          the access modal. None of that is layout. */}
      {note && (
        <p
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            color: note.ok ? 'var(--feedback-success)' : 'var(--feedback-error)',
          }}
        >
          {note.error ?? note.message}
        </p>
      )}

      <VaultTable
        credentials={credentials}
        projects={projects}
        canManage={canManage}
        canDelete={canDelete}
        canGrant={canGrant}
        nowMs={nowMs}
        busyId={busy}
        revealed={revealed}
        onAdd={() => setCreating(true)}
        onOpen={(credential) => {
          /* ⚠️ Opening a DIFFERENT credential drops any secret already on screen.
             Without this, revealing one password and then opening another row shows
             the first row's secret under the second row's name. */
          if (revealed && revealed.id !== credential.id) setRevealed(null);
          setOpenCredential(credential);
        }}
        /* ⚠️ REVEALING OPENS THE VIEW MODAL — it used to open a second, smaller
           dialogue of its own. Owner, 2026-08-25, of that one: *"the view model is
           still not showing properly as I want"*, with a reference showing the
           password beside the URL, the username and who can see it. Two dialogues
           for one credential meant the good layout was never the one a reveal
           produced. Now there is one sheet, and a reveal is a row inside it. */
        onReveal={(credential) => {
          if (revealed && revealed.id !== credential.id) setRevealed(null);
          setOpenCredential(credential);
          void reveal(credential.id);
        }}
        onEdit={setEditing}
        onStatus={(credential, status) =>
          void run(credential.id, () => setCredentialStatusAction(credential.id, status))
        }
        onDelete={setConfirmDelete}
        onAccess={setAccessFor}
      />

      {/* ── Who can see it ─────────────────────────────────────────────────
          One dialogue, shared with the project Access tab. Two copies would be
          two places deciding who may read a password, and the day they disagree
          that is a security bug rather than a cosmetic one. */}
      <CredentialAccessDialog
        credential={accessFor}
        people={readers}
        canGrant={canGrant}
        onClose={() => setAccessFor(null)}
        /* Refreshes so the Shared counter and the row grant count follow
           immediately rather than after the next navigation — and bumps the token
           the view modal watches, since that loads its own copy of the grants and
           would otherwise keep showing the faces from before the change. */
        onChanged={() => {
          setAccessToken((n) => n + 1);
          router.refresh();
        }}
      />

      {/* ---- One credential, in full ------------------------------------- */}
      {openCredential && (
        <CredentialDetails
          credential={openCredential}
          /* Only when it is THIS credential's secret — see onOpen above. */
          secret={revealed?.id === openCredential.id ? revealed.secret : null}
          people={readers}
          /* `credential.view` — Coordinator and above. A Member is looking at this
             only because an Admin named them on it, and gets the credential without
             the management of it. */
          canOversee={canOversee}
          canManage={canManage}
          canGrant={canGrant}
          busy={busy === openCredential.id}
          nowMs={nowMs}
          accessToken={accessToken}
          onClose={() => {
            setOpenCredential(null);
            /* ⚠️ The plaintext goes when the panel does. Leaving it in state would
               mean re-opening the row shows the password again with no reveal, and
               no second audit row for the second look. */
            setRevealed(null);
          }}
          onReveal={() => void reveal(openCredential.id)}
          onHide={() => setRevealed(null)}
          onEdit={() => {
            setOpenCredential(null);
            setEditing(openCredential);
          }}
          onStatus={(status) =>
            void run(openCredential.id, () =>
              setCredentialStatusAction(openCredential.id, status),
            )
          }
          onAccess={() => setAccessFor(openCredential)}
          onClearSecret={() => setConfirmClear(openCredential)}
        />
      )}



      {/* ---- Step-up, then resume the reveal they asked for ---------------- */}
      <StepUpDialog
        open={pendingReveal !== null}
        actionLabel="Showing a stored credential"
        onClose={() => setPendingReveal(null)}
        onConfirmed={() => {
          const id = pendingReveal;
          setPendingReveal(null);
          if (id) void reveal(id);
        }}
      />

      {/* ── FORGET THE PASSWORD, KEEP THE ACCOUNT ──────────────────────────
          ⚠️ RESTORED HERE ON 2026-08-25. This was a button inside the old reveal
          dialogue, and deleting that dialogue took the only way to clear a secret
          from the Vault page with it — the project panel had its own. It is the
          same wording and the same confirmation as that one, deliberately: two
          screens offering the same irreversible act should describe it identically. */}
      <Dialog
        open={confirmClear !== null}
        onClose={() => setConfirmClear(null)}
        size="sm"
        title={confirmClear ? `Forget the password for ${confirmClear.label}?` : ''}
        footer={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setConfirmClear(null)}
              disabled={busy !== null}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={busy !== null}
              onClick={() => {
                if (confirmClear) {
                  const id = confirmClear.id;
                  setConfirmClear(null);
                  /* The plaintext on screen goes with it — leaving it would show a
                     password the vault no longer holds. */
                  setRevealed(null);
                  void run(id, () => clearSecretAction(id));
                }
              }}
            >
              Forget it
            </Button>
          </>
        }
      >
        <p className="text-caption leading-relaxed text-text-secondary">
          The stored password is destroyed and the record of the account stays — the URL, the
          username and the notes are untouched. Use this when a client changes a password and
          nobody has told you the new one yet, so the vault stops offering a value that no longer
          works.
        </p>
      </Dialog>

      {/* ---- Create and edit ---------------------------------------------- */}
      {creating && (
        <CredentialDialog
          open
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            router.refresh();
          }}
          projects={projects}
          people={people}
        />
      )}

      {editing && (
        <CredentialDialog
          open
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
          projects={projects}
          people={people}
          credential={editing}
        />
      )}

      {/* ---- Delete ------------------------------------------------------- */}
      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        size="sm"
        title={confirmDelete ? `Delete ${confirmDelete.label}?` : ''}
        footer={
          <>
            <Button variant="ghost" size="md" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="md"
              disabled={busy !== null}
              onClick={() => {
                if (confirmDelete) {
                  void run(confirmDelete.id, () => deleteCredentialAction(confirmDelete.id));
                }
              }}
            >
              Delete it
            </Button>
          </>
        }
      >
        <p className="text-caption text-text-secondary">
          The record goes and so does the stored password.{' '}
          <span className="font-semibold text-text-primary">
            The account itself is not touched
          </span>{' '}
          — if it should no longer exist, revoke it wherever it lives first, or nobody will know
          it is still open.
        </p>
      </Dialog>
    </div>
  );
}


/* ----------------------------------------------------------------------------
 * THE REVEAL DIALOGUE WAS DELETED ON 2026-08-25
 * ----------------------------------------------------------------------------
 * It was a second, smaller modal that opened on top of everything to show one
 * secret. `CredentialDetails` now has a password row with Reveal and Copy on it,
 * which is what the owner's reference draws — so a reveal opens the sheet instead
 * of a dialogue of its own.
 *
 * ⚠️ WHY NOT KEEP BOTH. They disagreed. This one had the brand mark and a link to
 * the site; the sheet had the URL, the username, the project and the access list.
 * Whichever a person happened to use decided how much they were told about the
 * credential they were reading, and the quick path was the poorer one.
 *
 * What it carried that is worth keeping is kept: "Forget the password" — the
 * reversible clear — is on the row menu, and the audit note is in the sheet's
 * footer banner.
 * ------------------------------------------------------------------------- */
