'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, Mail, Paperclip, X } from 'lucide-react';

import {
  discardEmailAttachmentAction,
  emailComposerContextAction,
  prepareEmailAttachmentAction,
  sendLeadEmailAction,
  type EmailComposerContext,
} from '@/app/actions/crm-emails';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WRITING AN EMAIL TO THE CLIENT
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18: *"Make this email work. Right now email is not working…
 * email should be sender… make sure that there is a proper email setup, like a
 * subject and body, and we can select media also."*
 *
 * So: who it is from, who it is going to, a subject, a body, and attachments.
 *
 * ⚠️ THE FROM LINE IS READ FROM THE SERVER, NOT WRITTEN HERE. It is the address
 * this environment actually sends from, so what the client will see in their
 * inbox is what this says — a hard-coded "sales@" would be a promise the mailer
 * does not keep.
 *
 * ⚠️ AND THE MISSING PIECES ARE NAMED, NOT HIDDEN. No address on the lead, or no
 * mailer configured, each get their own sentence with the fix in it. A greyed-out
 * Send button teaches somebody the feature is broken.
 *
 * ⚠️ ATTACHMENTS GO TO STORAGE FIRST. A server action refuses a body over 4.5 MB
 * (Vercel's limit), so the browser uploads on a signed URL and the send action
 * reads the file back out of the bucket — the same route the WhatsApp composer
 * and the quotation PDF take.
 * ========================================================================= */

interface Attached {
  readonly id: string;
  readonly path: string;
  readonly filename: string;
  readonly mime: string;
  readonly sizeLabel: string;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmailComposer({
  leadId,
  onSent,
}: {
  leadId: string;
  /** Re-read the thread so the sent email appears without waiting for the poll. */
  onSent: () => void;
}) {
  const toast = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [context, setContext] = React.useState<EmailComposerContext | null>(null);
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [attached, setAttached] = React.useState<readonly Attached[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  /* ⚠️ ONE READ WHEN THE COMPOSER OPENS. The subject it suggests comes from the
     thread, so it cannot be computed on the client. */
  React.useEffect(() => {
    let alive = true;
    void emailComposerContextAction(leadId).then((next) => {
      if (!alive) return;
      setContext(next);
      if (next.ok && next.suggestedSubject) {
        setSubject((current) => current || next.suggestedSubject!);
      }
    });
    return () => {
      alive = false;
    };
  }, [leadId]);

  const pick = async (file: File) => {
    if (uploading) return;
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
          id: `${slot.path}`,
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
        text: result.unrecorded
          ? 'Sent — but it could not be added to the conversation.'
          : 'Email sent.',
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

  if (!context) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-border-default bg-bg-base px-3 py-3 text-caption text-text-secondary">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Reading who this would come from…
      </p>
    );
  }

  if (!context.ok) {
    return (
      <p className="rounded-xl border border-border-default bg-bg-base px-3 py-3 text-caption text-feedback-error">
        {context.error}
      </p>
    );
  }

  const noAddress = !context.to;
  const noMailer = !context.from;
  const blocked = noAddress || noMailer;

  return (
    <div className="rounded-xl border border-border-default bg-bg-base">
      {/* ── Who it is from and to ──────────────────────────────────────── */}
      <div className="space-y-1 border-b border-border-subtle px-3 py-2.5">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-caption">
          <span className="w-10 shrink-0 text-text-tertiary">From</span>
          <span className="truncate font-medium text-text-primary">
            {context.fromName}
            {context.businessName ? ` · ${context.businessName}` : ''}
          </span>
          {context.from ? (
            <span className="truncate text-text-secondary">&lt;{context.from}&gt;</span>
          ) : (
            <span className="text-[color:var(--feedback-warning)]">no mailer configured</span>
          )}
        </p>
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-caption">
          <span className="w-10 shrink-0 text-text-tertiary">To</span>
          {context.to ? (
            <>
              <span className="truncate font-medium text-text-primary">{context.toName}</span>
              <span className="truncate text-text-secondary">&lt;{context.to}&gt;</span>
            </>
          ) : (
            <span className="text-[color:var(--feedback-warning)]">
              {context.toName ?? 'This lead'} has no email address — add one on the Overview tab.
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
          disabled={uploading || attached.length >= 5}
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

        {blocked ? (
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-text-secondary">
            <AlertTriangle className="size-3.5 shrink-0 text-[color:var(--feedback-warning)]" aria-hidden="true" />
            {noAddress
              ? 'Nothing can be sent until this lead has an email address.'
              : 'Email is not configured in this environment — no RESEND_API_KEY.'}
          </p>
        ) : context.sandbox ? (
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-caption text-text-secondary">
            <AlertTriangle className="size-3.5 shrink-0 text-[color:var(--feedback-warning)]" aria-hidden="true" />
            Test sender: mail can only reach the Resend account&rsquo;s own address until a domain is verified.
          </p>
        ) : (
          <p className="min-w-0 flex-1 truncate text-caption text-text-tertiary">
            Goes out as {context.businessName ?? 'your business'}, signed {context.fromName}.
          </p>
        )}

        <button
          type="button"
          onClick={() => void send()}
          disabled={blocked || sending || !subject.trim() || !body.trim()}
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
