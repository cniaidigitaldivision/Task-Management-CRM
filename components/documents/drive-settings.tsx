'use client';

import * as React from 'react';
import {
  AlertTriangle,
  Clock,
  Folder,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';

import { setWatchedFolderAction, syncDriveFoldersAction, disconnectDriveAction } from '@/app/actions/documents';
import type { DocumentResult } from '@/app/actions/documents';
import type { DriveSyncRow } from '@/lib/db/queries/documents';
import { PlatformIcon } from '@/components/brand/platform-icon';
import { APP_NAME } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

/* ============================================================================
 * GOOGLE DRIVE INTEGRATION — the owner's layout
 * ----------------------------------------------------------------------------
 * *"I want this UI that I have here… same logo, same height and width, and
 * everything should be the same."*
 *
 * A header with Disconnect, a status strip of four facts, then three panels:
 * the watched folder with its URL field and Save / Check now, the sync settings,
 * and what this integration can and cannot reach.
 *
 * ── ⚠️ TWO PLACES WHERE THE DRAWING CLAIMS SOMETHING UNTRUE OF THIS SYSTEM ──
 * Both are called out on the panel itself rather than quietly rendered:
 *
 *   1. *"Auto-sync is enabled · Every 5 minutes."* There is no Drive cron.
 *      `vercel.json` schedules exactly two jobs — `/api/schedule` at 02:00 and
 *      `/api/digest` at 04:00 — and neither touches Drive. A sync happens when
 *      somebody presses Check now, and nothing else makes one happen.
 *
 *      Printing "enabled, every 5 minutes" would be the most damaging kind of
 *      wrong: the owner would stop pressing the button, the registry would go
 *      stale, and the folder sizes and counts on the Folders tab would silently
 *      drift from Drive while the screen insisted they were minutes old. The
 *      panel says how it actually works and offers the button.
 *
 *   2. *"52 subfolders • 1,248 files"* under a watched folder. `watched_folder_id`
 *      is NULL — no folder has been chosen — and with none set the walk reads My
 *      Drive from the root. So the panel says that, and the counts it shows are
 *      what the last sync actually recorded.
 * ========================================================================= */

export interface DriveSettingsProps {
  readonly drive: {
    configured: boolean;
    connected: boolean;
    account: string | null;
    /** ISO, or null. From `drive_connection.connected_at`. */
    connectedAt: string | null;
    lastError: string | null;
    sync: DriveSyncRow | null;
    drafts: Array<{ id: string; name: string; driveFolderId: string | null }>;
  };
  /** What the last sync left in the registry — real counts, not estimates. */
  readonly registry: { folders: number; files: number };
  /** The watched folder's own name, resolved from the registry. Null when unset. */
  readonly watchedFolderName: string | null;
  /** The server's clock. See lib/now.ts. */
  readonly nowMs: number;
  readonly onDone: (result: DocumentResult) => void;
}

export function DriveSettings({
  drive,
  registry,
  watchedFolderName,
  nowMs,
  onDone,
}: DriveSettingsProps) {
  const [folderInput, setFolderInput] = React.useState(drive.sync?.watchedFolderId ?? '');
  const [busy, setBusy] = React.useState<null | 'save' | 'sync' | 'disconnect'>(null);
  const [confirming, setConfirming] = React.useState(false);

  const run = async (which: 'save' | 'sync' | 'disconnect', work: () => Promise<DocumentResult>) => {
    setBusy(which);
    try {
      onDone(await work());
    } finally {
      setBusy(null);
    }
  };

  /* ── ⚠️ TWO DIFFERENT "NOT WORKING" STATES, TWO DIFFERENT FIXES ────────────
     `configured` is whether an OAuth client exists at all — only somebody with
     the Google Cloud project can create that. `connected` is whether anybody has
     since granted access. One message for both is how a screen tells you it is
     broken without telling you what to do about it. */
  if (!drive.configured) {
    return (
      <Shell>
        <Warn
          title="Google Drive is not set up yet"
          body={
            <>
              Uploads still work and still queue for approval — they simply cannot be sent
              anywhere yet. Somebody needs to create an OAuth client in Google Cloud and set{' '}
              <code className="font-mono text-micro">GOOGLE_OAUTH_CLIENT_ID</code> and{' '}
              <code className="font-mono text-micro">GOOGLE_OAUTH_CLIENT_SECRET</code>.
            </>
          }
        />
      </Shell>
    );
  }

  if (!drive.connected) {
    return (
      <Shell>
        <Warn
          title="Google Drive is set up but nobody has connected an account"
          body="Press Connect and sign in with the Google account that owns the division's Drive. Until then nothing can be filed there."
        />
        <a
          href="/api/drive/connect"
          className={cn(
            'inline-flex h-10 items-center gap-2 self-start rounded-xl bg-accent-primary px-4',
            'text-body-sm font-semibold text-text-on-brand hover:bg-accent-primary-hover',
          )}
        >
          <PlatformIcon slug="googledrive" size={18} />
          Connect Google Drive
        </a>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* ---- Header ------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-h3 font-semibold text-text-primary">Google Drive integration</h2>
          <p className="text-body-sm text-text-secondary">
            Connect and manage the Google Drive account {APP_NAME} reads folders and files from.
          </p>
        </div>

        {/* ⚠️ A confirm step, because this is the one control here that takes
            something away. Disconnecting does not delete a file — but it stops
            every upload reaching Drive and blanks the Folders tab, and it is one
            click from a row of harmless buttons. */}
        {confirming ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                setConfirming(false);
                void run('disconnect', disconnectDriveAction);
              }}
              className="h-10 rounded-xl px-4 text-body-sm font-semibold text-white"
              style={{ backgroundColor: 'var(--feedback-error)' }}
            >
              {busy === 'disconnect' ? 'Disconnecting…' : 'Yes, disconnect'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="h-10 rounded-xl border border-border-default px-4 text-body-sm font-semibold text-text-secondary hover:bg-bg-hover"
            >
              Keep it
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={cn(
              'h-10 rounded-xl border px-4 text-body-sm font-semibold',
              'transition-colors duration-[120ms]',
            )}
            style={{
              borderColor: 'color-mix(in oklab, var(--feedback-error) 45%, transparent)',
              color: 'var(--feedback-error)',
            }}
          >
            Disconnect
          </button>
        )}
      </div>

      {/* ---- Status strip -------------------------------------------------- */}
      <div className="grid gap-0 rounded-xl border border-border-default bg-bg-surface md:grid-cols-4">
        <div className="flex items-center gap-3 border-border-subtle p-4 md:border-r">
          {/* The real Drive logo, at the size the drawing gives it. */}
          <PlatformIcon slug="googledrive" size={46} />
          <span className="min-w-0">
            <span
              className="block truncate text-body-sm font-semibold"
              style={{ color: 'var(--feedback-success)' }}
            >
              Google Drive is connected
            </span>
            <span className="block truncate text-caption text-text-primary" title={drive.account ?? undefined}>
              {drive.account ?? '—'}
            </span>
            <span className="block text-micro text-text-tertiary">
              {drive.connectedAt ? `Connected ${dayLabel(drive.connectedAt, nowMs)}` : 'Connected'}
            </span>
          </span>
        </div>

        <Fact label="Sync status">
          {/* ⚠️ "Manual", not "Active". See the header: nothing schedules a Drive
              sync, so claiming it is running would be a lie the owner would act on
              by never pressing the button again. */}
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{
                backgroundColor: drive.lastError
                  ? 'var(--feedback-error)'
                  : 'var(--feedback-warning)',
              }}
            />
            <span className="text-body-sm font-semibold text-text-primary">
              {drive.lastError ? 'Last run failed' : 'Manual'}
            </span>
          </span>
          <span className="mt-0.5 block text-micro text-text-tertiary">
            {drive.lastError ? 'See the message below' : 'Runs when you press Check now'}
          </span>
        </Fact>

        <Fact label="Watched folder">
          <span className="flex items-center gap-1.5">
            <Folder className="size-4 shrink-0 text-text-tertiary" strokeWidth={2.25} aria-hidden="true" />
            <span className="truncate text-body-sm font-semibold text-text-primary">
              {watchedFolderName ?? (drive.sync?.watchedFolderId ? 'Set' : 'My Drive')}
            </span>
          </span>
          <span className="mt-0.5 block text-micro text-text-tertiary">
            {/* Real numbers from the registry the last sync wrote, not estimates. */}
            {drive.sync?.watchedFolderId
              ? `${registry.folders} folders · ${registry.files} files`
              : `No folder chosen — the whole Drive is read (${registry.folders} folders)`}
          </span>
        </Fact>

        <Fact label="Last sync">
          <span className="block text-body-sm font-semibold text-text-primary">
            {drive.sync?.lastCheckedAt ? dayLabel(drive.sync.lastCheckedAt, nowMs) : 'Never'}
          </span>
          <span className="mt-0.5 block text-micro text-text-tertiary">
            {drive.sync?.lastCheckedAt
              ? `${registry.files} files recorded`
              : 'Press Check now to read Drive'}
          </span>
        </Fact>
      </div>

      {drive.lastError && (
        <Warn title="Google refused the last request" body={drive.lastError} />
      )}

      {/* ---- Three panels -------------------------------------------------- */}
      <div className="grid gap-0 rounded-xl border border-border-default bg-bg-surface lg:grid-cols-3">
        {/* Watched folder */}
        <div className="space-y-3 border-border-subtle p-5 lg:border-r">
          <div className="space-y-1">
            <h3 className="text-body font-semibold text-text-primary">Watched folder</h3>
            <p className="text-caption text-text-secondary">
              The folder {APP_NAME} reads. Leave it empty to read the whole Drive.
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="block text-caption font-medium text-text-secondary">
              Google Drive folder URL or ID
            </span>
            <input
              value={folderInput}
              onChange={(event) => setFolderInput(event.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
              className={cn(
                'h-10 w-full rounded-xl border border-border-default bg-bg-surface px-3',
                'text-body-sm text-text-primary placeholder:text-text-tertiary',
                'focus-visible:border-border-brand focus-visible:outline-none',
              )}
            />
          </label>

          {/* ⚠️ A URL is accepted as well as a bare id, because pasting the address
              bar is what anybody actually does. The action pulls the id out — this
              field does not have to. */}
          <p className="text-micro text-text-tertiary">
            Paste the folder&rsquo;s address or its id. Everything inside it and its subfolders is
            read; nothing outside it is.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run('save', () => setWatchedFolderAction(folderInput))}
              className={cn(
                'h-10 rounded-xl bg-accent-primary px-4 text-body-sm font-semibold',
                'text-text-on-brand hover:bg-accent-primary-hover disabled:opacity-60',
              )}
            >
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>

            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run('sync', syncDriveFoldersAction)}
              className={cn(
                'flex h-10 items-center gap-2 rounded-xl border border-border-default px-4',
                'text-body-sm font-semibold text-text-primary',
                'hover:border-border-strong hover:bg-bg-hover disabled:opacity-60',
              )}
            >
              {busy === 'sync' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" strokeWidth={2.25} aria-hidden="true" />
              )}
              {busy === 'sync' ? 'Reading Drive…' : 'Check now'}
            </button>
          </div>
        </div>

        {/* Sync settings */}
        <div className="space-y-3 border-border-subtle p-5 lg:border-r">
          <h3 className="text-body font-semibold text-text-primary">Sync settings</h3>

          <Item
            icon={RefreshCw}
            title="Sync is manual"
            body={
              <>
                Nothing schedules a Drive read. <strong>Check now</strong> is what makes one happen
                — everything on the Folders tab is as of the last run.
              </>
            }
          />
          <Item
            icon={Clock}
            title="Last run"
            body={
              drive.sync?.lastCheckedAt
                ? `${dayLabel(drive.sync.lastCheckedAt, nowMs)} — ${registry.folders} folders and ${registry.files} files recorded${
                    drive.sync.lastCreated > 0 ? `, ${drive.sync.lastCreated} new` : ''
                  }.`
                : 'Never run.'
            }
          />
          {drive.drafts.length > 0 && (
            <Item
              icon={AlertTriangle}
              title={`${drive.drafts.length} draft project${drive.drafts.length === 1 ? '' : 's'}`}
              body="Created from Drive folders and still needing a name and a client."
            />
          )}
        </div>

        {/* Security */}
        <div className="space-y-3 p-5">
          <h3 className="text-body font-semibold text-text-primary">Access &amp; permissions</h3>

          <Item
            icon={ShieldCheck}
            title="Only the folders you choose"
            body={`${APP_NAME} reads the watched folder and what is inside it. Nothing else in the Drive is touched.`}
          />
          <Item
            icon={Users}
            title="One connected account"
            body="Every read uses the account above, not each person's own Google login — so what this screen shows does not depend on who is looking."
          />
        </div>
      </div>
    </Shell>
  );
}

/* ---- Pieces -------------------------------------------------------------- */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4 rounded-2xl border border-border-default bg-bg-subtle p-5">
      {children}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border-subtle p-4 md:border-t-0 md:border-r md:last:border-r-0">
      <p className="mb-1 text-caption text-text-secondary">{label}</p>
      {children}
    </div>
  );
}

function Item({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Clock;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <Icon
        className="mt-0.5 size-4 shrink-0 text-text-tertiary"
        strokeWidth={2.25}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block text-caption font-semibold text-text-primary">{title}</span>
        <span className="block text-micro text-text-secondary">{body}</span>
      </span>
    </div>
  );
}

function Warn({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div
      className="flex gap-2.5 rounded-xl p-3.5"
      style={{ backgroundColor: 'color-mix(in oklab, var(--feedback-warning) 10%, transparent)' }}
    >
      <AlertTriangle
        className="mt-0.5 size-4 shrink-0"
        strokeWidth={2.25}
        aria-hidden="true"
        style={{ color: 'var(--feedback-warning)' }}
      />
      <span className="min-w-0">
        <span className="block text-caption font-semibold text-text-primary">{title}</span>
        <span className="block text-micro text-text-secondary">{body}</span>
      </span>
    </div>
  );
}

/** `18 Aug 2026 · 7 days ago`. Formatted from the SERVER's clock — see lib/now.ts. */
function dayLabel(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';

  const date = new Date(then).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
  });

  const days = Math.floor((nowMs - then) / 86_400_000);
  if (days <= 0) return `${date} · today`;
  if (days === 1) return `${date} · yesterday`;
  return `${date} · ${days} days ago`;
}
