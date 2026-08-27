'use client';

import {
  FileArchive,
  FileAudio,
  FileImage,
  Presentation,
  FileSpreadsheet,
  FileText,
  FileVideo,
  File as FileIcon,
  type LucideIcon,
} from 'lucide-react';

import { fileKind, type FileKind } from '@/lib/domain/file-kind';

/* ============================================================================
 * THE GLYPH FOR A FILE
 * ----------------------------------------------------------------------------
 * A page of identical document icons tells the eye nothing; a video, a sheet and
 * a PDF are found by shape before they are found by name.
 *
 * ── ⚠️ WHY THIS IS A COMPONENT AND `fileKind` IS NOT ─────────────────────────
 * The classification is pure logic and belongs in `lib/domain/file-kind.ts`,
 * where the filter chips and the tests can reach it. Importing lucide-react there
 * would drag an icon library into the domain layer, which is how a pure module
 * stops being testable in isolation. So the KIND is decided there and the PICTURE
 * is chosen here.
 *
 * ⚠️ It also replaces a private `iconFor` that lived in project-files-tab.tsx and
 * knew about four of the seven kinds — a deck and a video got the same icon as a
 * contract there, which is the whole thing an icon is meant to prevent.
 * ========================================================================= */

const ICON: Record<FileKind, LucideIcon> = {
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  other: FileIcon,
};

/**
 * The icon component for a file, for the caller to place itself.
 *
 * ── ⚠️ WHY THERE IS NO `<FileGlyph mimeType name />` WRAPPER ─────────────────
 * There was, and `react-hooks/static-components` refused it: a component built by
 * calling a function in a render body looks, to the rule, like a component
 * DEFINED during render — which really would reset its state on every render. The
 * rule cannot tell that this only indexes a frozen map.
 *
 * Assigning the result inside a list callback — `const Icon = iconForFile(…)`
 * inside `documents.map(…)` — is the pattern the rule accepts and the one the
 * codebase already used. So the lookup is shared and the placement stays at the
 * call site, which also lets each list pick its own size and colour.
 */
export function iconForFile(mimeType: string | null, name: string): LucideIcon {
  return ICON[fileKind(mimeType, name)];
}

/* ============================================================================
 * THE COLOUR OF A FILE TYPE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-24, with a mockup of the Files table: coloured tiles per file
 * type and a matching type pill beside each name.
 *
 * ── ⚠️ EIGHT COLOURS, WHICH I ARGUED AGAINST ELSEWHERE AND IS RIGHT HERE ─────
 * `credential-icon.tsx` says inventing eight colours for eight families is how a
 * list turns into a fruit salad, and that stands — there the colour would have
 * been decoration, because a credential's FAMILY is not what you scan for.
 *
 * Here it is the opposite: the mockup's whole table is organised by file type,
 * there is a filter row along the top for it, and these are the colours people
 * already expect from every file manager they have used — PDF red, Excel green,
 * PowerPoint orange, Word blue. Matching that convention is recognition, not
 * decoration.
 *
 * ⚠️ ONE MAP, TWO RENDERERS. The tile behind the glyph and the pill beside the
 * name read from this, so a PDF cannot be red in one and orange in the other.
 * ========================================================================= */

export interface KindTint {
  /** The saturated brand-ish colour: the glyph, and the pill's text. */
  readonly ink: string;
  /** The wash behind them. Kept pale so a table of twenty rows stays readable. */
  readonly wash: string;
}

const TINT: Readonly<Record<FileKind, KindTint>> = {
  /* Adobe red, and the convention for PDFs everywhere. */
  document: { ink: '#c8322b', wash: '#fdeceb' },
  /* Excel green. */
  spreadsheet: { ink: '#1d7145', wash: '#e8f5ee' },
  /* PowerPoint orange. */
  presentation: { ink: '#c1521d', wash: '#fdefe6' },
  /* No convention for images; violet reads as "media" and clashes with none of
     the four above. */
  image: { ink: '#6d47c7', wash: '#f0ecfb' },
  video: { ink: '#1f6fb2', wash: '#e9f2fa' },
  audio: { ink: '#a83a75', wash: '#fbecf4' },
  archive: { ink: '#8a6410', wash: '#fbf3e0' },
  /* Deliberately grey. "Other" is the absence of a type, and giving it a colour
     of its own would make an unknown file look like a category. */
  other: { ink: '#5b6b6e', wash: '#eef1f2' },
};

/** The tint for a file. Same lookup the icon uses, so they cannot disagree. */
export function tintForFile(mimeType: string | null, name: string): KindTint {
  return TINT[fileKind(mimeType, name)];
}
