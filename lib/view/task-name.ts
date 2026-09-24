/* ============================================================================
 * THE TASK'S NAME, WHERE THE LOG WROTE ITS CODE
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-24: *"Instead of showing the exact task name, you are showing
 * the task code B1Z118. I don't understand what these codes are. I don't know
 * which task you are talking about ... Even everywhere you are considering the
 * task, use that exactly."*
 *
 * `activity_log.summary` is written when the event happens and embeds the
 * REFERENCE — "moved CLI-1621 to Done" — because the writer has no idea what
 * will be on screen when somebody reads it back. Any screen that knows the
 * title can put it in.
 *
 * ⚠️ A PURE MODULE, NOT A HELPER INSIDE THE PANEL. The panel that needed it
 * imports a server action, so a test importing the panel would pull
 * `server-only` into the test runner. The rule is testable; the component that
 * uses it is not the place to keep it (same reasoning as lib/view/raised-by.ts).
 * ========================================================================= */

/**
 * Swap a task's reference for its name inside a log summary.
 *
 * ⚠️ A PLAIN SPLIT, NOT A REGEX. A reference is data, and a pattern built from
 * data misfires on whatever character happens to mean something to the engine —
 * `.` matching any character is the cheap example. Splitting on the literal
 * string cannot.
 */
export function namedSummary(summary: string, reference: string, title: string): string {
  if (!reference || !title || !summary.includes(reference)) return summary;
  return summary.split(reference).join(title);
}
