'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  MoreVertical,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';

import { credentialActivityAction, listCredentialGrantsAction } from '@/app/actions/credentials';
import type { CredentialEventRow, CredentialRow } from '@/lib/db/queries/credentials';
import { credentialService } from '@/lib/domain/credential-service';
import {
  credentialOpeners,
  credentialReaders,
  type AccessGrant,
  type AccessPerson,
} from '@/lib/domain/credential-access';
import { brandMarkLabel } from '@/lib/brand/service-marks';
import { CredentialIcon } from '@/components/brand/credential-icon';
import { AvatarStack } from '@/components/ui/avatar';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { KIND_LABEL } from './credential-dialog';

/* ============================================================================
 * ONE CREDENTIAL, IN FULL
 * ----------------------------------------------------------------------------
 * Rebuilt 2026-08-25 to the owner's reference: the URL, the username, the
 * password, the notes, who can see it and which project it belongs to — laid out
 * as a label/value sheet rather than a stack of cards.
 *
 * ── ⚠️ WHY IT IS A `Dialog` AND NOT THE DRAWER IT WAS ───────────────────────
 * It used to paint its own scrim in a `fixed inset-0 z-50` div and slide in from
 * the right. Owner: *"When I click on a row, it shows a modal that is not popping
 * up properly… half of the background is totally out of form."* They were right,
 * and the cause was stacking: the sidebar is ALSO `fixed z-50`, so it drew over the
 * scrim and the dimming stopped halfway across the screen.
 *
 * `Dialog` is a native `<dialog>`, which renders in the browser's top layer — above
 * every z-index on the page by definition, so it cannot be out-stacked by a sidebar
 * or a sticky header. It also brings the two other things asked for: it centres,
 * and it caps at 92dvh with the BODY scrolling inside, so a long credential scrolls
 * the sheet rather than the page behind it.
 *
 * ── ⚠️ THE SECRET IS NEVER A PROP OF THE PAGE ───────────────────────────────
 * `credential` carries `hasSecret`, not the secret. The plaintext arrives only from
 * `revealCredentialAction`, lives in the workspace's state, and goes when this
 * closes. Passing it from the server would put a decrypted password into the HTML
 * of every row.
 *
 * ── ⚠️ NO PASSWORD PROMPT ───────────────────────────────────────────────────
 * Owner, 2026-08-25: *"don't require confirming the password again… Just decrypt
 * the credential and let me watch."* The eye reveals directly. That is also why the
 * activity log is a tab here rather than a link to the security screen: with the
 * step-up gone the log is the only remaining control on a reveal, and a control
 * nobody can find is not one.
 *
 * ── ⚠️ TWO AUDIENCES, ONE COMPONENT ─────────────────────────────────────────
 * Owner: *"all this information is for the admin, or you can say, the coordinator…
 * The things will be different for the team members."* `canOversee` is
 * `credential.view` — Coordinator and above. A Member is here only because an Admin
 * named them on this one credential (migration 050), so they get the credential
 * itself and nothing about the management of it: no access list, no activity log, no
 * share history, no status controls. Every one of those is refused server-side too,
 * so hiding them is honesty rather than security.
 *
 * ── ⚠️ COPY DOES NOT REVEAL, AND REVEAL DOES NOT COPY ───────────────────────
 * Two separate controls on the password row. Copying without showing is the safer
 * habit — the secret goes to the clipboard and nothing goes on screen for somebody
 * behind you to read — and one button doing both takes that choice away.
 * ========================================================================= */

type Tab = 'details' | 'activity' | 'shares';

export interface CredentialDetailsProps {
  readonly credential: CredentialRow;
  /** The plaintext, once revealed. Null until then. */
  readonly secret: string | null;
  /** The team, with ranks — the row of faces is derived from it. */
  readonly people: readonly AccessPerson[];
  /** `credential.view` — Coordinator and above. See the header. */
  readonly canOversee: boolean;
  readonly canManage: boolean;
  readonly canGrant: boolean;
  readonly busy: boolean;
  /** The server's clock. See lib/now.ts. */
  readonly nowMs: number;
  /**
   * Bumped by the page whenever the access dialogue changes something.
   *
   * ⚠️ That dialogue loads its own grants and so does this, so a change made there
   * would leave the faces here stale. Rather than share mutable state between two
   * dialogs, the page bumps a number and this re-reads.
   */
  readonly accessToken: number;
  readonly onClose: () => void;
  readonly onReveal: () => void;
  readonly onHide: () => void;
  readonly onEdit: () => void;
  readonly onStatus: (status: 'active' | 'inactive' | 'compromised') => void;
  readonly onAccess: () => void;
  /**
   * Destroy the stored password, keep the account record.
   *
   * ⚠️ Behind the overflow menu and a confirmation, never on the bar. Forgetting a
   * password and forgetting that an account exists are different decisions — the
   * URL, the username and the notes survive this — and it is the one act here that
   * cannot be undone by doing it again.
   */
  readonly onClearSecret: () => void;
}

const STATUS_META = {
  active: { label: 'Active', token: 'status-done' },
  inactive: { label: 'Inactive', token: 'status-backlog' },
  compromised: { label: 'Compromised', token: 'feedback-error' },
} as const;

export function CredentialDetails({
  credential,
  secret,
  people,
  canOversee,
  canManage,
  canGrant,
  busy,
  nowMs,
  accessToken,
  onClose,
  onReveal,
  onHide,
  onEdit,
  onStatus,
  onAccess,
  onClearSecret,
}: CredentialDetailsProps) {
  const [tab, setTab] = React.useState<Tab>('details');
  const [events, setEvents] = React.useState<readonly CredentialEventRow[] | null>(null);
  const [loadingLog, setLoadingLog] = React.useState(false);
  const [grants, setGrants] = React.useState<readonly AccessGrant[] | null>(null);
  const [copied, setCopied] = React.useState<'user' | 'secret' | 'url' | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);

  const meta = STATUS_META[credential.status] ?? STATUS_META.active;

  /* `brandMarkLabel` is passed so the resolver can name a chosen mark without
     `lib/domain` importing `lib/brand` — see its `markLabel` note. */
  const identity = credentialService({
    url: credential.url,
    label: credential.label,
    kind: credential.kind,
    service: credential.service,
    markLabel: brandMarkLabel,
  });

  /* ── Who can open it ──────────────────────────────────────────────────────
     ⚠️ Loaded here rather than passed in. It used to arrive as a `grants` prop the
     page hard-coded to `null`, so the Share history tab sat permanently in its
     loading state and the row of faces could not be drawn at all.

     ⚠️ Not attempted for a Member: `listCredentialGrantsAction` checks
     `credential.view` and would answer "you cannot read the vault" — a true
     refusal, but a pointless one to show somebody who is not asking. */
  React.useEffect(() => {
    if (!canOversee) return;
    let alive = true;
    void listCredentialGrantsAction(credential.id)
      .then((result) => {
        if (!alive) return;
        setGrants(result.ok ? result.grants : []);
      })
      .catch(() => {
        /* An empty list is the honest fallback: the rank rows are still right, and
           they are the majority of the answer. */
        if (alive) setGrants([]);
      });
    return () => {
      alive = false;
    };
  }, [credential.id, canOversee, accessToken]);

  const openers = React.useMemo(
    () => credentialOpeners(credentialReaders(people, grants ?? [])),
    [people, grants],
  );

  const openLog = async () => {
    setTab('activity');
    if (events !== null || loadingLog) return;
    setLoadingLog(true);
    try {
      const result = await credentialActivityAction(credential.id);
      setEvents(result.ok ? result.events : []);
    } finally {
      setLoadingLog(false);
    }
  };

  const copy = async (what: 'user' | 'secret' | 'url', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      /* Cleared on a timer rather than left showing — a permanent tick reads as
         "this is on the clipboard now", which stops being true the moment somebody
         copies anything else. */
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      /* A denied clipboard is not worth an error banner: the value is on screen and
         can be selected. Silently doing nothing is the honest outcome. */
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={credential.label}
      header={
        <div className="flex min-w-0 items-center gap-3">
          <CredentialIcon
            url={credential.url}
            label={credential.label}
            kind={credential.kind}
            service={credential.service}
            size={38}
          />
          <div className="min-w-0">
            <h2 className="truncate text-h3 text-text-primary">{credential.label}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {/* The kind, as the owner's reference draws it — a dotted chip rather
                  than a line of grey text. */}
              <span className="inline-flex items-center gap-1.5 rounded-full bg-bg-subtle px-2 py-0.5 text-micro font-semibold text-text-secondary">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: 'var(--accent-primary)' }}
                />
                {KIND_LABEL[credential.kind] ?? credential.kind}
              </span>
              {identity.label && (
                <span className="truncate text-micro text-text-tertiary">{identity.label}</span>
              )}
              {/* ⚠️ Status sits in the HEADER for anything but "Active". A
                  compromised password read off a detail row three screens down is a
                  password somebody uses. */}
              {canOversee && credential.status !== 'active' && (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-micro font-semibold"
                  style={{
                    backgroundColor: `color-mix(in oklab, var(--${meta.token}) 16%, transparent)`,
                    color: `var(--${meta.token})`,
                  }}
                >
                  {meta.label}
                </span>
              )}
            </div>
          </div>
        </div>
      }
    >
      {/* ---- What you can do with it -------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle pb-4">
        {credential.url && (
          <a
            href={credential.url}
            target="_blank"
            /* ⚠️ `noopener` as well as `noreferrer`: this tab may be holding a
               decrypted password in state, and without it the opened page gets a
               `window.opener` handle back to it. */
            rel="noopener noreferrer"
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-primary px-3 text-caption font-semibold text-text-on-brand hover:bg-accent-primary-hover"
          >
            <ExternalLink className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Open URL
          </a>
        )}

        {credential.hasSecret && (
          <>
            <ActionButton
              icon={secret ? EyeOff : Eye}
              label={secret ? 'Hide' : 'Reveal'}
              disabled={busy}
              onClick={secret ? onHide : onReveal}
            />
            <ActionButton
              icon={copied === 'secret' ? Check : Copy}
              label={copied === 'secret' ? 'Copied' : 'Copy'}
              disabled={busy}
              onClick={() => {
                /* Reveals first when it has to: the plaintext is not in this
                   component until somebody asks the server for it. */
                if (secret) void copy('secret', secret);
                else onReveal();
              }}
            />
          </>
        )}

        {canManage && <ActionButton icon={Pencil} label="Edit" disabled={busy} onClick={onEdit} />}

        {/* ── The less-used, more-consequential things ──────────────────────
            ⚠️ Behind a menu, not on the bar. Deactivating a credential and flagging
            one as leaked are both rare and both change what the rest of the team
            sees; a bar of six equal buttons makes the destructive one as easy to hit
            as Copy. Delete is not here at all — it lives in the row menu, so this
            sheet only ever offers the reversible acts. */}
        {canManage && (
          <div className="relative ml-auto">
            <button
              type="button"
              aria-label="More actions"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="grid size-9 place-items-center rounded-lg text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
            >
              <MoreVertical className="size-4" strokeWidth={2.25} aria-hidden="true" />
            </button>

            {menuOpen && (
              <>
                {/* Closes on any click outside, including one landing on something
                    else in the sheet. */}
                <div
                  role="presentation"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10"
                />
                <div className="absolute right-0 z-20 mt-1 w-[13rem] overflow-hidden rounded-xl border border-border-default bg-bg-surface py-1 shadow-[var(--shadow-lg)]">
                  {credential.status === 'active' ? (
                    <MenuItem
                      onClick={() => {
                        setMenuOpen(false);
                        onStatus('inactive');
                      }}
                    >
                      Deactivate it
                    </MenuItem>
                  ) : (
                    <MenuItem
                      onClick={() => {
                        setMenuOpen(false);
                        onStatus('active');
                      }}
                    >
                      Make it active
                    </MenuItem>
                  )}

                  {credential.status !== 'compromised' && (
                    <MenuItem
                      danger
                      onClick={() => {
                        setMenuOpen(false);
                        onStatus('compromised');
                      }}
                    >
                      <ShieldAlert className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                      Flag as leaked
                    </MenuItem>
                  )}

                  {credential.hasSecret && (
                    <MenuItem
                      danger
                      onClick={() => {
                        setMenuOpen(false);
                        onClearSecret();
                      }}
                    >
                      <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                      Forget the password
                    </MenuItem>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ---- Tabs, for the two views only an overseer gets ----------------- */}
      {canOversee && (
        <nav
          role="tablist"
          aria-label="Credential"
          className="flex gap-1 border-b border-border-subtle"
        >
          <TabButton on={tab === 'details'} onClick={() => setTab('details')}>
            Details
          </TabButton>
          <TabButton on={tab === 'activity'} onClick={() => void openLog()}>
            Activity log
          </TabButton>
          {canGrant && (
            <TabButton on={tab === 'shares'} onClick={() => setTab('shares')}>
              Share history
            </TabButton>
          )}
        </nav>
      )}

      {tab === 'details' && (
        <div className="pt-4">
          {/* ── THE CREDENTIAL ITSELF ──────────────────────────────────────
              A label/value sheet, as the owner drew it. Two columns from `sm` up;
              one on a phone, where a 9rem label would leave nothing for the value. */}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3.5 sm:grid-cols-[9rem_1fr]">
            <Row label="URL">
              {credential.url ? (
                <div className="flex min-w-0 items-center gap-1.5">
                  <a
                    href={credential.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate text-body-sm text-text-brand hover:underline"
                  >
                    {credential.url}
                  </a>
                  <ExternalLink
                    className="size-3.5 shrink-0 text-text-tertiary"
                    strokeWidth={2.25}
                    aria-hidden="true"
                  />
                  <Ghost
                    label="Copy the URL"
                    icon={copied === 'url' ? Check : Copy}
                    onClick={() => void copy('url', credential.url ?? '')}
                  />
                </div>
              ) : (
                <Muted>No sign-in page recorded</Muted>
              )}
            </Row>

            <Row label="Username / Email">
              {credential.username ? (
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-body-sm text-text-primary">
                    {credential.username}
                  </span>
                  <Ghost
                    label="Copy the username"
                    icon={copied === 'user' ? Check : Copy}
                    onClick={() => void copy('user', credential.username ?? '')}
                  />
                </div>
              ) : (
                <Muted>Not recorded</Muted>
              )}
            </Row>

            <Row label="Password / Secret">
              {!credential.hasSecret ? (
                <Muted>No password stored — only the account details are kept here.</Muted>
              ) : (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      'min-w-0 break-all text-body-sm text-text-primary',
                      secret ? 'font-mono' : 'tracking-[0.3em]',
                    )}
                  >
                    {/* ⚠️ A FIXED number of dots, not one per character. The real
                        length is the one thing a masked field must not leak. */}
                    {secret ?? '••••••••••••'}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={secret ? onHide : onReveal}
                    className="flex items-center gap-1.5 text-caption font-semibold text-text-brand hover:underline disabled:opacity-50"
                  >
                    {secret ? (
                      <EyeOff className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                    ) : (
                      <Eye className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                    )}
                    {secret ? 'Hide' : 'Reveal'}
                  </button>
                  <Ghost
                    label="Copy the password"
                    icon={copied === 'secret' ? Check : Copy}
                    onClick={() => {
                      if (secret) void copy('secret', secret);
                      else onReveal();
                    }}
                  />
                </div>
              )}
            </Row>

            {/* ── ⚠️ WHICH PROJECT THIS BELONGS TO ─────────────────────────
                Owner asked for it by name: *"This credential belongs to which
                project?"* A link, because the question after "whose login is this"
                is almost always about the work it belongs to. */}
            <Row label="Project">
              {credential.projectId ? (
                <Link
                  href={`/projects/${credential.projectId}`}
                  className="inline-flex min-w-0 items-center gap-1 text-body-sm text-text-brand hover:underline"
                >
                  <span className="truncate">{credential.projectName ?? 'Open the project'}</span>
                  <ArrowUpRight
                    className="size-3.5 shrink-0"
                    strokeWidth={2.25}
                    aria-hidden="true"
                  />
                </Link>
              ) : (
                <Muted>Not filed under a project — it belongs to the division</Muted>
              )}
            </Row>

            <Row label="Issued to">
              {credential.holders.length === 0 ? (
                <Muted>Nobody in particular</Muted>
              ) : (
                <span className="text-body-sm text-text-primary">
                  {credential.holders.map((h) => h.name).join(', ')}
                  {/* ⚠️ Said every time it is shown. The owner's worry was that an
                      empty "Issued to" meant everybody could open it. It never
                      decided that — access is rank plus named grants — and a field
                      people believe restricts access while it does not is worse than
                      no field. */}
                  <span className="ml-2 text-micro text-text-tertiary">custody, not access</span>
                </span>
              )}
            </Row>

            {credential.notes && (
              <Row label="Notes">
                {/* `whitespace-pre-line`: the notes field is a textarea and people
                    use line breaks in it. */}
                <p className="whitespace-pre-line text-body-sm text-text-secondary">
                  {credential.notes}
                </p>
              </Row>
            )}

            {credential.expiresAt && (
              <Row label="Expires">
                <span className="text-body-sm text-text-primary">
                  {stamp(credential.expiresAt)}
                </span>
              </Row>
            )}
          </dl>

          {/* ── WHO CAN OPEN IT, AND WHEN IT LAST CHANGED ─────────────────── */}
          {canOversee && (
            <div className="mt-4 space-y-3.5 border-t border-border-subtle pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-[9rem] shrink-0 text-caption text-text-tertiary">
                    People with access
                  </span>
                  {openers.length > 0 ? (
                    <AvatarStack
                      names={openers.map((r) => ({ name: r.name, src: r.avatarUrl }))}
                      max={5}
                      size="md"
                    />
                  ) : (
                    <Muted>Nobody — check the team&rsquo;s ranks</Muted>
                  )}
                </div>

                {/* ⚠️ Offered to a Coordinator too, who cannot change it. The
                    dialogue is read-only without `credential.grant`, and "who can
                    read this password" is a fair question for anybody who can read
                    it themselves. */}
                <button
                  type="button"
                  onClick={onAccess}
                  className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border-default px-3 text-caption font-semibold text-text-primary hover:bg-bg-hover"
                >
                  <Users className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  Who can see this
                </button>
              </div>

              <Meta label="Last updated">
                {stamp(credential.updatedAt)}
                {credential.updatedByName && (
                  <span className="text-text-secondary"> by {credential.updatedByName}</span>
                )}
                <span className="ml-2 text-micro text-text-tertiary">
                  {relative(credential.updatedAt, nowMs)}
                </span>
              </Meta>

              <Meta label="Last read">
                {credential.lastUsedAt ? (
                  <>
                    {stamp(credential.lastUsedAt)}
                    <span className="ml-2 text-micro text-text-tertiary">
                      {relative(credential.lastUsedAt, nowMs)}
                    </span>
                  </>
                ) : (
                  /* ⚠️ "Never" is a real answer on a vault, and often the more
                     interesting one — a password nobody has needed in months is a
                     password worth questioning. */
                  <span className="text-text-tertiary">Never read</span>
                )}
              </Meta>

              <Meta label="Added">
                {stamp(credential.createdAt)}
                {credential.createdByName && (
                  <span className="text-text-secondary"> by {credential.createdByName}</span>
                )}
              </Meta>
            </div>
          )}

          {/* ---- What is true about this credential ------------------------- */}
          <div
            className="mt-4 flex items-start gap-2.5 rounded-xl border p-3"
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
              {/* ⚠️ NO MENTION OF A CONFIRMATION. It used to say that showing or
                  copying needed a fresh one, which stopped being true when the owner
                  removed the step-up on 2026-08-25. A security note that overstates
                  the control is worse than none — somebody reads it and believes the
                  vault is harder to open than it is. What is left is what holds, and
                  the audit line now carries the weight the prompt used to. */}
              <p className="text-micro leading-relaxed text-text-secondary">
                {canOversee
                  ? 'Only Team Coordinators and Admins can open it, plus anybody an Admin has named, and every time the password is shown or copied it is recorded against the person who did it.'
                  : 'An Admin named you on this one credential, which is why you can open it. Every time you show or copy the password it is recorded against your name.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === 'activity' && canOversee && (
        <div className="space-y-2 pt-4">
          {/* ⚠️ Said plainly, because this tab is now the whole of the control on a
              reveal. */}
          <p className="text-caption text-text-secondary">
            Every time this password is shown, it is recorded here.
          </p>

          {loadingLog && (
            <p className="flex items-center gap-2 py-6 text-caption text-text-tertiary">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Reading the log…
            </p>
          )}

          {!loadingLog && events !== null && events.length === 0 && (
            <p className="py-6 text-caption text-text-tertiary">
              Nothing recorded yet — this password has not been shown since the log began.
            </p>
          )}

          {!loadingLog &&
            events?.map((event, index) => (
              <div
                key={`${event.at}-${index}`}
                className="flex items-start justify-between gap-3 border-b border-border-subtle py-2 last:border-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-caption text-text-primary">
                    {event.actorName ?? 'Somebody'}
                  </span>
                  <span className="block text-micro text-text-tertiary">
                    {event.eventType.replace(/_/g, ' ')}
                  </span>
                </span>
                <span className="shrink-0 text-micro text-text-tertiary">
                  {relative(event.at, nowMs)}
                </span>
              </div>
            ))}
        </div>
      )}

      {tab === 'shares' && canOversee && (
        <div className="space-y-2 pt-4">
          <p className="text-caption text-text-secondary">
            People named on this credential, beyond those whose rank already grants it.
          </p>

          {grants === null ? (
            <p className="flex items-center gap-2 py-6 text-caption text-text-tertiary">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Reading who has access…
            </p>
          ) : grants.length === 0 ? (
            <p className="py-6 text-caption text-text-tertiary">
              {/* Real, not an error — nobody has been named on this one. */}
              Nobody has been named on this one. Use “Who can see this” to add somebody.
            </p>
          ) : (
            grants.map((grant) => (
              <div
                key={grant.userId}
                className="flex items-start justify-between gap-3 border-b border-border-subtle py-2 last:border-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-caption text-text-primary">
                    {grant.name}
                  </span>
                  <span className="block text-micro text-text-tertiary">
                    {/* ⚠️ Names the DIRECTION. A `deny` row in a list headed "people
                        named on this credential" reads as access unless it says
                        otherwise. */}
                    {grant.effect === 'allow' ? 'Given access' : 'Excluded'}
                    {grant.grantedByName && ` · by ${grant.grantedByName}`}
                  </span>
                </span>
              </div>
            ))
          )}

          <button
            type="button"
            onClick={onAccess}
            className="mt-2 flex h-9 items-center gap-2 rounded-lg border border-border-default px-3 text-caption font-semibold text-text-primary hover:bg-bg-hover"
          >
            <Users className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Who can see this
          </button>
        </div>
      )}
    </Dialog>
  );
}

/* ---- Pieces -------------------------------------------------------------- */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-caption text-text-tertiary sm:pt-0.5">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** A label/value line below the sheet, where the grid has ended. */
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="w-[9rem] shrink-0 text-caption text-text-tertiary">{label}</span>
      <span className="text-body-sm text-text-primary">{children}</span>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-body-sm text-text-tertiary">{children}</span>;
}

function ActionButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof Eye;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-9 items-center gap-1.5 rounded-lg border border-border-default px-3',
        'text-caption font-semibold text-text-primary hover:bg-bg-hover',
        'disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent',
      )}
    >
      <Icon className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
      {label}
    </button>
  );
}

function MenuItem({
  children,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-2 text-left text-caption hover:bg-bg-hover',
        danger ? 'text-[var(--feedback-error)]' : 'text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

function Ghost({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof Copy;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-7 shrink-0 place-items-center rounded-lg text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
    >
      <Icon className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
    </button>
  );
}

function TabButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-2 text-caption font-semibold',
        on
          ? 'border-[var(--accent-primary)] text-text-primary'
          : 'border-transparent text-text-tertiary hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

/* ⚠️ Pinned locale and zone. The division is in Karachi, and a date that renders
   differently on the server and in the browser is a hydration mismatch — see
   lib/now.ts. */
function stamp(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '—';
  return new Date(at).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Karachi',
  });
}

function relative(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const elapsed = nowMs - then;
  if (elapsed < 60_000) return 'just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return `${Math.floor(elapsed / 604_800_000)}w ago`;
}
