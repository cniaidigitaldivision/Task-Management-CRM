/* ============================================================================
 * THE NAME A CLIENT IS ALLOWED TO SEE
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-19, about a letter that went out headed
 * `Demo — Product Enquiries [demo]`:
 *
 *   *"It should have a proper project name, a proper header, and a proper
 *   footer, like a professional email. It is just like you are putting random
 *   things over there."*
 *
 * They are right, and the name was never missing — it was in the wrong column.
 * `crm_project_settings.whatsapp_display_name` is what a client already sees on
 * WhatsApp ("CNI AI & Digital Division"); the email took `projects.name`, which
 * is what WE call the project in our own lists.
 *
 * ── ⚠️ ONE NAME ON EVERY CHANNEL ───────────────────────────────────────────
 * A business whose WhatsApp says one thing and whose email says another looks
 * like two companies to the person reading both. `app.crm_project_sender`
 * already resolves display name → project name, so email asks the same function
 * WhatsApp does rather than inventing a second answer.
 *
 * ── ⚠️ AND AN INTERNAL TAG NEVER REACHES A CLIENT ──────────────────────────
 * `[demo]` is how this database marks a project as ours to play with. It went
 * out in the From line, the subject, the letterhead and twice in the footer of a
 * real email to a real person.
 * ========================================================================= */

/**
 * A project or business name with our own markers taken off.
 *
 * Only square-bracketed tags go — `[demo]`, `[test]`, `[internal]`. Everything
 * else is the owner's own wording and is left exactly as they typed it: a name
 * this function "tidied" would differ from the one on their WhatsApp, which is
 * the disagreement it exists to prevent.
 */
export function clientFacingName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    /* A separator left hanging by the tag it followed - "Homes - [demo]" - at
       either end. Stripped after the spaces are collapsed, so " . " goes too. */
    .replace(/^[\s·|–—-]+/, '')
    .replace(/[\s·|–—-]+$/, '')
    .trim();
  return clean === '' ? null : clean;
}

/**
 * What goes under the business name on the letterhead.
 *
 * ⚠️ THE PROJECT, NOT THE CLIENT'S CITY. The shell printed the lead's own city
 * there — "RAWALPINDI" over a letter TO somebody in Rawalpindi, which tells the
 * reader nothing they did not know about themselves. The project is the thing
 * they enquired about, and it is what the owner asked for.
 *
 * ⚠️ AND NOTHING WHEN IT WOULD REPEAT THE NAME ABOVE IT. For most projects the
 * project IS the business — "Chitral Royal Homes" twice in two type sizes reads
 * as a template that could not find its second value.
 */
export function letterSubtitle(
  businessName: string | null | undefined,
  projectName: string | null | undefined,
): string | null {
  const business = clientFacingName(businessName);
  const project = clientFacingName(projectName);
  if (!project) return null;
  if (!business) return project;
  return project.toLowerCase() === business.toLowerCase() ? null : project;
}
