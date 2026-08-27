'use client';

import { CircleSlash, Cloud, HardDrive } from 'lucide-react';

import { STORAGE_META, storageHome } from '@/lib/domain/document-storage';

/* ============================================================================
 * WHICH STORE HOLDS THIS FILE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24: *"How can I see which files are in Google Drive and which
 * files are in the Supabase bucket?"* This is the answer, per row.
 *
 * ── ⚠️ ONE COMPONENT BECAUSE THERE ARE TWO SCREENS ───────────────────────────
 * The Documents register and a project's Files tab list the same rows, and the
 * first version of this change put a copy of this badge in each. That is the exact
 * shape of the bug it was written to fix: the register's state badge said "In
 * Drive" for files in the bucket for weeks, because the sentence lived next to the
 * screen instead of next to the fact. Two badges would eventually disagree about
 * the same row, and the one that goes stale is always the copy nobody is looking
 * at.
 *
 * The words and the colours are in `lib/domain/document-storage.ts` — this file is
 * only how they are drawn.
 *
 * ── WHY THE TOOLTIP CARRIES THE REAL EXPLANATION ─────────────────────────────
 * The badge is for scanning a list; two words is all it may spend. `title` is for
 * the one row somebody stops at, and it is where "held here, not in Drive, served
 * by a link that expires" belongs — that sentence under every filename would bury
 * the filenames.
 * ========================================================================= */

/** The glyph per store. Distinguishable at 12px, which rules out anything
 *  detailed: a cloud is elsewhere, a disc is here, a struck-through circle is
 *  gone. */
const ICON = { bucket: HardDrive, drive: Cloud, both: Cloud, none: CircleSlash } as const;

export function StorageBadge({
  document: doc,
  /** `sm` for a dense list (the project Files tab, beside two other badges),
   *  `md` for the register, where the row has more room. Only the horizontal
   *  padding changes — the text size is the same, because a badge that shrinks
   *  its type in one place and not the other reads as a different component. */
  size = 'md',
}: {
  document: { readonly storagePath: string | null; readonly driveFileId: string | null };
  size?: 'sm' | 'md';
}) {
  const home = storageHome(doc);
  const meta = STORAGE_META[home];
  const Icon = ICON[home];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border py-0.5 text-micro font-semibold ${
        size === 'sm' ? 'px-1.5' : 'px-2'
      }`}
      title={meta.hint}
      style={{
        borderColor: `color-mix(in oklab, var(--${meta.token}) 40%, transparent)`,
        backgroundColor: `color-mix(in oklab, var(--${meta.token}) 10%, transparent)`,
        color: `var(--${meta.token})`,
      }}
    >
      <Icon className="size-3" strokeWidth={2.25} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
