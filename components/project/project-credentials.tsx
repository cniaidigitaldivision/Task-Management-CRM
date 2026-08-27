'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Lock,
  MoreVertical,
  Pencil,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  X,
} from 'lucide-react';

import {
  clearSecretAction,
  deleteCredentialAction,
  listCredentialGrantsAction,
  revealCredentialAction,
} from '@/app/actions/credentials';
import type { CredentialGrantRow, CredentialRow } from '@/lib/db/queries/credentials';
import { relativeAge } from '@/lib/view/relative-age';
import { CredentialIcon, credentialServiceLabel } from '@/components/brand/credential-icon';
import { StepUpDialog } from '@/components/security/step-up-dialog';
import { credentialOpeners, credentialReaders } from '@/lib/domain/credential-access';
import { CredentialAccessDialog } from '@/components/vault/credential-access-dialog';
import { CredentialDialog, KIND_LABEL } from '@/components/vault/credential-dialog';
import { AvatarStack } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/* ============================================================================
 * ACCESS — THE PROJECT'S CREDENTIALS, AS A LIST AND A PANEL
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24, with a mockup: *"I want this UI in Access where all the
 * credentials are displayed. I want this exact same layout over there and make sure
 * that each and every button should be properly working according to my setup.
 * Keep the data the same but I want this UI."*
 *
 * ── WHAT THE LAYOUT CHANGED, AND WHY IT IS BETTER FOR THIS DATA ──────────────
 * It was a two-column grid of equal cards, each showing URL, user and a masked
 * secret. Every card was the same size whether it held three fields or eight, and
 * the notes — the field that says "primary Gmail, do not share outside the team" —
 * had nowhere to go at all, so they were simply not rendered.
 *
 * Master-detail fixes exactly that: the list answers "what accounts do we hold",
 * one line each; the panel answers "what is this one", at whatever length it takes.
 * It also means only ONE secret can be on screen at a time, which was already the
 * rule here and is now a property of the layout rather than a promise in a comment.
 *
 * ── ⚠️ WHERE THE MOCKUP AND THE DATABASE DISAGREE, THE DATABASE WINS ─────────
 * The mockup shows a "Recovery Email / Phone" row. There is no such column on
 * `public.credentials` (migration 023) and the owner asked to keep the data the
 * same, so inventing one would mean either a schema change nobody asked for or a
 * field that renders permanently empty. That slot carries the three real fields
 * the old grid also had nowhere to put — who holds it, when it expires, when the
 * password was last changed — which is the same shape of information and is true.
 *
 * The mockup's avatar stack is labelled "People with access". Since migration 047
 * access is not a per-credential list: it is RANK. Coordinator and above see every
 * credential; nobody else sees any, not even the person it was issued to and not
 * the project's own members. So the stack shows who genuinely can read it, and the
 * button next to it explains the rule rather than pretending to edit a grant that
 * does not exist. A control that looked like a per-credential ACL would be a lie
 * about who can see a client's password, which is the one thing on this screen
 * nobody should be wrong about.
 *
 * ── ⚠️ WHAT THIS DOES NOT DO: WEAKEN THE REVEAL ──────────────────────────────
 * Both Reveal and Copy call the SAME `revealCredentialAction` the Vault does,
 * which:
 *   · refuses without `credential.reveal`;
 *   · demands a fresh step-up (FR-149) BEFORE the row is fetched, so a refusal
 *     cannot even confirm the id exists;
 *   · writes an audit entry and a `critical` security event on every success.
 *
 * ⚠️ COPY COSTS THE SAME AS REVEAL, on purpose. It hands over a working secret —
 * to the clipboard instead of to the screen — so it takes the same step-up and
 * writes the same critical audit entry. A "copy" that skipped the challenge
 * because nothing was displayed would be a way to read every password in the
 * division without one.
 *
 * ── AND THE PLAINTEXT IS STILL NOT KEPT ──────────────────────────────────────
 * One secret is held at a time and it is dropped when the selection changes, when
 * the panel is closed, and when Hide is pressed. A panel that accumulated every
 * revealed password in React state would be one screenshot away from being the
 * thing the vault exists to prevent.
 * ========================================================================= */

/** How long "Copied" stays on the button. Long enough to read, short enough that
 *  it cannot be mistaken for the resting state of the control. */
const COPIED_MS = 2000;


/** An absolute stamp for the panel's footer. Pinned locale and zone, for the same
 *  reason the Documents page pins them: otherwise Node renders "17:12" and the
 *  browser renders "5:12 pm" and React calls it a hydration mismatch. */
function absolute(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Karachi',
  });
}

export function ProjectCredentials({
  credentials,
  projectId,
  projectName,
  people,
  canManage,
  canGrant,
  nowMs,
}: {
  credentials: readonly CredentialRow[];
  projectId: string;
  projectName: string;
  /** Every active person in the division, with rank and picture. Rank decides who
   *  is on the access list by role; the Members are who can be GRANTED it. */
  people: ReadonlyArray<{ id: string; name: string; role?: string; avatarUrl?: string | null }>;
  /** `project.edit`. Storing a credential also needs `credential.manage`, which the
   *  action checks — this only decides whether offering the button is a dead end. */
  canManage: boolean;
  /** `credential.grant` — Admin and Super Admin ONLY, unlike every other
   *  credential permission. Owner, 2026-08-24: *"only admins and super admins can
   *  add someone and can delete someone from here."* Both actions check it again,
   *  and migration 050's RLS checks it a third time. */
  canGrant: boolean;
  /** Epoch milliseconds from the server. See lib/view/relative-age.ts. */
  nowMs: number;
}) {
  const router = useRouter();

  /* ── SELECTION IS AN ID, NOT A ROW ────────────────────────────────────────
     `credentials` is replaced wholesale by `router.refresh()` after every save,
     so a held row object would be a stale copy the moment anything was edited —
     the panel would keep showing the old label beside the new one in the list.
     An id survives the swap and is re-resolved below. */
  const [selectedId, setSelectedId] = React.useState<string | null>(
    credentials[0]?.id ?? null,
  );

  const [editing, setEditing] = React.useState<CredentialRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [access, setAccess] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<CredentialRow | null>(null);
  const [confirmClear, setConfirmClear] = React.useState<CredentialRow | null>(null);

  /* One secret at a time — see the header. `pending` remembers what to resume
     after a step-up challenge, including WHICH act was asked for: resuming a Copy
     as a Reveal would put a password on screen that somebody meant to keep off it. */
  const [shown, setShown] = React.useState<{ id: string; secret: string } | null>(null);
  const [pending, setPending] = React.useState<{ id: string; intent: 'reveal' | 'copy' } | null>(
    null,
  );
  const [busy, setBusy] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);

  /* ── ⚠️ THE SELECTED ROW CAN VANISH UNDER THE PANEL, SO IT IS DERIVED ─────
     Deleting the selected credential, or editing it onto another project, removes
     it from `credentials` on the next refresh while `selectedId` still names it.
     Resolved during render with a fall back to the first row — which is where the
     tab opens anyway — rather than corrected in an effect. Correcting state from an
     effect means an extra render pass every time the list changes, and React's lint
     refuses it: this is derived data, not synchronisation with anything.

     ⚠️ `selectedId === null` is checked FIRST and separately. Null means the person
     pressed X, and falling back to the first row there would make Close re-open the
     panel with a different credential in it. Stale-id and nothing-chosen look the
     same in a `find()` and must not behave the same. */
  const selected =
    selectedId === null
      ? null
      : (credentials.find((c) => c.id === selectedId) ?? credentials[0] ?? null);

  /* ── DROPPING THE PLAINTEXT IS A CONSEQUENCE OF THE CLICK ──────────────────
     Not of a render. Every path that changes which credential is on screen goes
     through here, so the previously revealed secret is forgotten at the moment the
     person moves on — which is the load-bearing half of "one at a time". Revealing
     A and clicking B must not leave A's password in component state with nothing
     on screen admitting it is there.

     ⚠️ This used to be a `useEffect` on `selectedId`. It worked, but it made the
     drop a side effect of rendering, which is both a render cascade React's lint
     refuses AND the wrong story: the secret is dropped because somebody navigated
     away from it, not because the component re-rendered. */
  const select = (id: string | null) => {
    setSelectedId(id);
    setShown(null);
    setCopied(null);
    setNote(null);
  };

  /* ⚠️ The "Copied" flash is a timer, so it needs clearing on unmount — a
     `setCopied` after the component has gone is a React warning and, worse, keeps
     the closure (and the id) alive past the panel that owned it. */
  React.useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  /* ── ⚠️ THE GRANTS ARE FETCHED, NOT PASSED DOWN WITH THE PAGE ─────────────
     One credential's grant list is a handful of rows and most credentials have
     none, so loading them for every row on the page would be a join nobody reads.
     Fetched when a credential is selected, because BOTH the avatar stack and the
     modal need them — an earlier draft fetched only when the modal opened, which
     left the stack claiming that only the Coordinators could see a credential a
     Member had been given.

     ⚠️ Stored WITH the id it belongs to. Keeping a bare array would show the
     previous credential's grants for the moment between selecting a new one and
     its fetch returning — on this screen that reads as "this Member can see this
     password", which is exactly the wrong thing to be briefly wrong about. */
  const [grantsFor, setGrantsFor] = React.useState<{
    credentialId: string;
    rows: readonly CredentialGrantRow[];
  } | null>(null);

  /* ⚠️ MEMOISED, and not for speed. The `: []` branch produced a fresh array
     every render, so the two `useMemo`s below it — `readers` and `grantable` —
     saw a changed dependency on every single render and recomputed regardless.
     One of them feeds an avatar stack and the other a picker's option list, so
     the cost was small; the reason to fix it is that a memo which never hits is a
     memo that is lying about what it depends on. */
  const selectedGrants = React.useMemo<readonly CredentialGrantRow[]>(
    () => (selected && grantsFor?.credentialId === selected.id ? grantsFor.rows : []),
    [selected, grantsFor],
  );

  /* ⚠️ setState only inside the async callback, never in the effect body — a
     synchronous one there is the render cascade React's lint refuses. `alive`
     drops a response that arrives after the selection moved on.

     ⚠️ AND IT CATCHES. This was `void …then(…)` with no rejection handler, which
     is a defect I shipped rather than a precaution: the very first thing that went
     wrong was migration 050 not being applied, so the action threw
     `relation "credential_grants" does not exist` — and with no catch that became
     an unhandled promise rejection in the browser, with the access list silently
     empty. Silently empty is the worst possible failure for THIS list: it reads as
     "nobody else can see this password".

     `setGrantsFor` to an empty list on failure, so the panel shows the rank rows
     it can be sure of, plus a note saying the named grants could not be read. */
  const loadGrants = React.useCallback((credentialId: string) => {
    let alive = true;
    void listCredentialGrantsAction(credentialId)
      .then((result) => {
        if (!alive) return;
        if (result.ok) setGrantsFor({ credentialId, rows: result.grants });
        else {
          setGrantsFor({ credentialId, rows: [] });
          setNote({ ok: false, text: result.error });
        }
      })
      .catch(() => {
        if (!alive) return;
        setGrantsFor({ credentialId, rows: [] });
        setNote({
          ok: false,
          text: 'Who has been given this credential could not be read, so the list below shows only the people who can open it by role.',
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!selected) return;
    return loadGrants(selected.id);
  }, [selected, loadGrants]);

  /**
   * The faces on the panel: everybody who can actually open THIS credential.
   *
   * ⚠️ `credentialOpeners` drops the excluded, and that is a fix rather than a
   * tidy-up. This used to merge the rank rows with the grants and render the lot,
   * so somebody named OUT of a credential (migration 052) was still a face in the
   * stack — the panel said they could read a password the database refuses them.
   *
   * ⚠️ The derivation is shared with the access dialogue and the vault's credential
   * sheet, in lib/domain/credential-access.ts. Three components answering "who can
   * see this password" separately is how they came to disagree.
   */
  const readers = React.useMemo(
    () =>
      credentialOpeners(credentialReaders(people, selectedGrants)).map((r) => ({
        name: r.name,
        src: r.avatarUrl,
        role: r.role,
      })),
    [people, selectedGrants],
  );

  /* ── ONE PATH TO PLAINTEXT, TWO DESTINATIONS ──────────────────────────────
     `intent` decides where the secret goes and nothing else, and both produce the
     same audit entry, because both hand over a working password.

     ⚠️ NEITHER pays a step-up any more — owner, 2026-08-25: *"don't require
     confirming the password again."* `credential.reveal` left `STEP_UP_ACTIONS`,
     so the `stepUpRequired` branch below can no longer fire. It is kept because the
     field is still on the result type and a silent `return` would be worse than a
     challenge nobody sees; `credential.grant` DID keep its step-up, which is why
     the access dialogue still raises one. */
  const obtain = async (id: string, intent: 'reveal' | 'copy') => {
    /* A second press on Reveal hides it, which is what the owner described in
       August: *"when I hide it and then again click on the eye button, it will
       hide it."* Copy never toggles — pressing it twice means "copy it again". */
    if (intent === 'reveal' && shown?.id === id) {
      setShown(null);
      return;
    }

    setBusy(id);
    setNote(null);
    try {
      const result = await revealCredentialAction(id);

      /* ⚠️ `secret` is optional on `RevealResult` even when `ok` is true, so it is
         checked rather than asserted. An `ok` with no secret would otherwise show
         an empty box that reads as a blank password. */
      if (result.ok && typeof result.secret === 'string') {
        if (intent === 'reveal') {
          setShown({ id, secret: result.secret });
          return;
        }
        await toClipboard(result.secret, id, 'The password is on your clipboard.');
        return;
      }

      if (result.stepUpRequired) {
        setPending({ id, intent });
        return;
      }
      setNote({ ok: false, text: result.error ?? 'That could not be shown.' });
    } finally {
      setBusy(null);
    }
  };

  /** Write to the clipboard and say so. `key` marks which control flashes. */
  const toClipboard = async (text: string, key: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setNote({ ok: true, text: message });
    } catch {
      /* ⚠️ Reported, not swallowed. `navigator.clipboard` needs a secure context,
         so this fails outright over plain http — and a Copy button that silently
         does nothing is worse than one that explains itself. */
      setNote({
        ok: false,
        text: 'The clipboard is not available in this browser. Use Reveal and copy it by hand.',
      });
    }
  };

  const run = async (id: string, fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => {
    setBusy(id);
    setNote(null);
    try {
      const result = await fn();
      setNote({ ok: result.ok, text: result.error ?? result.message ?? '' });
      if (result.ok) {
        setConfirmDelete(null);
        setConfirmClear(null);
        setShown(null);
        router.refresh();
      }
    } catch {
      setNote({ ok: false, text: 'That could not be completed — the server did not answer.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {/* ══ THE HEADER ════════════════════════════════════════════════════════
          Lock, title, what this is, a count, and the one primary action — the
          mockup's top bar. The subtitle earns its line: "Access" as a tab name
          sounds like a permissions screen, and this is a password vault. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl"
            style={{
              backgroundColor:
                'color-mix(in oklab, var(--accent-primary) var(--tint-soft), var(--bg-surface))',
            }}
          >
            <Lock className="size-4 text-text-brand" strokeWidth={2.25} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-body-sm font-semibold text-text-primary">
              Credentials
              {credentials.length > 0 && (
                <Badge token="accent-primary" size="sm" variant="soft">
                  {credentials.length} {credentials.length === 1 ? 'item' : 'items'}
                </Badge>
              )}
            </p>
            <p className="text-micro text-text-tertiary">
              Secure vault for project logins and access
            </p>
          </div>
        </div>

        {canManage && (
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            Add credential
          </Button>
        )}
      </div>

      {note && (
        <p
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            color: note.ok ? 'var(--feedback-success)' : 'var(--feedback-error)',
          }}
        >
          {note.ok ? (
            <ShieldCheck className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <ShieldAlert className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          )}
          {note.text}
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
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => setCreating(true)}
              >
                <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
                Add the first one
              </Button>
            )}
          </CardBody>
        </Card>
      ) : (
        /* ⚠️ ONE COLUMN UNTIL `xl`, NOT `lg`. The panel carries a label, a URL, a
           masked secret and four action buttons on one row; at `lg` (1024px) the
           two columns together leave the panel about 34rem, and the action row
           wraps into two lines with the buttons half-width. Stacking is the
           better failure — the list stays scannable and the panel gets the page. */
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            <ul className="space-y-2">
              {credentials.map((credential) => (
                <li key={credential.id}>
                  <CredentialListRow
                    credential={credential}
                    selected={credential.id === selected?.id}
                    nowMs={nowMs}
                    canManage={canManage}
                    onSelect={() => select(credential.id)}
                    onEdit={() => setEditing(credential)}
                    onDelete={() => setConfirmDelete(credential)}
                  />
                </li>
              ))}
            </ul>

            {/* The mockup's reassurance card, under the list. It is true: see
                `credentials_secret_is_sealed` — the table itself refuses a row
                whose secret is not sealed, so this is a database invariant rather
                than a claim about how careful the code is. */}
            <div className="flex items-start gap-2.5 rounded-xl border border-border-subtle bg-bg-subtle px-3.5 py-3">
              <Lock
                className="mt-0.5 size-4 shrink-0 text-text-tertiary"
                strokeWidth={2}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-caption font-semibold text-text-primary">
                  All credentials are encrypted
                </p>
                <p className="text-micro text-text-secondary">
                  Sealed before they reach the database — the table refuses a secret that is not.
                </p>
              </div>
            </div>
          </div>

          {selected ? (
            <CredentialPanel
              credential={selected}
              nowMs={nowMs}
              canManage={canManage}
              readers={readers}
              busy={busy === selected.id}
              shownSecret={shown?.id === selected.id ? shown.secret : null}
              copied={copied}
              onClose={() => select(null)}
              onReveal={() => void obtain(selected.id, 'reveal')}
              onCopySecret={() => void obtain(selected.id, 'copy')}
              onCopyText={(text, key, message) => void toClipboard(text, key, message)}
              onEdit={() => setEditing(selected)}
              onDelete={() => setConfirmDelete(selected)}
              onClearSecret={() => setConfirmClear(selected)}
              onManageAccess={() => setAccess(true)}
            />
          ) : (
            /* Closing the panel is a real state, so it gets a real panel rather
               than collapsing the grid — the list would jump to full width and
               reflow every row the moment somebody pressed X. */
            <Card>
              <CardBody className="grid min-h-[18rem] place-items-center px-6 py-10 text-center">
                <div>
                  <KeyRound
                    className="mx-auto h-5 w-5 text-text-tertiary"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <p className="mt-2 text-body-sm font-semibold text-text-primary">
                    Choose a credential
                  </p>
                  <p className="mx-auto mt-1 max-w-[26rem] text-caption text-text-secondary">
                    Pick one on the left to see its URL, its username and the rest. The password
                    stays hidden until you ask for it.
                  </p>
                </div>
              </CardBody>
            </Card>
          )}
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
          people={people.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl }))}
          credential={editing ?? undefined}
        />
      )}

      <StepUpDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        /* Names the act being confirmed, so the challenge does not read as a random
           re-authentication — and says which of the two it was, because "copy" and
           "show" have different consequences for who else can see the screen. */
        actionLabel={pending?.intent === 'copy' ? 'copy this password' : 'show this credential'}
        onConfirmed={() => {
          const resume = pending;
          setPending(null);
          /* Resume the exact act they asked for. Anything else would make them hunt
             for the row again after proving who they are — and resuming a Copy as a
             Reveal would display a password somebody deliberately kept off screen. */
          if (resume) void obtain(resume.id, resume.intent);
        }}
      />

      {/* ⚠️ `credential` doubles as the open flag, so a closed dialogue holds no
          credential id at all. `onChanged` re-reads the grants THIS component
          keeps, because the panel's avatar stack is built from them — the dialogue
          loads its own copy and would otherwise leave the faces behind it stale. */}
      <CredentialAccessDialog
        credential={access && selected ? { id: selected.id, label: selected.label } : null}
        people={people}
        canGrant={canGrant}
        onClose={() => setAccess(false)}
        onChanged={() => {
          if (selected) loadGrants(selected.id);
        }}
      />

      {/* ── DELETE, AND WHAT IT DOES NOT DO ─────────────────────────────────
          A dialog rather than `window.confirm`: the native one blocks the page,
          cannot name the credential, and — the part that matters — cannot say that
          deleting the record does not revoke the account. */}
      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        size="sm"
        title={confirmDelete ? `Delete ${confirmDelete.label}?` : ''}
        footer={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={() => setConfirmDelete(null)}
              disabled={busy !== null}
            >
              Keep it
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
        {confirmDelete && (
          <div className="space-y-2">
            <p className="text-caption leading-relaxed text-text-secondary">
              This removes the record and the stored password from{' '}
              <span className="font-semibold text-text-primary">{projectName}</span>. It cannot be
              undone.
            </p>
            <p className="text-caption leading-relaxed text-text-secondary">
              {/* ⚠️ Said before the press. The account keeps working, and somebody
                  who thinks otherwise leaves a live login nobody is tracking. */}
              It does <span className="font-semibold text-text-primary">not</span> close or change
              the account itself — if this login should stop working, change the password at{' '}
              {credentialServiceLabel({
                url: confirmDelete.url,
                label: confirmDelete.label,
                kind: confirmDelete.kind,
                service: confirmDelete.service,
              })}{' '}
              as well.
            </p>
            <p className="text-micro text-text-tertiary">
              The deletion is recorded in the audit log against your name.
            </p>
          </div>
        )}
      </Dialog>

      {/* ── CLEAR THE PASSWORD, KEEP THE ACCOUNT ────────────────────────────
          The other half of `clearSecretAction`, which exists because forgetting a
          password and forgetting that an account exists are different decisions. */}
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
                  void run(confirmClear.id, () => clearSecretAction(confirmClear.id));
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
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * A ROW IN THE LIST
 * ----------------------------------------------------------------------------
 * ⚠️ THE ROW IS A `<button>`, AND THE MENU IS OUTSIDE IT. A `<details>` nested in
 * a button is invalid HTML and browsers recover from it by moving the element,
 * which breaks both. So the row is a grid: the button spans the clickable area and
 * the menu sits in its own column as a sibling.
 * ------------------------------------------------------------------------- */
function CredentialListRow({
  credential,
  selected,
  nowMs,
  canManage,
  onSelect,
  onEdit,
  onDelete,
}: {
  credential: CredentialRow;
  selected: boolean;
  nowMs: number;
  canManage: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const age = relativeAge(credential.updatedAt, nowMs);
  const service = credentialServiceLabel({
    url: credential.url,
    label: credential.label,
    kind: credential.kind,
    service: credential.service,
  });

  return (
    <div
      /* ── ⚠️ ALWAYS A 2px BORDER, ONLY THE COLOUR CHANGES ──────────────────
         Owner, 2026-08-24: *"increase the height of these cards"* and *"when one
         of these cards is hovered over or open… its border color should be dark
         green, like our theme color… that's our logo color or you can say the left
         sidebar color."*

         The width is constant on purpose. Going from `border` to `border-2` on
         selection moves the row's content by a pixel on each side, so clicking
         down a list makes every row twitch — and with six rows that reads as the
         page jumping rather than as a selection.

         The colour is `--border-brand-strong`, a token added for this — one step
         deeper than `--border-brand` in light mode and one step BRIGHTER in dark,
         because "stronger" means further from the background rather than darker.
         `--border-brand` was already teal-700 and the owner still read it as light:
         at 1px on a teal-50 background, it is.

         ⚠️ HOVER GETS THE FULL COLOUR, NOT A FADED VERSION. It was mixed to 55%
         so that hover "previewed" selection — owner, 2026-08-24: *"the same hovering
         effect. When I hover over the [other] tab, it should show this border around
         that plus the tab which is open also."* At 55% on a white row it read as a
         grey outline rather than as the green border they had just asked for.

         The open row stays distinguishable by its BACKGROUND (`bg-bg-selected`),
         which is the more reliable signal anyway: hover is transient and follows
         the pointer, so it cannot be confused with a persistent selection. */
      className={cn(
        'flex items-center gap-2.5 rounded-xl border-2 px-3.5 py-3.5',
        'transition-[border-color,background-color] duration-[140ms]',
        selected
          ? 'border-[var(--border-brand-strong)] bg-bg-selected'
          : 'border-border-subtle bg-bg-surface hover:border-[var(--border-brand-strong)]',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <CredentialIcon
          url={credential.url}
          label={credential.label}
          kind={credential.kind}
          service={credential.service}
          size={34}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-sm font-semibold text-text-primary">
            {credential.label}
          </span>
          {/* The service, then the age. The service name is the useful half — it
              says a row called "Main login" is actually cPanel. */}
          <span className="block truncate text-micro text-text-tertiary">
            {service}
            {age && <> {'•'} Last updated {age}</>}
          </span>
        </span>
      </button>

      {/* ── THE LOCK, IN ITS OWN BORDERED WELL ─────────────────────────────
          Owner, 2026-08-24: *"there is a lock icon appearing. I want to make its
          border prominent and increase its height also, exactly the same as shown
          in the screenshot."*

          It was a bare 14px glyph, which read as decoration next to the kebab
          beside it. In a bordered pill it reads as a STATUS — and it is one: a row
          with no stored secret is a record of an account whose password we do not
          hold, which is worth seeing before clicking into it.

          ⚠️ The border is what makes the two states distinguishable at a glance.
          A missing secret used to be "the same icon, fainter", which is not a
          difference anybody notices in a list; now the well itself goes quiet —
          dashed and dimmed — so an empty one is visible without reading. */}
      <span
        className={cn(
          'grid h-7 w-6 shrink-0 place-items-center rounded-md border',
          credential.hasSecret
            ? 'border-border-strong bg-bg-surface text-text-secondary'
            : 'border-dashed border-border-subtle text-text-disabled',
        )}
        title={
          credential.hasSecret
            ? 'A password is stored for this, sealed.'
            : 'No password stored — the record of the account only.'
        }
      >
        <Lock className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
        <span className="sr-only">
          {credential.hasSecret ? 'Password stored' : 'No password stored'}
        </span>
      </span>

      {canManage && (
        <RowMenu label={credential.label} onEdit={onEdit} onDelete={onDelete} />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * THE KEBAB
 * ----------------------------------------------------------------------------
 * ⚠️ `<details>`, NOT A HAND-ROLLED POPOVER — the same choice, for the same
 * reasons, as `ProjectMenu` on this page: Escape closes it, the summary toggles
 * it, and it is keyboard reachable, all from the browser with no state, no
 * outside-click listener and no focus trap to get wrong. The one thing it does
 * not do natively is close when an item is chosen, which is why each item closes
 * the parent explicitly.
 * ------------------------------------------------------------------------- */
function RowMenu({
  label,
  onEdit,
  onDelete,
  onClearSecret,
  hasSecret,
  align = 'right',
}: {
  label: string;
  onEdit: () => void;
  onDelete: () => void;
  /** Only the panel offers this — see the panel's menu for why. */
  onClearSecret?: () => void;
  hasSecret?: boolean;
  align?: 'right' | 'left';
}) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute('open');

  const item =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-caption text-text-secondary hover:bg-bg-hover hover:text-text-primary';

  return (
    <details ref={ref} className="relative shrink-0">
      <summary
        aria-label={`More for ${label}`}
        title={`More for ${label}`}
        className={cn(
          'grid size-7 cursor-pointer place-items-center rounded-md text-text-tertiary',
          'marker:content-none hover:bg-bg-hover hover:text-text-primary',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <MoreVertical className="size-4" strokeWidth={2.25} aria-hidden="true" />
      </summary>

      <div
        className={cn(
          'absolute z-20 mt-1 w-[13rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[var(--shadow-lg)]',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        <button
          type="button"
          className={item}
          onClick={() => {
            close();
            onEdit();
          }}
        >
          <Pencil className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          Edit details
        </button>

        {onClearSecret && hasSecret && (
          <button
            type="button"
            className={item}
            onClick={() => {
              close();
              onClearSecret();
            }}
          >
            <EyeOff className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            Forget the password
          </button>
        )}

        <button
          type="button"
          className={cn(item, 'hover:text-[var(--feedback-error)]')}
          style={{ color: 'var(--feedback-error)' }}
          onClick={() => {
            close();
            onDelete();
          }}
        >
          <Trash2 className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          Delete credential
        </button>
      </div>
    </details>
  );
}

/* ----------------------------------------------------------------------------
 * THE DETAIL PANEL
 * ------------------------------------------------------------------------- */
function CredentialPanel({
  credential,
  nowMs,
  canManage,
  readers,
  busy,
  shownSecret,
  copied,
  onClose,
  onReveal,
  onCopySecret,
  onCopyText,
  onEdit,
  onDelete,
  onClearSecret,
  onManageAccess,
}: {
  credential: CredentialRow;
  nowMs: number;
  canManage: boolean;
  readers: ReadonlyArray<{ name: string; src: string | null; role: string }>;
  busy: boolean;
  /** The plaintext, when this row is the one being shown. Null otherwise. */
  shownSecret: string | null;
  /** Which control last copied something, so exactly one shows a tick. */
  copied: string | null;
  onClose: () => void;
  onReveal: () => void;
  onCopySecret: () => void;
  onCopyText: (text: string, key: string, message: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClearSecret: () => void;
  onManageAccess: () => void;
}) {
  const age = relativeAge(credential.updatedAt, nowMs);

  return (
    <Card>
      <CardBody className="space-y-4 p-4 sm:p-5">
        {/* ── TITLE ROW ─────────────────────────────────────────────────────── */}
        <div className="flex items-start gap-3">
          <CredentialIcon
            url={credential.url}
            label={credential.label}
            kind={credential.kind}
            service={credential.service}
            size={40}
          />
          <div className="min-w-0 flex-1 space-y-1.5">
            <h3 className="truncate text-h3 text-text-primary">{credential.label}</h3>
            <Badge token="accent-primary" size="sm" variant="soft">
              {KIND_LABEL[credential.kind] ?? credential.kind.replace(/_/g, ' ')}
            </Badge>
          </div>
          <IconButton
            variant="ghost"
            size="sm"
            label="Close this credential"
            icon={X}
            onClick={onClose}
          />
        </div>

        {/* ── THE ACTION ROW ────────────────────────────────────────────────
            Open URL is primary because it is the only one of the four that is not
            about the secret — it is what somebody wants nine times out of ten. */}
        <div className="flex flex-wrap items-center gap-2">
          {credential.url ? (
            /* ⚠️ A REAL ANCHOR, not a button calling `window.open`. Middle-click,
               ⌘-click and "open in new window" all work on a link and none of them
               work on a click handler. `rel="noreferrer"` as well as noopener: a
               client's admin panel should not receive this CRM's URL as a
               referrer, and without noopener the new tab gets a `window.opener`
               handle back into this app. */
            <a
              href={credential.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-caption font-semibold',
                'bg-[image:var(--gradient-brand)] text-text-on-brand shadow-[var(--shadow-brand-glow)]',
                'hover:bg-[image:var(--gradient-brand-hover)] active:translate-y-px',
              )}
            >
              <ExternalLink className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
              Open URL
            </a>
          ) : (
            /* Rendered disabled rather than hidden, so the action row does not
               change shape between credentials and the reason is stated. */
            <span
              title="No URL is stored for this credential."
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-caption font-semibold text-text-tertiary opacity-70"
            >
              <ExternalLink className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
              No URL
            </span>
          )}

          <Button
            variant="secondary"
            size="md"
            disabled={busy || !credential.hasSecret}
            onClick={onReveal}
            title={
              credential.hasSecret
                ? 'Shows the password. Recorded against you in the security log.'
                : 'No password is stored for this credential.'
            }
          >
            {shownSecret ? (
              <EyeOff className="size-4" strokeWidth={2.25} aria-hidden="true" />
            ) : (
              <Eye className="size-4" strokeWidth={2.25} aria-hidden="true" />
            )}
            {shownSecret ? 'Hide' : 'Reveal'}
          </Button>

          {/* ⚠️ COPY COSTS THE SAME AS REVEAL — see the file header. It hands
              over a working secret, just to the clipboard instead of the screen. */}
          <Button
            variant="secondary"
            size="md"
            disabled={busy || !credential.hasSecret}
            onClick={onCopySecret}
            title={
              credential.hasSecret
                ? 'Copies the password to your clipboard. Needs the same confirmation as Reveal, and is audited the same way.'
                : 'No password is stored for this credential.'
            }
          >
            {copied === credential.id ? (
              <Check
                className="size-4"
                strokeWidth={2.5}
                aria-hidden="true"
                style={{ color: 'var(--feedback-success)' }}
              />
            ) : (
              <Copy className="size-4" strokeWidth={2.25} aria-hidden="true" />
            )}
            {copied === credential.id ? 'Copied' : 'Copy'}
          </Button>

          {canManage && (
            <Button variant="secondary" size="md" onClick={onEdit}>
              <Pencil className="size-4" strokeWidth={2.25} aria-hidden="true" />
              Edit
            </Button>
          )}

          {canManage && (
            <div className="ml-auto">
              <RowMenu
                label={credential.label}
                onEdit={onEdit}
                onDelete={onDelete}
                /* Only here, not on the list rows. Forgetting a password is a
                   decision about the row you are looking AT — offering it from a
                   list, where the reader has not seen which account it is, is how
                   the wrong one gets cleared. */
                onClearSecret={onClearSecret}
                hasSecret={credential.hasSecret}
              />
            </div>
          )}
        </div>

        {/* ── THE FIELDS ───────────────────────────────────────────────────── */}
        <dl className="space-y-3 border-t border-border-subtle pt-4">
          <Field label="URL">
            {credential.url ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <a
                  href={credential.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate text-body-sm text-text-brand hover:underline"
                >
                  {credential.url}
                </a>
                <ExternalLink
                  className="size-3.5 shrink-0 text-text-brand"
                  strokeWidth={2.25}
                  aria-hidden="true"
                />
                <CopyButton
                  value={credential.url}
                  what="URL"
                  copied={copied === `url:${credential.id}`}
                  copyKey={`url:${credential.id}`}
                  onCopy={onCopyText}
                />
              </span>
            ) : (
              <Empty />
            )}
          </Field>

          <Field label="Username / Email">
            {credential.username ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-body-sm text-text-primary">
                  {credential.username}
                </span>
                <CopyButton
                  value={credential.username}
                  what="username"
                  copied={copied === `user:${credential.id}`}
                  copyKey={`user:${credential.id}`}
                  onCopy={onCopyText}
                />
              </span>
            ) : (
              <Empty />
            )}
          </Field>

          <Field label="Password / Secret">
            {credential.hasSecret ? (
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  className={cn(
                    'min-w-0 truncate rounded px-1.5 py-0.5 font-mono text-body-sm',
                    shownSecret
                      ? 'bg-bg-active text-text-primary'
                      : 'tracking-[0.18em] text-text-tertiary',
                  )}
                >
                  {/* Sixteen dots regardless of the real length. A mask that
                      matched it would leak how long the password is, which is the
                      one fact a mask exists to hide. */}
                  {shownSecret ?? '•'.repeat(16)}
                </span>

                <button
                  type="button"
                  onClick={onReveal}
                  disabled={busy}
                  className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-text-brand hover:underline disabled:opacity-60"
                >
                  {shownSecret ? (
                    <EyeOff className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  ) : (
                    <Eye className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  )}
                  {shownSecret ? 'Hide' : 'Reveal'}
                </button>

                <IconButton
                  variant="ghost"
                  size="sm"
                  label={`Copy the password for ${credential.label}`}
                  icon={copied === credential.id ? Check : Copy}
                  disabled={busy}
                  onClick={onCopySecret}
                />
              </span>
            ) : (
              <span className="text-body-sm text-text-tertiary">
                None stored — the record only.
              </span>
            )}
          </Field>

          {/* ── ⚠️ THE MOCKUP'S "Recovery Email / Phone" SLOT ────────────────
              There is no such column, and the owner asked to keep the data the
              same — see the file header. These three are the real fields the old
              card grid had nowhere to show, and they answer the same kind of
              question: who holds this, and is it still current. Each is hidden
              when empty rather than rendered as a dash, so a credential with none
              of them does not carry three blank rows. */}
          {credential.holders.length > 0 && (
            <Field label="Held by">
              <span className="text-body-sm text-text-primary">
                {/* Every holder — see the note on the vault table's column. */}
                {credential.holders.map((h) => h.name).join(', ')}
                <span className="ml-2 text-micro text-text-tertiary">
                  custody, not access — see who can see this, below
                </span>
              </span>
            </Field>
          )}

          {credential.expiresAt && (
            <Field label="Expires">
              <span className="text-body-sm text-text-primary">{credential.expiresAt}</span>
            </Field>
          )}

          {credential.lastRotatedAt && (
            <Field label="Password changed">
              <span className="text-body-sm text-text-primary">
                {absolute(credential.lastRotatedAt)}
                <span className="ml-2 text-micro text-text-tertiary">
                  {relativeAge(credential.lastRotatedAt, nowMs)}
                </span>
              </span>
            </Field>
          )}

          {credential.notes && (
            <Field label="Notes">
              {/* `whitespace-pre-line`: the notes field is a textarea and people
                  put each fact on its own line. Collapsing them into a paragraph
                  loses the only structure the field has. */}
              <span className="whitespace-pre-line text-body-sm leading-relaxed text-text-secondary">
                {credential.notes}
              </span>
            </Field>
          )}
        </dl>

        {/* ── WHO CAN SEE THIS ───────────────────────────────────────────────
            ⚠️ `<span>` AND `<p>`, NOT `<dt>`/`<dd>`. These two rows line up with
            the `<dl>` above and were first written with the same tags to match —
            but they are OUTSIDE it, and `<dt>` outside a `<dl>` is invalid HTML
            that browsers recover from unpredictably. This block also holds a
            button, which has no place in a definition pair. The label column keeps
            the same width so the alignment survives; only the tags changed. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="w-[10.5rem] shrink-0 text-caption text-text-tertiary">
              People with access
            </span>
            {readers.length > 0 ? (
              <AvatarStack names={readers} max={4} size="md" />
            ) : (
              <span className="text-caption text-text-tertiary">Coordinators and Admins</span>
            )}
          </div>

          {/* ⚠️ NOT "Manage access". There is no per-credential grant to manage —
              access is rank (migration 047) — and a button that implied otherwise
              would misrepresent who can read a client's password. It opens the
              rule, and the list, and the one place the rule is actually changed. */}
          <Button variant="secondary" size="sm" onClick={onManageAccess}>
            <UserCog className="size-4" strokeWidth={2.25} aria-hidden="true" />
            Who can see this
          </Button>
        </div>

        <div className="flex flex-wrap items-baseline gap-3">
          <span className="w-[10.5rem] shrink-0 text-caption text-text-tertiary">
            Last updated
          </span>
          <p className="text-body-sm text-text-primary">
            {absolute(credential.updatedAt)}
            {credential.updatedByName && (
              <span className="text-text-secondary"> by {credential.updatedByName}</span>
            )}
            {age && <span className="ml-2 text-micro text-text-tertiary">{age}</span>}
          </p>
        </div>

        {/* ── THE FOOTER NOTICE ────────────────────────────────────────────── */}
        <div
          className="flex items-start gap-2.5 rounded-xl border px-3.5 py-3"
          style={{
            borderColor: 'color-mix(in oklab, var(--feedback-success) 30%, transparent)',
            backgroundColor: 'color-mix(in oklab, var(--feedback-success) 8%, transparent)',
          }}
        >
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0"
            strokeWidth={2.25}
            aria-hidden="true"
            style={{ color: 'var(--feedback-success)' }}
          />
          <div className="min-w-0">
            <p className="text-caption font-semibold text-text-primary">
              This credential is encrypted and stored securely
            </p>
            {/* ⚠️ NO LONGER MENTIONS A CONFIRMATION. It used to say "showing or
                copying the password needs a fresh confirmation", which stopped being
                true when the owner removed the step-up on 2026-08-25. A security
                note that overstates the control is worse than none: somebody reads
                it and believes the vault is harder to open than it is.

                What is left is what still holds, and the audit line now carries
                more weight than it did — it is the only control on a reveal. */}
            <p className="text-micro text-text-secondary">
              Only Team Coordinators and Admins can open it, and every time the password is
              shown or copied it is recorded against the person who did it.
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/* ---- Small pieces -------------------------------------------------------- */

/** A label/value row. The label column is fixed so every value lines up — the
 *  mockup's alignment, and the reason the panel scans as a table rather than as a
 *  paragraph. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="w-[10.5rem] shrink-0 text-caption text-text-tertiary">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center">{children}</dd>
    </div>
  );
}

function Empty() {
  return <span className="text-body-sm text-text-tertiary">Not recorded</span>;
}

/**
 * Copy one non-secret value.
 *
 * ⚠️ DELIBERATELY NOT THE SAME PATH AS THE PASSWORD. A URL and a username are
 * already rendered on this page, so copying them reveals nothing new and takes no
 * step-up and no audit entry. The password's copy goes through
 * `revealCredentialAction` because it hands over something not on screen. Treating
 * the two the same in either direction would be wrong: one would demand a
 * challenge to copy a visible email address, the other would leak a password.
 */
function CopyButton({
  value,
  what,
  copyKey,
  copied,
  onCopy,
}: {
  value: string;
  what: string;
  copyKey: string;
  copied: boolean;
  onCopy: (text: string, key: string, message: string) => void;
}) {
  return (
    <IconButton
      variant="ghost"
      size="sm"
      label={`Copy the ${what}`}
      icon={copied ? Check : Copy}
      onClick={() => onCopy(value, copyKey, `The ${what} is on your clipboard.`)}
    />
  );
}

/* ----------------------------------------------------------------------------
 * WHO CAN SEE THIS — MOVED OUT ON 2026-08-25
 * ----------------------------------------------------------------------------
 * The dialogue that used to live here is now
 * components/vault/credential-access-dialog.tsx, unchanged in behaviour and shared
 * with the Vault page.
 *
 * ⚠️ WHY IT MOVED RATHER THAN BEING COPIED. The Vault needed the same control, and
 * two dialogues deciding who may read a password is a security bug waiting for the
 * day one is fixed and the other is not. Everything the old one knew is still
 * enforced there and worth restating, because it is all owner instruction:
 *
 *   · three row states — by rank, named in, excluded — drawn differently, because
 *     a rank row cannot be revoked and somebody who does not know that presses
 *     Remove and finds nothing happens;
 *   · an excluded person stays LISTED, struck through, naming who excluded them,
 *     so "why can't Kashif see this" is answerable by looking. That is the
 *     mitigation for having an allow-list and a deny-list at once, which I argued
 *     against and the owner asked for anyway;
 *   · the Super Admin has no bin at all — *"I can't delete super admin"* — because
 *     they are the last route back into the vault, and migration 052's trigger
 *     refuses it too;
 *   · the step-up on `credential.grant` survives and RESUMES, so proving who you
 *     are finishes the change instead of returning you to the start of it.
 *
 * The new file loads its own grants, so it takes a credential and the team rather
 * than a pre-merged reader list. The merge that used to feed it is gone; what
 * remains below (`readers`) exists only for the panel's avatar stack.
 * ------------------------------------------------------------------------- */
