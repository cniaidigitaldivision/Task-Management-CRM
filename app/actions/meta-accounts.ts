'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { getProject } from '@/lib/db/queries/projects';
import { insertMetaAccount, linkedObjectIds } from '@/lib/db/queries/meta-studio';
import { can } from '@/lib/domain/permissions';
import { discoverPages, metaIsConfigured } from '@/lib/meta/client';
import { runMetaSync } from '@/lib/meta/sync';

/* ============================================================================
 * CONNECTING AND RESYNCING META ACCOUNTS — owner, 2026-09-04
 * ----------------------------------------------------------------------------
 * The Meta Accounts tab's Quick Actions. Owner: *"Quick action is also in a
 * small sleek design and should be added properly page-wise."*
 *
 * ── ⚠️ WHY "CONNECT ACCOUNT" IS A PICKER AND NOT AN OAUTH FLOW ─────────────
 * There is no consent screen to show. `META_SYSTEM_USER_TOKEN` is a SYSTEM_USER
 * token over the business's own asset portfolio, so the set of connectable
 * accounts is already knowable — `discoverPages()` asks Meta which Pages and
 * Instagram accounts this token can see. Connecting is therefore choosing one
 * from that list, not authorising anything.
 *
 * That is also its honest limit, and the dialog says so: a client's page must
 * first be shared INTO the business account on Meta's side. Until it is, it does
 * not appear in the list, and no button here can conjure it.
 * ========================================================================= */

export interface ConnectablePage {
  readonly objectId: string;
  readonly platform: 'facebook' | 'instagram';
  readonly name: string;
  readonly username: string | null;
  readonly followers: number | null;
  readonly mediaCount: number | null;
  readonly permalink: string;
  /** Already linked to some project — offered greyed rather than hidden. */
  readonly alreadyLinked: boolean;
}

export async function discoverMetaPagesAction(): Promise<{
  readonly ok: boolean;
  readonly error?: string;
  readonly pages?: readonly ConnectablePage[];
}> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return { ok: false, error: 'Only a Coordinator and above can connect an account.' };
  }

  if (!metaIsConfigured()) {
    return {
      ok: false,
      error: 'No Meta system-user token is configured, so there is nothing to list.',
    };
  }

  const linked = new Set(await linkedObjectIds(user.id));

  let discovered;
  try {
    discovered = await discoverPages();
  } catch (error) {
    /* ⚠️ Meta's own message, verbatim. A guessed cause ("check your token") sends
       somebody to the wrong place; the API says whether it is permissions, a
       revoked asset or a bad token, and that sentence is what solves it. */
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Meta did not answer.',
    };
  }

  const pages: ConnectablePage[] = [];

  for (const page of discovered) {
    pages.push({
      objectId: page.pageId,
      platform: 'facebook',
      name: page.name,
      username: null,
      followers: page.followers,
      mediaCount: null,
      permalink: `https://facebook.com/${page.pageId}`,
      alreadyLinked: linked.has(page.pageId),
    });

    /* ⚠️ THE INSTAGRAM ACCOUNT IS A SEPARATE ROW, not a property of the page.
       Meta nests it under the Page because that is how the association is
       stored, but its figures, its posts and its metric keys are all different —
       and 091 keys a row on ONE Meta object id. Flattening them into one row is
       how a follower count ends up describing the wrong platform. */
    if (page.instagram) {
      pages.push({
        objectId: page.instagram.igUserId,
        platform: 'instagram',
        name: page.instagram.name ?? page.instagram.username ?? page.name,
        username: page.instagram.username || null,
        followers: page.instagram.followers,
        mediaCount: page.instagram.mediaCount,
        permalink: page.instagram.username
          ? `https://instagram.com/${page.instagram.username}`
          : `https://instagram.com`,
        alreadyLinked: linked.has(page.instagram.igUserId),
      });
    }
  }

  return { ok: true, pages };
}

export async function linkMetaAccountAction(input: {
  readonly projectId: string;
  readonly objectId: string;
  readonly platform: 'facebook' | 'instagram';
  readonly name: string;
  readonly username: string | null;
  readonly followers: number | null;
  readonly mediaCount: number | null;
  readonly permalink: string;
}): Promise<{ readonly ok: boolean; readonly error?: string }> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return { ok: false, error: 'Only a Coordinator and above can connect an account.' };
  }

  if (input.platform !== 'facebook' && input.platform !== 'instagram') {
    return { ok: false, error: 'That is not a platform this system collects.' };
  }

  const project = await getProject(user.id, input.projectId);
  if (!project) return { ok: false, error: 'That project is no longer available.' };

  /* ⚠️ THE OBJECT ID IS RE-VERIFIED AGAINST META, not trusted from the form. It
     arrives from a client component, and an id that Meta does not serve to this
     token would be linked successfully and then fail on every sync forever —
     with the account row sitting on the page looking connected. */
  let discovered;
  try {
    discovered = await discoverPages();
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Meta did not answer.',
    };
  }

  const known = new Set<string>();
  for (const page of discovered) {
    known.add(page.pageId);
    if (page.instagram) known.add(page.instagram.igUserId);
  }
  if (!known.has(input.objectId)) {
    return {
      ok: false,
      error:
        'Meta does not serve that account to this token. Share the page into the business account first.',
    };
  }

  try {
    await insertMetaAccount(user.id, {
      projectId: input.projectId,
      platformSlug: input.platform,
      objectId: input.objectId,
      username: input.username,
      displayName: input.name,
      followers: input.followers,
      mediaCount: input.mediaCount,
      permalink: input.permalink,
    });
  } catch {
    /* 091's `meta_accounts_object_unique` — one Taskly row per real Meta object.
       Re-linking the same page to a second project is a mistake, not a feature. */
    return {
      ok: false,
      error: 'That account is already linked to a project. Unlink it there first.',
    };
  }

  revalidatePath('/studio');
  return { ok: true };
}

/**
 * Pull every linked account now.
 *
 * ⚠️ IT CALLS `runMetaSync` DIRECTLY RATHER THAN FETCHING `/api/meta-sync`.
 * That route exists for Vercel Cron and is guarded by `CRON_SECRET`; calling it
 * from here would mean either shipping that secret somewhere it does not belong
 * or issuing an HTTP request to ourselves to do work we are already in a
 * position to do. The permission check below is the guard on this path.
 */
export async function resyncAccountsAction(): Promise<{
  readonly ok: boolean;
  readonly error?: string;
  readonly summary?: string;
}> {
  const user = await requireUser();

  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return { ok: false, error: 'Only a Coordinator and above can trigger a sync.' };
  }

  if (!metaIsConfigured()) {
    return { ok: false, error: 'No Meta system-user token is configured.' };
  }

  try {
    const results = await runMetaSync({});
    const failed = results.filter((r) => r.outcome === 'failed');
    const days = results.reduce((n, r) => n + r.daysWritten, 0);
    const posts = results.reduce((n, r) => n + r.postsWritten, 0);

    revalidatePath('/studio');

    /* ⚠️ THE FAILURES ARE NAMED. A summary reading "2 accounts synced" when one
       of them errored is the shape of report that lets a client's figures sit
       frozen for a fortnight. */
    return {
      ok: true,
      summary:
        failed.length > 0
          ? `${results.length - failed.length} of ${results.length} accounts synced. Failed: ${failed
              .map((r) => `${r.projectName} ${r.platform}`)
              .join(', ')}.`
          : `${results.length} ${results.length === 1 ? 'account' : 'accounts'} synced — ${days} metric days and ${posts} posts written.`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The sync could not run.',
    };
  }
}
