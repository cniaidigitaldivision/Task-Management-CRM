/* ============================================================================
 * THE TERMINAL'S VOCABULARY — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * ⚠️ IN `lib/domain/` AND NOT WITH THE QUERY, for the reason
 * `lib/domain/library.ts` records at length: query modules start with
 * `import 'server-only'`, whose entry point throws if it is ever pulled into a
 * client bundle. The admin screens are client components and need these labels
 * to render, so anything they render lives here. A `import type` would be erased
 * and be fine; these are VALUES, so they are not.
 *
 * ⚠️ MIRRORS THE ENUMS IN MIGRATION 078. Adding a value here without adding it
 * there gives a screen an option the database refuses.
 * ========================================================================= */

/* ── How a time was recorded ───────────────────────────────────────────────
   `public.attendance_source` */
export const ATTENDANCE_SOURCES = ['self', 'device'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const SOURCE_META: Readonly<
  Record<AttendanceSource, { label: string; short: string; token: string }>
> = {
  self: { label: 'In Taskly', short: 'App', token: 'status-todo' },
  device: { label: 'At the terminal', short: 'Wall', token: 'status-done' },
};

/* ── How the terminal recognised somebody ─────────────────────────────────
   `public.scan_method`. Owner: *"I should know that he has checked in with face
   recognition or with a face."* */
export const SCAN_METHODS = [
  'face',
  'fingerprint',
  'card',
  'pin',
  'combination',
  'other',
] as const;
export type ScanMethod = (typeof SCAN_METHODS)[number];

export const METHOD_LABEL: Readonly<Record<ScanMethod, string>> = {
  face: 'Face',
  fingerprint: 'Fingerprint',
  card: 'Card',
  pin: 'PIN',
  combination: 'Two checks',
  /* ⚠️ "Not recorded", NOT "Other". The terminal did recognise them somehow; we
     could not tell which way from what it sent. Saying "Other" implies a fifth
     method exists, which would send somebody looking for it. */
  other: 'Not recorded',
};

/* ── Who may use which door ───────────────────────────────────────────────
   `public.attendance_mode`. Admin-only to change — the owner's instruction. */
export const ATTENDANCE_MODES = ['either', 'terminal_only'] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export const MODE_META: Readonly<
  Record<AttendanceMode, { label: string; description: string; token: string }>
> = {
  either: {
    label: 'Terminal or Taskly',
    description:
      'They can scan at a terminal or press the button in Taskly. Right for anybody working remotely, and for everybody before a terminal is live.',
    token: 'status-todo',
  },
  terminal_only: {
    label: 'Terminal only',
    description:
      'The button is refused — they record attendance by scanning at the reader. Right for anybody who works from an office.',
    token: 'status-done',
  },
};

/* ── What a scan did ──────────────────────────────────────────────────────
   `public.scan_outcome` */
export const SCAN_OUTCOMES = [
  'opened_day',
  'closed_day',
  'ignored',
  'unmatched',
  'duplicate',
  'out_of_range',
  'locked',
] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

/**
 * ⚠️ `needsAttention` IS WHAT DRIVES THE ADMIN QUEUE, and only two outcomes have
 * it. `duplicate` and `ignored` are the system working correctly — a resend was
 * caught, or somebody scanned twice on the way past — and putting those in front
 * of an Admin trains them to ignore the list that also carries the real problems.
 */
export const OUTCOME_META: Readonly<
  Record<ScanOutcome, { label: string; explains: string; token: string; needsAttention: boolean }>
> = {
  opened_day: {
    label: 'Arrived',
    explains: 'This scan became their arrival time.',
    token: 'status-done',
    needsAttention: false,
  },
  closed_day: {
    label: 'Left',
    explains: 'This scan moved their leaving time.',
    token: 'status-todo',
    needsAttention: false,
  },
  ignored: {
    label: 'No change',
    explains: 'A scan between arriving and leaving. Nothing to change.',
    token: 'status-backlog',
    needsAttention: false,
  },
  unmatched: {
    label: 'Nobody matched',
    explains:
      'The terminal recognised somebody, but no Taskly account carries that employee number. Map them and this scan can be applied.',
    token: 'feedback-warning',
    needsAttention: true,
  },
  duplicate: {
    label: 'Already had it',
    explains: 'The terminal sent this scan more than once. The repeat was ignored.',
    token: 'status-cancelled',
    needsAttention: false,
  },
  out_of_range: {
    label: 'Bad date',
    explains:
      'Dated more than a day ahead or a week behind. That is a terminal whose clock is wrong, not somebody who arrived.',
    token: 'feedback-error',
    needsAttention: true,
  },
  locked: {
    label: 'Day was corrected',
    explains:
      'An Admin had already corrected this day by hand, so the scan was recorded but not applied.',
    token: 'status-review',
    needsAttention: false,
  },
};

/** A mode if the string is one, null otherwise. A posted field is a claim. */
export function toAttendanceMode(value: string): AttendanceMode | null {
  return (ATTENDANCE_MODES as readonly string[]).includes(value)
    ? (value as AttendanceMode)
    : null;
}

/* ── The employee number ──────────────────────────────────────────────────── */

/**
 * Whether a number is usable as a terminal enrolment id.
 *
 * ⚠️ NARROW ON PURPOSE. This value is compared against whatever the terminal
 * sends, and Hikvision transmits it as a bare string in JSON. Letting somebody
 * type spaces or punctuation into Taskly produces a mapping that looks right on
 * screen and never matches a scan — a failure that shows up as "the terminal is
 * not working" rather than as a typo.
 */
export function checkEmployeeNo(value: string): { ok: true } | { ok: false; message: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, message: 'Enter the number this person has on the terminal.' };
  if (trimmed.length > 32) {
    return { ok: false, message: 'That is too long for a terminal employee number.' };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return {
      ok: false,
      message:
        'A terminal employee number can hold letters, digits, dashes and underscores only — no spaces.',
    };
  }
  return { ok: true };
}
