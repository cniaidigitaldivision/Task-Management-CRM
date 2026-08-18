/* ============================================================================
 * FOLDER ACCESS LEVELS — owner request 2026-08-16
 * ----------------------------------------------------------------------------
 * Owner, correcting the boolean this replaced:
 *
 *   *"It will give access like: it can read only files, it can view, it can add
 *   it, it can upload, it can delete. These options of access should be provided
 *   at the time of giving access… the access level is defined at the time of
 *   giving, right?"*
 *
 * ── ⚠️ WHY THIS IS IN `lib/domain/` AND NOT WITH THE QUERIES ─────────────────
 * `lib/db/queries/drive-folders.ts` is `server-only`. The folder panel is a client
 * component and has to render the same four levels in the same order, so the
 * vocabulary lives here where both sides can import it. Putting it in the query
 * module and re-exporting would drag `server-only` into the client bundle.
 *
 * ── ⚠️ THE ORDER IS LOAD-BEARING, IN TWO PLACES AT ONCE ──────────────────────
 * `public.folder_access` (migration 028) is a Postgres enum, and Postgres orders
 * an enum by declaration. Every policy there compares with `>=`. This array is the
 * same list in the same order, and `accessAtLeast` is that comparison on this
 * side. A new level goes on the END of both, or the two quietly disagree and the
 * screen starts promising access the database refuses.
 * ========================================================================= */

export const FOLDER_ACCESS = ['none', 'view', 'upload', 'manage'] as const;

export type FolderAccess = (typeof FOLDER_ACCESS)[number];

/** Whether `level` is at least `min`, matching Postgres's enum comparison. */
export function accessAtLeast(level: FolderAccess, min: FolderAccess): boolean {
  return FOLDER_ACCESS.indexOf(level) >= FOLDER_ACCESS.indexOf(min);
}

/** Whether an arbitrary string is one of the levels. Used on form input. */
export function isFolderAccess(value: string): value is FolderAccess {
  return (FOLDER_ACCESS as readonly string[]).includes(value);
}

/**
 * What each level is called on screen, and the colour that carries it.
 *
 * ⚠️ The labels say the CONSEQUENCE, not the enum value. Nobody reading the word
 * "upload" would guess that it also skips the approval queue — and the person
 * reading these labels is the one about to grant it. The colours climb with the
 * risk rather than being decorative.
 */
export const ACCESS_META: Record<
  FolderAccess,
  { readonly label: string; readonly token: string }
> = {
  none: { label: 'Coordinators and above', token: 'text-tertiary' },
  view: { label: 'Members can view', token: 'feedback-info' },
  upload: { label: 'Members can upload (no approval)', token: 'feedback-success' },
  manage: { label: 'Members can upload and delete', token: 'feedback-warning' },
};

/** The same thing as a sentence, for the message after a change is saved. */
export const ACCESS_MEANS: Record<FolderAccess, string> = {
  none: 'is private again — Coordinators and above only. Members lose access to what is in it.',
  view: 'is readable by members. They can see what is in it and add nothing.',
  upload:
    'accepts uploads from members, and those go straight to Drive without waiting for approval.',
  manage:
    'is fully open to members: they can read it, upload into it without approval, and delete anything in it.',
};
