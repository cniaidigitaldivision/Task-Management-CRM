import 'server-only';

import { APP_NAME } from '@/lib/domain/constants';

/* ============================================================================
 * EMAIL — Resend
 * ----------------------------------------------------------------------------
 * ── NO SDK ───────────────────────────────────────────────────────────────────
 * Resend's REST API is one POST with a JSON body. The SDK wraps that in a
 * dependency, and the whole surface used here is twelve lines. Fewer moving
 * parts, nothing to keep up to date, and the failure modes are visible.
 *
 * ── SENDING NEVER THROWS INTO THE CALLER ─────────────────────────────────────
 * Every function returns a result rather than raising. That is deliberate and it
 * is the most important decision in this file.
 *
 * Consider inviting somebody: the account is created, the token is issued, and
 * then Resend is briefly unreachable. If the send throws, the whole action
 * fails — and the caller is left with an account and a token that already exist,
 * looking at an error suggesting nothing happened. Retrying then collides with
 * the email address that was just taken.
 *
 * So the invitation is created, the send is attempted, and whether it arrived is
 * *reported*. The screen shows the link either way, which means a failed send is
 * an inconvenience rather than a dead end.
 *
 * ── ⚠️ THE SANDBOX SENDER ONLY REACHES ONE ADDRESS ───────────────────────────
 * `onboarding@resend.dev` delivers ONLY to the address that owns the Resend
 * account. A team cannot be onboarded until a real domain is verified —
 * `describeSender()` exists so the interface can say so rather than letting
 * somebody discover it by wondering why nobody replied.
 *
 * **Correction, observed 2026-08-12.** This comment previously said mail to
 * anybody else is "accepted with a 200 and silently dropped". That is NOT what
 * happens. Resend **refuses it outright**:
 *
 *     403 validation_error — "You can only send testing emails to your own
 *     email address (…). To send emails to other recipients, please verify a
 *     domain at resend.com/domains…"
 *
 * Which is better, and it changes how the rest of the system should read: a
 * refusal is a fact we are told, so `sendEmail` reports `sent: false` with the
 * reason and nothing has to be inferred from a sender string. The silent-drop
 * case is what `usingSandboxSender()` still guards against being *claimed* as
 * delivery, but it is not the case that actually occurs on this path.
 * ========================================================================= */

export type EmailResult =
  | { readonly sent: true; readonly id: string }
  | { readonly sent: false; readonly reason: string; readonly configured: boolean };

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function apiKey(): string | null {
  const key = process.env.RESEND_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

function from(): string {
  /* ⚠️ The fallback is the SANDBOX sender, and it is a fallback rather than a
     default: `onboarding@resend.dev` refuses any recipient except the Resend
     account owner (see the 403 above). Naming it after the product rather than
     the old "CNI CRM" keeps a sandbox message from arriving under a name the
     application no longer uses. The real sender is EMAIL_FROM. */
  return process.env.EMAIL_FROM?.trim() || `${APP_NAME} <onboarding@resend.dev>`;
}

/** True while mail can only reach the Resend account's own address. */
export function usingSandboxSender(): boolean {
  return from().includes('resend.dev');
}

export function describeSender(): { configured: boolean; sandbox: boolean; from: string } {
  return { configured: apiKey() !== null, sandbox: usingSandboxSender(), from: from() };
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  /* Always supplied. A message with no plain-text alternative scores worse with
     spam filters, and the recovery design depends on these arriving (ADR-007). */
  text: string;
  /* ── INLINE IMAGES, BY CONTENT ID ─────────────────────────────────────────
     Optional so a caller with nothing to attach stays a three-field call, but
     in practice every template carries the header mark.

     ⚠️ The field names go over the wire in snake_case. Resend rejects
     `contentId` silently — it is not a validation error, the attachment simply
     arrives as a normal file and the cid: reference in the HTML resolves to
     nothing, which is a broken image with no error anywhere to explain it. The
     mapping below is the whole reason this is not a straight pass-through. */
  attachments?: readonly {
    filename: string;
    content: string;
    contentId: string;
    contentType: string;
  }[];
}): Promise<EmailResult> {
  const key = apiKey();
  if (!key) {
    return {
      sent: false,
      configured: false,
      reason: 'RESEND_API_KEY is not set, so nothing was sent.',
    };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from(),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        /* Omitted entirely when there is nothing to attach, rather than sent as
           an empty array — a stray `attachments: []` is the kind of thing an API
           is within its rights to reject. */
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((file) => ({
                filename: file.filename,
                content: file.content,
                content_id: file.contentId,
                content_type: file.contentType,
              })),
            }
          : {}),
      }),
      /* A slow mail provider must not hold a page open. The invitation exists
         regardless of whether this succeeds. */
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      /* Resend puts a readable message in the body. Surfaced because "422" alone
         sends somebody hunting, and the usual causes — an unverified domain, a
         recipient the sandbox will not deliver to — are both fixable once named. */
      const body = await response.text().catch(() => '');
      return {
        sent: false,
        configured: true,
        reason: `Resend refused it (${response.status}). ${body.slice(0, 300)}`,
      };
    }

    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: body.id ?? 'unknown' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      sent: false,
      configured: true,
      reason: message.includes('timeout')
        ? 'Resend did not respond within ten seconds.'
        : `Could not reach Resend: ${message}`,
    };
  }
}
