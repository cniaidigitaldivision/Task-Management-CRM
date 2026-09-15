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
  /** 16 of the 632 gave one. The desk's email control is live for those. */
  readonly email: string | null;
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
  /* ── The desk's redesign, 2026-09-14 ──────────────────────────────────────
     ⚠️ THE PROJECT IS READ THROUGH THE DEFINER, NOT A JOIN. `projects_select`
     needs membership and a salesperson is a member of nothing — the same bug as
     130, which 404'd every lead for its own owner. A join here would empty the
     whole desk for the people it is for. */
  readonly projectName: string | null;
  /** The last WhatsApp message either way, for the "Recent conversation"
   *  column. Null for a lead nobody has messaged, which is most of them. */
  readonly lastMessageBody: string | null;
  readonly lastMessageAt: string | null;
  /** 'inbound' when THEY wrote last — which is what "waiting for reply" means. */
  readonly lastMessageDirection: 'inbound' | 'outbound' | null;
  /* ⚠️ PER ROW, NOT PER PAGE — since "All projects" the desk can show leads from
     several projects at once, and only some of those have a WhatsApp number.
     One flag for the whole page would have pointed half the rows at `wa.me`
     (the salesperson's own handset, unrecorded) or hidden the chat on rows that
     can use it. Read through the definer; see migration 140. */
  readonly canWhatsApp: boolean;
  /* ── Migration 147 ────────────────────────────────────────────────────────
     ⚠️ STATE ONLY. Nothing advances these — the scheduler is not built — so
     every value on screen was put there by a person or a seed, and nothing
     claims an automation ran. */
  readonly sequenceState: string;
  readonly sequenceStep: number | null;
  readonly sequenceTotal: number | null;
  readonly sequenceNote: string | null;
  /* ── Migration 148 ────────────────────────────────────────────────────────
     ⚠️ THE CHANNEL AND THE DETAIL ARE TWO FIELDS. `source` is a closed enum;
     `sourceDetail` is the open half — "Lead ad", "Search ad", "Contact form" —
     because enumerating every channel × type pair is how an enum reaches thirty
     values nobody can read. Rendered by `lib/domain/lead-source.ts`. */
  readonly source: string | null;
  readonly sourceDetail: string | null;
  /* ── Migrations 150 / 151 ─────────────────────────────────────────────────
     ⚠️ THE PROPERTY LINE THE DESIGN ASKS FOR — "5 Marla Plot · A-101, Block A".
     Null for a service project, and for any lead nobody has matched to a plot
     yet, which is most of them. Absent renders nothing rather than a blank. */
  readonly propertyLabel: string | null;
  /** The live quotation, if there is one — "QT-1042 · PKR 4,500,000". */
  readonly quotationNumber: string | null;
  readonly quotationAmount: number | null;
  readonly quotationStatus: string | null;
  readonly quotationValidUntil: string | null;
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
  /* ⚠️ MINE MEANS OWNED BY ME, AND IT IS NOT THE SAME AS WHAT RLS ALREADY DOES.
     `crm_leads_select` lets a MANAGER read every lead on their department's
     projects, so without this the manager's own "My leads" would show the whole
     team's. For a salesperson it narrows nothing they could otherwise see — it
     is the manager it exists for. */
  readonly mine?: boolean;
}

/**
 * Projects for the dropdown, with how many leads each holds.
 *
 * ⚠️ EVERY project the reader can see, not only the ones with leads. A project
 * showing "Not connected" is information — it says the pipeline exists and this
 * client is not in it yet. Hiding them would make the dropdown look like the
 * whole world, which is how somebody concludes a client was never set up.
 *
 * ⚠️ TOOLS ARE NO LONGER EXCLUDED, AND THE COMMENT THAT EXCLUDED THEM WAS
 * WRONG. It read *"a product has no leads and never will"* — reasonable when the
 * only campaigns were a client's. The owner is now advertising the division's
 * OWN products: *"we are going to start an ERP ad campaign and a CRM ad campaign,
 * plus a lot of others."* `Internal CRM`, `Social Media Automation Tool` and
 * `WhatsApp Business API Automation` are all `type = 'tool'`, so those leads
 * would have imported and then been invisible on this screen.
 *
 * ⚠️ AND IT IS NOW SCOPED BY DEPARTMENT. Migration 124 routes each project's
 * leads to a department; showing a salesperson the ERP project would offer them
 * a dropdown entry whose table they cannot read. Admin sees everything.
 */
export async function listCrmProjects(actorId: string): Promise<CrmProjectOption[]> {
  /* ⚠️ THROUGH MIGRATION 125'S READER, NOT A QUERY ON `projects`. `projects_select`
     is `app.project_is_visible(id)`, which needs project MEMBERSHIP — and the
     sales team are not members of Chitral. Read directly, this returned ZERO
     rows for the sales manager while they could read all 615 leads, so the desk
     said "No projects are visible to you yet" above six hundred readable leads.
     Same shape as the "Former member" bug, on a third table. */
  const rows = await withUser(actorId, (tx) => tx`select * from app.crm_project_options()`);

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
  /** ⚠️ NULL MEANS EVERY PROJECT THE CALLER MAY SEE — not "no filter applied".
   *  RLS is what scopes it, exactly as it scopes a single project, so a
   *  salesperson asking for "all" still gets only their own leads. */
  projectId: string | null,
  filters: CrmLeadFilters = {},
  limit = 25,
  offset = 0,
): Promise<{ rows: CrmLeadRow[]; total: number; stageCounts: Record<string, number> }> {
  const search = filters.search?.trim() || null;

  const { rows, counts, owners } = await withUser(actorId, async (tx) => {
    /* Every condition EXCEPT stage. See the header. */
    /* ⚠️ A CONDITION THAT MATCHES EVERYTHING, not an absent one. RLS still
       narrows the result, so "all projects" means "all the ones you may read" —
       for a salesperson that is still only their own leads. */
    const conditions = [
      tx`(${projectId}::uuid is null or l.project_id = ${projectId}::uuid)`,
    ];

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
    } else if (filters.due === 'upcoming') {
      /* Planned, and not yet due. The opposite of `overdue`, and deliberately
         NOT "everything with a date" — a lead due this morning belongs under
         Needs attention, not under Upcoming. */
      conditions.push(tx`l.next_action_at is not null
        and (l.next_action_at at time zone 'Asia/Karachi')::date
            > (now() at time zone 'Asia/Karachi')::date`);
    } else if (filters.due === 'closed') {
      conditions.push(tx`l.stage in ('won', 'lost')`);
    } else if (filters.due === 'waiting') {
      /* ⚠️ THE SAME EXPRESSION AS THE COUNT ABOVE, deliberately — a tab whose
         number and whose rows are computed two different ways is a tab that
         eventually says 3 and shows 2. */
      conditions.push(tx`(select m.direction from public.crm_lead_messages m
                           where m.lead_id = l.id
                           order by m.occurred_at desc, m.id desc limit 1) = 'inbound'`);
    }

    if (filters.mine) {
      conditions.push(tx`l.owner_id = app.current_user_id()`);
    }

    /* ⚠️ ONLY ON "MY LEADS", AND ONLY WHEN NOTHING ELSE ASKED FOR THEM.
       A salesperson's list of 20 with 8 long since lost does not describe 20
       leads of work, so the personal view hides closed ones by default. But this
       must NOT reach the manager's desk (`mine` false), where the stage strip
       offers Won and Lost as chips and hiding them would make those counts
       unclickable — and it must not fight an explicit request: pressing the Won
       chip, or the Closed tab, asks for exactly the rows this would remove. */
    if (filters.mine && filters.due !== 'closed' && !filters.stage) {
      conditions.push(tx`l.stage not in ('won', 'lost')`);
    }

    let where = conditions[0];
    for (const c of conditions.slice(1)) where = tx`${where} and ${c}`;

    const stage = filters.stage ?? null;

    const page = await tx`
      select l.id, l.full_name, l.phone, l.phone_e164, l.email, l.city,
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
             /* ⚠️ THE DEFINER, NOT A JOIN TO public.projects — see the note on
                projectName in CrmLeadRow. Migration 130 exists because of
                exactly this. */
             app.crm_project_name(l.project_id) as project_name,
             app.crm_project_can_whatsapp(l.project_id) as can_whatsapp,
             l.sequence_state::text, l.sequence_step, l.sequence_total, l.sequence_note,
             l.source::text, l.source_detail,
             /* ⚠️ ONE LATERAL EACH, not a join — a lead can have several
                quotations and a plain join would multiply the row. Ordering by
                version descending takes the CURRENT one, which is the whole
                point of versioning: v2 supersedes v1 and the desk must show v2.
                (No backticks anywhere in this file: it is one long JS template
                literal, and a stray one ends the string. Third time.) */
             prop.label as property_label,
             quo.number as quotation_number,
             quo.net_amount as quotation_amount,
             quo.status::text as quotation_status,
             quo.valid_until as quotation_valid_until,
             msg.body as last_message_body,
             msg.occurred_at as last_message_at,
             msg.direction::text as last_message_direction,
             count(*) over () as total
        from public.crm_leads l
        left join public.crm_lead_forms f on f.id = l.form_id
        left join public.crm_campaigns  c on c.id = l.campaign_id
        /* ⚠️ ONE LATERAL, NOT THREE CORRELATED SUBQUERIES. The body, the time
           and the direction all come from the SAME message; three separate
           "order by occurred_at desc limit 1" reads can disagree the moment two
           messages share a timestamp, and then the desk shows one message's text
           over another's arrow. */
        left join lateral (
          select m.body, m.occurred_at, m.direction
            from public.crm_lead_messages m
           where m.lead_id = l.id
           order by m.occurred_at desc, m.id desc
           limit 1
        ) msg on true
        left join lateral (
          select
            concat_ws(' · ',
              nullif(concat_ws(' ',
                /* ⚠️ THE TRAILING DOT HAS TO GO. The FM999999.99 mask renders
                   5.00 as "5." — it strips the zeros and leaves the point — so
                   the row read "5. Marla". Whole Marla are the common case. */
                case when p.size_marla is not null
                     then trim(trailing '.' from to_char(p.size_marla, 'FM999999.99'))
                          || ' Marla' end,
                /* ⚠️ THE LAST WORD OF THE KIND, not the whole phrase. "5 Marla
                   Residential plot · A-101, Block A" is too long for a row that
                   also carries a name, a project and a city — and "Residential"
                   is true of nearly every row, so it distinguishes nothing. */
                /* NO BACKSLASH CLASS HERE. A regexp_replace with a
                   whitespace class is correct Postgres and survives neither a
                   shell nor a JS template literal intact — it silently produced
                   "Idential Plot" once. A last-word substring needs no escaping
                   anywhere. (And no backticks in this file at all: it is one
                   template literal and a stray one ends the string.) */
                initcap(substring(p.kind from '[^ ]+$'))), ''),
              nullif(concat_ws(', ', p.plot_number,
                case when p.block is not null then 'Block ' || p.block end), '')
            ) as label
            from public.crm_properties p
           where p.id = l.property_id
        ) prop on true
        left join lateral (
          select q.number, q.net_amount, q.status, q.valid_until
            from public.crm_quotations q
           where q.lead_id = l.id
             and q.status in ('approved', 'sent', 'pending_approval')
           order by q.version desc, q.created_at desc
           limit 1
        ) quo on true
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
      email: (r.email as string | null) ?? null,
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
      projectName: (r.project_name as string | null) ?? null,
      canWhatsApp: r.can_whatsapp === true,
      sequenceState: String(r.sequence_state ?? 'not_started'),
      sequenceStep: r.sequence_step === null || r.sequence_step === undefined ? null : Number(r.sequence_step),
      sequenceTotal: r.sequence_total === null || r.sequence_total === undefined ? null : Number(r.sequence_total),
      sequenceNote: (r.sequence_note as string | null) ?? null,
      source: (r.source as string | null) ?? null,
      sourceDetail: (r.source_detail as string | null) ?? null,
      propertyLabel: (r.property_label as string | null) ?? null,
      quotationNumber: (r.quotation_number as string | null) ?? null,
      quotationAmount:
        r.quotation_amount === null || r.quotation_amount === undefined
          ? null
          : Number(r.quotation_amount),
      quotationStatus: (r.quotation_status as string | null) ?? null,
      quotationValidUntil: r.quotation_valid_until
        ? new Date(r.quotation_valid_until as string).toISOString()
        : null,
      lastMessageBody: (r.last_message_body as string | null) ?? null,
      lastMessageAt: r.last_message_at
        ? new Date(r.last_message_at as string).toISOString()
        : null,
      lastMessageDirection:
        r.last_message_direction === 'inbound'
          ? ('inbound' as const)
          : r.last_message_direction === 'outbound'
            ? ('outbound' as const)
            : null,
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
/** One lead's full record — what the drawer needs beyond the list row. */
export interface CrmLeadFull {
  lead: CrmLeadRecord;
  notes: CrmLeadNote[];
  activity: CrmLeadEvent[];
  alsoEnquired: CrmLeadSibling[];
}

export async function getCrmLead(
  actorId: string,
  leadId: string,
): Promise<CrmLeadFull | null> {
  /* ⚠️ A malformed uuid reaches Postgres as a cast error — a 500 on a URL
     somebody mistyped, rather than the "no such lead" this returns. The route
     is the one input a person edits by hand. */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)) {
    return null;
  }

  return withUser(actorId, async (tx) => {
    const found = await tx`
      select l.id, l.project_id,
             /* A DEFINER READER, NOT A JOIN - migration 130. projects_select
                needs project MEMBERSHIP and a salesperson is not a member of
                the project whose leads they work, so an inner join here matched
                nothing and every salesperson got a 404 on every lead they
                owned. A LEFT JOIN would print a dash where the project belongs,
                on the one screen that exists to say where a lead came from. */
             app.crm_project_name(l.project_id) as project_name,
             l.full_name, l.phone, l.phone_e164, l.email, l.city,
             l.answers,
             l.stage::text, l.temperature::text, l.lost_reason::text,
             l.next_action, l.next_action_at,
             l.submitted_at, l.imported_at, l.first_contacted_at, l.closed_at,
             l.owner_id,
             f.name as form_name, c.name as campaign_name,
             l.source::text, l.external_id
        from public.crm_leads l
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
            select l.id, l.submitted_at, l.stage::text,
                   /* Same definer reader, same reason — migration 130. */
                   app.crm_project_name(l.project_id) as project_name,
                   f.name as form_name
              from public.crm_leads l
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
 * ⚠️ EMPTY FOR SOMEBODY WHO DOES NOT MANAGE THIS PROJECT, by migration 124's
 * guard inside the function rather than by a check here. Colleagues' win counts
 * and response times are the manager's view, not the team's.
 */
export async function crmProjectRoster(
  actorId: string,
  projectId: string,
): Promise<CrmSalesPerson[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from app.crm_project_roster(${projectId}::uuid)
  `);

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
export async function crmNextOwner(actorId: string, projectId: string): Promise<string | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select app.crm_next_owner(${projectId}::uuid) as id
  `);
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

/* ============================================================================
 * CLIENTS — Step 9
 * ========================================================================= */

/** Somebody who bought. `Won` is what makes one — see migration 126. */
export interface CrmClient {
  readonly id: string;
  readonly name: string;
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly city: string | null;
  /** When they FIRST came to us, across every lead of theirs. */
  readonly firstLeadAt: string | null;
  readonly convertedAt: string;
  /** How many leads they hold — the "Khurram · 16 Leads" figure. */
  readonly leadCount: number;
  readonly wonCount: number;
  readonly projects: readonly string[];
}

/**
 * The clients the caller can see.
 *
 * ⚠️ THROUGH MIGRATION 126'S READER, and the project names are the reason.
 * `projects_select` needs project membership, which the sales team does not
 * have — read directly the project column would be empty for exactly the people
 * whose job this is. Same trap as 125.
 *
 * ⚠️ VISIBILITY FOLLOWS THE LEADS, not a rule of its own: a salesperson sees the
 * clients they closed, a department manager sees their department's.
 */
export async function crmClients(actorId: string): Promise<CrmClient[]> {
  const rows = await withUser(actorId, (tx) => tx`select * from app.crm_client_list()`);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.full_name ?? 'Unnamed'),
    phoneE164: (r.phone_e164 as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    firstLeadAt: r.first_lead_at ? new Date(r.first_lead_at as string).toISOString() : null,
    convertedAt: new Date(r.converted_at as string).toISOString(),
    leadCount: Number(r.lead_count ?? 0),
    wonCount: Number(r.won_count ?? 0),
    projects: ((r.projects as string[] | null) ?? []).map(String),
  }));
}

/** What is owed on this project right now, for whoever is asking. */
export interface CrmDueCounts {
  readonly overdue: number;
  readonly dueToday: number;
  /** Open, owned, and with no next action set at all — nothing is planned. */
  readonly noPlan: number;
  /* ⚠️ THEY SPOKE LAST. Counted from the CONVERSATION, not from the follow-up
     date — a lead can have a tidy plan for Friday and an unanswered message from
     this morning, and it is the message that is running out of time. Meta's free
     window shuts 24 hours after they wrote. */
  readonly waitingForReply: number;
  /** Only set by `crmMyCounts` — the manager's desk has no "assigned to me". */
  readonly assigned?: number;
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
export async function crmDueCounts(
  actorId: string,
  /** Null for every project the caller may see — see `listCrmLeads`. */
  projectId: string | null,
): Promise<CrmDueCounts> {
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
      ) as no_plan,
      count(*) filter (
        where (select m.direction from public.crm_lead_messages m
                where m.lead_id = l.id
                order by m.occurred_at desc, m.id desc limit 1) = 'inbound'
      ) as waiting_for_reply
      from public.crm_leads l
     where (${projectId}::uuid is null or l.project_id = ${projectId}::uuid)
       and l.stage not in ('won', 'lost')
  `);

  const r = (rows as Array<Record<string, unknown>>)[0];
  return {
    overdue: Number(r?.overdue ?? 0),
    dueToday: Number(r?.due_today ?? 0),
    noPlan: Number(r?.no_plan ?? 0),
    waitingForReply: Number(r?.waiting_for_reply ?? 0),
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
  projectId: string | null,
): Promise<Array<{ id: string; name: string; leads: number }>> {
  /* ⚠️ THE SAME TRAP AS THE LIST, and it bit here too: this joined `users`, so
     under the sales manager's session every option came back with a null name.
     Counted from the leads, named through 121's reader. */
  const { counts, owners } = await withUser(actorId, async (tx) => {
    const counts = await tx`
      select l.owner_id, count(*) as leads
        from public.crm_leads l
       where (${projectId}::uuid is null or l.project_id = ${projectId}::uuid)
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

/* ==========================================================================
 * THE ROTA, WITH ITS REASONING — migration 133
 * ========================================================================== */

export interface CrmRotaRow {
  readonly userId: string;
  readonly name: string;
  readonly openLeads: number;
  readonly weightedLoad: number;
  /** ⚠️ Null means never measured — NOT fast. See migration 133. */
  readonly medianMinutes: number | null;
  readonly atWork: boolean;
  /** 999 means they have never acted on a lead at all. */
  readonly daysQuiet: number;
}

/**
 * Everybody who could take a lead on this project, best first, with every
 * number the ordering used.
 *
 * ⚠️ READ BEFORE ASSIGNING, NEVER AFTER. The moment a lead lands, the winner's
 * load has already changed — so an explanation built from a later read would
 * justify the decision with the figures the decision itself produced, which is
 * how a correct rota comes to look wrong to the person watching it.
 */
export async function crmLeadRota(actorId: string, projectId: string): Promise<CrmRotaRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from app.crm_lead_rota(${projectId}::uuid)
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    userId: String(r.user_id),
    name: String(r.full_name),
    openLeads: Number(r.open_leads ?? 0),
    weightedLoad: Number(r.weighted_load ?? 0),
    medianMinutes: r.median_minutes === null ? null : Number(r.median_minutes),
    atWork: r.at_work === true,
    daysQuiet: Number(r.days_quiet ?? 999),
  }));
}

/**
 * Two numbers that say "a lead has arrived", for the 25-second pulse.
 *
 * ⚠️ NO DEFINER, AND THAT IS THE POINT. `crm_leads_select` is a row-local
 * comparison — it does NOT need project membership, unlike `projects_select` —
 * so running this as the caller gives each person exactly the leads they may
 * see, with no second copy of the visibility rule to keep in step. A
 * salesperson's reading moves when a lead lands on THEIR desk; their manager's
 * moves when one lands anywhere on the project.
 *
 * ⚠️ MEASURED BEFORE SHIPPING, because this is paid every 25 seconds by every
 * open tab in the office: **0.65 ms, 92 buffers, all cache hits** over 647
 * leads. It is a Seq Scan and therefore linear — at fifty thousand leads it is
 * still single-digit milliseconds, but that is the number to re-measure rather
 * than assume. See docs/crm/09-DATABASE-MANAGEMENT.md.
 *
 * ⚠️ AND IT RETURNS NUMBERS, NEVER ROWS. This is fetched every 25 seconds by
 * every open tab. A name or a phone number in the answer would put a stranger's
 * details into a response nobody reads, on a timer, for the life of the tab —
 * the same reason `notificationPulse` returns a count and a timestamp and
 * nothing about the task.
 */
export async function crmLeadPulse(
  actorId: string,
): Promise<{ leads: number; latestLead: string | null }> {
  try {
    const rows = await withUser(actorId, (tx) => tx`
      select count(*)::int as leads, max(imported_at) as latest
        from public.crm_leads
    `);
    const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
    return {
      leads: Number(row.leads ?? 0),
      latestLead: row.latest ? new Date(row.latest as string).toISOString() : null,
    };
  } catch {
    /* ⚠️ Fails to a STABLE reading, not to zero. Zero would differ from the
       last one and trigger a refresh on every failed poll — turning a blip into
       a refresh loop on every open tab at once. */
    return { leads: -1, latestLead: null };
  }
}

/* ==========================================================================
 * THE MANAGER'S LIVE PICTURE — migration 135
 *
 * ⚠️ NOT STORED, and that is the distinction from `/lead-reports`. A frozen
 * report answers "what did we say in September". These answer "what is wrong
 * right now", and a snapshot is the wrong shape for that — correct and out of
 * date, which is worse than either.
 * ========================================================================== */

export interface CrmAttention {
  readonly overdue: number;
  readonly dueToday: number;
  readonly unassigned: number;
  /** ⚠️ Kept separate from overdue. A lead nobody ever rang is a different
   *  failure from one whose follow-up slipped. */
  readonly neverContacted: number;
  readonly goneQuiet: number;
}

/** Null when the caller does not manage this project — the function returns no
 *  row at all rather than a row of zeros, so the page can say whose screen it
 *  is instead of reporting a reassuring nothing. */
export async function crmLeadAttention(
  actorId: string,
  projectId: string,
): Promise<CrmAttention | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from app.crm_lead_attention(${projectId}::uuid)
  `);
  const r = (rows as Array<Record<string, unknown>>)[0];
  if (!r) return null;
  return {
    overdue: Number(r.overdue ?? 0),
    dueToday: Number(r.due_today ?? 0),
    unassigned: Number(r.unassigned ?? 0),
    neverContacted: Number(r.never_contacted ?? 0),
    goneQuiet: Number(r.gone_quiet ?? 0),
  };
}

export interface CrmArrival {
  readonly date: string;
  readonly arrived: number;
  readonly contacted: number;
}

/** Leads per day, and how many of that day's intake was ever answered. */
export async function crmLeadArrivals(
  actorId: string,
  projectId: string,
  days = 14,
): Promise<CrmArrival[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from app.crm_lead_arrivals(${projectId}::uuid, ${days})
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    date: String(r.on_date).slice(0, 10),
    arrived: Number(r.arrived ?? 0),
    contacted: Number(r.contacted ?? 0),
  }));
}

export interface CrmMyDay {
  readonly openTotal: number;
  readonly overdue: number;
  readonly dueToday: number;
  readonly neverContacted: number;
  readonly goneQuiet: number;
  readonly wonTotal: number;
  /** ⚠️ Null means never measured, NOT fast. Renders as "no calls yet". */
  readonly medianMinutes: number | null;
}

/**
 * One salesperson's own leads on one project, plus their own response time.
 *
 * ⚠️ THE RESPONSE TIME IS RETURNED ON PURPOSE. It is the number their manager
 * judges them on — the first column of the sales team panel, and signal 1 of
 * the rota. Somebody who cannot see the measure applied to them cannot improve
 * it, and learning at an appraisal what has been on a screen for months is the
 * worst version of this product.
 */
export async function crmMyDay(actorId: string, projectId: string): Promise<CrmMyDay | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from app.crm_my_day(${projectId}::uuid)
  `);
  const r = (rows as Array<Record<string, unknown>>)[0];
  if (!r) return null;
  return {
    openTotal: Number(r.open_total ?? 0),
    overdue: Number(r.overdue ?? 0),
    dueToday: Number(r.due_today ?? 0),
    neverContacted: Number(r.never_contacted ?? 0),
    goneQuiet: Number(r.gone_quiet ?? 0),
    wonTotal: Number(r.won_total ?? 0),
    /* ⚠️ NOT `Number(x ?? 0)`. That would turn "never measured" into "instant",
       which is the single most flattering possible misreading of no data. */
    medianMinutes: r.median_minutes === null || r.median_minutes === undefined
      ? null
      : Number(r.median_minutes),
  };
}

export interface CrmLeadInsight {
  readonly summary: string;
  readonly talkingPoints: string[];
  readonly draftMessage: string | null;
  readonly generatedAt: string;
  readonly model: string;
  /** ⚠️ False when the lead has moved since — the panel then offers a refresh
   *  rather than quietly showing advice about a stage the lead has left. */
  readonly current: boolean;
}

/**
 * The cached AI reading, and whether it still matches the lead.
 *
 * ⚠️ NEVER GENERATES. This is a read; producing one costs money and happens
 * only when somebody presses the button — see `app/actions/crm-lead-ai.ts`.
 */
export async function crmLeadInsight(
  actorId: string,
  leadId: string,
  currentFingerprint: string,
): Promise<CrmLeadInsight | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select summary, talking_points, draft_message, generated_at, model, source_fingerprint
      from public.crm_lead_insights where lead_id = ${leadId}::uuid
  `);
  const r = (rows as Array<Record<string, unknown>>)[0];
  if (!r) return null;
  return {
    summary: String(r.summary),
    talkingPoints: Array.isArray(r.talking_points)
      ? (r.talking_points as unknown[]).filter((p): p is string => typeof p === 'string')
      : [],
    draftMessage: (r.draft_message as string | null) ?? null,
    generatedAt: new Date(r.generated_at as string).toISOString(),
    model: String(r.model),
    current: r.source_fingerprint === currentFingerprint,
  };
}

/* ==========================================================================
 * THE WHATSAPP THREAD — migration 138
 * ========================================================================== */

export interface CrmMessage {
  readonly id: string;
  readonly direction: 'inbound' | 'outbound';
  readonly kind: string;
  readonly body: string | null;
  readonly mediaId: string | null;
  readonly mediaMime: string | null;
  readonly mediaFilename: string | null;
  readonly status: string | null;
  readonly errorDetail: string | null;
  readonly sentByName: string | null;
  readonly occurredAt: string;
}

/**
 * One lead's conversation, oldest first.
 *
 * ⚠️ NO EXPLICIT OWNER CHECK, AND THAT IS CORRECT. `crm_lead_messages_select`
 * delegates to the lead by EXISTS, so a salesperson querying a colleague's
 * thread gets zero rows from the database rather than being refused by a line
 * of TypeScript. Restating the rule here would be the sixth copy of a predicate
 * that has already cost five migrations.
 *
 * ⚠️ THE SENDER'S NAME COMES FROM `app.crm_lead_owners()` (121), NOT A JOIN TO
 * `users`. A salesperson sees ONE row of that table — their own — so a plain
 * join renders every colleague as "Former member", which is the 2026-09-08 bug
 * that migration 121 exists to prevent.
 *
 * ⚠️ AND I FIRST WROTE `app.crm_owner_name`, WHICH DOES NOT EXIST. `tsc` passed,
 * because SQL inside a template literal is a string to TypeScript — the exact
 * trap `lib/db/queries` has hit before. The function was checked against
 * `pg_proc` rather than assumed.
 */
export async function crmLeadThread(actorId: string, leadId: string): Promise<CrmMessage[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select m.id, m.direction::text, m.kind::text, m.body,
           m.media_id, m.media_mime, m.media_filename,
           m.status::text, m.error_detail, m.occurred_at,
           (select o.full_name from app.crm_lead_owners() o where o.id = m.sent_by_id)
             as sent_by_name
      from public.crm_lead_messages m
     where m.lead_id = ${leadId}::uuid
     order by m.occurred_at asc
     limit 500
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    direction: r.direction === 'inbound' ? 'inbound' : 'outbound',
    kind: String(r.kind),
    body: (r.body as string | null) ?? null,
    mediaId: (r.media_id as string | null) ?? null,
    mediaMime: (r.media_mime as string | null) ?? null,
    mediaFilename: (r.media_filename as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    errorDetail: (r.error_detail as string | null) ?? null,
    sentByName: (r.sent_by_name as string | null) ?? null,
    occurredAt: new Date(r.occurred_at as string).toISOString(),
  }));
}

/**
 * Can this project send at all? Decides whether the composer is drawn, and
 * whether the WhatsApp buttons open OUR thread or fall back to `wa.me`.
 *
 * ⚠️ THROUGH A DEFINER, NOT `public.projects` — migration 140, and the sixth
 * time this exact shape has bitten. `projects_select` needs project MEMBERSHIP
 * and a salesperson is a member of nothing, so the direct read returned zero
 * rows for the entire sales team. Zero rows reads as `false`, `false` means
 * "cannot send", and "cannot send" pointed every salesperson at `wa.me` — their
 * own handset, off the record. An Admin sees every project, so it worked
 * perfectly in the only session anybody had tested it from.
 */
export async function crmProjectCanWhatsApp(actorId: string, projectId: string): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    select app.crm_project_can_whatsapp(${projectId}::uuid) as ready
  `);
  return (rows as Array<Record<string, unknown>>)[0]?.ready === true;
}

/* ============================================================================
 * ONE MESSAGE'S ATTACHMENT — Step 8
 * ----------------------------------------------------------------------------
 * ⚠️ RLS IS THE WHOLE PERMISSION CHECK, AND THAT IS DELIBERATE. 138's select
 * policy on `crm_lead_messages` delegates to the lead, so somebody who may not
 * read the lead gets no row and the route answers 404 — the same 404 a message
 * that does not exist gets. There is no second check written by hand here to
 * drift out of step with the policy, and no way to probe which ids exist.
 * ========================================================================= */
export interface CrmMessageMedia {
  readonly mediaId: string;
  readonly mime: string | null;
  readonly filename: string | null;
  readonly projectId: string;
}

export async function crmMessageMedia(
  actorId: string,
  messageId: string,
): Promise<CrmMessageMedia | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select m.media_id, m.media_mime, m.media_filename, l.project_id
      from public.crm_lead_messages m
      join public.crm_leads l on l.id = m.lead_id
     where m.id = ${messageId}::uuid
       and m.media_id is not null
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  return {
    mediaId: String(row.media_id),
    mime: (row.media_mime as string | null) ?? null,
    filename: (row.media_filename as string | null) ?? null,
    projectId: String(row.project_id),
  };
}

/* ============================================================================
 * WHAT IS MINE — the figures on `/my-leads`
 * ----------------------------------------------------------------------------
 * ⚠️ THE SAME ARITHMETIC AS `crmDueCounts`, WITH ONE EXTRA CLAUSE, and it is
 * deliberately the same SQL rather than a tidier rewrite. Two screens counting
 * "overdue" slightly differently is how somebody comes to distrust both — and
 * the person most likely to notice the discrepancy is the one being measured by
 * it. If the definition changes it must change in both, and they are next to
 * each other so that is hard to forget.
 *
 * ⚠️ `owner_id = app.current_user_id()`, NOT `actorId` INTERPOLATED. The session
 * already knows who is asking; passing the id in as a parameter would let a
 * caller ask for somebody else's figures and get them, because RLS permits a
 * MANAGER to read the whole department.
 * ========================================================================= */
export async function crmMyCounts(
  actorId: string,
  projectId: string | null,
): Promise<CrmDueCounts> {
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
      count(*) filter (where l.next_action_at is null) as no_plan,
      count(*) filter (
        where (select m.direction from public.crm_lead_messages m
                where m.lead_id = l.id
                order by m.occurred_at desc, m.id desc limit 1) = 'inbound'
      ) as waiting_for_reply,
      count(*) as assigned
      from public.crm_leads l
     where l.owner_id = app.current_user_id()
       and (${projectId}::uuid is null or l.project_id = ${projectId}::uuid)
       and l.stage not in ('won', 'lost')
  `);

  const r = (rows as Array<Record<string, unknown>>)[0];
  return {
    overdue: Number(r?.overdue ?? 0),
    dueToday: Number(r?.due_today ?? 0),
    noPlan: Number(r?.no_plan ?? 0),
    waitingForReply: Number(r?.waiting_for_reply ?? 0),
    assigned: Number(r?.assigned ?? 0),
  };
}

/* ============================================================================
 * THE DRAWER'S RELATED ITEMS — quotations, appointments, follow-ups
 * ----------------------------------------------------------------------------
 * ⚠️ ONE ROUND TRIP, NOT FOUR. The drawer opens over a list somebody is already
 * reading; four sequential awaits to Singapore is most of a second of a blank
 * panel. Each of these is small and none depends on another.
 *
 * ⚠️ AND EVERY ONE IS RLS-SCOPED THE SAME WAY — each child table's policy
 * delegates to `crm_leads`, so a lead the caller may not read returns four empty
 * lists rather than a refusal. That is the same answer "no such lead" gives, and
 * it is deliberate: a drawer that errors differently for "not yours" than for
 * "does not exist" is a way to probe which ids are real.
 * ========================================================================= */
export interface CrmQuotationRow {
  readonly id: string;
  readonly number: string;
  readonly version: number;
  readonly status: string;
  readonly netAmount: number;
  readonly requestedDiscount: number;
  readonly approvedDiscount: number;
  readonly validUntil: string | null;
  readonly propertyLabel: string | null;
  readonly preparedByName: string | null;
  readonly approvedByName: string | null;
  readonly createdAt: string;
}

export interface CrmAppointmentRow {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly location: string | null;
  readonly outcome: string | null;
  readonly ownerName: string | null;
}

export interface CrmFollowUpRow {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly channel: string;
  readonly status: string;
  readonly dueAt: string;
  readonly doneAt: string | null;
  readonly outcomeNote: string | null;
}

export interface CrmLeadRelated {
  readonly quotations: readonly CrmQuotationRow[];
  readonly appointments: readonly CrmAppointmentRow[];
  readonly followUps: readonly CrmFollowUpRow[];
  /** The live sequence run, if any — state, step, and why it paused. */
  readonly sequence: {
    readonly name: string;
    readonly state: string;
    readonly step: number;
    readonly total: number;
    readonly pauseReason: string | null;
  } | null;
}

export async function crmLeadRelated(
  actorId: string,
  leadId: string,
): Promise<CrmLeadRelated> {
  const { quotations, appointments, followUps, sequence, owners } = await withUser(
    actorId,
    async (tx) => {
      const [quotations, appointments, followUps, sequence, owners] = await Promise.all([
        tx`
          select q.id, q.number, q.version, q.status::text, q.net_amount,
                 q.requested_discount, q.approved_discount, q.valid_until,
                 q.prepared_by_id, q.approved_by_id, q.created_at,
                 concat_ws(', ', p.plot_number,
                   case when p.block is not null then 'Block ' || p.block end) as property_label
            from public.crm_quotations q
            left join public.crm_properties p on p.id = q.property_id
           where q.lead_id = ${leadId}::uuid
           order by q.number, q.version desc
        `,
        tx`
          select a.id, a.kind::text, a.status::text, a.scheduled_at,
                 a.duration_minutes, a.location, a.outcome, a.owner_id
            from public.crm_appointments a
           where a.lead_id = ${leadId}::uuid
           order by a.scheduled_at desc
        `,
        tx`
          select f.id, f.title, f.purpose::text, f.channel::text, f.status::text,
                 f.due_at, f.done_at, f.outcome_note
            from public.crm_follow_ups f
           where f.lead_id = ${leadId}::uuid
           order by f.due_at desc
        `,
        tx`
          select s.name, ls.state::text, ls.current_step, ls.total_steps, ls.pause_reason
            from public.crm_lead_sequences ls
            join public.crm_sequences s on s.id = ls.sequence_id
           where ls.lead_id = ${leadId}::uuid
             and ls.state in ('scheduled', 'active', 'paused')
           limit 1
        `,
        /* ⚠️ NAMES THROUGH 121'S READER, NEVER A JOIN TO `users`. The sales
           manager is a `member`, so a join returns one row — their own — and
           every colleague renders as "Former member". That was the 2026-09-08
           bug and it has been re-found on four screens since. */
        tx`select * from app.crm_lead_owners()`,
      ]);
      return { quotations, appointments, followUps, sequence, owners };
    },
  );

  const names = new Map<string, string>();
  for (const o of owners as Array<Record<string, unknown>>) {
    names.set(String(o.id), String(o.full_name ?? 'Unnamed'));
  }
  const nameOf = (id: unknown) => (id ? (names.get(String(id)) ?? null) : null);

  return {
    quotations: (quotations as Array<Record<string, unknown>>).map((q) => ({
      id: String(q.id),
      number: String(q.number),
      version: Number(q.version),
      status: String(q.status),
      netAmount: Number(q.net_amount),
      requestedDiscount: Number(q.requested_discount ?? 0),
      approvedDiscount: Number(q.approved_discount ?? 0),
      validUntil: q.valid_until ? new Date(q.valid_until as string).toISOString() : null,
      propertyLabel: (q.property_label as string | null) || null,
      preparedByName: nameOf(q.prepared_by_id),
      approvedByName: nameOf(q.approved_by_id),
      createdAt: new Date(q.created_at as string).toISOString(),
    })),
    appointments: (appointments as Array<Record<string, unknown>>).map((a) => ({
      id: String(a.id),
      kind: String(a.kind),
      status: String(a.status),
      scheduledAt: new Date(a.scheduled_at as string).toISOString(),
      durationMinutes: Number(a.duration_minutes ?? 60),
      location: (a.location as string | null) ?? null,
      outcome: (a.outcome as string | null) ?? null,
      ownerName: nameOf(a.owner_id),
    })),
    followUps: (followUps as Array<Record<string, unknown>>).map((f) => ({
      id: String(f.id),
      title: String(f.title),
      purpose: String(f.purpose),
      channel: String(f.channel),
      status: String(f.status),
      dueAt: new Date(f.due_at as string).toISOString(),
      doneAt: f.done_at ? new Date(f.done_at as string).toISOString() : null,
      outcomeNote: (f.outcome_note as string | null) ?? null,
    })),
    sequence: (() => {
      const s = (sequence as Array<Record<string, unknown>>)[0];
      if (!s) return null;
      return {
        name: String(s.name),
        state: String(s.state),
        step: Number(s.current_step ?? 0),
        total: Number(s.total_steps ?? 0),
        pauseReason: (s.pause_reason as string | null) ?? null,
      };
    })(),
  };
}

/* ============================================================================
 * ADDING A LEAD BY HAND
 * ----------------------------------------------------------------------------
 * Both of these go through SECURITY DEFINER functions (migration 158), and not
 * for convenience:
 *
 *   · a salesperson CANNOT insert into crm_leads — the policy from 124 requires
 *     crm_manages_project, so the whole feature is refused by RLS as it stands
 *   · a salesperson CANNOT insert into crm_lead_assignments either (154), which
 *     is deliberate: a row written by hand would be a claim about a decision
 *     nobody made
 *
 * ⚠️ AND NEITHER OF THESE PASSES AN OWNER. The database function has no such
 * argument. The rule "a salesperson must not choose who gets the lead" is
 * enforced by a signature nobody can forget rather than by a check somebody can
 * skip on a second call site.
 * ========================================================================= */

export interface CrmDuplicate {
  /** 'lead' — an enquiry that exists. 'client' — somebody who already bought. */
  readonly kind: 'lead' | 'client';
  readonly id: string;
  readonly name: string;
  /** Null for a client: they belong to no single project. */
  readonly projectName: string | null;
  readonly sameProject: boolean;
  readonly stage: string | null;
  readonly isOpen: boolean;
  /** Null when the lead is unassigned or its owner has left. */
  readonly ownerName: string | null;
  /**
   * ⚠️ Answers "is this mine?" without handing over an id. "You already have
   * this person" and "a colleague does" lead to different buttons, and a boolean
   * discloses strictly less than the owner name already beside it.
   */
  readonly isMine: boolean;
  readonly matchedOn: string;
  readonly lastSeenAt: string | null;
}

/**
 * Do we already know this person?
 *
 * ⚠️ THIS SEES ACROSS THE OWNERSHIP BOUNDARY AND IT IS MEANT TO. Sarah cannot
 * read Sahad's leads, which is the whole point of the row-level rules — but if
 * she cannot be TOLD one exists, she types it in again, two people ring one
 * client, and the client decides nobody here talks to each other.
 *
 * What comes back is the minimum that stops her: a name, a stage, an owner and a
 * project. No phone, no email, no notes, no budget, no quotation.
 */
export async function crmLeadDuplicates(
  actorId: string,
  projectId: string,
  phoneE164: string | null,
  email: string | null,
): Promise<CrmDuplicate[]> {
  if (!phoneE164 && !email) return [];

  const rows = await withUser(actorId, (tx) => tx`
    select * from app.crm_lead_duplicates(
      ${projectId}::uuid, ${phoneE164}::text, ${email}::text)
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    kind: String(r.kind) === 'client' ? ('client' as const) : ('lead' as const),
    id: String(r.ref_id),
    name: String(r.full_name ?? 'Unnamed'),
    projectName: (r.project_name as string | null) ?? null,
    sameProject: r.same_project === true,
    stage: (r.stage as string | null) ?? null,
    isOpen: r.is_open === true,
    ownerName: (r.owner_name as string | null) ?? null,
    isMine: r.is_mine === true,
    matchedOn: String(r.matched_on ?? 'phone'),
    lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as string).toISOString() : null,
  }));
}

export interface CrmNewLead {
  readonly projectId: string;
  readonly fullName: string;
  /** Exactly as they typed it. Kept because it is what they wrote. */
  readonly phone: string | null;
  /** Derived by toE164 in lib/domain/phone. Null when it could not be parsed. */
  readonly phoneE164: string | null;
  readonly email: string | null;
  readonly city: string | null;
  readonly source: string;
  readonly sourceDetail: string | null;
  readonly enquiry: string | null;
  readonly propertyId: string | null;
  readonly budget: number | null;
  /** ⚠️ Three states. Null means nobody asked, which is not the same as no. */
  readonly whatsappConsent: boolean | null;
  readonly preferredChannel: string | null;
  readonly preferredTime: string | null;
  readonly nextAction: string | null;
  readonly nextActionAt: string | null;
  readonly nextActionType: string | null;
  /** Only ever gets past a CLOSED duplicate, or one already theirs. */
  readonly allowDuplicate: boolean;
}

export interface CrmCreatedLead {
  readonly id: string;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly why: string | null;
}

/**
 * Create the lead and let the rota own it.
 *
 * ⚠️ THE RETURN CARRIES WHO GOT IT AND WHY, read back from the assignment row
 * the function itself wrote. Building that sentence here from a second query
 * would justify the decision with figures the decision had already changed —
 * the same trap crmLeadRota's comment describes.
 */
export async function crmCreateLead(
  actorId: string,
  input: CrmNewLead,
): Promise<CrmCreatedLead> {
  return withUser(actorId, async (tx) => {
    const created = await tx`
      select app.crm_create_lead(
        ${input.projectId}::uuid,
        ${input.fullName}::text,
        ${input.phone}::text,
        ${input.phoneE164}::text,
        ${input.email}::text,
        ${input.city}::text,
        ${input.source}::public.crm_lead_source,
        ${input.sourceDetail}::text,
        ${input.enquiry}::text,
        ${input.propertyId}::uuid,
        ${input.budget}::bigint,
        ${input.whatsappConsent}::boolean,
        ${input.preferredChannel}::public.crm_followup_channel,
        ${input.preferredTime}::text,
        ${input.nextAction}::text,
        ${input.nextActionAt}::timestamptz,
        ${input.nextActionType}::public.crm_next_action_kind,
        ${input.allowDuplicate}::boolean
      ) as id`;

    const id = String((created as Array<Record<string, unknown>>)[0]?.id ?? '');

    const why = await tx`
      select a.reason_text, a.to_user_id, u.full_name as owner_name
        from public.crm_lead_assignments a
        left join public.users u on u.id = a.to_user_id
       where a.lead_id = ${id}::uuid
       order by a.assigned_at desc
       limit 1`;
    const w = (why as Array<Record<string, unknown>>)[0];

    return {
      id,
      ownerId: (w?.to_user_id as string | null) ?? null,
      ownerName: (w?.owner_name as string | null) ?? null,
      why: (w?.reason_text as string | null) ?? null,
    };
  });
}

export interface CrmAddLeadProject {
  readonly id: string;
  readonly name: string;
}

/**
 * The projects this person may add a lead to.
 *
 * ⚠️ THROUGH A DEFINER (159), NOT A QUERY ON `projects` — the seventh instance
 * of the bug 125 already documented. `projects_select` needs project MEMBERSHIP,
 * which the sales team do not have, so RLS empties the result before the
 * department clause is ever evaluated. Written the obvious way this returned
 * ZERO projects for both salespeople and the Add Lead form could not be used at
 * all; it was measured by scripts/check-add-lead.mjs, not reasoned about, because
 * an Admin session sees a picker that works perfectly.
 *
 * ⚠️ NOT "every project" either — the definer asks the same question the write
 * will. A form that lists a choice and then rejects it on submit is worse than
 * one that never offered it.
 */
export async function crmAddLeadProjects(actorId: string): Promise<CrmAddLeadProject[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select * from app.crm_add_lead_projects()
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name),
  }));
}

export interface CrmPropertyOption {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly price: number | null;
}

/**
 * The catalogue for one project, for the Add Lead picker.
 *
 * ⚠️ THE SAME LABEL THE ROW SHOWS, built by the same expression as the list
 * query's `prop` lateral. A picker that says "5 Marla Residential" where the
 * table says "5 Marla · A-101" makes somebody check whether they chose the right
 * one, every time.
 *
 * ⚠️ SOLD UNITS ARE STILL LISTED, and that is deliberate. A lead may well be
 * enquiring about the plot next to one that sold; hiding them makes the numbers
 * in the catalogue stop matching the numbers on the wall. The status is returned
 * so the option can say so.
 */
export async function crmProjectProperties(
  actorId: string,
  projectId: string,
): Promise<CrmPropertyOption[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select
      p.id,
      p.status::text as status,
      p.base_price,
      concat_ws(' · ',
        nullif(concat_ws(' ',
          case when p.size_marla is not null
               then trim(trailing '.' from to_char(p.size_marla, 'FM999999.99'))
                    || ' Marla' end,
          initcap(substring(p.kind from '[^ ]+$'))), ''),
        nullif(concat_ws(', ', p.plot_number,
          case when p.block is not null then 'Block ' || p.block end), '')
      ) as label
      from public.crm_properties p
     where p.project_id = ${projectId}::uuid
     order by p.block nulls last, p.plot_number nulls last
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    label: String(r.label ?? 'Unnamed unit'),
    status: String(r.status ?? 'available'),
    price: r.base_price === null ? null : Number(r.base_price),
  }));
}

/* ============================================================================
 * APPOINTMENTS — Phase E
 * ----------------------------------------------------------------------------
 * ⚠️ NO DEFINER HERE, AND THAT IS CORRECT. `crm_appointments_write` (152) is a
 * row-local check — *you may write an appointment on a lead you can read* — and
 * needs no project membership, unlike `projects_select`. So these run as the
 * caller and RLS answers exactly as it should: a salesperson books on their own
 * leads and nobody else's, with no second copy of the visibility rule to keep in
 * step. Compare `crmAddLeadProjects`, which genuinely needed one.
 * ========================================================================= */

export interface CrmDiaryEntry {
  readonly id: string;
  readonly leadId: string;
  readonly leadName: string | null;
  readonly kind: string;
  readonly status: string;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly location: string | null;
  readonly propertyLabel: string | null;
  readonly outcome: string | null;
}

/**
 * What else is already in this person's diary around a given moment.
 *
 * ⚠️ READ BEFORE BOOKING, so the form can say "you already have something then"
 * while somebody can still change it. A window either side rather than the exact
 * slot, because a clash is about SPANS overlapping — see `clashesWith`.
 */
export async function crmDiaryAround(
  actorId: string,
  aroundIso: string,
  hours = 12,
): Promise<CrmDiaryEntry[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.id, a.lead_id, a.kind::text, a.status::text, a.scheduled_at,
           a.duration_minutes, a.location, a.outcome,
           l.full_name as lead_name
      from public.crm_appointments a
      join public.crm_leads l on l.id = a.lead_id
     where a.owner_id = app.current_user_id()
       and a.scheduled_at between ${aroundIso}::timestamptz - make_interval(hours => ${hours})
                              and ${aroundIso}::timestamptz + make_interval(hours => ${hours})
     order by a.scheduled_at
  `);
  return (rows as Array<Record<string, unknown>>).map(toDiaryEntry);
}

/**
 * This person's upcoming appointments — the "Today's plan" rail.
 *
 * ⚠️ FROM THE START OF TODAY IN KARACHI, not from `now()`. A visit at 9am is
 * still today's business at 10am, and a rail that dropped it the moment it began
 * would empty itself over the course of the morning — which is exactly when
 * somebody is looking at it.
 */
export async function crmMyDiary(actorId: string, days = 7): Promise<CrmDiaryEntry[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.id, a.lead_id, a.kind::text, a.status::text, a.scheduled_at,
           a.duration_minutes, a.location, a.outcome,
           l.full_name as lead_name,
           (select concat_ws(' · ',
              nullif(concat_ws(' ',
                case when p.size_marla is not null
                     then trim(trailing '.' from to_char(p.size_marla, 'FM999999.99')) || ' Marla' end,
                initcap(substring(p.kind from '[^ ]+$'))), ''),
              nullif(concat_ws(', ', p.plot_number,
                case when p.block is not null then 'Block ' || p.block end), ''))
            from public.crm_properties p where p.id = a.property_id) as property_label
      from public.crm_appointments a
      join public.crm_leads l on l.id = a.lead_id
     where a.owner_id = app.current_user_id()
       and a.status not in ('cancelled', 'rescheduled')
       and a.scheduled_at >= date_trunc('day', now() at time zone 'Asia/Karachi') at time zone 'Asia/Karachi'
       and a.scheduled_at < (date_trunc('day', now() at time zone 'Asia/Karachi') + make_interval(days => ${days})) at time zone 'Asia/Karachi'
     order by a.scheduled_at
     limit 100
  `);
  return (rows as Array<Record<string, unknown>>).map(toDiaryEntry);
}

function toDiaryEntry(r: Record<string, unknown>): CrmDiaryEntry {
  return {
    id: String(r.id),
    leadId: String(r.lead_id),
    leadName: (r.lead_name as string | null) ?? null,
    kind: String(r.kind),
    status: String(r.status),
    scheduledAt: new Date(r.scheduled_at as string).toISOString(),
    durationMinutes: Number(r.duration_minutes ?? 60),
    location: (r.location as string | null) ?? null,
    propertyLabel: (r.property_label as string | null) ?? null,
    outcome: (r.outcome as string | null) ?? null,
  };
}

export interface BookAppointment {
  readonly leadId: string;
  readonly kind: string;
  readonly scheduledAt: string;
  readonly durationMinutes: number;
  readonly location: string | null;
  readonly note: string | null;
}

/**
 * Put it in the diary.
 *
 * ⚠️ THE PROJECT AND THE OWNER COME FROM THE LEAD, NOT FROM THE CALLER. Both are
 * columns on `crm_appointments` and both could have been arguments — and then a
 * client could book a visit on their own lead into somebody else's diary, or
 * file it under a project the lead does not belong to. Reading them from the
 * lead row, inside the same transaction, is what makes those two states
 * unreachable rather than merely unlikely.
 *
 * ⚠️ AND THE PROPERTY COMES FROM THE LEAD TOO. A site visit is to the unit the
 * lead is asking about; letting the caller name a different one would produce a
 * visit to a plot nobody discussed.
 */
export async function crmBookAppointment(
  actorId: string,
  input: BookAppointment,
): Promise<{ id: string } | null> {
  return withUser(actorId, async (tx) => {
    const rows = await tx`
      insert into public.crm_appointments
        (lead_id, project_id, property_id, kind, scheduled_at, duration_minutes,
         location, notes, owner_id, created_by_id, is_test_data)
      select l.id, l.project_id, l.property_id,
             ${input.kind}::public.crm_appointment_kind,
             ${input.scheduledAt}::timestamptz,
             ${input.durationMinutes}::int,
             ${input.location}::text,
             ${input.note}::text,
             /* ⚠️ The LEAD'S owner, so it lands in the diary of whoever has to
                turn up. A manager booking on somebody's behalf books it for
                them, which is the only reading that makes a rail useful. */
             l.owner_id,
             ${actorId}::uuid,
             l.is_test_data
        from public.crm_leads l
       where l.id = ${input.leadId}::uuid
      returning id`;

    /* ⚠️ ZERO ROWS MEANS RLS REFUSED THE LEAD, not that something broke. The
       insert...select simply selects nothing when the lead is not visible, so
       there is no exception to catch — the same shape `setLeadStage` documents,
       and the reason this returns null rather than throwing. */
    const id = (rows as Array<Record<string, unknown>>)[0]?.id;
    if (!id) return null;

    await tx`
      insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at, detail)
      values (
        ${input.leadId}::uuid, ${actorId}::uuid, 'next_action_set', now(),
        ${tx.json({
          appointment: String(id),
          kind: input.kind,
          at: input.scheduledAt,
          location: input.location,
        })}
      )`;

    return { id: String(id) };
  });
}

/**
 * Record what happened at one.
 *
 * ⚠️ `outcome_at` IS SET HERE AND NOT BY THE CALLER — migration 152 refuses a
 * completed appointment without one, and a caller that forgot it would get a
 * check violation rather than a helpful refusal. The database's rule and this
 * function's behaviour are the same rule, stated once each.
 */
export async function crmCloseAppointment(
  actorId: string,
  appointmentId: string,
  status: 'completed' | 'no_show' | 'cancelled',
  outcome: string | null,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_appointments
       set status = ${status}::public.crm_appointment_status,
           outcome = ${outcome}::text,
           /* ⚠️ DECIDED IN SQL, NOT INTERPOLATED. A ternary that yields the
              string now() would send it as a literal, and Postgres cannot parse
              that as a timestamp — so every completion would have failed with a
              cast error. (The bare word now, without brackets, WOULD have parsed
              and meant something subtly different, which is worse.)

              ⚠️ AND NO BACKTICKS IN THIS COMMENT. This file is one template
              literal; a stray backtick ends the string and the error surfaces
              hundreds of lines away as a missing comma. It has happened five
              times here, including inside the comment warning about it.

              Cancelled carries no time because 152 only demands one for
              completed and no_show. */
           outcome_at = case when ${status}::text = 'cancelled' then null else now() end,
           updated_at = now()
     where id = ${appointmentId}::uuid
     returning id`);
  return (rows as unknown[]).length > 0;
}
