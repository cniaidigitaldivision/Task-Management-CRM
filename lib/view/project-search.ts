/* ============================================================================
 * SEARCHING THE PROJECT LIST — owner, 2026-09-08
 * ----------------------------------------------------------------------------
 *   *"the projects are increasing day by day so it's very difficult to search
 *   for some specific project. I want to add a search bar where I can write a
 *   character so relevant projects will be… displayed."*
 *
 * LAYER 2-ish: pure, no framework. Lives in lib/view because it is about how a
 * list is presented rather than about what a project IS — the same reason
 * project-finance.ts is here.
 *
 * ── ⚠️ EVERY WORD MUST MATCH, AND ORDER DOES NOT ────────────────────────────
 * "royal chitral" finds Chitral Royal Homes. Matching the query as one string
 * would not, and somebody who half-remembers a name types the memorable word
 * first — which is exactly the person this box exists for. Each word is an AND,
 * so a second word narrows rather than widens; typing more should never return
 * more.
 *
 * ── ⚠️ AND IT DOES NOT SEARCH THE DESCRIPTION ───────────────────────────────
 * Tempting, and wrong. A description is a paragraph of prose, so almost any
 * short query matches almost every project — which reads as the search being
 * broken rather than as the search being thorough. The fields here are the ones
 * somebody would actually type: what the project is called, its code (which is
 * what they see on a task reference), the client, and who owns it, because
 * "whose was that one" is a real way to look for something.
 * ========================================================================= */

/** The parts of a project this search can see. */
export interface SearchableProject {
  readonly name: string;
  readonly code: string;
  readonly clientName?: string | null;
  readonly ownerName?: string | null;
}

/**
 * The query, split into the words that all have to match.
 *
 * Exported so the caller can compute it once per render rather than once per
 * project — on a list of two hundred that is two hundred string splits per
 * keystroke, which is the kind of waste that makes typing feel heavy.
 */
export function searchTerms(query: string): readonly string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Whether one project matches.
 *
 * ⚠️ An empty query matches everything. The alternative — an empty query
 * matching nothing — would blank the page the instant somebody cleared the box.
 */
export function matchesSearch(project: SearchableProject, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;

  const haystack = [project.name, project.code, project.clientName, project.ownerName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}
