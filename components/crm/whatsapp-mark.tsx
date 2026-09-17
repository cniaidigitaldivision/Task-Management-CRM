/* ============================================================================
 * WHATSAPP'S OWN MARK AND GREEN
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-13: *"please use the WhatsApp green icon for the WhatsApp chat.
 * Right now you are using a chat icon that's not understandable as a WhatsApp
 * chat."* A generic speech bubble is not a WhatsApp button — the whole value of
 * a brand mark is being recognised without being read.
 *
 * ⚠️ #25D366 IS HARD-CODED, AND IT IS THE ONE COLOUR ON THESE SCREENS THAT IS.
 * Everything else comes from `tokens.css`, and that rule holds. This is a BRAND
 * mark: a themed approximation of it is just a green circle, and it would drift
 * the first time the palette moved.
 *
 * ⚠️ AND IT IS A FILL, NEVER INK. White on #25D366 measures about 2.1:1 against
 * a 4.5 floor — so anything written ON the green carries dark ink, which is what
 * WhatsApp itself does on its outgoing bubbles.
 *
 * Inline rather than fetched: the artifact CSP admits no icon host, and a mark
 * that silently fails to load is worse than one that is a few lines of path.
 * ========================================================================= */

export const WA_GREEN = '#25D366';
/** Safe ink for anything drawn on top of WA_GREEN. */
export const WA_BUBBLE_INK = '#0b271a';

/* ⚠️ THE OTHER TWO CHANNEL COLOURS, HARD-CODED FOR THE SAME REASON.
   Owner, 2026-09-17: *"make sure the email icon is blue… I want the exact
   same colours."* A channel mark is recognised before it is read, and the
   brand teal on an envelope reads as ours rather than as email. Orange is
   the paused state on the follow-up strip — a warning tint, not a token,
   because it must stay orange whatever the palette does. */
export const MAIL_BLUE = '#2563EB';
export const PAUSED_ORANGE = '#F59E0B';

export function WhatsAppMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.21 8.21 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.24-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43l-.48-.01c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.02 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}
