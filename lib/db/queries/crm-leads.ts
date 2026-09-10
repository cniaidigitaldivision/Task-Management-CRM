import 'server-only';

import { withUser } from '../client';

/* ============================================================================
 * THE LEAD LIST — LAYER 1
 * ----------------------------------------------------------------------------
 * ── ⚠️ NO AUTHORISATION CODE IN THIS FILE, AND THAT IS THE DESIGN ──────────
 * Everything runs through `withUser`, and migration 118's policies decide who
 * sees what: Admin, Super Admin and the SALES MANAGER see every lead; a
 * salesperson sees the leads ASSIGNED TO THEM; nobody else sees any. So the
 * staff view and the manager's view are the same query — the database narrows
 * it.
 *
 * ⚠️ IT WAS RANK UNTIL 2026-09-10 and is a DEPARTMENT now. Migration 111 wrote
 * `acting_at_least('team_coordinator')` into six policies; the owner then
 * separated the jobs, and the Coordinator — who runs the digital team — no
 * longer reads leads at all. See ADR-012.
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
 *   a salesperson only ever sees leads ASSIGNED TO THEM, so the owner of every
 *   lead they can see IS them, so the join reads their own row and succeeds.
 *   Admin and above — and the Coordinator — read the whole staff table anyway.
 *
 * ⚠️ THE SALES MANAGER IS THE CASE TO WATCH. They see every lead in the
 * department and are `member` in `users.role`, so `users_select` shows them one
 * row of the staff table — their own. Today that is harmless because nothing is
 * assigned; the moment Step 7 hands leads out, the manager's list will show
 * "Former member" against every colleague's name unless this join is replaced by
 * a definer reader. Migration 105 is the pattern, and 114 already has two.
 *
 * With today's policies there is no case where the join fails, so the function
 * was deleted rather than shipped unused.
 *
 * ⚠️ AND IT BECOMES WRONG IF VISIBILITY WIDENS FURTHER — if a salesperson is
 * ever allowed to see their PROJECT's leads rather than only their own, the same
 * failure appears for them too.
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

/**
 * One lead, whole — everything the record holds about the person.
 *
 * Deliberately wider than `CrmLeadRow`: the list carries what a person scans,
 * this carries what they need in hand before ringing somebody.
 */
export interface CrmLeadRecord {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly fullName: string | null;
  readonly phone: string | null;
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly city: string | null;
  /** Every answer Meta sent, raw. See `lib/domain/crm-answers.ts`. */
  readonly answers: Record<string, string>;
  readonly stage: string;
  readonly temperature: string | null;
  readonly lostReason: string | null;
  readonly nextAction: string | null;
  readonly nextActionAt: string | null;
  readonly submittedAt: string;
  readonly importedAt: string;
  readonly firstContactedAt: string | null;
  readonly closedAt: string | null;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly formName: string | null;
  readonly campaignName: string | null;
  readonly source: string;
  /** Meta's own lead id. Shown so a row can be traced back to the account. */
  readonly externalId: string | null;
}

export interface CrmLeadNote {
  readonly id: string;
  readonly body: string;
  readonly createdAt: string;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly authorAvatarUrl: string | null;
}

export interface CrmLeadEvent {
  readonly id: string;
  readonly kind: string;
  readonly outcome: string | null;
  readonly occurredAt: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly actorAvatarUrl: string | null;
}

/** Another lead carrying the same number — the same person, enquiring twice. */
export interface CrmLeadSibling {
  readonly id: string;
  readonly submittedAt: string;
  readonly stage: string;
  readonly projectName: string;
  readonly formName: string | null;
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
  /** Step 8: `overdue` · `today` · `no-plan`. */
  readonly due?: string | null;
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

  const { rows, counts, owners } = await withUser(actorId, async (tx) => {
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

    /* ⚠️ KARACHI, matching the strip that offers it and migration 123. And
       `no-plan` is deliberately owned-only: an unassigned lead has no plan by
       definition, so counting those would make the chip read 312 on a project
       nobody has started. */
    if (filters.due === 'overdue') {
      conditions.push(tx`l.next_action_at is not null
        and (l.next_action_at at time zone 'Asia/Karachi')::date
            < (now() at time zone 'Asia/Karachi')::date`);
    } else if (filters.due === 'today') {
      conditions.push(tx`l.next_action_at is not null
        and (l.next_action_at at time zone 'Asia/Karachi')::date
            = (now() at time zone 'Asia/Karachi')::date`);
    } else if (filters.due === 'no-plan') {
      conditions.push(tx`l.next_action_at is null and l.owner_id is not null`);
    }

    let where = conditions[0];
    for (const c of conditions.slice(1)) where = tx`${where} and ${c}`;

    const stage = filters.stage ?? null;

    const page = await tx`
      select l.id, l.full_name, l.phone, l.phone_e164, l.city,
             l.stage::text, l.temperature::text,
             l.next_action, l.next_action_at, l.submitted_at,
             l.owner_id,
             f.name as form_name,
             c.name as campaign_name,
             (select a.kind::text from public.crm_lead_activity a
               where a.lead_id = l.id order by a.occurred_at desc limit 1) as last_kind,
             (select a.occurred_at from public.crm_lead_activity a
               where a.lead_id = l.id order by a.occurred_at desc limit 1) as last_at,
             (select count(*) from public.crm_lead_notes n where n.lead_id = l.id) as note_count,
             count(*) over () as total
        from public.crm_leads l
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

    /* ⚠️ NAMES COME THROUGH MIGRATION 121, NOT A JOIN — see this file's header.
       The sales manager is `member` in `users.role`, so a join to `users` reads
       one row (their own) and every colleague renders as "Former member". That
       is the 2026-09-08 bug, and it was measured against this exact query under
       the manager's own session before 121 was written.

       One extra round trip inside the same transaction, returning at most a
       handful of rows. */
    const owners = await tx`select * from app.crm_lead_owners()`;

    return { rows: page, counts: tally, owners };
  });

  const list = rows as Array<Record<string, unknown>>;

  const ownerNames = new Map<string, string>();
  for (const o of owners as Array<Record<string, unknown>>) {
    ownerNames.set(String(o.id), String(o.full_name ?? 'Unnamed'));
  }

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
      /* ⚠️ A name that is missing here means the account is GONE — the reader
         returns every owner the caller can see. Before 121 it meant "hidden by
         users_select", which is what made the label a lie. */
      ownerName: r.owner_id ? (ownerNames.get(String(r.owner_id)) ?? null) : null,
      formName: (r.form_name as string | null) ?? null,
      campaignName: (r.campaign_name as string | null) ?? null,
      lastActivityKind: (r.last_kind as string | null) ?? null,
      lastActivityAt: r.last_at ? new Date(r.last_at as string).toISOString() : null,
      noteCount: Number(r.note_count ?? 0),
    })),
  };
}

/**
 * One lead and everything hanging off it, or null when the caller cannot read
 * it — which is the same answer for "no such lead" and "not yours", deliberately.
 * Distinguishing them would confirm that a lead exists to somebody with no right
 * to know it.
 *
 * ── ⚠️ THE NOTE AND ACTIVITY AUTHORS COME THROUGH MIGRATION 114 ────────────
 * NOT through a join, and this is the one place in the CRM where that matters.
 * The header of this file explains why the LIST's owner join is safe: a sales
 * member only ever sees leads assigned to them, so the owner they read is
 * themselves. A note's author and an activity's actor are somebody else by
 * design — an Admin assigns the lead, and the `assigned` row's actor is that
 * Admin. `users_select` hides them, the join returns NULL, and the screen calls
 * a working colleague "Former member". That is migration 105's bug, in a new
 * table, and 114's self-check proves it is real rather than assuming it.
 *
 * The lead's OWN owner stays a plain join, for exactly the reason the header
 * gives. If that ever stops being true, both must change together.
 *
 * ── ⚠️ FOUR READS IN ONE TRANSACTION, NOT FOUR ROUND TRIPS ─────────────────
 * The same reasoning as the client statement in `finance.ts`: one page, one
 * `withUser`, so the reads share a session and cannot see different states of
 * the row halfway through.
 */
export async function getCrmLead(
  actorId: string,
  leadId: string,
): Promise<{
  lead: CrmLeadRecord;
  notes: CrmLeadNote[];
  activity: CrmLeadEvent[];
  alsoEnquired: CrmLeadSibling[];
} | null> {
  /* ⚠️ A malformed uuid reaches Postgres as a cast error — a 500 on a URL
     somebody mistyped, rather than the "no such lead" this returns. The route
     is the one input a person edits by hand. */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)) {
    return null;
  }

  return withUser(actorId, async (tx) => {
    const found = await tx`
      select l.id, l.project_id, p.name as project_name,
             l.full_name, l.phone, l.phone_e164, l.email, l.city,
             l.answers,
             l.stage::text, l.temperature::text, l.lost_reason::text,
             l.next_action, l.next_action_at,
             l.submitted_at, l.imported_at, l.first_contacted_at, l.closed_at,
             l.owner_id,
             f.name as form_name, c.name as campaign_name,
             l.source::text, l.external_id
        from public.crm_leads l
        join public.projects p on p.id = l.project_id
        left join public.crm_lead_forms f on f.id = l.form_id
        left join public.crm_campaigns  c on c.id = l.campaign_id
       where l.id = ${leadId}::uuid
       limit 1
    `;

    const row = (found as Array<Record<string, unknown>>)[0];
    if (!row) return null;

    /* ⚠️ THE OWNER'S NAME THROUGH 121, for the same reason as the list — the
       sales manager reads one row of `users` and every colleague would render
       as "Former member". Added to the same wave, so it costs no extra wait. */
    const [ownerRows, noteRows, activityRows, siblingRows] = await Promise.all([
      row.owner_id
        ? tx`select full_name from app.crm_lead_owners() where id = ${row.owner_id as string}::uuid`
        : Promise.resolve([]),
      tx`select * from app.crm_lead_notes_with_authors(${leadId}::uuid)`,
      tx`select * from app.crm_lead_activity_with_actors(${leadId}::uuid)`,
      /* ── ⚠️ THE SAME PERSON, ENQUIRING TWICE ─────────────────────────────
         Measured on the live table 2026-09-10: 615 leads carry 597 distinct
         numbers, so roughly eighteen leads share a number with another. Those
         are real people who filled the form again, and without this the second
         salesperson to open one has no way of knowing the first already rang
         them.

         Matched on `phone_e164`, never on the raw `phone` — the whole reason
         that column exists is that `0300-1234567` and `+92 300 1234567` are the
         same person and two different strings (see lib/domain/phone.ts).

         ⚠️ RLS APPLIES HERE, unlike the two readers above, and that is correct
         but incomplete: a sales member sees only the sibling leads assigned to
         THEM, so a duplicate held by a colleague stays invisible to them. The
         screen therefore renders this section only when it has something to
         show, and never prints a count — "0 other enquiries" would be a
         sentence this query cannot support. Widening it means a definer reader
         that discloses the COUNT without the rows. */
      row.phone_e164
        ? tx`
            select l.id, l.submitted_at, l.stage::text, p.name as project_name,
                   f.name as form_name
              from public.crm_leads l
              join public.projects p on p.id = l.project_id
              left join public.crm_lead_forms f on f.id = l.form_id
             where l.phone_e164 = ${row.phone_e164 as string}
               and l.id <> ${leadId}::uuid
             order by l.submitted_at desc
             limit 20
          `
        : Promise.resolve([]),
    ]);

    return {
      lead: {
        id: String(row.id),
        projectId: String(row.project_id),
        projectName: String(row.project_name),
        fullName: (row.full_name as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        phoneE164: (row.phone_e164 as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        city: (row.city as string | null) ?? null,
        answers: (row.answers as Record<string, string> | null) ?? {},
        stage: String(row.stage),
        temperature: (row.temperature as string | null) ?? null,
        lostReason: (row.lost_reason as string | null) ?? null,
        nextAction: (row.next_action as string | null) ?? null,
        nextActionAt: row.next_action_at
          ? new Date(row.next_action_at as string).toISOString()
          : null,
        submittedAt: new Date(row.submitted_at as string).toISOString(),
        importedAt: new Date(row.imported_at as string).toISOString(),
        firstContactedAt: row.first_contacted_at
          ? new Date(row.first_contacted_at as string).toISOString()
          : null,
        closedAt: row.closed_at ? new Date(row.closed_at as string).toISOString() : null,
        ownerId: (row.owner_id as string | null) ?? null,
        ownerName:
          ((ownerRows as Array<Record<string, unknown>>)[0]?.full_name as string | null) ?? null,
        formName: (row.form_name as string | null) ?? null,
        campaignName: (row.campaign_name as string | null) ?? null,
        source: String(row.source),
        externalId: (row.external_id as string | null) ?? null,
      },
      notes: (noteRows as Array<Record<string, unknown>>).map((n) => ({
        id: String(n.id),
        body: String(n.body),
        createdAt: new Date(n.created_at as string).toISOString(),
        authorId: (n.author_id as string | null) ?? null,
        authorName: (n.author_name as string | null) ?? null,
        authorAvatarUrl: (n.author_avatar_url as string | null) ?? null,
      })),
      activity: (activityRows as Array<Record<string, unknown>>).map((a) => ({
        id: String(a.id),
        kind: String(a.kind),
        outcome: (a.outcome as string | null) ?? null,
        occurredAt: new Date(a.occurred_at as string).toISOString(),
        actorId: (a.actor_id as string | null) ?? null,
        actorName: (a.actor_name as string | null) ?? null,
        actorAvatarUrl: (a.actor_avatar_url as string | null) ?? null,
      })),
      alsoEnquired: (siblingRows as Array<Record<string, unknown>>).map((s) => ({
        id: String(s.id),
        submittedAt: new Date(s.submitted_at as string).toISOString(),
        stage: String(s.stage),
        projectName: String(s.project_name),
        formName: (s.form_name as string | null) ?? null,
      })),
    };
  });
}

/* ============================================================================
 * WRITING — Step 6
 * ----------------------------------------------------------------------------
 * ── ⚠️ NOT ONE OF THESE WRITES TO `crm_lead_activity` ──────────────────────
 * Migration 116's triggers do, and that is the whole design. The obvious build
 * is "update the lead, then insert the timeline row", which works until the
 * SECOND caller — a bulk action, a script, a fix somebody runs by hand — forgets
 * the second half. A timeline with a hole in it looks complete.
 *
 * So a stage change here is one UPDATE, and the history is the database's job.
 * The exception is `logLeadContact`, where the activity row IS the thing that
 * happened rather than a record of something else.
 *
 * ── ⚠️ AND NOT ONE OF THEM CHECKS A ROLE ───────────────────────────────────
 * 111's policy decides which rows, and 116's column grant decides which columns:
 * a session can change exactly five, so `project_id`, the number Meta captured
 * and `first_contacted_at` are unreachable from here whatever this file does.
 * A `can(...)` call would be a third rule to keep in step with two that cannot
 * be forgotten.
 * ========================================================================= */

/** The kinds a person may log. Mirrors 116's `crm_lead_activity_insert`. */
export const CONTACT_KINDS = [
  'call_attempted',
  'call_connected',
  'call_no_answer',
  'whatsapp_sent',
  'email_sent',
] as const;

export type CrmContactKind = (typeof CONTACT_KINDS)[number];

export function isContactKind(value: string): value is CrmContactKind {
  return (CONTACT_KINDS as readonly string[]).includes(value);
}

/**
 * Move a lead along the pipeline.
 *
 * ⚠️ `lost_reason` IS SENT ON EVERY CALL, including as null. Sending it only
 * when the stage is `lost` would leave a reopened lead carrying the reason it
 * was lost for — 116's BEFORE trigger clears it anyway, but a query that relies
 * on a trigger to undo what it just wrote is one refactor away from not being
 * undone.
 */
export async function setLeadStage(
  actorId: string,
  leadId: string,
  stage: string,
  lostReason: string | null,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_leads
       set stage       = ${stage}::public.crm_stage,
           lost_reason = ${lostReason}::public.crm_lost_reason
     where id = ${leadId}::uuid
     returning id
  `);
  return (rows as unknown[]).length === 1;
}

export async function setLeadTemperature(
  actorId: string,
  leadId: string,
  temperature: string | null,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_leads
       set temperature = ${temperature}::public.crm_temperature
     where id = ${leadId}::uuid
     returning id
  `);
  return (rows as unknown[]).length === 1;
}

/**
 * What is owed on this lead, and when.
 *
 * ⚠️ THE DATE IS READ IN KARACHI. `next_action_at` is a timestamptz and the
 * input is a calendar date off a date picker; `'2026-09-12'::timestamptz` under
 * a UTC server means 05:00 Karachi on the 12th, so "due the 12th" would show as
 * overdue to anybody looking before five in the morning — and every one of this
 * division's users is in Karachi. Anchored at the end of that day, because a
 * task due "on Friday" is not overdue at nine on Friday morning.
 */
export async function setLeadNextAction(
  actorId: string,
  leadId: string,
  action: string | null,
  dueDate: string | null,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_leads
       set next_action    = ${action},
           next_action_at = case
             when ${dueDate}::text is null then null
             else ((${dueDate}::date + interval '1 day' - interval '1 second')
                     at time zone 'Asia/Karachi')
           end
     where id = ${leadId}::uuid
     returning id
  `);
  return (rows as unknown[]).length === 1;
}

/**
 * Record that somebody reached out.
 *
 * ⚠️ THIS is what stamps `first_contacted_at`, through 116's trigger, and that
 * is the number every response-time report is built on. It is measured from
 * `occurred_at` — the default is now, but a call logged tomorrow morning for
 * yesterday afternoon must be able to say so.
 */
export async function logLeadContact(
  actorId: string,
  leadId: string,
  kind: CrmContactKind,
  outcome: string | null,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.crm_lead_activity (lead_id, actor_id, kind, outcome)
    values (${leadId}::uuid, ${actorId}::uuid, ${kind}::public.crm_activity_kind, ${outcome})
    returning id
  `);
  return (rows as unknown[]).length === 1;
}

/** ⚠️ The author is the caller, always — 111's policy refuses anything else. */
export async function addLeadNote(
  actorId: string,
  leadId: string,
  body: string,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.crm_lead_notes (lead_id, author_id, body)
    values (${leadId}::uuid, ${actorId}::uuid, ${body})
    returning id
  `);
  return (rows as unknown[]).length === 1;
}

/**
 * Withdraw a note.
 *
 * ⚠️ A REAL DELETE, and the `note_added` row in the timeline STAYS — activity
 * has no delete policy at any rank. That is the right pair: the text somebody
 * withdrew is gone, and the fact that something was written at that hour is
 * still on the record. 111 lets an author remove their own and an Admin remove
 * anybody's; this file adds no rule of its own.
 */
export async function deleteLeadNote(actorId: string, noteId: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    delete from public.crm_lead_notes where id = ${noteId}::uuid returning id
  `);
  return (rows as unknown[]).length === 1;
}

/* ============================================================================
 * ASSIGNMENT — Step 7
 * ========================================================================= */

/** One salesperson, as the manager sees them when deciding. */
export interface CrmSalesPerson {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly isManager: boolean;
  readonly openLeads: number;
  readonly totalLeads: number;
  readonly wonLeads: number;
  readonly lastGivenAt: string | null;
  /** ⚠️ Null until somebody logs a call — never 0, which would read as instant. */
  readonly medianResponseMinutes: number | null;
}

/**
 * The sales team, with the arithmetic the rota runs on.
 *
 * ⚠️ EMPTY FOR A SALESPERSON, by migration 120's own guard rather than by a
 * check here. Colleagues' win counts and response times are the manager's view,
 * not the team's.
 */
export async function crmSalesRoster(actorId: string): Promise<CrmSalesPerson[]> {
  const rows = await withUser(actorId, (tx) => tx`select * from app.crm_sales_roster()`);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.user_id),
    name: String(r.full_name ?? 'Unnamed'),
    avatarUrl: (r.avatar_url as string | null) ?? null,
    isManager: r.is_manager === true,
    openLeads: Number(r.open_leads ?? 0),
    totalLeads: Number(r.total_leads ?? 0),
    wonLeads: Number(r.won_leads ?? 0),
    lastGivenAt: r.last_given ? new Date(r.last_given as string).toISOString() : null,
    medianResponseMinutes:
      r.median_response_minutes === null || r.median_response_minutes === undefined
        ? null
        : Number(r.median_response_minutes),
  }));
}

/**
 * Hand one lead to somebody, or take it back with `ownerId = null`.
 *
 * ⚠️ NOTHING HERE CHECKS WHO IS ALLOWED TO. Migration 120's trigger refuses
 * anybody but the sales manager and an Admin, and 116's trigger writes the
 * timeline entry. Both happen whatever calls this — including a script — which
 * is the reason neither lives in TypeScript.
 */
export async function assignLead(
  actorId: string,
  leadId: string,
  ownerId: string | null,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_leads
       set owner_id = ${ownerId}::uuid
     where id = ${leadId}::uuid
       and owner_id is distinct from ${ownerId}::uuid
     returning id
  `);
  return (rows as unknown[]).length === 1;
}

/**
 * Whose turn it is. Null when there is no salesperson to give a lead to.
 *
 * ⚠️ CALLED ONCE PER LEAD, not once per batch, and that is what makes a bulk
 * share-out balance. Each assignment changes the open counts the next call
 * reads — a single call reused across twenty leads would give all twenty to
 * whoever happened to be lowest at the start.
 */
export async function crmNextOwner(actorId: string): Promise<string | null> {
  const rows = await withUser(actorId, (tx) => tx`select app.crm_next_owner() as id`);
  const id = (rows as Array<Record<string, unknown>>)[0]?.id;
  return id ? String(id) : null;
}

/**
 * The unassigned leads on a project, oldest enquiry first.
 *
 * ⚠️ OLDEST FIRST, deliberately. Somebody who filled the form in June has been
 * waiting longest and their lead is closest to Meta's 90-day deletion; sharing
 * out the newest first would leave the stalest leads permanently at the back.
 */
export async function unassignedLeadIds(
  actorId: string,
  projectId: string,
  limit: number,
): Promise<string[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select id from public.crm_leads
     where project_id = ${projectId}::uuid
       and owner_id is null
       and stage not in ('won', 'lost')
     order by submitted_at asc
     limit ${limit}
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => String(r.id));
}

/** What is owed on this project right now, for whoever is asking. */
export interface CrmDueCounts {
  readonly overdue: number;
  readonly dueToday: number;
  /** Open, owned, and with no next action set at all — nothing is planned. */
  readonly noPlan: number;
}

/**
 * The follow-up position — Step 8.
 *
 * ⚠️ NARROWED BY RLS, NOT BY A `where owner_id`. A salesperson's counts describe
 * their own leads because migration 118's policy is what they can see; the
 * manager's describe the whole project. One query, two meanings, and no second
 * rule to keep in step.
 *
 * ⚠️ AND "TODAY" IS KARACHI, matching migration 123 and the date filter. A UTC
 * comparison calls a Friday task overdue from 5am Friday.
 */
export async function crmDueCounts(actorId: string, projectId: string): Promise<CrmDueCounts> {
  const rows = await withUser(actorId, (tx) => tx`
    select
      count(*) filter (
        where l.next_action_at is not null
          and (l.next_action_at at time zone 'Asia/Karachi')::date
              < (now() at time zone 'Asia/Karachi')::date
      ) as overdue,
      count(*) filter (
        where l.next_action_at is not null
          and (l.next_action_at at time zone 'Asia/Karachi')::date
              = (now() at time zone 'Asia/Karachi')::date
      ) as due_today,
      count(*) filter (
        where l.next_action_at is null and l.owner_id is not null
      ) as no_plan
      from public.crm_leads l
     where l.project_id = ${projectId}::uuid
       and l.stage not in ('won', 'lost')
  `);

  const r = (rows as Array<Record<string, unknown>>)[0];
  return {
    overdue: Number(r?.overdue ?? 0),
    dueToday: Number(r?.due_today ?? 0),
    noPlan: Number(r?.no_plan ?? 0),
  };
}

/**
 * How many leads on this project have nobody working them.
 *
 * ⚠️ OPEN ONES ONLY, matching the rota in migration 120. A lead that was closed
 * without ever being assigned is not waiting for anybody, and counting it would
 * offer to share out work that does not exist.
 */
export async function unassignedCount(actorId: string, projectId: string): Promise<number> {
  const rows = await withUser(actorId, (tx) => tx`
    select count(*) as n from public.crm_leads
     where project_id = ${projectId}::uuid
       and owner_id is null
       and stage not in ('won', 'lost')
  `);
  return Number((rows as Array<Record<string, unknown>>)[0]?.n ?? 0);
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
  /* ⚠️ THE SAME TRAP AS THE LIST, and it bit here too: this joined `users`, so
     under the sales manager's session every option came back with a null name.
     Counted from the leads, named through 121's reader. */
  const { counts, owners } = await withUser(actorId, async (tx) => {
    const counts = await tx`
      select l.owner_id, count(*) as leads
        from public.crm_leads l
       where l.project_id = ${projectId}::uuid
         and l.owner_id is not null
       group by l.owner_id
    `;
    const owners = await tx`select * from app.crm_lead_owners()`;
    return { counts, owners };
  });

  const names = new Map<string, string>();
  for (const o of owners as Array<Record<string, unknown>>) {
    names.set(String(o.id), String(o.full_name ?? 'Unnamed'));
  }

  return (counts as Array<Record<string, unknown>>)
    .map((r) => ({
      id: String(r.owner_id),
      name: names.get(String(r.owner_id)) ?? 'Former member',
      leads: Number(r.leads ?? 0),
    }))
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
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
