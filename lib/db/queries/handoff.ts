import 'server-only';

import { withUser } from '@/lib/db/client';
import type { Priority, ProjectType } from '@/lib/domain/constants';
import type { HandoffChain, HandoffNode } from '@/lib/domain/handoff';

/* ============================================================================
 * HANDOFF CHAINS — reads and writes. doc 12 E-004, owner rule R4a.
 * ----------------------------------------------------------------------------
 * Every function goes through `withUser`, so row-level security decides what a
 * caller sees and writes. The policies from migration 026 are the coarse half —
 * readable by anyone signed in, writable by Admin and above — and the server
 * actions re-check with `can()` for the second layer doc 16 §7 requires.
 * ========================================================================= */

export interface ChainSummary {
  readonly id: string;
  readonly name: string;
  readonly projectType: ProjectType;
  readonly isActive: boolean;
  readonly stepCount: number;
  readonly updatedAt: string;
}

interface NodeRow {
  readonly id: string;
  readonly position: number;
  readonly skill_id: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly effort_points: string | number | null;
  readonly priority: Priority;
  readonly due_offset_days: number | null;
}

/* `numeric` comes back from postgres.js as a STRING, deliberately — it is
   arbitrary precision and Number() would silently lose it above 2^53. Effort
   points are small, so converting is safe, but it has to be done ON PURPOSE
   rather than by an implicit coercion somewhere further up. */
const toNumber = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

function toNode(row: NodeRow): HandoffNode {
  return {
    id: row.id,
    position: row.position,
    skillId: row.skill_id,
    title: row.title,
    description: row.description,
    effortPoints: toNumber(row.effort_points),
    priority: row.priority,
    dueOffsetDays: row.due_offset_days,
  };
}

/**
 * The one active chain for a project type, with its steps in order.
 *
 * Returns null when nothing is configured, which is the normal state for a
 * division that has not set any up — not an error, and the caller treats it as
 * "no handoff" rather than as a failure.
 */
export async function activeChainForType(
  actorId: string,
  projectType: ProjectType,
): Promise<HandoffChain | null> {
  return withUser(actorId, async (tx) => {
    const chains = await tx`
      select id, name, project_type, is_active
        from public.handoff_chains
       where project_type = ${projectType} and is_active
       limit 1
    `;
    const chain = chains[0];
    if (!chain) return null;

    const nodes = await tx`
      select id, position, skill_id, title, description,
             effort_points, priority, due_offset_days
        from public.handoff_nodes
       where chain_id = ${chain.id as string}
       order by position asc
    `;

    return {
      id: chain.id as string,
      name: chain.name as string,
      projectType: chain.project_type as ProjectType,
      isActive: chain.is_active as boolean,
      nodes: (nodes as unknown as NodeRow[]).map(toNode),
    };
  });
}

/** Every chain, for the editor's list. Retired ones included — they are history. */
export async function listChains(actorId: string): Promise<readonly ChainSummary[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select c.id, c.name, c.project_type, c.is_active, c.updated_at,
           /* The trigger is not a step somebody performs, so it is not counted
              as one. A chain reading "3 steps" that runs three handoffs is what
              a person expects; "4" would need explaining every time. */
           (select count(*) from public.handoff_nodes n
             where n.chain_id = c.id and n.position > 0) as step_count
      from public.handoff_chains c
     order by c.is_active desc, c.project_type asc, c.name asc
  `);

  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    projectType: row.project_type as ProjectType,
    isActive: row.is_active as boolean,
    stepCount: Number(row.step_count),
    updatedAt: String(row.updated_at),
  }));
}

/** One chain with its steps, for the canvas. */
export async function getChain(actorId: string, chainId: string): Promise<HandoffChain | null> {
  return withUser(actorId, async (tx) => {
    const chains = await tx`
      select id, name, project_type, is_active
        from public.handoff_chains where id = ${chainId}
    `;
    const chain = chains[0];
    if (!chain) return null;

    const nodes = await tx`
      select id, position, skill_id, title, description,
             effort_points, priority, due_offset_days
        from public.handoff_nodes
       where chain_id = ${chainId}
       order by position asc
    `;

    return {
      id: chain.id as string,
      name: chain.name as string,
      projectType: chain.project_type as ProjectType,
      isActive: chain.is_active as boolean,
      nodes: (nodes as unknown as NodeRow[]).map(toNode),
    };
  });
}

export interface NodeInput {
  readonly position: number;
  readonly skillId: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly effortPoints: number | null;
  readonly priority: Priority;
  readonly dueOffsetDays: number | null;
}

/**
 * Replace a chain's steps wholesale.
 *
 * ── WHY DELETE-AND-REINSERT AND NOT A DIFF ───────────────────────────────────
 * `handoff_nodes_chain_position_key` makes positions unique per chain, so
 * reordering two steps by updating them in place collides the moment the first
 * update lands on a position the second still holds. A diff would have to route
 * around its own constraint with temporary positions — more code, and a window
 * where the chain is briefly nonsense.
 *
 * The cost is that node IDs change, and `tasks.handoff_node_id` points at them.
 * That is exactly why migration 026 declares it `on delete set null`: a task
 * created by an old step keeps existing as an ordinary task, and the chain
 * simply stops advancing it — which `decideHandoff` reports as "the step that
 * created this task no longer exists" rather than guessing a position.
 *
 * One transaction, so a failure leaves the chain as it was rather than empty.
 */
export async function replaceNodes(
  actorId: string,
  chainId: string,
  nodes: readonly NodeInput[],
): Promise<void> {
  await withUser(actorId, async (tx) => {
    await tx`delete from public.handoff_nodes where chain_id = ${chainId}`;

    for (const node of nodes) {
      await tx`
        insert into public.handoff_nodes
          (chain_id, position, skill_id, title, description,
           effort_points, priority, due_offset_days)
        values (
          ${chainId}, ${node.position}, ${node.skillId},
          ${node.title}, ${node.description},
          ${node.effortPoints}, ${node.priority}, ${node.dueOffsetDays}
        )
      `;
    }

    await tx`
      update public.handoff_chains
         set updated_by_id = ${actorId}
       where id = ${chainId}
    `;
  });
}

export async function createChain(
  actorId: string,
  input: { name: string; projectType: ProjectType },
): Promise<string> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.handoff_chains (name, project_type, created_by_id, is_active)
    /* Created switched OFF. A chain with no steps that is live would match a
       completed task and do nothing, and "why did nothing happen" is a worse
       first experience than having to turn it on deliberately. */
    values (${input.name}, ${input.projectType}, ${actorId}, false)
    returning id
  `);
  return rows[0].id as string;
}

export async function renameChain(actorId: string, chainId: string, name: string): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.handoff_chains
       set name = ${name}, updated_by_id = ${actorId}
     where id = ${chainId}
  `);
}

/**
 * Switch a chain on or off.
 *
 * Turning one ON can violate `handoff_chains_one_active_per_type`, and that is
 * the point — the caller catches the unique violation and says "another chain
 * is already live for this project type" rather than this function silently
 * retiring the other one. Deciding which of two chains a person meant to keep is
 * not a decision code should make on their behalf.
 */
export async function setChainActive(
  actorId: string,
  chainId: string,
  isActive: boolean,
): Promise<void> {
  await withUser(actorId, (tx) => tx`
    update public.handoff_chains
       set is_active = ${isActive}, updated_by_id = ${actorId}
     where id = ${chainId}
  `);
}

export async function deleteChain(actorId: string, chainId: string): Promise<void> {
  /* Nodes cascade. Tasks created by them do NOT — `on delete set null` keeps the
     work and drops only the pointer. */
  await withUser(actorId, (tx) => tx`
    delete from public.handoff_chains where id = ${chainId}
  `);
}
