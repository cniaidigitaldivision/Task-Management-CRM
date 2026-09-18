'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, Mail, Paperclip, X } from 'lucide-react';

import {
  discardEmailAttachmentAction,
  mailerStatusAction,
  prepareEmailAttachmentAction,
  sendLeadEmailAction,
  type MailerStatus,
} from '@/app/actions/crm-emails';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WRITING AN EMAIL TO THE CLIENT
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18: *"Make this email work… a proper email setup, like a subject
 * and body, and we can select media also."*
 *
 * ── ⚠️ AND IT DRAWS IN THE FRAME IT OPENS ───────────────────────────────────
 * Owner, an hour later: *"why is it taking a lot of time to load in the
 * conversation in the email tab?"* The first version asked the server for a
 * context object before rendering anything, and everything in that object except
 * two fields was **already on the page** — the client's name and address, the
 * business, the salesperson, and the last email's subject all live in the
 * drawer's own record and thread. Rule Zero, law 3: *never re-fetch what is
 * already on the page.* The query measured 6.4 ms; the wait was a round trip that
 * did not need to exist.
 *
 * So everything the header shows arrives as a prop, and the one genuinely unknown
 * thing — whether a mailer is configured and which address it sends from — is a
 * per-ENVIRONMENT fact, asked once for the whole session and never blocking.
 *
 * ⚠️ THE FROM LINE IS STILL THE SERVER'S. What this shows is a label; the letter's
 * real sender, business and recipient are read from the lead under RLS inside
 * `sendLeadEmailAction`. A composer that posted its own "from" could put one
 * client's business on another's letter.
 *
 * ⚠️ ATTACHMENTS GO TO STORAGE FIRST. A server action refuses a body over 4.5 MB
 * (Vercel's limit), so the browser uploads on a signed URL and the send action
 * reads the file back out of the bucket — the same route the WhatsApp composer and
 * the quotation PDF take.
 * ========================================================================= */

interface Attached {
  readonly id: string;
  readonly path: string;
  readonly filename: string;
  readonly mime: string;
  readonly sizeLabel: string;
}

const MAX_FILES = 5;

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The mailer, asked once per page load.
 *
 * ⚠️ A MODULE-LEVEL PROMISE, NOT STATE. Switching leads unmounts this component,
 * and re-asking "is email configured" for every drawer would be the same wasted
 * round trip in smaller pieces. The answer cannot change while the page is open —
 * it is read from the environment.
 */
let mailerOnce: Promise<MailerStatus> | null = null;
function mailer(): Promise<MailerStatus> {
  mailerOnce ??= mailerStatusAction().catch(
    /* A failed probe must not break the composer: Send still works, and the
       server refuses with the real reason if there is one. */
    (): MailerStatus => ({ configured: true, from: null, sandbox: false }),
  );
  return mailerOnce;
}

export function EmailComposer({
  leadId,
  to,
  toName,
  businessName,
  fromName,
  suggestedSubject,
  handoff,
  onHandoffUsed,
  onSent,
}: {
  leadId: string;
  /** The client's address, or null when the lead has none on record. */
  to: string | null;
  toName: string;
  businessName: string;
  /** Who signs it — the person reading this screen. */
  fromName: string;
  /** Computed from the thread already on the page. */
  suggestedSubject: string;
  /**
   * A quotation, property sheet or invoice the Related items dialog handed over
   * after somebody chose Email.
   *
   * ⚠️ IT ARRIVES IN THE COMPOSER, IT DOES NOT SEND. The letter is filled in and
   * the file attached; a person reads it and presses Send. Nothing in that dialog
   * talks to a client.
   */
  handoff?: {
    readonly id: number;
    readonly files: readonly File[];
    readonly text: string;
    readonly subject?: string;
  } | null;
  onHandoffUsed?: () => void;
  /** Re-read the thread so the sent email appears without waiting for the poll. */
  onSent: () => void;
}) {
  const toast = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [subject, setSubject] = React.useState(suggestedSubject);
  const [body, setBody] = React.useState('');
  const [attached, setAttached] = React.useState<readonly Attached[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [status, setStatus] = React.useState<MailerStatus | null>(null);
  const [handoffSeen, setHandoffSeen] = React.useState<number | null>(null);

  /* ⚠️ THE SUBJECT AND BODY ARE SET DURING RENDER, ONCE PER HAND-OFF, so the
     letter is on screen in the same frame the dialog closes. The file needs an
     await, so it goes through the same upload a manual Attach uses. */
  if (handoff && handoff.id !== handoffSeen) {
    setHandoffSeen(handoff.id);
    if (handoff.subject) setSubject(handoff.subject);
    if (handoff.text) setBody((current) => (current.trim() ? `${current}

${handoff.text}` : handoff.text));
  }

  /* ⚠️ UNDERNEATH A SCREEN THAT IS ALREADY UP. Nothing waits on this. */
  React.useEffect(() => {
    let alive = true;
    void mailer().then((next) => {
      if (alive) setStatus(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  const pick = async (file: File) => {
    setUploading(true);
    try {
      const slot = await prepareEmailAttachmentAction(leadId, file.name, file.size);
      if (!slot.ok || !slot.url || !slot.path) {
        toast({ tone: 'error', text: slot.error ?? 'That file could not be prepared.' });
        return;
      }
      const put = await fetch(slot.url, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!put.ok) {
        toast({ tone: 'error', text: `The upload was refused (${put.status}).` });
        return;
      }
      setAttached((list) => [
        ...list,
        {
          id: slot.path!,
          path: slot.path!,
          filename: file.name,
          mime: file.type || 'application/octet-stream',
          sizeLabel: sizeLabel(file.size),
        },
      ]);
    } catch {
      toast({ tone: 'error', text: 'The upload did not finish — check the connection.' });
    } finally {
      setUploading(false);
    }
  };

  const pickRef = React.useRef<(file: File) => Promise<void>>(async () => {});
  /* ⚠️ ASSIGNED IN AN EFFECT, NEVER DURING RENDER — `react-hooks/refs`, and the
     same slip the WhatsApp composer's `pickFilesRef` made first. Effects run in
     declaration order after the render, so `pick` is defined by the time this
     runs even though it is written below. */
  React.useEffect(() => {
    pickRef.current = pick;
  });

  React.useEffect(() => {
    if (!handoff || handoff.files.length === 0) {
      if (handoff) onHandoffUsed?.();
      return;
    }
    let alive = true;
    void (async () => {
      /* ⚠️ IN SERIES, NOT IN PARALLEL. Each upload sets `uploading`, and two at
         once would have the second refused by its own guard. */
      for (const file of handoff.files) {
        if (!alive) return;
        await pickRef.current(file);
      }
      if (alive) onHandoffUsed?.();
    })();
    return () => {
      alive = false;
    };
  }, [handoff, onHandoffUsed]);

  const remove = (item: Attached) => {
    setAttached((list) => list.filter((a) => a.id !== item.id));
    /* Nothing points at it; a failed tidy-up must not become an unhandled rejection. */
    void discardEmailAttachmentAction(leadId, item.path).catch(() => {});
  };

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const result = await sendLeadEmailAction({
        leadId,
        subject,
        body,
        attachments: attached.map((a) => ({ path: a.path, filename: a.filename, mime: a.mime })),
      });
      if (!result.ok) {
        toast({ tone: 'error', text: result.error ?? 'The email could not be sent.' });
        return;
      }
      toast({
        tone: 'ok',
        text: result.unrecorded ? 'Sent — but it could not be added to the conversation.' : 'Email sent.',
      });
      setBody('');
      setAttached([]);
      onSent();
    } catch {
      toast({ tone: 'error', text: 'The email could not be sent — the connection dropped.' });
    } finally {
      setSending(false);
    }
  };

  /* ⚠️ THE ADDRESS ON THE LEAD IS THE ONE THING THAT CAN STOP A SEND, and the
     page knows it — so that refusal is instant rather than waiting on a probe. */
  const noAddress = !to;

  return (
    <div className="rounded-xl border border-border-default bg-bg-base">
      {/* ── Who it is from and to ──────────────────────────────────────── */}
      <div className="space-y-1 border-b border-border-subtle px-3 py-2.5">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-caption">
          <span className="w-10 shrink-0 text-text-tertiary">From</span>
          <span className="truncate font-medium text-text-primary">
            {fromName} · {businessName}
          </span>
          {/* ⚠️ THE ADDRESS APPEARS WHEN IT ARRIVES, and its absence is not
              announced — an empty slot for a beat is not worth a spinner. */}
          {status?.from && <span className="truncate text-text-secondary">&lt;{status.from}&gt;</span>}
          {status && !status.configured && (
            <span className="text-[color:var(--feedback-warning)]">no mailer configured</span>
          )}
        </p>
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-caption">
          <span className="w-10 shrink-0 text-text-tertiary">To</span>
          {to ? (
            <>
              <span className="truncate font-medium text-text-primary">{toName}</span>
              <span className="truncate text-text-secondary">&lt;{to}&gt;</span>
            </>
          ) : (
            <span className="text-[color:var(--feedback-warning)]">
              {toName} has no email address — add one with Edit details.
            </span>
          )}
        </p>
      </div>

      {/* ── Subject ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <label htmlFor="crm-email-subject" className="w-10 shrink-0 text-caption text-text-tertiary">
          Subject
        </label>
        <input
          id="crm-email-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="What it is about"
          className="min-w-0 flex-1 bg-transparent text-body-sm font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none"
        />
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <textarea
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write the email — a blank line starts a new paragraph."
        className="w-full resize-y bg-transparent px-3 py-2.5 text-body-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
      />

      {/* ── Attachments ───────────────────────────────────────────────── */}
      {attached.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 px-3 pb-2">
          {attached.map((a) => (
            <li
              key={a.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border-default bg-bg-surface px-2 py-1 text-caption"
            >
              <Paperclip className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
              <span className="truncate text-text-primary">{a.filename}</span>
              <span className="shrink-0 tabular-nums text-text-tertiary">{a.sizeLabel}</span>
              <button
                type="button"
                onClick={() => remove(a)}
                aria-label={`Remove ${a.filename}`}
                className="grid size-4 shrink-0 place-items-center rounded text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── The foot ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-3 py-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || attached.length >= MAX_FILES}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1.5 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Paperclip className="size-3.5" aria-hidden="true" />
          )}
          {uploading ? 'Uploading…' : 'Attach'}
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="application/pdf,image/*,video/*,audio/*,.doc,.docx,.xls,.xlsx,.csv,.txt"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void pick(file);
          }}
        />

        {noAddress ? (
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-text-secondary">
            <AlertTriangle className="size-3.5 shrink-0 text-[color:var(--feedback-warning)]" aria-hidden="true" />
            Nothing can be sent until this lead has an email address.
          </p>
        ) : status && !status.configured ? (
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-text-secondary">
            <AlertTriangle className="size-3.5 shrink-0 text-[color:var(--feedback-warning)]" aria-hidden="true" />
            Email is not configured in this environment — no RESEND_API_KEY.
          </p>
        ) : status?.sandbox ? (
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-text-secondary">
            <AlertTriangle className="size-3.5 shrink-0 text-[color:var(--feedback-warning)]" aria-hidden="true" />
            Test sender: mail only reaches the Resend account&rsquo;s own address until a domain is verified.
          </p>
        ) : (
          <p className="min-w-0 flex-1 truncate text-caption text-text-tertiary">
            Goes out as {businessName}, signed {fromName}.
          </p>
        )}

        {/* ⚠️ NOT DISABLED WHILE THE PROBE IS IN FLIGHT. Send is live the moment
            there is something to send; the server is what actually refuses, and it
            refuses with the provider's own sentence. */}
        <button
          type="button"
          onClick={() => void send()}
          disabled={noAddress || sending || !subject.trim() || !body.trim()}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg bg-accent-primary px-3.5 py-2 text-caption font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40',
          )}
        >
          {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Mail className="size-4" aria-hidden="true" />}
          {sending ? 'Sending…' : 'Send email'}
        </button>
      </div>
    </div>
  );
}
