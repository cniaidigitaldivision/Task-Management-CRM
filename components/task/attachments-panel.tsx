'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Archive,
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from 'lucide-react';

import {
  attachmentUrlAction,
  deleteAttachmentAction,
  uploadAttachmentAction,
} from '@/app/actions/attachments';
import { Button, IconButton } from '@/components/ui/button';
import type { AttachmentRow } from '@/lib/db/queries/task-relations';
import {
  ACCEPT_ATTRIBUTE,
  formatBytes,
  kindOf,
  type AttachmentKind,
} from '@/lib/domain/attachments';

/* ============================================================================
 * ATTACHMENTS — FR-029
 * ----------------------------------------------------------------------------
 * ── THE DOWNLOAD IS TWO STEPS, AND THE FIRST ONE IS THE POINT ────────────────
 * A row holds no URL. Clicking asks the server for one, the server re-checks
 * that this person may still see the task, and the link it mints lasts an hour.
 *
 * That is why the bucket is private. A permanent address forwarded once is
 * access forever, to anybody, with no account — including after somebody has
 * left. Here, a link pasted into a group chat is spent by the time it is read,
 * and someone whose access was revoked this morning gets nothing this
 * afternoon.
 *
 * The cost is one round trip per download, and a `window.open` that has to
 * happen after an await. Popup blockers care about that, which is why the link
 * is assigned to a real anchor rather than opened from script — see below.
 * ========================================================================= */

const ICONS: Record<AttachmentKind, typeof FileText> = {
  image: ImageIcon,
  pdf: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  archive: Archive,
  text: FileText,
};

export function AttachmentsPanel({
  taskId,
  attachments,
  currentUserId,
  canManage,
  storage,
  busy,
  onChanged,
}: {
  taskId: string;
  attachments: readonly AttachmentRow[];
  currentUserId: string;
  /** Coordinator and above may remove anybody's; everybody may remove their own. */
  canManage: boolean;
  storage: { configured: boolean; reason: string | null };
  busy: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [workingId, setWorkingId] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const send = React.useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);

      const form = new FormData();
      form.set('file', file);
      const result = await uploadAttachmentAction(taskId, form);

      if (!result.ok) setError(result.error ?? 'That file could not be attached.');
      else await onChanged();

      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    },
    [taskId, onChanged],
  );

  /**
   * Fetch a link, then follow it.
   *
   * `window.open` after an await is blocked by most browsers — the popup
   * heuristic wants the window to be opened in the same tick as the click.
   * Creating an anchor and clicking it is a navigation rather than a popup, and
   * `download` on it means the file saves instead of replacing the page.
   */
  const open = React.useCallback(async (attachment: AttachmentRow) => {
    setWorkingId(attachment.id);
    setError(null);

    const result = await attachmentUrlAction(attachment.id);
    if (!result.ok || !result.url) {
      setError(result.error ?? 'That file could not be opened.');
      setWorkingId(null);
      return;
    }

    const anchor = document.createElement('a');
    anchor.href = result.url;
    anchor.rel = 'noopener';
    anchor.download = attachment.fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    setWorkingId(null);
  }, []);

  const remove = React.useCallback(
    async (attachment: AttachmentRow) => {
      setWorkingId(attachment.id);
      setError(null);
      const result = await deleteAttachmentAction(attachment.id);
      if (!result.ok) setError(result.error ?? 'That file could not be removed.');
      else await onChanged();
      setWorkingId(null);
    },
    [onChanged],
  );

  return (
    <section className="space-y-2 rounded-xl border border-border-subtle bg-bg-surface p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-caption font-semibold text-text-primary">
          <Paperclip className="h-3.5 w-3.5 text-text-tertiary" strokeWidth={2} aria-hidden="true" />
          Files
          {attachments.length > 0 && (
            <span className="text-micro font-normal text-text-tertiary">
              {attachments.length}
            </span>
          )}
        </h3>

        {storage.configured && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            )}
            {uploading ? 'Uploading…' : 'Attach'}
          </Button>
        )}
      </div>

      {!storage.configured && (
        <p className="text-micro text-text-tertiary">
          {storage.reason ?? 'File storage is not set up yet.'}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg px-2.5 py-2 text-micro text-text-primary"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
            border: '1px solid color-mix(in oklab, var(--feedback-error) 32%, transparent)',
          }}
        >
          <AlertTriangle
            className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]"
            style={{ color: 'var(--feedback-error)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          {error}
        </p>
      )}

      {attachments.length > 0 && (
        <ul className="divide-y divide-border-subtle">
          {attachments.map((attachment) => {
            const Icon = ICONS[kindOf(attachment.mimeType, attachment.fileName)];
            const mine = attachment.uploadedById === currentUserId;
            const working = workingId === attachment.id;

            return (
              <li key={attachment.id} className="flex items-center gap-2 py-1.5">
                <Icon
                  className="h-4 w-4 shrink-0 text-text-tertiary"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <button
                  type="button"
                  disabled={busy || working}
                  onClick={() => void open(attachment)}
                  className="min-w-0 flex-1 text-left disabled:opacity-60"
                >
                  <span className="block truncate text-caption text-text-primary hover:underline">
                    {attachment.fileName}
                  </span>
                  <span className="block text-micro text-text-tertiary">
                    {formatBytes(attachment.sizeBytes ?? 0)}
                    {attachment.uploadedByName && <> · {mine ? 'You' : attachment.uploadedByName}</>}
                  </span>
                </button>

                {working ? (
                  <Loader2
                    className="h-3.5 w-3.5 shrink-0 animate-spin text-text-tertiary"
                    aria-hidden="true"
                  />
                ) : (
                  <>
                    <IconButton
                      label={`Download ${attachment.fileName}`}
                      icon={Download}
                      size="sm"
                      disabled={busy}
                      onClick={() => void open(attachment)}
                    />
                    {(mine || canManage) && (
                      <IconButton
                        label={`Remove ${attachment.fileName}`}
                        icon={Trash2}
                        size="sm"
                        disabled={busy}
                        onClick={() => void remove(attachment)}
                      />
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {storage.configured && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void send(file);
            }}
          />

          {/* Drag and drop. The label makes the whole area a click target too,
              so it works without a mouse and without reading the instruction. */}
          <label
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-micro transition-colors ${
              dragOver
                ? 'border-border-brand bg-bg-selected text-text-primary'
                : 'border-border-default text-text-tertiary hover:bg-bg-hover'
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const file = event.dataTransfer.files?.[0];
              if (file) void send(file);
            }}
          >
            <input
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void send(file);
              }}
            />
            <Upload className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            {dragOver ? 'Drop it' : 'Drop a file here, or click to choose · 25 MB max'}
          </label>

          <p className="text-micro text-text-tertiary">
            Download links last an hour and then stop working, so a link forwarded outside the team
            is no use to whoever receives it.
          </p>
        </>
      )}
    </section>
  );
}
