'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';

import {
  clearSecretAction,
  deleteCredentialAction,
  revealCredentialAction,
  type VaultResult,
} from '@/app/actions/credentials';
import { StepUpDialog } from '@/components/security/step-up-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Toolbar, ToolbarGroup, ToolbarLabel, ToolbarSpacer } from '@/components/ui/toolbar';
import type { CredentialRow } from '@/lib/db/queries/credentials';
import { cn } from '@/lib/utils';

import { CredentialDialog, KIND_LABEL, KINDS } from './credential-dialog';

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
  canManage,
  canDelete,
}: {
  credentials: readonly CredentialRow[];
  projects: ReadonlyArray<{ id: string; name: string }>;
  people: ReadonlyArray<{ id: string; name: string }>;
  canManage: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [kind, setKind] = React.useState<string>('all');
  const [projectId, setProjectId] = React.useState<string>('all');
  const [editing, setEditing] = React.useState<CredentialRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState<CredentialRow | null>(null);
  const [note, setNote] = React.useState<VaultResult | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  /* The reveal, and the step-up it may demand. `pendingReveal` remembers what
     they were trying to see so the dialog can resume it rather than making them
     find the row again. */
  const [revealed, setRevealed] = React.useState<
    { id: string; label: string; username: string | null; secret: string } | null
  >(null);
  const [pendingReveal, setPendingReveal] = React.useState<string | null>(null);

  const visible = credentials.filter((c) => {
    if (kind !== 'all' && c.kind !== kind) return false;
    if (projectId === 'none' && c.projectId !== null) return false;
    if (projectId !== 'all' && projectId !== 'none' && c.projectId !== projectId) return false;
    return true;
  });

  const pager = usePagination(visible);

  const reveal = async (id: string) => {
    setBusy(id);
    setNote(null);
    try {
      const result = await revealCredentialAction(id);
      if (result.stepUpRequired) {
        setPendingReveal(id);
        return;
      }
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

  const usedKinds = [...new Set(credentials.map((c) => c.kind))];

  return (
    <div className="space-y-4">
      <Toolbar aria-label="Credential filters">
        <ToolbarGroup>
          <ToolbarLabel>Kind</ToolbarLabel>
          <Select
            label="Filter by kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            options={[
              { value: 'all', label: 'Every kind' },
              ...KINDS.filter((k) => usedKinds.includes(k)).map((k) => ({
                value: k,
                label: KIND_LABEL[k],
              })),
            ]}
            className="w-[12rem]"
          />
        </ToolbarGroup>

        <ToolbarGroup>
          <ToolbarLabel>Project</ToolbarLabel>
          <Select
            label="Filter by project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            options={[
              { value: 'all', label: 'Any project' },
              { value: 'none', label: 'Not tied to a project' },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
            className="w-[14rem]"
          />
        </ToolbarGroup>

        <ToolbarSpacer />

        <span className="text-caption text-text-secondary">
          <span className="tabular font-semibold text-text-primary">{visible.length}</span> stored
        </span>

        {canManage && (
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            Add credential
          </Button>
        )}
      </Toolbar>

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
              className="mt-px h-4 w-4 shrink-0"
              strokeWidth={2.25}
              aria-hidden="true"
            />
          )}
          {note.error ?? note.message}
        </p>
      )}

      {visible.length === 0 ? (
        <Card>
          <CardBody className="px-6 py-14 text-center">
            <p className="text-body-sm font-semibold text-text-primary">
              {credentials.length === 0 ? 'Nothing stored yet' : 'Nothing matches that filter'}
            </p>
            <p className="mx-auto mt-1 max-w-[42rem] text-caption text-text-secondary">
              {credentials.length === 0
                ? 'This is for the logins the division holds on behalf of clients and projects — a client portal, a hosting account, an ad manager, an API key.'
                : 'Clear a filter to see the rest.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-border-default bg-bg-surface shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse">
                <thead>
                  <tr className="border-b border-border-default bg-bg-surface-sunken">
                    <th scope="col" className={thLeft}>Credential</th>
                    <th scope="col" className={thLeft}>Kind</th>
                    <th scope="col" className={thLeft}>Project</th>
                    <th scope="col" className={thLeft}>Issued to</th>
                    <th scope="col" className={thLeft}>Rotation</th>
                    <th scope="col" className="w-px" />
                  </tr>
                </thead>
                <tbody>
                  {pager.visible.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border-subtle last:border-0 hover:bg-bg-hover"
                    >
                      <td className="px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-body-sm font-medium text-text-primary">
                            {row.label}
                          </p>
                          <p className="truncate text-micro text-text-tertiary">
                            {row.username ?? 'no username recorded'}
                            {row.url && (
                              <>
                                {' · '}
                                <a
                                  href={row.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-text-brand hover:underline"
                                >
                                  open
                                </a>
                              </>
                            )}
                          </p>
                        </div>
                      </td>

                      <td className="px-3 py-2.5">
                        <Badge token="accent-primary" size="sm" variant="outline">
                          {KIND_LABEL[row.kind] ?? row.kind}
                        </Badge>
                      </td>

                      <td className="px-3 py-2.5 text-caption text-text-secondary">
                        {row.projectName ?? <span className="text-text-disabled">—</span>}
                      </td>

                      <td className="px-3 py-2.5 text-caption text-text-secondary">
                        {row.issuedToName ?? <span className="text-text-disabled">—</span>}
                      </td>

                      <td className="px-3 py-2.5">
                        <Rotation row={row} />
                      </td>

                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {row.hasSecret ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy !== null}
                              onClick={() => void reveal(row.id)}
                            >
                              {busy === row.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
                              )}
                              Reveal
                            </Button>
                          ) : (
                            <span
                              className="px-2 text-micro text-text-tertiary"
                              title="The account is recorded here but its password is not"
                            >
                              no password stored
                            </span>
                          )}

                          {canManage && (
                            <IconButton
                              label={`Edit ${row.label}`}
                              icon={Pencil}
                              size="sm"
                              onClick={() => setEditing(row)}
                            />
                          )}
                          {canDelete && (
                            <IconButton
                              label={`Delete ${row.label}`}
                              icon={Trash2}
                              size="sm"
                              onClick={() => setConfirmDelete(row)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination
            page={pager.page}
            pageCount={pager.pageCount}
            onPage={pager.setPage}
            from={pager.from}
            to={pager.to}
            total={pager.total}
            label="credentials"
          />
        </div>
      )}

      {/* ---- The revealed secret ------------------------------------------ */}
      {revealed && (
        <RevealDialog
          revealed={revealed}
          onClose={() => setRevealed(null)}
          onForget={
            canManage
              ? () => void run(revealed.id, () => clearSecretAction(revealed.id))
              : undefined
          }
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

/* ---- Rotation ------------------------------------------------------------ */

/**
 * When it was last changed, and whether it is due.
 *
 * Days are computed from the date strings rather than from `Date.now()` against a
 * timestamp, so a reader in another timezone does not see a key expire a day
 * early. "Today" is close enough to the boundary that the distinction shows.
 */
function Rotation({ row }: { row: CredentialRow }) {
  const today = new Date().toISOString().slice(0, 10);

  if (row.expiresAt) {
    const overdue = row.expiresAt < today;
    const soon = !overdue && daysUntil(row.expiresAt, today) <= 14;

    return (
      <span
        className="text-caption"
        style={{
          color: overdue
            ? 'var(--feedback-error)'
            : soon
              ? 'var(--feedback-warning)'
              : 'var(--text-secondary)',
        }}
        title={row.lastRotatedAt ? `Last changed ${row.lastRotatedAt.slice(0, 10)}` : undefined}
      >
        {overdue ? 'Expired ' : 'Expires '}
        {row.expiresAt}
      </span>
    );
  }

  return (
    <span className="text-caption text-text-tertiary">
      {row.lastRotatedAt ? `Changed ${row.lastRotatedAt.slice(0, 10)}` : 'No expiry set'}
    </span>
  );
}

function daysUntil(iso: string, todayIso: string): number {
  const a = Date.parse(`${todayIso}T00:00:00Z`);
  const b = Date.parse(`${iso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/* ---- The reveal dialog --------------------------------------------------- */

/**
 * Shows one secret, and nothing else.
 *
 * Hidden behind a toggle even after the step-up, because "reveal" and "on screen
 * in an open-plan office" are not the same decision — and Copy exists so the
 * common case never needs it visible at all.
 */
function RevealDialog({
  revealed,
  onClose,
  onForget,
}: {
  revealed: { label: string; username: string | null; secret: string };
  onClose: () => void;
  onForget?: () => void;
}) {
  const [shown, setShown] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(revealed.secret);
      setCopied(true);
    } catch {
      /* A denied clipboard permission is not an error worth a dialog — the value
         is on screen behind the toggle, which is the fallback. */
      setShown(true);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="sm"
      title={revealed.label}
      footer={
        <>
          {onForget && (
            <Button variant="ghost" size="md" onClick={onForget}>
              Forget the password
            </Button>
          )}
          <Button variant="primary" size="md" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {revealed.username && (
          <div>
            <p className="text-micro text-text-tertiary">Username</p>
            <p className="font-mono text-caption break-all text-text-primary">
              {revealed.username}
            </p>
          </div>
        )}

        <div>
          <p className="text-micro text-text-tertiary">Password</p>
          <div className="mt-1 flex items-start gap-2">
            <code
              className={cn(
                'min-w-0 flex-1 rounded-lg border border-border-default bg-bg-surface-sunken px-3 py-2',
                'font-mono text-caption break-all text-text-primary',
              )}
            >
              {shown ? revealed.secret || '(empty)' : '•'.repeat(Math.min(revealed.secret.length, 24))}
            </code>
            <IconButton
              label={shown ? 'Hide' : 'Show'}
              icon={shown ? EyeOff : Eye}
              size="sm"
              onClick={() => setShown((v) => !v)}
            />
            <IconButton
              label={copied ? 'Copied' : 'Copy'}
              icon={copied ? Check : Copy}
              size="sm"
              onClick={() => void copy()}
            />
          </div>
        </div>

        <p className="flex items-start gap-2 text-micro text-text-tertiary">
          <KeyRound className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
          This was written to the security log as a critical event, with your name and the time.
          That is deliberate: reading a stored password changes nothing else, so the log is the
          only trace it leaves.
        </p>
      </div>
    </Dialog>
  );
}

const thBase = 'py-2 text-micro font-semibold tracking-[0.07em] text-text-tertiary uppercase';
const thLeft = `px-3 text-left ${thBase}`;
