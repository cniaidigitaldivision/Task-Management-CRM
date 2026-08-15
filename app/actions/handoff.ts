'use server';

import { revalidatePath } from 'next/cache';

import { requireRole } from '@/lib/auth/current-user';
import * as H from '@/lib/db/queries/handoff';
import { PROJECT_TYPES, type Priority, type ProjectType } from '@/lib/domain/constants';
import { validateChain, type HandoffNode } from '@/lib/domain/handoff';

/* ============================================================================
 * HANDOFF CHAINS — the editor's server actions. doc 12 E-004, rule R4a.
 * ----------------------------------------------------------------------------
 * `requireRole('admin')` on every one, which is the SECOND layer rather than
 * the only one: migration 026's policies already refuse a Coordinator's write.
 * doc 16 §7 asks for two independent enforcement layers precisely so a mistake
 * in one is not a breach, and this is the one that produces a readable refusal
 * instead of a silent zero-row update.
 * ========================================================================= */

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly chainId?: string;
}

const fail = (error: string): ActionResult => ({ ok: false, error });

function refresh(): void {
  revalidatePath('/workflow');
}

export async function createChainAction(input: {
  name: string;
  projectType: string;
}): Promise<ActionResult> {
  const user = await requireRole('admin');

  const name = input.name.trim();
  if (name === '') return fail('Give the chain a name.');
  if (name.length > 120) return fail('That name is too long.');
  if (!PROJECT_TYPES.includes(input.projectType as ProjectType)) {
    return fail('That is not a project type.');
  }

  try {
    const chainId = await H.createChain(user.id, {
      name,
      projectType: input.projectType as ProjectType,
    });
    refresh();
    return { ok: true, chainId };
  } catch {
    return fail('That chain could not be created.');
  }
}

export async function renameChainAction(chainId: string, name: string): Promise<ActionResult> {
  const user = await requireRole('admin');
  const trimmed = name.trim();
  if (trimmed === '') return fail('Give the chain a name.');

  try {
    await H.renameChain(user.id, chainId, trimmed);
    refresh();
    return { ok: true };
  } catch {
    return fail('That chain could not be renamed.');
  }
}

/**
 * Switch a chain on or off.
 *
 * ── THE UNIQUE VIOLATION IS THE FEATURE, NOT A FAILURE ───────────────────────
 * `handoff_chains_one_active_per_type` refuses a second live chain on one
 * project type. Catching it here and SAYING so is the whole point: the
 * alternative would be this action quietly retiring the other chain, and
 * deciding which of two chains somebody meant to keep is not a decision code
 * should make on their behalf.
 */
export async function setChainActiveAction(
  chainId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const user = await requireRole('admin');

  if (isActive) {
    const chain = await H.getChain(user.id, chainId);
    if (!chain) return fail('That chain no longer exists.');

    const problems = validateChain(chain.nodes);
    if (problems.length > 0) {
      /* Refusing to switch on a half-built chain, rather than letting it go live
         and silently create nothing — or worse, a nameless task. */
      return fail(problems[0]);
    }
  }

  try {
    await H.setChainActive(user.id, chainId, isActive);
    refresh();
    return { ok: true };
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (code === '23505') {
      return fail(
        'Another chain is already live for that project type. Switch that one off first.',
      );
    }
    return fail('That chain could not be updated.');
  }
}

export async function deleteChainAction(chainId: string): Promise<ActionResult> {
  const user = await requireRole('admin');
  try {
    await H.deleteChain(user.id, chainId);
    refresh();
    return { ok: true };
  } catch {
    return fail('That chain could not be deleted.');
  }
}

export interface NodeDraft {
  readonly position: number;
  readonly skillId: string;
  readonly title: string;
  readonly description: string;
  readonly effortPoints: string;
  readonly priority: string;
  readonly dueOffsetDays: string;
}

/** Replace every step in one go — see `replaceNodes` for why it is wholesale. */
export async function saveNodesAction(
  chainId: string,
  drafts: readonly NodeDraft[],
): Promise<ActionResult> {
  const user = await requireRole('admin');

  const nodes: HandoffNode[] = drafts.map((draft, index) => ({
    id: `draft-${index}`,
    position: draft.position,
    skillId: draft.skillId,
    title: draft.position === 0 ? null : draft.title.trim(),
    description: draft.description.trim() === '' ? null : draft.description.trim(),
    effortPoints: draft.position === 0 ? null : Number(draft.effortPoints),
    priority: draft.priority as Priority,
    dueOffsetDays:
      draft.position === 0 || draft.dueOffsetDays.trim() === ''
        ? null
        : Number(draft.dueOffsetDays),
  }));

  if (nodes.some((n) => !n.skillId)) return fail('Every step needs a skill.');
  if (nodes.some((n) => n.effortPoints !== null && !Number.isFinite(n.effortPoints))) {
    return fail('Effort must be a number.');
  }
  if (nodes.some((n) => n.dueOffsetDays !== null && !Number.isFinite(n.dueOffsetDays))) {
    return fail('The due offset must be a whole number of days.');
  }

  /* The same validator the "switch on" path uses, so a chain cannot be saved into
     a shape that would then refuse to go live. */
  const problems = validateChain(nodes);
  if (problems.length > 0) return fail(problems[0]);

  try {
    await H.replaceNodes(
      user.id,
      chainId,
      nodes.map((n) => ({
        position: n.position,
        skillId: n.skillId,
        title: n.title,
        description: n.description,
        effortPoints: n.effortPoints,
        priority: n.priority,
        dueOffsetDays: n.dueOffsetDays,
      })),
    );
    refresh();
    return { ok: true };
  } catch {
    return fail('Those steps could not be saved.');
  }
}
