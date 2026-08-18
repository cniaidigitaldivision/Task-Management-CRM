'use client';

import * as React from 'react';
import { Download, ExternalLink } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import type { FolderFile } from '@/app/actions/folders';

/* ============================================================================
 * VIEWING A DRIVE FILE — owner request 2026-08-18
 * ----------------------------------------------------------------------------
 * *"If it is like a PDF it can be opened in a PDF or in a next tab maybe like
 * that. For a video it should be displayed in a popup, like the same as it is
 * opening in the Google Drive… When I click it downloads, right, but it can also
 * be viewable, right?"*
 *
 * So: not a download link. The bytes come from `/api/drive/file/[id]`, which
 * streams them through the CRM — necessary because the team has no Google account
 * on this Drive, and useful because folder access is then checked on every
 * request rather than delegated to Google's sharing settings.
 *
 * ── WHY A PDF OPENS A TAB AND A VIDEO OPENS A DIALOG ─────────────────────────
 * The owner's own split, and it happens to be the right one. A PDF wants the
 * whole window and the browser's native viewer already has search, zoom and
 * print; reimplementing that inside a modal would be worse in every respect. A
 * video wants to stay in context — you glance at it and carry on — so it plays
 * where you are.
 *
 * ── SEEKING WORKS BECAUSE THE ROUTE FORWARDS `Range` ─────────────────────────
 * `<video>` seeks by asking for byte ranges and needs `206 Partial Content` back.
 * Nothing here arranges that; the route does, by passing the header to Drive
 * untouched. If scrubbing ever stops working, that is where to look.
 * ========================================================================= */

/** Where the bytes come from. `download=1` flips Content-Disposition. */
export function fileUrl(id: string, download = false): string {
  return `/api/drive/file/${encodeURIComponent(id)}${download ? '?download=1' : ''}`;
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function FileViewer({
  file,
  onClose,
}: {
  file: FolderFile;
  onClose: () => void;
}) {
  const src = fileUrl(file.id);

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={file.name}
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose}>
            Close
          </Button>
          {/* A real download stays available. Viewing was the missing half, not
              the replacement — somebody who wants the file on their machine
              should not have to right-click a video. */}
          <a
            href={fileUrl(file.id, true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border-default px-3.5 text-body-sm font-semibold text-text-primary"
          >
            <Download className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
            Download
          </a>
        </>
      }
    >
      <div className="flex min-h-[12rem] items-center justify-center">
        {file.kind === 'image' && (
          /* eslint-disable-next-line @next/next/no-img-element --
             next/image optimises by fetching the source server-side, which cannot
             work here: the URL is access-checked per user and the optimiser has
             no session. A plain img is correct, not a shortcut. */
          <img
            src={src}
            alt={file.name}
            className="max-h-[70vh] max-w-full rounded-lg object-contain"
          />
        )}

        {file.kind === 'video' && (
          <video
            src={src}
            controls
            preload="metadata"
            className="max-h-[70vh] w-full rounded-lg bg-black"
          >
            Your browser cannot play this video.
          </video>
        )}

        {file.kind === 'audio' && (
          <audio src={src} controls className="w-full">
            Your browser cannot play this audio.
          </audio>
        )}

        {file.kind === 'text' && (
          <iframe
            src={src}
            title={file.name}
            className="h-[60vh] w-full rounded-lg border border-border-subtle bg-bg-surface"
          />
        )}

        {file.kind === 'google' && (
          <div className="space-y-2 text-center">
            <p className="text-body-sm text-text-primary">
              This is a Google Docs, Sheets or Slides file.
            </p>
            <p className="text-caption text-text-secondary">
              Those live inside Google&rsquo;s editor and have no file to stream, so the CRM
              cannot show them here.
            </p>
          </div>
        )}

        {file.kind === 'other' && (
          <div className="space-y-2 text-center">
            <p className="text-body-sm text-text-primary">No preview for this kind of file.</p>
            <p className="text-caption text-text-secondary">
              {file.mimeType} · {formatFileSize(file.size)} — download it to open it.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** PDFs get the whole window and the browser's own viewer. */
export function openPdf(file: FolderFile): void {
  window.open(fileUrl(file.id), '_blank', 'noopener,noreferrer');
}

export { ExternalLink };
