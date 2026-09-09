import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * THE LEAD LIST — LAYER 1
 * ----------------------------------------------------------------------------
 * ── ⚠️ NO AUTHORISATION CODE IN THIS FILE, AND THAT IS THE DESIGN ──────────
 * Everything runs through `withUser`, and migration 111's policies decide who
 * sees what: Coordinator and above see every lead, everybody else sees the leads
 * ASSIGNED TO THEM. So the staff view and the admin view are the same query —
 * the database narrows it.
 *
 * That is the whole reason the two views cannot drift apart. A `where owner_id =`
 * bolted onto the query would be a second rule to keep in step with the first,
 * and the first is the one that cannot be forgotten.
 *
 * ── ⚠️ THE OWNER'S NAME IS A PLAIN JOIN, AND THAT IS ONLY SAFE BY ACCIDENT ─
 * `users_select` lets a Member read exactly one row of the staff table — their
 * own — which is what made the remarks modal label live colleagues "Former
 * member" on 2026-09-08. A SECURITY DEFINER reader was written for this file to
 * avoid repeating it, and its own self-check proved it unnecessary:
 *
 *   a Member only ever sees leads ASSIGNED TO THEM, so the owner of every lead
 *   they can see IS them, so the join reads their own row and succeeds.
 *   Coordinator and above can read the whole staff table anyway.
 *
 * With today's policies there is no case where the join fails, so the function
 * was deleted rather than shipped unused.
 *
 * ⚠️ IT BECOMES WRONG THE MOMENT VISIBILITY WIDENS. If a sales member is ever
 * allowed to see their PROJECT's leads rather than only their own, they will see
 * leads owned by colleagues, the join will return NULL for those, and the screen
 * will describe working colleagues as former members. Widening
 * `crm_leads_select` means restoring a definer reader here in the same change —
 * migration 105 is the pattern.
 * ========================================================================= */

export interface CrmProjectOption {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly leads: number;
  /** Lead forms linked to this project — see `connection` below. */
  readonly forms: number;
  /**
   * ⚠️ THREE STATES, NOT TWO, because "nothing here" has two different causes
   * and they call for two different actions:
   *
   *   'live'          leads are arriving — show the table
   *   'no-leads-yet'  a form is connected but has produced nothing — wait
   *   'not-connected' no form is linked — somebody has to link one
   *
   * Collapsing the middle one into "Not connected" is what makes a person go
   * looking for a setup step that was already done.
   */
  readonly connection: 'live' | 'no-leads-yet' | 'not-connected';
}

export interface CrmLeadRow {
  readonly id: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly phoneE164: string | null;
  readonly city: string | null;
  readonly stage: string;
  readonly temperature: string | null;
  readonly nextAction: string | null;
  readonly nextActionAt: string | null;
  readonly submittedAt: string;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly formName: string | null;
  readonly campaignName: string | null;
  /** The most recent activity, for the "Call — Contacted · 9 days ago" column. */
  readonly lastActivityKind: string | null;
  readonly lastActivityAt: string | null;
  readonly noteCount: number;
}

export interface CrmLeadFilters {
  readonly stage?: string | null;
  readonly ownerId?: string | null;
  readonly temperature?: string | null;
  readonly formId?: string | null;
  readonly search?: string | null;
  /** Inclusive, on `submitted_at` — when THEY enquired, not when we imported. */
  readonly from?: string | null;
  readonly to?: string | null;
}

/**
 * Projects for the dropdown, with how many leads each holds.
 *
 * ⚠️ EVERY project the reader can see, not only the ones with leads. A project
 * showing "Not connected" is information — it says the pipeline exists and this
 * client is not in it yet. Hiding them would make the dropdown look like the
 * whole world, which is how somebody concludes a client was never set up.
 *
 * ⚠️ Tools are excluded for the same reason the Studio excludes them: a product
 * has no leads and never will.
 */
export async function listCrmProjects(actorId: string): Promise<CrmProjectOption[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select p.id, p.name, p.code,
           (select count(*) from public.crm_leads      l where l.project_id = p.id) as leads,
           (select count(*) from public.crm_lead_forms f where f.project_id = p.id) as forms
      from public.projects p
     where p.is_draft = false
       and p.type <> 'tool'
     order by leads desc, p.name
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => {
    const leads = Number(r.leads ?? 0);
    const forms = Number(r.forms ?? 0);
    return {
      id: String(r.id),
      name: String(r.name),
      code: String(r.code),
      leads,
      forms,
      connection: leads > 0 ? 'live' : forms > 0 ? 'no-leads-yet' : 'not-connected',
    } as const;
  });
}

/**
 * One project's leads, the counts strip above them, and the total — in ONE
 * transaction, off ONE predicate.
 *
 * ── ⚠️ THE COUNTS AND THE ROWS SHARE `where`, AND THAT IS THE WHOLE DESIGN ──
 * The strip doubles as the stage filter, so its numbers have to describe the set
 * the table is drawn from. Written as two independent queries, a date filter
 * would leave the strip reading "New 615" above a table of 21 rows, and the
 * first person to notice would be a client being shown the screen.
 *
 * So the non-stage conditions are built once as a fragment (the idiom in
 * audit.ts) and used by both. The STAGE condition is applied only to the rows —
 * a strip that zeroed every other stage the moment you clicked one would remove
 * the only thing you navigate back by.
 *
 * ── ⚠️ ORDERED BY NEXT ACTION, WHICH IS THE WHOLE POINT OF THE SCREEN ──────
 * The PropForce reference sorts on it, and that is the difference between a list
 * somebody works from and a list somebody scrolls. `nulls last` matters right
 * now: nothing has a next action yet, so every lead falls through to
 * newest-first — and the moment somebody sets one, it rises to the top where it
 * is due.
 *
 * ── ⚠️ PAGED IN SQL, NOT IN THE BROWSER ────────────────────────────────────
 * Against the default in components/ui/pagination.tsx — and that file's comment
 * names this exact exception. One project already holds 615 leads and the import
 * adds more every fifteen minutes; serialising all of them into the HTML is the
 * failure this application has actually had, twice (see the payload note in
 * app/(app)/studio/page.tsx).
 */
export async function listCrmLeads(
  actorId: string,
  projectId: string,
  filters: CrmLeadFilters = {},
  limit = 25,
  offset = 0,
): Promise<{ rows: CrmLeadRow[]; total: number; stageCounts: Record<string, number> }> {
  const search = filters.search?.trim() || null;

  const { rows, counts } = await withUser(actorId, async (tx) => {
    /* Every condition EXCEPT stage. See the header. */
    const conditions = [tx`l.project_id = ${projectId}::uuid`];

    if (filters.ownerId) conditions.push(tx`l.owner_id = ${filters.ownerId}::uuid`);
    if (filters.temperature) conditions.push(tx`l.temperature::text = ${filters.temperature}`);
    if (filters.formId) conditions.push(tx`l.form_id = ${filters.formId}::uuid`);

    if (search) {
      /* ⚠️ Searches the name, the raw phone AND the normalised one. Somebody
         reading a number off a ringing handset types it however they see it;
         matching only the stored column misses the lead that arrived in the
         other format, and they conclude the caller is not in the system. */
      const needle = `%${search}%`;
      conditions.push(
        tx`(l.full_name ilike ${needle} or l.phone ilike ${needle} or l.phone_e164 ilike ${needle})`,
      );
    }

    /* ⚠️ COMPARED IN KARACHI, NOT UTC. `submitted_at` is a timestamptz and these
       are calendar dates picked off a calendar; comparing in UTC puts every lead
       that arrived after 7pm Karachi onto the following day.

       Measured on the live table, 2026-09-10: **109 of 615 leads — 18% — have a
       different UTC date from their Karachi date.** So this is not a rounding
       detail. A salesperson filtering to "yesterday" under a UTC comparison
       would be shown a fifth of the wrong evening's leads and would never know
       which ones were missing. */
    if (filters.from) {
      conditions.push(
        tx`(l.submitted_at at time zone 'Asia/Karachi')::date >= ${filters.from}::date`,
      );
    }
    if (filters.to) {
      conditions.push(
        tx`(l.submitted_at at time zone 'Asia/Karachi')::date <= ${filters.to}::date`,
      );
    }

    let where = conditions[0];
    for (const c of conditions.slice(1)) where = tx`${where} and ${c}`;

    const stage = filters.stage ?? null;

    const page = await tx`
      select l.id, l.full_name, l.phone, l.phone_e164, l.city,
             l.stage::text, l.temperature::text,
             l.next_action, l.next_action_at, l.submitted_at,
             l.owner_id, u.full_name as owner_name,
             f.name as form_name,
             c.name as campaign_name,
             (select a.kind::text from public.crm_lead_activity a
               where a.lead_id = l.id order by a.occurred_at desc limit 1) as last_kind,
             (select a.occurred_at from public.crm_lead_activity a
               where a.lead_id = l.id order by a.occurred_at desc limit 1) as last_at,
             (select count(*) from public.crm_lead_notes n where n.lead_id = l.id) as note_count,
             count(*) over () as total
        from public.crm_leads l
        left join public.users          u on u.id = l.owner_id
        left join public.crm_lead_forms f on f.id = l.form_id
        left join public.crm_campaigns  c on c.id = l.campaign_id
       where ${where}
         and (${stage}::text is null or l.stage::text = ${stage})
       order by l.next_action_at asc nulls last, l.submitted_at desc
       limit ${limit} offset ${offset}
    `;

    const tally = await tx`
      select l.stage::text as stage, count(*) as n
        from public.crm_leads l
       where ${where}
       group by l.stage
    `;

    return { rows: page, counts: tally };
  });

  const list = rows as Array<Record<string, unknown>>;

  const stageCounts: Record<string, number> = {};
  for (const r of counts as Array<Record<string, unknown>>) {
    stageCounts[String(r.stage)] = Number(r.n ?? 0);
  }

  return {
    /* ⚠️ `count(*) over ()` is absent when the page is empty, so the total falls
       back to the strip's own sum rather than to zero — otherwise paging past
       the last row would report "0 leads" for a project that plainly has some. */
    total:
      list.length > 0
        ? Number(list[0].total ?? 0)
        : filters.stage
          ? (stageCounts[filters.stage] ?? 0)
          : Object.values(stageCounts).reduce((a, b) => a + b, 0),
    stageCounts,
    rows: list.map((r) => ({
      id: String(r.id),
      fullName: (r.full_name as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      phoneE164: (r.phone_e164 as string | null) ?? null,
      city: (r.city as string | null) ?? null,
      stage: String(r.stage),
      temperature: (r.temperature as string | null) ?? null,
      nextAction: (r.next_action as string | null) ?? null,
      nextActionAt: r.next_action_at ? new Date(r.next_action_at as string).toISOString() : null,
      submittedAt: new Date(r.submitted_at as string).toISOString(),
      ownerId: (r.owner_id as string | null) ?? null,
      ownerName: (r.owner_name as string | null) ?? null,
      formName: (r.form_name as string | null) ?? null,
      campaignName: (r.campaign_name as string | null) ?? null,
      lastActivityKind: (r.last_kind as string | null) ?? null,
      lastActivityAt: r.last_at ? new Date(r.last_at as string).toISOString() : null,
      noteCount: Number(r.note_count ?? 0),
    })),
  };
}

/**
 * The people who hold leads in this project — the owner filter's options.
 *
 * ⚠️ Derived from the leads themselves, not from the project's members. A
 * salesperson who has left the project still owns rows until somebody reassigns
 * them, and building this list from the membership table would make those leads
 * unfindable through the filter that exists to find them.
 */
export async function crmOwnerOptions(
  actorId: string,
  projectId: string,
): Promise<Array<{ id: string; name: string; leads: number }>> {
  const rows = await withUser(actorId, (tx) => tx`
    select u.id, u.full_name, count(l.id) as leads
      from public.crm_leads l
      join public.users u on u.id = l.owner_id
     where l.project_id = ${projectId}::uuid
     group by u.id, u.full_name
     order by leads desc, u.full_name
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.full_name ?? 'Unnamed'),
    leads: Number(r.leads ?? 0),
  }));
}

/** The forms this project's leads came from — the filter's options. */
export async function crmFormOptions(
  actorId: string,
  projectId: string,
): Promise<Array<{ id: string; name: string; leads: number }>> {
  const rows = await withUser(actorId, (tx) => tx`
    select f.id, f.name, count(l.id) as leads
      from public.crm_lead_forms f
      left join public.crm_leads l on l.form_id = f.id
     where f.project_id = ${projectId}::uuid
     group by f.id, f.name
     having count(l.id) > 0
     order by leads desc
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    leads: Number(r.leads ?? 0),
  }));
}
