import type { Metadata } from 'next';

import { KnowledgeScreen } from '@/components/crm/knowledge-screen';
import { requireCrmAccess } from '@/lib/auth/current-user';
import { knowledgeBoard } from '@/lib/db/queries/crm-knowledge';
import { listCrmProjects } from '@/lib/db/queries/crm-leads';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'AI Knowledge' };

/* ============================================================================
 * WHAT THE AGENT KNOWS — the approval screen
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-20: *"give me some chatbot or something like that where I can
 * guide, instruct, or give knowledge to my AI agent."*
 *
 * This is that, as a list somebody can finish rather than a conversation they
 * have to remember: read a document, decide on each drafted answer, and fill the
 * gaps the document could not answer.
 *
 * ── ⚠️ ONE WAVE, AND THE BOARD IS DRAWN FROM IT ────────────────────────────
 * Rule Zero law 4: the project list and the chosen project's board have no
 * dependency between them, so they leave together. Switching project is then a
 * client-side change against rows already held — no server render to change a
 * tab.
 * ========================================================================= */

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { user } = await requireCrmAccess();
  const params = await searchParams;

  const projects = await listCrmProjects(user.id);
  /* ⚠️ THE ID IS ALREADY IN THE URL, so the board does not wait for the list to
     know which project to read — except on a first visit, where there is no
     parameter and the first project is the answer. */
  const wanted = params.project && projects.some((p) => p.id === params.project)
    ? params.project
    : projects[0]?.id;

  const board = wanted ? await knowledgeBoard(user.id, wanted) : null;

  return (
    <KnowledgeScreen
      projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      board={board}
      /* The server's clock — "expired" is decided here, and a laptop a day out
         would otherwise disagree with the render. */
      nowMs={nowMs()}
    />
  );
}
