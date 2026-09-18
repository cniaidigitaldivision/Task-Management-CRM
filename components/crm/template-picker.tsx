'use client';

import * as React from 'react';
import { AlertTriangle, ExternalLink, Loader2, Send, X } from 'lucide-react';

import { whatsAppTemplatesAction, type TemplateList } from '@/app/actions/crm-followups';
import { sendWhatsAppTemplateAction } from '@/app/actions/crm-whatsapp';
import { WA_GREEN, WhatsAppMark } from '@/components/crm/whatsapp-mark';
import { useToast } from '@/components/ui/toast';
import type { CrmMessage } from '@/lib/db/queries/crm-leads';
import { cn } from '@/lib/utils';

/* ============================================================================
 * STARTING A CONVERSATION
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18: *"how can I initiate a chat with it?"*
 *
 * With an approved template, and until now there was no button for it. One could
 * be SCHEDULED through the follow-up wizard and sent by the cron a few minutes
 * later — but a salesperson looking at a conversation they cannot start had
 * nowhere to press, which is why the question was asked at all.
 *
 * ⚠️ THE LIST IS READ LIVE FROM META, never from our own guess at it. A template
 * is approved, paused or rejected by Meta and can change between one send and the
 * next; a cached list would offer one that no longer works.
 *
 * ⚠️ AND WHAT CANNOT BE SENT IS SHOWN, NOT HIDDEN. A template awaiting approval
 * is the answer to "why can I not message them yet", so it is listed with Meta's
 * own status against it and no send button — hiding it would leave somebody
 * wondering where the template they submitted went.
 * ========================================================================= */

export function TemplatePicker({
  leadId,
  leadName,
  senderName,
  onClose,
  onSent,
}: {
  leadId: string;
  leadName: string;
  senderName: string;
  onClose: () => void;
  /** The thread as it stands after the send, so the chat updates at once. */
  onSent: (thread: readonly CrmMessage[]) => void;
}) {
  const toast = useToast();
  const [list, setList] = React.useState<TemplateList | null>(null);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void whatsAppTemplatesAction(leadId).then((next) => {
      if (!alive) return;
      setList(next);
      /* The first one that can actually be sent — usually the only one. */
      const ready = next.templates.find((t) => t.status === 'APPROVED' && t.variables === 0);
      if (ready) setChosen(`${ready.name}:${ready.language}`);
    });
    return () => {
      alive = false;
    };
  }, [leadId]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const templates = list?.templates ?? [];
  const picked = templates.find((t) => `${t.name}:${t.language}` === chosen) ?? null;
  const sendable = picked?.status === 'APPROVED' && picked.variables === 0;

  const send = async () => {
    if (!picked || sending) return;
    setSending(true);
    try {
      const result = await sendWhatsAppTemplateAction({
        leadId,
        name: picked.name,
        language: picked.language,
        preview: picked.body,
      });
      if (!result.ok) {
        toast({ tone: 'error', text: result.error ?? 'WhatsApp refused the template.' });
        if (result.thread) onSent(result.thread);
        return;
      }
      toast({ tone: 'ok', text: `Sent to ${leadName}. Once they reply you can write freely for 24 hours.` });
      if (result.thread) onSent(result.thread);
      onClose();
    } catch {
      toast({ tone: 'error', text: 'That did not send — the connection dropped.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Start the conversation with a template"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border-subtle px-5 py-4">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-xl"
            style={{ background: `color-mix(in oklab, ${WA_GREEN} 12%, transparent)`, color: WA_GREEN }}
          >
            <WhatsAppMark className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-body font-semibold text-text-primary">Start the conversation</h2>
            <p className="text-caption text-text-secondary">
              {leadName} has not messaged you, so WhatsApp only delivers an approved template. Sending one opens a
              24-hour window.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!list ? (
            <p className="flex items-center gap-2 py-6 text-caption text-text-secondary">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Reading your approved templates from WhatsApp…
            </p>
          ) : !list.ok ? (
            <p className="rounded-xl border border-border-default px-3.5 py-3 text-caption text-text-secondary">
              {list.error}
            </p>
          ) : templates.length === 0 ? (
            <p className="rounded-xl border border-border-default px-3.5 py-3 text-caption text-text-secondary">
              This business has no message templates yet. One has to be written and approved by Meta before a
              conversation can be started.
            </p>
          ) : (
            <ul className="space-y-2">
              {templates.map((t) => {
                const id = `${t.name}:${t.language}`;
                const ok = t.status === 'APPROVED' && t.variables === 0;
                const on = chosen === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      disabled={!ok}
                      onClick={() => setChosen(id)}
                      className={cn(
                        'w-full rounded-xl border px-3.5 py-3 text-left transition-colors',
                        ok ? 'border-border-default hover:bg-bg-subtle' : 'cursor-not-allowed border-dashed opacity-70',
                      )}
                      style={on ? { borderColor: WA_GREEN, background: `color-mix(in oklab, ${WA_GREEN} 7%, transparent)` } : undefined}
                    >
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-text-primary">
                          {t.name}
                        </span>
                        <span className="shrink-0 text-caption text-text-tertiary">{t.language}</span>
                        <Status status={t.status} />
                      </span>
                      {t.body && (
                        <span className="mt-1.5 block whitespace-pre-wrap text-caption leading-relaxed text-text-secondary">
                          {t.body}
                        </span>
                      )}
                      {t.buttons.length > 0 && (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {t.buttons.map((b) => (
                            <span
                              key={b}
                              className="rounded-md px-2 py-0.5 text-caption"
                              style={{ background: `color-mix(in oklab, ${WA_GREEN} 10%, transparent)`, color: WA_GREEN }}
                            >
                              {b}
                            </span>
                          ))}
                        </span>
                      )}
                      {/* ⚠️ A TEMPLATE WITH PLACEHOLDERS CANNOT GO FROM HERE. Meta
                          refuses a send whose parameter count does not match, and
                          this dialog has nowhere to type them — the follow-up
                          wizard fills them from the lead's own details. */}
                      {t.status === 'APPROVED' && t.variables > 0 && (
                        <span className="mt-1.5 flex items-center gap-1.5 text-caption text-text-secondary">
                          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                          Has {t.variables} placeholder{t.variables === 1 ? '' : 's'} — send it from New follow-up,
                          which fills them in.
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-5 py-4">
          <a
            href={list?.managerUrl ?? 'https://business.facebook.com/latest/whatsapp_manager/message_templates'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-caption font-medium text-text-secondary hover:text-text-primary"
          >
            Write a new template
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border-default bg-bg-surface px-4 py-2 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!sendable || sending}
              onClick={() => void send()}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-body-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: WA_GREEN }}
            >
              {sending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
              {sending ? 'Sending…' : 'Send as ' + senderName}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Status({ status }: { status: string }) {
  const approved = status === 'APPROVED';
  return (
    <span
      className="shrink-0 rounded-md px-1.5 py-0.5 text-caption font-medium"
      style={
        approved
          ? { background: `color-mix(in oklab, ${WA_GREEN} 12%, transparent)`, color: WA_GREEN }
          : { background: 'color-mix(in oklab, var(--feedback-warning) 12%, transparent)', color: 'var(--feedback-warning)' }
      }
    >
      {status.toLowerCase()}
    </span>
  );
}
