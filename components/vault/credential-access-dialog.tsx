'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, Plus, ShieldCheck, Undo2, UserMinus, X } from 'lucide-react';

import { listCredentialGrantsAction, setCredentialAccessAction } from '@/app/actions/credentials';
import { StepUpDialog } from '@/components/security/step-up-dialog';
import { Avatar } from '@/components/ui/avatar';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHO CAN SEE THIS CREDENTIAL
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-25: *"when I click on 'Who can see it?' it is not showing a modal
 * in which the list of people who can see these credentials is visible."*
 *
 * ── ⚠️ WHY THIS FILE EXISTS RATHER THAN A SECOND COPY OF THE OLD DIALOGUE ───
 * There was already a working one, private inside
 * components/project/project-credentials.tsx, taking a prop shape its caller
 * assembled: rank rows merged with grant rows, exceptions replacing the rank row
 * they override, plus a grantable list. Roughly 250 lines of dialogue and 60 of
 * merge above it.
 *
 * Copying that to the Vault would mean TWO dialogues deciding who may read a
 * password. The day one is fixed and the other is not, they disagree about access —
 * and this is the one screen in the system where disagreeing about access is a
 * security bug rather than a cosmetic one. So it is one component, and it is
 * SELF-CONTAINED: it loads its own grants and computes its own rows, so a caller
 * only has to say which credential and who the team is.
 *
 * ── ⚠️ TWO KINDS OF ROW, AND THEY ARE NOT THE SAME THING ────────────────────
 *   by rank    Coordinator and above can open every credential (migration 047).
 *              These people are not "granted" anything and cannot be revoked —
 *              only excluded, which writes a `deny` row.
 *   by name    A `credential_grants` row an Admin created (050), with an author
 *              and a date, revocable.
 *
 * Showing them identically would invite somebody to "remove" a Coordinator and
 * find the button does nothing, so a rank row says why it is there.
 *
 * ── ⚠️ THE STEP-UP STAYS, AND IT RESUMES ────────────────────────────────────
 * `credential.grant` KEEPS its step-up — reading hands one secret to the person at
 * the keyboard, granting hands it to a third party until somebody notices. Only
 * `credential.reveal` lost the prompt (owner, 2026-08-25).
 *
 * So the challenge is raised HERE and the change is retried afterwards, rather than
 * being reported as an error telling somebody to go to the Security page and come
 * back. Sending a person away to prove who they are and then making them find the
 * row again is how a feature stops being used. The challenge opens OVER this
 * dialogue, so the list is still on screen when the change lands.
 * ========================================================================= */

export type AccessIntent = 'grant' | 'exclude' | 'reset';

/** Ranks that can open any credential — the floor from migration 047. */
const CAN_READ = new Set(['super_admin', 'admin', 'team_coordinator']);

interface GrantRow {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  effect: 'allow' | 'deny';
  grantedByName: string | null;
}

export interface CredentialAccessDialogProps {
  /** Null closes it. The id is what the grants are loaded for. */
  readonly credential: { readonly id: string; readonly label: string } | null;
  /** The whole team, with ranks — the rank rows are derived from this. */
  readonly people: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly role?: string | null;
    readonly avatarUrl?: string | null;
  }>;
  /** `credential.grant` — Admin and above only. */
  readonly canGrant: boolean;
  readonly onClose: () => void;
  /** Fired after a successful change, so the caller can refresh its counts. */
  readonly onChanged: () => void;
}

export function CredentialAccessDialog({
  credential,
  people,
  canGrant,
  onClose,
  onChanged,
}: CredentialAccessDialogProps) {
  const [grants, setGrants] = React.useState<readonly GrantRow[] | null>(null);
  const [note, setNote] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  /** What to retry once they have proved who they are. See the header. */
  const [pending, setPending] = React.useState<{
    userId: string;
    intent: AccessIntent;
  } | null>(null);
  const [adding, setAdding] = React.useState(false);

  const id = credential?.id ?? null;

  /**
   * Load the named grants.
   *
   * ⚠️ AND IT CATCHES. This was `void …then(…)` in the original and the first thing
   * that went wrong was migration 050 not being applied — the action threw
   * `relation "credential_grants" does not exist`, which became an unhandled
   * rejection and left the list silently empty. Silently empty is the worst
   * possible failure for THIS list: it reads as "nobody else can see this
   * password". So a failure sets an empty list AND says so.
   */
  const load = React.useCallback((credentialId: string) => {
    let alive = true;
    /* ⚠️ NO `setGrants(null)` HERE. This is called from an effect body, and a
       synchronous setState there is the render cascade the lint refuses — the same
       note the project component carried. The reset happens during render below,
       where changing credential is handled as a whole. */
    void listCredentialGrantsAction(credentialId)
      .then((result) => {
        if (!alive) return;
        if (result.ok) setGrants(result.grants as readonly GrantRow[]);
        else {
          setGrants([]);
          setNote({ ok: false, text: result.error });
        }
      })
      .catch(() => {
        if (!alive) return;
        setGrants([]);
        setNote({
          ok: false,
          text: 'Who has been named on this credential could not be read, so the list below shows only the people who can open it by rank.',
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  /* ── ⚠️ RESET DURING RENDER, NOT IN AN EFFECT ─────────────────────────────
     Opening this on a different credential has to clear everything held about the
     last one — the grants above all, because showing the previous credential's
     readers for the moment before the fetch returns says "this Member can see this
     password" about the wrong password. That is exactly the thing to never be
     briefly wrong about.

     Doing it in an effect means one render where the old rows are on screen, and
     the lint refuses a synchronous setState there anyway. Adjusting state during
     render is React's own answer for "derive from a prop that changed": it
     re-renders before anything is painted, so the stale list never appears. */
  const [shownFor, setShownFor] = React.useState<string | null>(id);
  if (id !== shownFor) {
    setShownFor(id);
    setGrants(null);
    setNote(null);
    setAdding(false);
    setPending(null);
  }

  React.useEffect(() => {
    if (!id) return;
    return load(id);
  }, [id, load]);

  /* Rank rows, minus anybody who has an exception — the merged row below replaces
     them. Without this an excluded Coordinator appears twice: once "by rank" and
     once struck through. */
  const rows = React.useMemo(() => {
    const named = grants ?? [];
    const byRank = people
      .filter((p) => CAN_READ.has(p.role ?? ''))
      .filter((p) => !named.some((g) => g.userId === p.id))
      .map((p) => ({
        userId: p.id,
        name: p.name,
        avatarUrl: p.avatarUrl ?? null,
        role: p.role ?? 'member',
        effect: null as 'allow' | 'deny' | null,
        grantedByName: null as string | null,
      }));

    const merged = [
      ...byRank,
      ...named.map((g) => ({
        ...g,
        effect: g.effect as 'allow' | 'deny' | null,
      })),
    ];

    /* Seniors first, then Members named in, then anybody excluded — which puts the
       exceptions at the bottom, where they read as exceptions rather than as part
       of the ordinary list. */
    const rank = ['super_admin', 'admin', 'team_coordinator', 'member'];
    const weight = (r: (typeof merged)[number]) =>
      r.effect === 'deny' ? 2 : r.effect === 'allow' ? 1 : 0;
    return merged.sort((a, b) => {
      if (weight(a) !== weight(b)) return weight(a) - weight(b);
      const byRankOrder = rank.indexOf(a.role) - rank.indexOf(b.role);
      return byRankOrder !== 0 ? byRankOrder : a.name.localeCompare(b.name);
    });
  }, [people, grants]);

  /* Who may still be added: active Members with no exception row. Coordinators and
     above are deliberately absent — they can already open it, so a grant would add
     nothing and could not be revoked. The action refuses them too. */
  const grantable = React.useMemo(
    () =>
      people
        .filter((p) => (p.role ?? '') === 'member')
        .filter((p) => !(grants ?? []).some((g) => g.userId === p.id))
        .map((p) => ({
          id: p.id,
          name: p.name,
          avatarUrl: p.avatarUrl ?? null,
        })),
    [people, grants],
  );

  const change = async (userId: string, intent: AccessIntent) => {
    if (!id) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await setCredentialAccessAction(id, userId, intent);
      if (result.stepUpRequired) {
        /* Remembered rather than reported, so confirming finishes the job they
           asked for instead of returning them to the start of it. */
        setPending({ userId, intent });
        return;
      }
      setNote({ ok: result.ok, text: result.error ?? result.message ?? '' });
      if (result.ok) {
        load(id);
        onChanged();
      }
    } catch {
      setNote({
        ok: false,
        text: 'That could not be completed — the server did not answer.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* ⚠️ Rendered OUTSIDE the dialogue's own `open`, so it survives while the
          list stays put. `actionLabel` names the act rather than the screen: a
          challenge that says "confirm to continue" could be confirming anything,
          which is the substitution step-up exists to prevent. */}
      <StepUpDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        actionLabel={
          pending?.intent === 'grant'
            ? 'give somebody access to this password'
            : pending?.intent === 'exclude'
              ? 'stop somebody seeing this password'
              : 'change who can see this password'
        }
        onConfirmed={() => {
          const resume = pending;
          setPending(null);
          if (resume) void change(resume.userId, resume.intent);
        }}
      />

      <Dialog
        open={credential !== null}
        onClose={onClose}
        title="Who can see this credential"
        description={credential?.label}
        size="md"
      >
        <div className="space-y-3">
          {note && (
            <p
              className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
              style={{
                backgroundColor: 'var(--bg-subtle)',
                color: note.ok ? 'var(--feedback-success)' : 'var(--feedback-error)',
              }}
            >
              {!note.ok && (
                <AlertTriangle
                  className="mt-px size-4 shrink-0"
                  strokeWidth={2.25}
                  aria-hidden="true"
                />
              )}
              {note.text}
            </p>
          )}

          {grants === null ? (
            <p className="flex items-center gap-2 py-6 text-caption text-text-tertiary">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Reading who has access…
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {rows.map((row) => {
                const excluded = row.effect === 'deny';
                const named = row.effect !== null;
                /* ⚠️ NO CONTROL FOR THE SUPER ADMIN, and it says why rather than
                 offering a bin that fails. Owner, 2026-08-24: *"I can't delete
                 super admin."* The trigger in migration 052 refuses a `deny` row
                 for them outright — they are the last route back into the vault, so
                 a credential they cannot read is a credential nobody can recover.
                 Without this the button was there, pressing it raised a
                 check_violation, and the dialogue reported a failure for something
                 that was never allowed. */
                const untouchable = row.role === 'super_admin';

                return (
                  <li key={row.userId} className="flex items-center gap-2.5 py-2.5">
                    <Avatar name={row.name} src={row.avatarUrl} size="sm" />

                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'block truncate text-body-sm',
                          excluded ? 'text-text-tertiary line-through' : 'text-text-primary',
                        )}
                      >
                        {row.name}
                      </span>
                      <span className="block truncate text-micro text-text-tertiary">
                        {/* ⚠️ Says WHY each person is here. A rank row cannot be
                          revoked, only excluded, and a reader who does not know
                          that presses Remove and finds nothing happens. */}
                        {excluded
                          ? 'Excluded — cannot open it'
                          : named
                            ? row.grantedByName
                              ? `Named by ${row.grantedByName}`
                              : 'Named on this credential'
                            : `Can open it by rank (${row.role.replace(/_/g, ' ')})`}
                      </span>
                    </span>

                    {canGrant && untouchable && !excluded && (
                      <span
                        className="shrink-0 pr-2 text-micro text-text-tertiary"
                        title="The Super Admin is the last route back into the vault and cannot be excluded from a credential."
                      >
                        always
                      </span>
                    )}

                    {canGrant && !(untouchable && !excluded) && (
                      <span className="flex shrink-0 items-center gap-1">
                        {excluded ? (
                          <Action
                            label={`Let ${row.name} see it again`}
                            icon={Undo2}
                            busy={busy}
                            onClick={() => void change(row.userId, 'reset')}
                          />
                        ) : named ? (
                          /* A named grant is revoked outright — `reset` deletes the
                           row, leaving the person with whatever their rank gives. */
                          <Action
                            label={`Stop ${row.name} seeing it`}
                            icon={UserMinus}
                            busy={busy}
                            onClick={() => void change(row.userId, 'reset')}
                          />
                        ) : (
                          /* Rank rows can only be EXCLUDED — writing a `deny` row
                           (migration 052) — because there is no grant to remove. */
                          <Action
                            label={`Exclude ${row.name}`}
                            icon={UserMinus}
                            busy={busy}
                            onClick={() => void change(row.userId, 'exclude')}
                          />
                        )}
                      </span>
                    )}
                  </li>
                );
              })}

              {rows.length === 0 && (
                <li className="py-6 text-center text-caption text-text-tertiary">
                  {/* ⚠️ TWO DIFFERENT EMPTIES, and saying the wrong one is a lie
                      about access. The project page loads its people list only for
                      somebody who may edit the project, so a Member opening this
                      gets an empty `people` — and "nobody can open this" would be
                      flatly false about a credential every Coordinator can read. */}
                  {people.length === 0
                    ? 'Who can open this cannot be listed from here — it needs the team list, which this page does not load for your rank.'
                    : 'Nobody can open this credential — not even by rank. That is unusual; check the team’s roles.'}
                </li>
              )}
            </ul>
          )}

          {/* ---- Add somebody --------------------------------------------------- */}
          {canGrant && grants !== null && (
            <div className="border-t border-border-subtle pt-3">
              {!adding ? (
                <button
                  type="button"
                  disabled={grantable.length === 0}
                  onClick={() => setAdding(true)}
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-lg border border-border-default px-3',
                    'text-caption font-semibold text-text-primary hover:bg-bg-hover',
                    'disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent',
                  )}
                  title={
                    grantable.length === 0
                      ? 'Everybody who could be named already is — Coordinators and above can open it by rank'
                      : undefined
                  }
                >
                  <Plus className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                  Name somebody
                </button>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-caption text-text-secondary">
                    {/* Members only, and it says so — otherwise the short list looks
                      like a bug rather than a rule. */}
                    Team members who cannot already open it by rank:
                  </p>
                  <div className="max-h-[10rem] space-y-1 overflow-y-auto">
                    {grantable.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setAdding(false);
                          void change(person.id, 'grant');
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-caption text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                      >
                        <Avatar name={person.name} src={person.avatarUrl} size="xs" />
                        {person.name}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setAdding(false)}
                    className="flex items-center gap-1 text-micro text-text-tertiary hover:text-text-primary"
                  >
                    <X className="size-3" strokeWidth={2.5} aria-hidden="true" />
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {canGrant && (
            /* ⚠️ The mitigation for having BOTH an allow-list and a deny-list. I
             argued against exclusions for exactly this reason — "why can I not see
             this?" becomes hard to answer — and the owner asked for them anyway. So
             the answer lives in the list: excluded people stay visible, and this
             says which lever changes what. */
            <p className="border-t border-border-subtle pt-3 text-micro leading-relaxed text-text-tertiary">
              Changes here affect <span className="font-semibold">this credential only</span> — a
              person&rsquo;s rank is untouched and they keep every other credential. To change what
              a rank can reach at all, change it on the Team page.
            </p>
          )}

          {!canGrant && (
            <p className="flex items-start gap-2 border-t border-border-subtle pt-3 text-micro text-text-tertiary">
              <ShieldCheck
                className="mt-px size-3.5 shrink-0"
                strokeWidth={2.25}
                aria-hidden="true"
              />
              {/* Read-only for a Coordinator, and the reason is worth stating: handing
                a password to a third person cannot be undone by revoking it. */}
              Only an Admin can change this. Naming somebody cannot be taken back once they have
              seen the password, so it is the higher-ranked act.
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}

function Action({
  label,
  icon: Icon,
  busy,
  onClick,
}: {
  label: string;
  icon: typeof UserMinus;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-lg text-text-tertiary hover:bg-bg-active hover:text-text-primary disabled:opacity-40"
    >
      <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}
