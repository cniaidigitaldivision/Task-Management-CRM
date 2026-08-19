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
