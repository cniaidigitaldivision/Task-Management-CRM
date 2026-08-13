'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FileUp,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';

import {
  approveDocumentAction,
  deleteDocumentAction,
  pendingFileUrlAction,
  rejectDocumentAction,
  requestDocumentAction,
  setWatchedFolderAction,
  syncDriveFoldersAction,
  type DocumentResult,
} from '@/app/actions/documents';
import type { DocumentRow } from '@/lib/db/queries/documents';
import type { DriveSyncRow } from '@/lib/db/queries/documents';
import { Badge } from '@/components/ui/badge';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Pagination, usePagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { ToggleGroup, Toolbar, ToolbarGroup, ToolbarLabel, ToolbarSpacer } from '@/components/ui/toolbar';
import { cn } from '@/lib/utils';

/* ============================================================================
 * DOCUMENTS — owner request 2026-08-13
 * ----------------------------------------------------------------------------
 * The register, and the queue of uploads waiting to go into Google Drive.
 *
 * ── THE QUEUE IS THE POINT OF THIS SCREEN ────────────────────────────────────
 * So it opens on Waiting, not on everything. An approver arriving needs to see
 * what is asked of them; the full list is a reference they go looking for.
 *
 * ── WHAT "PENDING" MEANS IS SAID EVERYWHERE IT MATTERS ───────────────────────
 * A pending document is **not in Drive**. That is easy to assume the other way
 * round — the file uploaded, so surely it arrived — and the whole approval step
 * exists because it has not. Every pending row says so.
 * ========================================================================= */

const EMPTY: DocumentResult = { ok: false };

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

const FILTER_LABEL: Record<Filter, string> = {
  pending: 'Waiting',
  approved: 'In Drive',
  rejected: 'Refused',
  all: 'Everything',
};

export function DocumentsWorkspace({
  documents,
  projects,
  canApprove,
  canManage,
  canConfigure,
  drive,
}: {
  documents: readonly DocumentRow[];
  projects: ReadonlyArray<{ id: string; name: string }>;
  canApprove: boolean;
  canManage: boolean;
  canConfigure: boolean;
  drive: {
    configured: boolean;
    account: string | null;
    sync: DriveSyncRow | null;
    drafts: Array<{ id: string; name: string; driveFolderId: string | null }>;
  };
}) {
  const router = useRouter();
  const pendingCount = documents.filter((d) => d.state === 'pending').length;

  /* Opens on the queue when there is one. A screen that opens on "everything"
     when four things are waiting has buried its own purpose. */
  const [filter, setFilter] = React.useState<Filter>(pendingCount > 0 ? 'pending' : 'all');
  const [uploading, setUploading] = React.useState(false);
  const [rejecting, setRejecting] = React.useState<DocumentRow | null>(null);
  const [note, setNote] = React.useState<DocumentResult | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const visible = documents.filter((d) => filter === 'all' || d.state === filter);
  const pager = usePagination(visible);

  const run = async (id: string, fn: () => Promise<DocumentResult>) => {
    setBusy(id);
    try {
      setNote(await fn());
      router.refresh();
    } catch {
      setNote({ ok: false, error: 'That could not be completed — the server did not answer.' });
    } finally {
      setBusy(null);
      setRejecting(null);
    }
  };

  const preview = async (id: string) => {
    setBusy(id);
    try {
      const result = await pendingFileUrlAction(id);
      if (!result.ok) {
        setNote({ ok: false, error: result.error });
        return;
      }
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* ---- Drive connection, and the folder watch ---------------------- */}
      {canConfigure && <DrivePanel drive={drive} onDone={(r) => { setNote(r); router.refresh(); }} />}

      <Toolbar aria-label="Document filters">
        <ToolbarGroup>
          <ToolbarLabel>Show</ToolbarLabel>
          <ToggleGroup
            label="Which documents"
            value={filter}
            onChange={setFilter}
            options={(['pending', 'approved', 'rejected', 'all'] as Filter[]).map((key) => ({
              key,
              label:
                key === 'pending' && pendingCount > 0
                  ? `${FILTER_LABEL[key]} · ${pendingCount}`
                  : FILTER_LABEL[key],
            }))}
          />
        </ToolbarGroup>

        <ToolbarSpacer />

        <Button variant="primary" size="md" onClick={() => setUploading(true)}>
          <FileUp className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
          Upload a document
        </Button>
      </Toolbar>

      {note && (
        <p
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            color: note.ok
              ? note.warning
                ? 'var(--feedback-warning)'
                : 'var(--feedback-success)'
              : 'var(--feedback-error)',
          }}
        >
          {!note.ok && (
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          )}
          <span>{note.error ?? note.message} {note.warning}</span>
        </p>
      )}

      {visible.length === 0 ? (
        <Card>
          <CardBody className="px-6 py-14 text-center">
            <p className="text-body-sm font-semibold text-text-primary">
              {filter === 'pending' ? 'Nothing is waiting' : 'Nothing here yet'}
            </p>
            <p className="mx-auto mt-1 max-w-[40rem] text-caption text-text-secondary">
              {filter === 'pending'
                ? 'Every upload has been decided on.'
                : 'Upload a document and it will wait here until an Admin approves it into Google Drive.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-2">
            {pager.visible.map((doc) => (
              <li key={doc.id}>
                <Card>
                  <CardBody className="flex flex-wrap items-start gap-3 p-4">
                    <StateBadge state={doc.state} />

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-semibold text-text-primary">
                        {doc.name}
                      </p>
                      <p className="text-micro text-text-tertiary">
                        {doc.uploadedByName ?? 'Unknown'}
                        {doc.projectName && <> · {doc.projectName}</>}
                        {doc.sizeBytes !== null && <> · {formatBytes(doc.sizeBytes)}</>}
                        {doc.state === 'pending' && (
                          <>
                            {' · '}
                            <span style={{ color: 'var(--feedback-warning)' }}>
                              not in Drive yet
                            </span>
                          </>
                        )}
                      </p>
                      {doc.description && (
                        <p className="mt-1 text-caption text-text-secondary">{doc.description}</p>
                      )}
                      {doc.state === 'rejected' && doc.decisionReason && (
                        <p className="mt-1 text-micro" style={{ color: 'var(--feedback-error)' }}>
                          Refused by {doc.decidedByName ?? 'an Admin'}: {doc.decisionReason}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {doc.state === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => void preview(doc.id)}
                        >
                          <Eye className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
                          Look
                        </Button>
                      )}

                      {doc.state === 'approved' && doc.driveWebLink && (
                        <a
                          href={doc.driveWebLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-micro font-semibold text-text-brand hover:bg-bg-hover"
                        >
                          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
                          Open in Drive
                        </a>
                      )}

                      {doc.state === 'pending' && canApprove && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => setRejecting(doc)}
                          >
                            Refuse
                          </Button>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={busy !== null}
                            onClick={() => void run(doc.id, () => approveDocumentAction(doc.id))}
                          >
                            {busy === doc.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
                            )}
                            Approve into Drive
                          </Button>
                        </>
                      )}

                      {canManage && (
                        <IconButton
                          label={`Remove ${doc.name} from the list`}
                          icon={Trash2}
                          size="sm"
                          onClick={() => void run(doc.id, () => deleteDocumentAction(doc.id))}
                        />
                      )}
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>

          <Pagination
            page={pager.page}
            pageCount={pager.pageCount}
            onPage={pager.setPage}
            from={pager.from}
            to={pager.to}
            total={pager.total}
            label="documents"
          />
        </div>
      )}

      {uploading && (
        <UploadDialog
          projects={projects}
          onClose={() => setUploading(false)}
          onDone={(result) => {
            setUploading(false);
            setNote(result);
            router.refresh();
          }}
        />
      )}

      {/* ---- Refuse, with a reason ---------------------------------------- */}
      <RejectDialog
        document={rejecting}
        busy={busy !== null}
        onClose={() => setRejecting(null)}
        onRefuse={(reason) => {
          if (rejecting) void run(rejecting.id, () => rejectDocumentAction(rejecting.id, reason));
        }}
      />
    </div>
  );
}

/* ---- Drive connection ---------------------------------------------------- */

/**
 * Whether Drive is connected, which folder is watched, and what the last check
 * found.
 *
 * States what to do when it is not connected rather than only that it is not.
 * "Drive is not configured" sends somebody to ask; naming the variable and the
 * sharing step is the difference between a message and an instruction.
 */
function DrivePanel({
  drive,
  onDone,
}: {
  drive: {
    configured: boolean;
    account: string | null;
    sync: DriveSyncRow | null;
    drafts: Array<{ id: string; name: string; driveFolderId: string | null }>;
  };
  onDone: (result: DocumentResult) => void;
}) {
  const [folderId, setFolderId] = React.useState(drive.sync?.watchedFolderId ?? '');
  const [busy, setBusy] = React.useState<null | 'save' | 'sync'>(null);

  if (!drive.configured) {
    return (
      <Card>
        <CardBody className="space-y-2 p-4">
          <p className="flex items-center gap-2 text-body-sm font-semibold text-text-primary">
            <AlertTriangle
              className="h-4 w-4"
              strokeWidth={2.25}
              aria-hidden="true"
              style={{ color: 'var(--feedback-warning)' }}
            />
            Google Drive is not connected
          </p>
          <p className="text-caption text-text-secondary">
            Uploads still work and still queue for approval — they simply cannot be sent anywhere
            yet. To connect it: create a Google Cloud service account, download its JSON key, put
            the whole thing in <code className="font-mono">GOOGLE_SERVICE_ACCOUNT_JSON</code> in{' '}
            <code className="font-mono">.env.local</code>, then{' '}
            <span className="font-semibold text-text-primary">
              share your Drive folder with the service account&rsquo;s email address
            </span>{' '}
            — it can see nothing until you do.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="space-y-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-body-sm font-semibold text-text-primary">Google Drive is connected</p>
          {drive.account && (
            <p className="text-micro text-text-tertiary">
              Share folders with{' '}
              <code className="font-mono text-text-secondary">{drive.account}</code>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Field
            label="Watched folder id"
            htmlFor="watchedFolder"
            hint="A new subfolder here becomes a draft project. Leave empty to turn it off."
            className="min-w-[18rem] flex-1"
          >
            <Input
              id="watchedFolder"
              value={folderId}
              onChange={(event) => setFolderId(event.target.value)}
              placeholder="1AbC…  (from the folder's URL in Drive)"
            />
          </Field>

          <Button
            variant="secondary"
            size="md"
            disabled={busy !== null}
            onClick={async () => {
              setBusy('save');
              try {
                onDone(await setWatchedFolderAction(folderId));
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save
          </Button>

          <Button
            variant="ghost"
            size="md"
            disabled={busy !== null || !drive.sync?.watchedFolderId}
            title={
              drive.sync?.watchedFolderId
                ? 'Read the folder now'
                : 'Set a folder first'
            }
            onClick={async () => {
              setBusy('sync');
              try {
                onDone(await syncDriveFoldersAction());
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === 'sync' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            )}
            Check now
          </Button>
        </div>

        <p className="text-micro text-text-tertiary">
          {drive.sync?.lastCheckedAt
            ? `Last checked ${new Date(drive.sync.lastCheckedAt).toLocaleString()} — ${
                drive.sync.lastCreated
              } new.`
            : 'Not checked yet.'}
          {drive.sync?.lastError && (
            <span style={{ color: 'var(--feedback-error)' }}> {drive.sync.lastError}</span>
          )}
        </p>

        {drive.drafts.length > 0 && (
          <p className="text-caption" style={{ color: 'var(--feedback-warning)' }}>
            {drive.drafts.length} draft {drive.drafts.length === 1 ? 'project' : 'projects'} need a
            type and an owner before they count anywhere: {drive.drafts.map((d) => d.name).join(', ')}.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

/* ---- Upload -------------------------------------------------------------- */

function UploadDialog({
  projects,
  onClose,
  onDone,
}: {
  projects: ReadonlyArray<{ id: string; name: string }>;
  onClose: () => void;
  onDone: (result: DocumentResult) => void;
}) {
  const [state, formAction, pending] = React.useActionState(requestDocumentAction, EMPTY);
  const seen = React.useRef(false);

  React.useEffect(() => {
    if (state.ok && !seen.current) {
      seen.current = true;
      onDone(state);
    }
  }, [state, onDone]);

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Upload a document"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" size="md" type="submit" form="upload-form" disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Send for approval
          </Button>
        </>
      }
    >
      <form id="upload-form" action={formAction} className="space-y-4">
        {!state.ok && state.error && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
          >
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {state.error}
          </p>
        )}

        <Field label="File" htmlFor="file" hint="Up to 25 MB.">
          <input
            id="file"
            name="file"
            type="file"
            required
            className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-caption text-text-primary"
          />
        </Field>

        <Field
          label="Name"
          htmlFor="name"
          hint="Leave empty to use the file's own name."
        >
          <Input id="name" name="name" placeholder="ABC Traders — signed contract" />
        </Field>

        <Field
          label="Project"
          htmlFor="projectId"
          hint="Filing it against a project is what lets that project's people see it."
        >
          <Select
            id="projectId"
            name="projectId"
            options={[
              { value: '', label: 'Not tied to a project' },
              ...projects.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </Field>

        <Field label="Note" htmlFor="description" hint="Anything the approver should know.">
          <Input id="description" name="description" />
        </Field>

        <p className="text-micro text-text-tertiary">
          It is held here until an Admin approves it. Nothing reaches Google Drive before that.
        </p>
      </form>
    </Dialog>
  );
}

/* ---- Refuse -------------------------------------------------------------- */

function RejectDialog({
  document: doc,
  busy,
  onClose,
  onRefuse,
}: {
  document: DocumentRow | null;
  busy: boolean;
  onClose: () => void;
  onRefuse: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState('');

  return (
    <Dialog
      open={doc !== null}
      onClose={onClose}
      size="sm"
      title={doc ? `Refuse ${doc.name}?` : ''}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="md"
            disabled={busy || reason.trim() === ''}
            onClick={() => onRefuse(reason)}
          >
            Refuse it
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-caption text-text-secondary">
          The file is deleted and never reaches Drive. The record stays, with your reason, so
          whoever uploaded it knows what to fix.
        </p>
        <Field label="Why" htmlFor="reason" hint="The uploader sees this.">
          <Input
            id="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Wrong client — this is ABC, not XYZ"
          />
        </Field>
      </div>
    </Dialog>
  );
}

/* ---- Bits ---------------------------------------------------------------- */

function StateBadge({ state }: { state: DocumentRow['state'] }) {
  const meta = {
    pending: { token: 'feedback-warning', label: 'Waiting', icon: Clock },
    approved: { token: 'feedback-success', label: 'In Drive', icon: CheckCircle2 },
    rejected: { token: 'feedback-error', label: 'Refused', icon: XCircle },
  }[state];
  const Icon = meta.icon;

  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5')}>
      <Icon
        className="h-4 w-4"
        strokeWidth={2.25}
        aria-hidden="true"
        style={{ color: `var(--${meta.token})` }}
      />
      <Badge token={meta.token} size="sm" variant="outline">
        {meta.label}
      </Badge>
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
