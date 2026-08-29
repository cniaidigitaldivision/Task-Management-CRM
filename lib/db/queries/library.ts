import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * THE DOCUMENT LIBRARY — migration 035
 * ----------------------------------------------------------------------------
 * The agency's own reference material: rate cards, booklets, decks, design
 * sources. Read by everybody signed in, written by Admin+.
 *
 * Distinct from `lib/db/queries/documents.ts`, which is the client-upload
 * approval queue. See migration 035's header for why they are not one table.
 * ========================================================================= */

/* The categories live in lib/domain/library.ts, not here: this module is
   `server-only` and the library panel is a client component that needs them to
   render its filter chips. See that file's header. */
import type { LibraryCategory } from '@/lib/domain/library';

export interface LibraryDocumentRow {
  readonly id: string;
  readonly title: string;
  readonly category: LibraryCategory;
  readonly mimeType: string;
  readonly sizeBytes: number | null;
  readonly pageCount: number | null;
  readonly summary: string | null;
  /** False where no browser can render it — the screen offers a download. */
  readonly isViewable: boolean;
  readonly uploadedByName: string | null;
  readonly createdAt: string | null;
}

export async function listLibraryDocuments(
  actorId: string,
): Promise<LibraryDocumentRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select d.id, d.title, d.category, d.mime_type, d.size_bytes, d.page_count,
           d.summary, d.is_viewable, d.created_at,
           u.full_name as uploaded_by_name
      from public.library_documents d
      left join public.users u on u.id = d.uploaded_by_id
     order by d.category, d.title
  `);

  return rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    category: r.category as LibraryCategory,
    mimeType: r.mime_type as string,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
    pageCount: r.page_count === null ? null : Number(r.page_count),
    summary: (r.summary as string | null) ?? null,
    isViewable: Boolean(r.is_viewable),
    uploadedByName: (r.uploaded_by_name as string | null) ?? null,
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : (r.created_at as string | null),
  }));
}

/** The stored path, for the streaming route. Kept separate from the list so a
 *  screen never receives storage paths it has no use for. */
export async function libraryDocumentPath(
  actorId: string,
  id: string,
): Promise<{ path: string; mimeType: string; title: string } | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select storage_path, mime_type, title
      from public.library_documents where id = ${id}
  `);
  const row = rows[0];
  return row
    ? {
        path: row.storage_path as string,
        mimeType: row.mime_type as string,
        title: row.title as string,
      }
    : null;
}

/* ==========================================================================
 * WRITING — owner request 2026-08-29
 * ========================================================================== */

export interface NewLibraryDocument {
  readonly title: string;
  readonly category: LibraryCategory;
  readonly storagePath: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly summary: string | null;
  readonly pageCount: number | null;
  readonly isViewable: boolean;
}

/**
 * Record one document that is already in the bucket.
 *
 * ⚠️ THE ORDER IS BYTES FIRST, ROW SECOND, and the caller undoes the bytes if
 * this throws. The other order — row first — would leave the library listing a
 * document that cannot be opened, which is worse than an orphaned object nobody
 * can see: the panel would offer a working-looking link to a 502.
 *
 * ⚠️ NO PERMISSION CHECK HERE, DELIBERATELY. `library_documents_write` is
 * Admin+ (migration 035) and this runs through `withUser`, so a Coordinator's
 * insert is refused by the database whatever the caller believed. The action
 * checks `library.manage` as well — two layers, per doc 16 §7 — and this is the
 * one that cannot be forgotten.
 */
export async function createLibraryDocument(
  actorId: string,
  input: NewLibraryDocument,
): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.library_documents (
      title, category, storage_path, mime_type, size_bytes,
      summary, page_count, is_viewable, uploaded_by_id
    ) values (
      ${input.title},
      ${input.category}::public.library_category,
      ${input.storagePath},
      ${input.mimeType},
      ${input.sizeBytes},
      ${input.summary},
      ${input.pageCount},
      ${input.isViewable},
      ${actorId}
    )
    returning id
  `);

  const id = rows[0]?.id as string | undefined;
  /* RLS refuses by returning no rows rather than by raising, so a silent zero-row
     insert is exactly what a Member's attempt looks like. Throwing here is what
     turns that into the caller's rollback instead of a "saved" message about a
     row that does not exist. */
  if (!id) throw new Error('The library row was not written.');
  return id;
}
