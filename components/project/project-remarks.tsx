'use client';

import * as React from 'react';
import { Loader2, MessageSquareText, Send, Trash2 } from 'lucide-react';

import {
  addRemarkAction,
  listRemarksAction,
  removeRemarkAction,
} from '@/app/actions/project-remarks';
import { Avatar } from '@/components/ui/avatar';
import { Dialog } from '@/components/ui/dialog';
import { ROLE_LABEL, type Role } from '@/lib/domain/constants';
import type { RemarkRow } from '@/lib/db/queries/project-remarks';
import { cn } from '@/lib/utils';

/* ============================================================================
 * REMARKS — owner, 2026-09-08
 * ----------------------------------------------------------------------------
 *   *"I want to add a remarks option and the remarks should be properly shown.
 *   When I click it, it should properly pop up like a proper chat that shows
 *   which remarks are added by which person… Plus if I want to add some
 *   remarks, I can add them in the same modal."*
 *
 * A button on the project header and one dialog: the thread above, the composer
 * below. Read and write in the same place, because a note somebody wants to
 * leave is almost always a reply to one already there.
 *
 * ── ⚠️ THE THREAD IS FETCHED ON OPEN, NOT SHIPPED WITH THE PAGE ─────────────
 * The project page already carries members, tasks, credentials, documents,
 * placements and a month of calendar. Every prop of a server component is
 * serialised into the HTML, and payload size is where this application's
 * slowness has actually been, twice. The page carries the COUNT — one integer
 * for the badge — and the conversation arrives when somebody asks for it.
 *
 * ── ⚠️ AND EVERY WRITE RETURNS THE WHOLE THREAD ─────────────────────────────
 * `addRemarkAction` and `removeRemarkAction` both answer with the server's copy
 * of the list, which is what gets rendered. Appending the new remark locally is
 * shorter and drifts: two people with this open produce two different orders and
 * neither matches the database.
 * ========================================================================= */

function when(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.max(0, Math.round((Date.now() - then.getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ProjectRemarks({
  projectId,
  projectName,
  /** From the server, so the badge is right before anything is fetched. */
  initialCount,
  currentUserId,
  /* ── ⚠️ YOUR NAME AND FACE, NOT ONLY YOUR ID — owner, 2026-09-08 ──────────
     *"You should display my image with my name. You are displaying it at the
     bottom left in the left sidebar, in a circle, with my profile picture and
     my name. In that way I want that."*

     The composer was an unattributed box. Showing who is about to speak is
     what makes it read as a conversation rather than a form — and it answers
     the question somebody asks before writing anything on a shared record:
     under whose name is this going out? */
  currentUserName,
  currentUserAvatarUrl,
  currentUserRole,
  /** `project.edit` and above may remove anybody's; everyone may remove their own. */
  canModerate,
}: {
  projectId: string;
  projectName: string;
  initialCount: number;
  currentUserId: string;
  currentUserName: string;
  currentUserAvatarUrl: string | null;
  currentUserRole: Role;
  canModerate: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [remarks, setRemarks] = React.useState<readonly RemarkRow[] | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  /* The badge follows the thread once it has been loaded, and the server's
     count until then — so posting updates the number without a page refresh. */
  const count = remarks?.length ?? initialCount;

  const listRef = React.useRef<HTMLDivElement>(null);
  const boxRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (!open) return;

    let cancelled = false;
    void (async () => {
      const result = await listRemarksAction(projectId);
      if (cancelled) return;
      if (!result.ok) setError(result.error ?? 'Those remarks could not be loaded.');
      else setRemarks(result.remarks ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  /* ⚠️ SCROLLED TO THE BOTTOM, because a conversation is read oldest-first and
     the part worth seeing is the end. Runs on every render of an open dialog
     rather than on a dependency: the list grows when a remark is posted, and
     the height it grows to is not known until after that paint. */
  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const post = async () => {
    const text = draft.trim();
    if (!text || busy) return;

    setBusy(true);
    setError('');
    const result = await addRemarkAction(projectId, text);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? 'That could not be saved.');
      return;
    }
    /* ⚠️ Cleared only on success. A failed post that wipes what somebody typed
       is the create-task dialog's bug in a smaller box. */
    setDraft('');
    setRemarks(result.remarks ?? []);
    boxRef.current?.focus();
  };

  const remove = async (remarkId: string) => {
    setBusy(true);
    setError('');
    const result = await removeRemarkAction(projectId, remarkId);
    setBusy(false);
    if (!result.ok) setError(result.error ?? 'That could not be removed.');
    else setRemarks(result.remarks ?? []);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? `Remarks — ${count} on this project` : 'Remarks'}
        title="Remarks"
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-caption font-semibold',
          'text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary',
        )}
      >
        <MessageSquareText className="size-4" strokeWidth={2.25} aria-hidden="true" />
        Remarks
        {count > 0 && (
          <span
            className="rounded-full px-1.5 text-micro font-semibold tabular-nums"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--accent-primary) 18%, transparent)',
              color: 'var(--accent-primary)',
            }}
          >
            {count}
          </span>
        )}
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        title="Remarks"
        description={`Notes about ${projectName}. Everybody who can see this project can read them.`}
      >
        <div className="space-y-3">
          {error && (
            <p
              className="rounded-lg px-3 py-2 text-caption"
              style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
              role="alert"
            >
              {error}
            </p>
          )}

          <div
            ref={listRef}
            className="max-h-[22rem] space-y-3 overflow-y-auto pr-1"
            /* A conversation is a list of messages, and announcing it as one
               lets a screen reader move between them. */
            role="log"
            aria-label={`Remarks on ${projectName}`}
          >
            {remarks === null && !error && (
              <p className="flex items-center justify-center gap-2 py-8 text-caption text-text-tertiary">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Loading the thread…
              </p>
            )}

            {remarks?.length === 0 && (
              <div className="rounded-lg border border-dashed border-border-default px-4 py-8 text-center">
                <p className="text-caption font-semibold text-text-primary">No remarks yet</p>
                <p className="mx-auto mt-1 max-w-sm text-micro text-text-tertiary">
                  Anything the next person opening this project should know — what the client
                  said, why a date moved, what is still waiting on them.
                </p>
              </div>
            )}

            {remarks?.map((remark) => {
              const mine = remark.authorId === currentUserId;

              /* ⚠️ THREE CASES, AND THEY USED TO BE TWO. A null name meant
                 "Former member", which is right only when `author_id` is null
                 too — a deleted account. Until migration 105 a Team Member also
                 got null names for everybody, because `users_select` hides the
                 staff table from them, so live colleagues were labelled as gone.
                 The reader no longer produces that, and this keeps the two
                 states apart anyway: a missing name beside a real author id is
                 a fault to say plainly, not a departure to invent. */
              const name = mine
                ? currentUserName
                : (remark.authorName ?? (remark.authorId ? 'Someone' : 'Former member'));
              return (
                <article key={remark.id} className="flex items-start gap-2.5">
                  <Avatar
                    name={name}
                    src={mine ? currentUserAvatarUrl : remark.authorAvatarUrl}
                    size="sm"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      {/* ⚠️ THE NAME, ALWAYS — even when it is yours. "You"
                          alone was shorter and left a thread of your own notes
                          with nobody's name in it, which is not what somebody
                          scrolling back a month wants to read. */}
                      <span className="text-caption font-semibold text-text-primary">
                        {name}
                        {mine && <span className="font-normal text-text-tertiary"> (you)</span>}
                      </span>
                      {remark.authorRole && (
                        <span className="text-micro text-text-tertiary">
                          {ROLE_LABEL[remark.authorRole]}
                        </span>
                      )}
                      <span className="text-micro text-text-tertiary">
                        {when(remark.createdAt)}
                      </span>

                      {(mine || canModerate) && (
                        <button
                          type="button"
                          onClick={() => void remove(remark.id)}
                          disabled={busy}
                          aria-label={`Remove the remark by ${mine ? 'you' : name}`}
                          className="ml-auto rounded p-1 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                        >
                          <Trash2 className="size-3" strokeWidth={2.25} aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    {/* `whitespace-pre-wrap` so a remark typed with line breaks
                        keeps them, and `break-words` so a pasted URL cannot push
                        the dialog sideways. */}
                    <p className="mt-0.5 rounded-lg bg-bg-subtle px-3 py-2 text-caption break-words whitespace-pre-wrap text-text-primary">
                      {remark.body}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>

          {/* ── The composer, in the same dialog ──────────────────────────── */}
          <div className="border-t border-border-subtle pt-3">
            {/* Who is about to speak, in the shape the sidebar already uses:
                the picture, the name, the designation. */}
            <div className="mb-2 flex items-center gap-2">
              <Avatar name={currentUserName} src={currentUserAvatarUrl} size="sm" />
              <span className="min-w-0 text-caption font-semibold text-text-primary">
                {currentUserName}
              </span>
              <span className="truncate text-micro text-text-tertiary">
                {ROLE_LABEL[currentUserRole]}
              </span>
            </div>

            <label htmlFor="remark-body" className="sr-only">
              Add a remark
            </label>
            <textarea
              id="remark-body"
              ref={boxRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              /* ⚠️ Enter posts, Shift+Enter breaks the line — the convention
                 every chat uses. Without it the obvious key does nothing and the
                 person hunts for the button. */
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void post();
                }
              }}
              rows={3}
              maxLength={4000}
              placeholder="Add a remark — what happened, what to watch for…"
              className="w-full resize-y rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-caption text-text-primary placeholder:text-text-tertiary focus:border-border-brand focus:outline-none"
            />

            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-micro text-text-tertiary">
                Enter to post, Shift+Enter for a new line.
              </p>
              <button
                type="button"
                onClick={() => void post()}
                disabled={busy || draft.trim().length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-caption font-semibold text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                )}
                Post
              </button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
