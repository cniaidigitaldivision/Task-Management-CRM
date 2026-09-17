import 'server-only';

import { withUser, type Tx } from '../client';
import { needsApproval, netAmount, nextQuotationNumber } from '@/lib/domain/crm-quotations';

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
  /**
   * property | service | mixed — migration 174's resolver.
   *
   * ⚠️ ON THE ROW SO THE DRAWER CAN DRAW ITS LIFECYCLE BEFORE THE RECORD
   * ARRIVES. A service lead has no Visit step; drawing the property strip
   * from the row and then redrawing it one step shorter on arrival was the
   * last visible jump left between click and loaded. Measured 2026-09-17:
   * resolving it for all 671 leads is lost in the noise of the two definers
   * this query already calls per row.
   */
  readonly sells: string;
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
  /** The unit they are asking about, if one has been attached. */
  readonly propertyId: string | null;
  readonly propertyLabel: string | null;
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
  /* ── Qualification · migration 167 ────────────────────────────────────────
     ⚠️ NULL AND "unknown" ARE DIFFERENT AND BOTH ARE REAL. NULL means nobody
     asked; `unknown` / `not_disclosed` mean asked and not answered, which is
     information. The gate in front of `qualified` refuses the first and accepts
     the second. */
  readonly budgetBand: string | null;
  readonly authority: string | null;
  readonly purpose: string | null;
  readonly timeline: string | null;
  readonly paymentMode: string | null;
  readonly locationPreference: string | null;
  readonly qualificationNote: string | null;
  readonly budget: number | null;
  readonly qualifiedAt: string | null;
  /* ⚠️ WHICH QUESTIONS THIS LEAD NEEDS — migration 174. Resolved server-side from
     the attached item, then the campaign it arrived on, then the project. The
     drawer must never re-derive it: a second opinion about whether somebody is
     buying a plot or an ERP is a second set of questions. */
  readonly sells: string;
  /** call · whatsapp · email · meeting · site_visit · task. Drives the channel
   *  chip on the Next action card. */
  readonly nextActionType: string | null;
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
             app.crm_lead_sells(l.id)::text as sells,
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
             and m.hidden_at is null
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
      sells: String(r.sells ?? 'property'),
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

  return withUser(actorId, async (tx) =>
    (await readCrmLeads(tx, [leadId], readOwnerNames(tx))).get(leadId) ?? null,
  );
}

/** The owners' names, once per transaction — 121's reader, made fast by 181. */
type OwnerNames = Map<string, string>;

async function readOwnerNames(tx: Tx): Promise<OwnerNames> {
  const rows = await tx`select id, full_name from app.crm_lead_owners()`;
  const names: OwnerNames = new Map();
  for (const o of rows as Array<Record<string, unknown>>) {
    names.set(String(o.id), String(o.full_name ?? 'Unnamed'));
  }
  return names;
}

/**
 * Several leads' records in FIVE queries, however many leads.
 *
 * ⚠️ SET-BASED, AND THAT IS THE WHOLE POINT. The per-lead version ran five
 * queries per lead; inside one transaction they run one after another on one
 * connection, so ten leads were fifty round trips. Here every table is read once
 * with `= any(ids)` and the rows are sorted into leads in memory.
 *
 * Notes and activity still go through their definer readers (they exist because
 * a salesperson cannot join `users`), called once per lead SERVER-SIDE through a
 * lateral join — one round trip, not one per lead.
 */
async function readCrmLeads(
  tx: Tx,
  ids: readonly string[],
  namesP: Promise<OwnerNames>,
): Promise<Map<string, CrmLeadFull>> {
  const out = new Map<string, CrmLeadFull>();
  if (ids.length === 0) return out;
  const idList = ids as unknown as string[];

  const [found, noteRows, activityRows, siblingRows, names] = await Promise.all([
    tx`
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
             l.source::text, l.external_id,
             l.property_id,
             /* Qualification · 167. In the same select, so opening the drawer
                costs no extra wait — Rule Zero, law 4. */
             l.budget_band::text, l.authority::text, l.purpose::text,
             l.timeline::text, l.payment_mode::text,
             l.location_preference, l.qualification_note, l.budget,
             l.qualified_at,
             app.crm_lead_sells(l.id)::text as sells,
             l.next_action_type::text,
             /* ⚠️ THE SAME LABEL THE LIST BUILDS. A second expression here would
                render "5 Marla · A-101" on the desk and something else in the
                drawer for the same unit, and the reader would reasonably wonder
                which one is the plot. */
             (select concat_ws(' · ',
                nullif(concat_ws(' ',
                  case when p.size_marla is not null
                       then trim(trailing '.' from to_char(p.size_marla, 'FM999999.99')) || ' Marla' end,
                  initcap(substring(p.kind from '[^ ]+$'))), ''),
                nullif(concat_ws(', ', p.plot_number,
                  case when p.block is not null then 'Block ' || p.block end), ''))
                from public.crm_properties p where p.id = l.property_id) as property_label
        from public.crm_leads l
        left join public.crm_lead_forms f on f.id = l.form_id
        left join public.crm_campaigns  c on c.id = l.campaign_id
       where l.id = any(${idList}::uuid[])
    `,
    tx`
      select x.lead_id, n.*
        from unnest(${idList}::uuid[]) with ordinality as x(lead_id, ord)
        cross join lateral app.crm_lead_notes_with_authors(x.lead_id) with ordinality as n
       order by x.ord, n.ordinality
    `,
    tx`
      select x.lead_id, a.*
        from unnest(${idList}::uuid[]) with ordinality as x(lead_id, ord)
        cross join lateral app.crm_lead_activity_with_actors(x.lead_id) with ordinality as a
       order by x.ord, a.ordinality
    `,
    /* THE SAME PERSON, ENQUIRING TWICE — matched on phone_e164, never the raw
       phone. RLS applies, exactly as it did per lead: a sales member sees only
       the sibling leads assigned to them, so the screen never prints a count. */
    tx`
      select l.id, l.phone_e164, l.submitted_at, l.stage::text,
             app.crm_project_name(l.project_id) as project_name,
             f.name as form_name
        from public.crm_leads l
        left join public.crm_lead_forms f on f.id = l.form_id
       where l.phone_e164 in (
               select s.phone_e164 from public.crm_leads s
                where s.id = any(${idList}::uuid[]) and s.phone_e164 is not null)
       order by l.submitted_at desc
    `,
    namesP,
  ]);

  const byLead = <T,>(rows: unknown, key: string, map: (r: Record<string, unknown>) => T) => {
    const m = new Map<string, T[]>();
    for (const r of rows as Array<Record<string, unknown>>) {
      const k = String(r[key]);
      const list = m.get(k) ?? [];
      list.push(map(r));
      m.set(k, list);
    }
    return m;
  };

  const notes = byLead(noteRows, 'lead_id', (n) => ({
    id: String(n.id),
    body: String(n.body),
    createdAt: new Date(n.created_at as string).toISOString(),
    authorId: (n.author_id as string | null) ?? null,
    authorName: (n.author_name as string | null) ?? null,
    authorAvatarUrl: (n.author_avatar_url as string | null) ?? null,
  }));
  const activity = byLead(activityRows, 'lead_id', (a) => ({
    id: String(a.id),
    kind: String(a.kind),
    outcome: (a.outcome as string | null) ?? null,
    occurredAt: new Date(a.occurred_at as string).toISOString(),
    actorId: (a.actor_id as string | null) ?? null,
    actorName: (a.actor_name as string | null) ?? null,
    actorAvatarUrl: (a.actor_avatar_url as string | null) ?? null,
  }));
  const siblings = siblingRows as Array<Record<string, unknown>>;

  for (const row of found as Array<Record<string, unknown>>) {
    const id = String(row.id);
    out.set(id, {
      lead: {
        id: String(row.id),
        projectId: String(row.project_id),
        projectName: String(row.project_name),
        propertyId: (row.property_id as string | null) ?? null,
        propertyLabel: (row.property_label as string | null) ?? null,
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
        ownerName: row.owner_id ? (names.get(String(row.owner_id)) ?? null) : null,
        formName: (row.form_name as string | null) ?? null,
        campaignName: (row.campaign_name as string | null) ?? null,
        source: String(row.source),
        externalId: (row.external_id as string | null) ?? null,
        /* ⚠️ `?? null` ON EVERY ONE, never `|| null`. An empty string in
           `qualification_note` is a note somebody cleared, and `||` would turn
           it back into "never written" — the same distinction the enums make
           between NULL and `unknown`. */
        budgetBand: (row.budget_band as string | null) ?? null,
        authority: (row.authority as string | null) ?? null,
        purpose: (row.purpose as string | null) ?? null,
        timeline: (row.timeline as string | null) ?? null,
        paymentMode: (row.payment_mode as string | null) ?? null,
        locationPreference: (row.location_preference as string | null) ?? null,
        qualificationNote: (row.qualification_note as string | null) ?? null,
        budget: row.budget === null || row.budget === undefined ? null : Number(row.budget),
        qualifiedAt: row.qualified_at
          ? new Date(row.qualified_at as string).toISOString()
          : null,
        sells: String(row.sells ?? 'property'),
        nextActionType: (row.next_action_type as string | null) ?? null,
      },
      notes: notes.get(id) ?? [],
      activity: activity.get(id) ?? [],
      alsoEnquired: row.phone_e164
        ? siblings
            .filter((sib) => sib.phone_e164 === row.phone_e164 && String(sib.id) !== id)
            .slice(0, 20)
            .map((sib) => ({
              id: String(sib.id),
              submittedAt: new Date(sib.submitted_at as string).toISOString(),
              stage: String(sib.stage),
              projectName: String(sib.project_name),
              formName: (sib.form_name as string | null) ?? null,
            }))
        : [],
    });
  }
  return out;
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

export interface QualificationInput {
  readonly budgetBand: string | null;
  readonly authority: string | null;
  readonly purpose: string | null;
  readonly timeline: string | null;
  readonly paymentMode: string | null;
  readonly locationPreference: string | null;
  readonly qualificationNote: string | null;
  /** The precise figure, when they gave one. The band is what the gate reads. */
  readonly budget: number | null;
  /** Committed by the salesperson, never by `suggestTemperature`. */
  readonly temperature: string | null;
}

/**
 * Record what the qualifying call established — migration 167.
 *
 * ⚠️ IT DOES NOT TOUCH `stage`. Recording the answers and moving the lead are
 * two decisions: a salesperson who learns the client is just browsing has
 * qualified them perfectly well and should not be marched into `qualified` for
 * their trouble. The caller moves the stage afterwards, through `setLeadStage`,
 * where 167's trigger is waiting.
 *
 * ⚠️ AND IT NEVER WRITES `qualified_at`. The trigger stamps that, and the column
 * is deliberately outside the application's grant — a response-time figure the
 * measured party can edit is not a measurement. See 116 and `first_contacted_at`.
 */
export async function saveQualification(
  actorId: string,
  leadId: string,
  input: QualificationInput,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_leads
       set budget_band         = ${input.budgetBand}::public.crm_budget_band,
           authority           = ${input.authority}::public.crm_authority,
           purpose             = ${input.purpose}::public.crm_purpose,
           timeline            = ${input.timeline}::public.crm_timeline,
           payment_mode        = ${input.paymentMode}::public.crm_payment_mode,
           location_preference = ${input.locationPreference}::text,
           qualification_note  = ${input.qualificationNote}::text,
           budget              = ${input.budget}::numeric,
           temperature         = ${input.temperature}::public.crm_temperature
     where id = ${leadId}::uuid
     returning id
  `);
  /* ⚠️ ZERO ROWS IS RLS REFUSING THE LEAD, not a fault — the same shape
     `setLeadStage` documents, and the reason this returns a boolean. */
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
  /** whatsapp | email — migration 175. The thread carries both. */
  readonly channel: string;
  /** ⚠️ Email only. A WhatsApp message has no subject and a CHECK refuses one. */
  readonly subject: string | null;
  /** Meta's id — what a reply or a reaction points at. Null when it never sent. */
  readonly waMessageId: string | null;
  /** The wamid of the message this one replies to (184). */
  readonly replyToWamid: string | null;
  readonly ourReaction: string | null;
  readonly theirReaction: string | null;
  readonly pinnedAt: string | null;
  readonly pinnedByName: string | null;
  /** "Delete for me" — the body is withheld from the screen (184). */
  readonly hiddenAt: string | null;
  readonly hiddenByName: string | null;
  readonly deliveredAt: string | null;
  readonly readAt: string | null;
  readonly playedAt: string | null;
  readonly mediaSize: number | null;
  readonly mediaVoice: boolean;
  readonly forwarded: boolean;
  /** Starred by the person reading — stars are personal. */
  readonly starred: boolean;
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
  return withUser(actorId, async (tx) =>
    (await readCrmLeadThreads(tx, [leadId], readOwnerNames(tx))).get(leadId) ?? [],
  );
}

/**
 * Several leads' threads in ONE query. The sender's name comes from the owner
 * names already read for the transaction, not from 121's reader called once per
 * message — which, before 181, was a second per message.
 *
 * ⚠️ THE FIRST 500 PER LEAD, OLDEST FIRST — the same window the per-lead query
 * had, now applied per lead rather than across the whole batch.
 */
async function readCrmLeadThreads(
  tx: Tx,
  ids: readonly string[],
  namesP: Promise<OwnerNames>,
): Promise<Map<string, CrmMessage[]>> {
  const out = new Map<string, CrmMessage[]>();
  if (ids.length === 0) return out;
  const [rows, names] = await Promise.all([
    tx`
      select t.*, (st.message_id is not null) as starred
        from (
          select m.lead_id, m.id, m.direction::text, m.kind::text, m.body,
                 m.media_id, m.media_mime, m.media_filename, m.media_size, m.media_voice,
                 m.status::text, m.error_detail, m.occurred_at,
                 m.channel::text, m.subject, m.sent_by_id, m.wa_message_id, m.reply_to_wamid,
                 m.our_reaction, m.their_reaction, m.pinned_at, m.pinned_by_id,
                 m.hidden_at, m.hidden_by_id, m.delivered_at, m.read_at, m.played_at, m.forwarded,
                 /* ⚠️ THE NEWEST 500, NOT THE OLDEST. This ranked ascending, so a
                    conversation past 500 messages silently lost its latest ones —
                    the exact messages somebody opens a chat to read. */
                 row_number() over (partition by m.lead_id order by m.occurred_at desc, m.id desc) as n
            from public.crm_lead_messages m
           where m.lead_id = any(${ids as unknown as string[]}::uuid[])
        ) t
        left join public.crm_message_stars st
          on st.message_id = t.id and st.user_id = (select app.current_user_id())
       where t.n <= 500
       order by t.lead_id, t.occurred_at asc, t.id asc
    `,
    namesP,
  ]);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  for (const r of rows as Array<Record<string, unknown>>) {
    const lead = String(r.lead_id);
    const list = out.get(lead) ?? [];
    const hidden = Boolean(r.hidden_at);
    list.push({
      id: String(r.id),
      direction: r.direction === 'inbound' ? 'inbound' : 'outbound',
      channel: String(r.channel ?? 'whatsapp'),
      subject: hidden ? null : ((r.subject as string | null) ?? null),
      kind: String(r.kind),
      /* ⚠️ A DELETED MESSAGE'S CONTENT NEVER LEAVES THE SERVER. The row is kept
         for the record; the screen gets the fact of the deletion and no words. */
      body: hidden ? null : ((r.body as string | null) ?? null),
      mediaId: hidden ? null : ((r.media_id as string | null) ?? null),
      mediaMime: hidden ? null : ((r.media_mime as string | null) ?? null),
      mediaFilename: hidden ? null : ((r.media_filename as string | null) ?? null),
      mediaSize: hidden || r.media_size == null ? null : Number(r.media_size),
      mediaVoice: r.media_voice === true,
      status: (r.status as string | null) ?? null,
      errorDetail: (r.error_detail as string | null) ?? null,
      sentByName: r.sent_by_id ? (names.get(String(r.sent_by_id)) ?? null) : null,
      occurredAt: new Date(r.occurred_at as string).toISOString(),
      waMessageId: (r.wa_message_id as string | null) ?? null,
      replyToWamid: (r.reply_to_wamid as string | null) ?? null,
      ourReaction: hidden ? null : ((r.our_reaction as string | null) ?? null),
      theirReaction: hidden ? null : ((r.their_reaction as string | null) ?? null),
      pinnedAt: hidden ? null : iso(r.pinned_at),
      pinnedByName: r.pinned_by_id ? (names.get(String(r.pinned_by_id)) ?? null) : null,
      hiddenAt: iso(r.hidden_at),
      hiddenByName: r.hidden_by_id ? (names.get(String(r.hidden_by_id)) ?? null) : null,
      deliveredAt: iso(r.delivered_at),
      readAt: iso(r.read_at),
      playedAt: iso(r.played_at),
      forwarded: r.forwarded === true,
      starred: !hidden && r.starred === true,
    });
    out.set(lead, list);
  }
  return out;
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
  readonly messageId: string;
  readonly leadId: string;
  readonly mediaId: string | null;
  /** Our stored copy (184) — served from storage when present. */
  readonly path: string | null;
  readonly mime: string | null;
  readonly filename: string | null;
  readonly projectId: string;
}

export async function crmMessageMedia(
  actorId: string,
  messageId: string,
): Promise<CrmMessageMedia | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select m.id, m.lead_id, m.media_id, m.media_path, m.media_mime, m.media_filename, l.project_id
      from public.crm_lead_messages m
      join public.crm_leads l on l.id = m.lead_id
     where m.id = ${messageId}::uuid
       and (m.media_id is not null or m.media_path is not null)
       and m.hidden_at is null
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row) return null;
  return {
    messageId: String(row.id),
    leadId: String(row.lead_id),
    path: (row.media_path as string | null) ?? null,
    mediaId: (row.media_id as string | null) ?? null,
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
  /** remind_me · review_first · auto_send — who acts on it (153). */
  readonly mode: string;
  readonly body: string | null;
  /** Set when a sequence step queued it (170); null for a follow-up a person set. */
  readonly leadSequenceId: string | null;
  readonly sequenceStepNo: number | null;
  readonly doneByName: string | null;
  readonly createdByName: string | null;
}

export interface CrmSequenceStep {
  readonly stepNo: number;
  readonly channel: string;
  readonly delayDays: number;
  readonly purpose: string;
  readonly body: string | null;
  /** The name the person who planned it gave this step — 185. */
  readonly title: string | null;
  /** remind_me · review_first · auto_send — who completes it (185). */
  readonly mode: string;
}

/** A sequence this lead could be put on — active, and for its project. */
export interface CrmSequenceOption {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly steps: number;
}

export interface CrmLeadRelated {
  readonly quotations: readonly CrmQuotationRow[];
  readonly appointments: readonly CrmAppointmentRow[];
  readonly followUps: readonly CrmFollowUpRow[];
  /* ⚠️ THE SENDER RIDES WITH THE LEAD'S OTHER RELATED ROWS, and that is why.
     The composer needs the number of the LEAD's project, which is not known
     until the lead is read — so fetching it separately would be a second wave
     waiting on the first, which law 4 exists to prevent. It is one more read
     inside a query that already runs in the wave. */
  readonly sender: CrmSender | null;
  /** The stored AI summary of the conversation — migration 180. Never generated here. */
  readonly summary: CrmConversationSummary | null;
  /**
   * The lead's sequence run — the live one if there is one, otherwise the most
   * recent, so a stopped chase still shows what it sent and why it ended.
   */
  readonly sequence: {
    readonly id: string;
    readonly name: string;
    readonly purpose: string;
    readonly state: string;
    readonly step: number;
    readonly total: number;
    readonly pauseReason: string | null;
    readonly startedAt: string;
    readonly nextStepAt: string | null;
    readonly quotationId: string | null;
    readonly steps: readonly CrmSequenceStep[];
  } | null;
  /** Sequences this lead could be started on. */
  readonly sequenceOptions: readonly CrmSequenceOption[];
  /**
   * A plan written for this lead and saved without starting it (185/187).
   *
   * ⚠️ A DRAFT IS A PLAN WITH NO RUN, which is why it needs its own field: the
   * sequence card reads `sequence`, and a draft has nothing to read there.
   */
  readonly draft: {
    readonly id: string;
    readonly name: string;
    readonly purpose: string;
    readonly createdAt: string;
    readonly steps: readonly CrmSequenceStep[];
  } | null;
}

export type CrmSummaryPointKind = 'we_said' | 'they_said' | 'agreed' | 'open';

export interface CrmSummaryPoint {
  readonly kind: CrmSummaryPointKind;
  readonly text: string;
}

export interface CrmConversationSummary {
  readonly overview: string;
  readonly points: readonly CrmSummaryPoint[];
  /** What it was written from — compared against the thread on screen. */
  readonly messageCount: number;
  readonly lastMessageId: string | null;
  readonly noteCount: number;
  readonly generatedAt: string;
  readonly model: string;
}

const POINT_KINDS: readonly CrmSummaryPointKind[] = ['we_said', 'they_said', 'agreed', 'open'];

/** ⚠️ Coerced, never trusted — jsonb written from a model's output. */
export function readSummaryRow(r: Record<string, unknown>): CrmConversationSummary {
  const points = Array.isArray(r.points) ? (r.points as unknown[]) : [];
  return {
    overview: String(r.overview ?? ''),
    points: points.flatMap((p) => {
      const o = p as { kind?: unknown; text?: unknown };
      return POINT_KINDS.includes(o.kind as CrmSummaryPointKind) && typeof o.text === 'string'
        ? [{ kind: o.kind as CrmSummaryPointKind, text: o.text }]
        : [];
    }),
    messageCount: Number(r.message_count ?? 0),
    lastMessageId: (r.last_message_id as string | null) ?? null,
    noteCount: Number(r.note_count ?? 0),
    generatedAt: new Date(r.generated_at as string).toISOString(),
    model: String(r.model ?? ''),
  };
}

/* ============================================================================
 * EVERY ROW'S DRAWER, BEFORE ANYBODY CLICKS
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"If this table is loaded then all relevant data should be
 * loaded, and whenever I click on that, it will instantly show all these
 * things… How can I manage 2,000, 3,000 leads a day with this type of lazy
 * system?"*
 *
 * ⚠️ WHAT WAS WRONG. The drawer's record, thread and related rows were fetched
 * only AFTER a click, by a server render of the whole page — so every row
 * opened was a fresh wait, and the second row waited exactly as long as the
 * first.
 *
 * ⚠️ WHAT THIS DOES. The desk calls it once, in the background, for the rows on
 * screen. Every lead's three readers run inside ONE transaction and leave in one
 * `Promise.all`, so the queries are pipelined over a single connection rather
 * than 25 round trips — and they are the SAME readers the page and the full
 * record use, not a second copy of their SQL to drift out of step.
 *
 * ⚠️ BOUNDED BY THE PAGE, NEVER BY THE LIST. Twenty-five rows, not six hundred:
 * the only drawers a person can open in one click are the ones they can see.
 * RLS applies to every read, so a lead the caller cannot see comes back null.
 * ========================================================================= */

export interface CrmLeadBundle {
  readonly record: CrmLeadFull;
  readonly messages: CrmMessage[];
  readonly related: CrmLeadRelated;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function crmLeadBundles(
  actorId: string,
  leadIds: readonly string[],
): Promise<Record<string, CrmLeadBundle>> {
  const ids = [...new Set(leadIds)].filter((id) => UUID.test(id)).slice(0, 50);
  if (ids.length === 0) return {};

  /* ⚠️ THIRTEEN QUERIES FOR THE WHOLE PAGE, and the owner names read once and
     shared by all three readers. Measured before this was set-based: ten leads
     took 21 seconds from Karachi, one lead 1.7. */
  const [records, threads, related] = await withUser(actorId, (tx) => {
    const namesP = readOwnerNames(tx);
    return Promise.all([
      readCrmLeads(tx, ids, namesP),
      readCrmLeadThreads(tx, ids, namesP),
      readCrmLeadRelatedMany(tx, ids, namesP),
    ]);
  });

  const out: Record<string, CrmLeadBundle> = {};
  for (const id of ids) {
    const record = records.get(id);
    /* ⚠️ A lead RLS hid is simply absent — never an empty bundle that would open
       a drawer on somebody else's lead with nothing in it. */
    if (!record) continue;
    out[id] = { record, messages: threads.get(id) ?? [], related: related.get(id) ?? NO_RELATED };
  }
  return out;
}

/**
 * Write the summary, replacing any older one — migration 180.
 *
 * ⚠️ THROUGH RLS, AS THE READER. 180's write policy delegates to the lead, so
 * this can only ever land on a lead the caller can already see.
 */
export async function saveConversationSummary(
  actorId: string,
  leadId: string,
  input: {
    overview: string;
    points: readonly CrmSummaryPoint[];
    messageCount: number;
    lastMessageId: string | null;
    noteCount: number;
    fingerprint: string;
    model: string;
  },
): Promise<CrmConversationSummary | null> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.crm_lead_conversation_summaries
      (lead_id, overview, points, message_count, last_message_id, note_count,
       source_fingerprint, model, generated_at, generated_by_id)
    values (${leadId}::uuid, ${input.overview}, ${tx.json(input.points as never)},
            ${input.messageCount}, ${input.lastMessageId}::uuid, ${input.noteCount},
            ${input.fingerprint}, ${input.model}, now(), ${actorId}::uuid)
    on conflict (lead_id) do update set
      overview = excluded.overview,
      points = excluded.points,
      message_count = excluded.message_count,
      last_message_id = excluded.last_message_id,
      note_count = excluded.note_count,
      source_fingerprint = excluded.source_fingerprint,
      model = excluded.model,
      generated_at = excluded.generated_at,
      generated_by_id = excluded.generated_by_id
    returning overview, points, message_count, last_message_id, note_count, generated_at, model
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return row ? readSummaryRow(row) : null;
}

export async function crmLeadRelated(
  actorId: string,
  leadId: string,
): Promise<CrmLeadRelated> {
  return withUser(actorId, async (tx) =>
    (await readCrmLeadRelatedMany(tx, [leadId], readOwnerNames(tx))).get(leadId) ?? NO_RELATED,
  );
}

const NO_RELATED: CrmLeadRelated = {
  quotations: [],
  appointments: [],
  followUps: [],
  sender: null,
  summary: null,
  sequence: null,
  sequenceOptions: [],
  draft: null,
};

/** Several leads' related records in SIX queries, however many leads. */
async function readCrmLeadRelatedMany(
  tx: Tx,
  ids: readonly string[],
  namesP: Promise<OwnerNames>,
): Promise<Map<string, CrmLeadRelated>> {
  const out = new Map<string, CrmLeadRelated>();
  if (ids.length === 0) return out;
  const idList = ids as unknown as string[];

  const [quotations, appointments, followUps, sequences, drafts, options, senders, summaries, names] = await Promise.all([
    tx`
      select q.lead_id, q.id, q.number, q.version, q.status::text, q.net_amount,
             q.requested_discount, q.approved_discount, q.valid_until,
             q.prepared_by_id, q.approved_by_id, q.created_at,
             concat_ws(', ', p.plot_number,
               case when p.block is not null then 'Block ' || p.block end) as property_label
        from public.crm_quotations q
        left join public.crm_properties p on p.id = q.property_id
       where q.lead_id = any(${idList}::uuid[])
       order by q.lead_id, q.number, q.version desc
    `,
    tx`
      select a.lead_id, a.id, a.kind::text, a.status::text, a.scheduled_at,
             a.duration_minutes, a.location, a.outcome, a.owner_id
        from public.crm_appointments a
       where a.lead_id = any(${idList}::uuid[])
       order by a.lead_id, a.scheduled_at desc
    `,
    tx`
      select f.lead_id, f.id, f.title, f.purpose::text, f.channel::text, f.status::text,
             f.due_at, f.done_at, f.outcome_note, f.mode::text, f.body,
             f.lead_sequence_id, f.sequence_step_no, f.done_by_id, f.created_by_id
        from public.crm_follow_ups f
       where f.lead_id = any(${idList}::uuid[])
       order by f.lead_id, f.due_at desc
    `,
    tx`
      select distinct on (ls.lead_id)
             ls.lead_id, ls.id, s.name, s.purpose::text as purpose, ls.state::text,
             ls.current_step, ls.total_steps, ls.pause_reason, ls.started_at,
             ls.next_step_at, ls.quotation_id,
             coalesce((
               select json_agg(json_build_object(
                        'stepNo', st.step_no, 'channel', st.channel, 'delayDays', st.delay_days,
                        'purpose', st.purpose, 'body', st.body,
                        'title', st.title, 'mode', st.mode) order by st.step_no)
                 from public.crm_sequence_steps st
                where st.sequence_id = ls.sequence_id), '[]'::json) as steps
        from public.crm_lead_sequences ls
        join public.crm_sequences s on s.id = ls.sequence_id
       where ls.lead_id = any(${idList}::uuid[])
       /* The live run first; otherwise the latest, so a stopped chase still says
          what it sent and why it ended. At most one is live (unique index). */
       order by ls.lead_id,
                (ls.state in ('scheduled', 'active', 'paused')) desc,
                ls.started_at desc nulls last
    `,
    /* ⚠️ A DRAFT PLAN — written for this lead and never started. One row per
       lead, newest first, and only when nothing of it is running: a sequence
       whose run exists is not a draft, it is the sequence card. */
    tx`
      select distinct on (s.lead_id)
             s.lead_id, s.id, s.name, s.purpose::text as purpose, s.created_at,
             coalesce((
               select json_agg(json_build_object(
                        'stepNo', st.step_no, 'channel', st.channel, 'delayDays', st.delay_days,
                        'purpose', st.purpose, 'body', st.body,
                        'title', st.title, 'mode', st.mode) order by st.step_no)
                 from public.crm_sequence_steps st
                where st.sequence_id = s.id), '[]'::json) as steps
        from public.crm_sequences s
       where s.lead_id = any(${idList}::uuid[])
         and s.is_active
         and not exists (select 1 from public.crm_lead_sequences ls where ls.sequence_id = s.id)
       order by s.lead_id, s.created_at desc
    `,
    /* Sequences each lead could be put on: active, the lead's project or every
       project, and demo templates only for demo leads. */
    tx`
      select l.id as lead_id, s.id, s.name, s.purpose::text as purpose,
             (select count(*) from public.crm_sequence_steps st where st.sequence_id = s.id)::int as steps
        from public.crm_leads l
        join public.crm_sequences s
          on s.is_active
          /* ⚠️ TEMPLATES ONLY. A plan written for one lead (185) is that lead's
             own chase, not something to start on somebody else. */
         and s.lead_id is null
         and (s.project_id is null or s.project_id = l.project_id)
         and (not s.is_test_data or l.is_test_data)
       where l.id = any(${idList}::uuid[])
       order by l.id, s.name
    `,
    /* One sender per PROJECT, read once per project rather than once per lead. */
    tx`
      select l.id as lead_id, snd.configured, snd.display_name, snd.display_number
        from public.crm_leads l
        cross join lateral app.crm_project_sender(l.project_id) snd
       where l.id = any(${idList}::uuid[])
    `,
    tx`
      select lead_id, overview, points, message_count, last_message_id, note_count,
             generated_at, model
        from public.crm_lead_conversation_summaries
       where lead_id = any(${idList}::uuid[])
    `,
    namesP,
  ]);

  const nameOf = (id: unknown) => (id ? (names.get(String(id)) ?? null) : null);
  const rel = (id: string) => {
    let r = out.get(id) as {
      quotations: CrmQuotationRow[];
      appointments: CrmAppointmentRow[];
      followUps: CrmFollowUpRow[];
      sender: CrmSender | null;
      summary: CrmConversationSummary | null;
      sequence: CrmLeadRelated['sequence'];
      sequenceOptions: CrmSequenceOption[];
      draft: CrmLeadRelated['draft'];
    } | undefined;
    if (!r) {
      r = {
        quotations: [], appointments: [], followUps: [], sender: null, summary: null,
        sequence: null, sequenceOptions: [], draft: null,
      };
      out.set(id, r);
    }
    return r;
  };
  for (const id of ids) rel(id);

  for (const q of quotations as Array<Record<string, unknown>>) {
    rel(String(q.lead_id)).quotations.push({
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
    });
  }
  for (const a of appointments as Array<Record<string, unknown>>) {
    rel(String(a.lead_id)).appointments.push({
      id: String(a.id),
      kind: String(a.kind),
      status: String(a.status),
      scheduledAt: new Date(a.scheduled_at as string).toISOString(),
      durationMinutes: Number(a.duration_minutes ?? 60),
      location: (a.location as string | null) ?? null,
      outcome: (a.outcome as string | null) ?? null,
      ownerName: nameOf(a.owner_id),
    });
  }
  for (const f of followUps as Array<Record<string, unknown>>) {
    rel(String(f.lead_id)).followUps.push({
      id: String(f.id),
      title: String(f.title),
      purpose: String(f.purpose),
      channel: String(f.channel),
      status: String(f.status),
      dueAt: new Date(f.due_at as string).toISOString(),
      doneAt: f.done_at ? new Date(f.done_at as string).toISOString() : null,
      outcomeNote: (f.outcome_note as string | null) ?? null,
      mode: String(f.mode ?? 'remind_me'),
      body: (f.body as string | null) ?? null,
      leadSequenceId: (f.lead_sequence_id as string | null) ?? null,
      sequenceStepNo: f.sequence_step_no === null || f.sequence_step_no === undefined
        ? null
        : Number(f.sequence_step_no),
      doneByName: nameOf(f.done_by_id),
      createdByName: nameOf(f.created_by_id),
    });
  }
  for (const s of sequences as Array<Record<string, unknown>>) {
    const steps = Array.isArray(s.steps) ? (s.steps as Array<Record<string, unknown>>) : [];
    rel(String(s.lead_id)).sequence = {
      id: String(s.id),
      name: String(s.name),
      purpose: String(s.purpose ?? 'custom'),
      state: String(s.state),
      step: Number(s.current_step ?? 0),
      total: Number(s.total_steps ?? 0),
      pauseReason: (s.pause_reason as string | null) ?? null,
      startedAt: new Date(s.started_at as string).toISOString(),
      nextStepAt: s.next_step_at ? new Date(s.next_step_at as string).toISOString() : null,
      quotationId: (s.quotation_id as string | null) ?? null,
      steps: steps.map((st) => ({
        stepNo: Number(st.stepNo),
        channel: String(st.channel),
        delayDays: Number(st.delayDays ?? 0),
        purpose: String(st.purpose ?? ''),
        body: (st.body as string | null) ?? null,
        title: (st.title as string | null) ?? null,
        mode: String(st.mode ?? 'auto_send'),
      })),
    };
  }
  for (const d of drafts as Array<Record<string, unknown>>) {
    const steps = Array.isArray(d.steps) ? (d.steps as Array<Record<string, unknown>>) : [];
    rel(String(d.lead_id)).draft = {
      id: String(d.id),
      name: String(d.name),
      purpose: String(d.purpose ?? 'custom'),
      createdAt: new Date(d.created_at as string).toISOString(),
      steps: steps.map((st) => ({
        stepNo: Number(st.stepNo),
        channel: String(st.channel),
        delayDays: Number(st.delayDays ?? 0),
        purpose: String(st.purpose ?? ''),
        body: (st.body as string | null) ?? null,
        title: (st.title as string | null) ?? null,
        mode: String(st.mode ?? 'auto_send'),
      })),
    };
  }
  for (const o of options as Array<Record<string, unknown>>) {
    rel(String(o.lead_id)).sequenceOptions.push({
      id: String(o.id),
      name: String(o.name),
      purpose: String(o.purpose),
      steps: Number(o.steps ?? 0),
    });
  }
  for (const r of senders as Array<Record<string, unknown>>) {
    rel(String(r.lead_id)).sender = {
      configured: r.configured === true,
      displayName: String(r.display_name ?? ''),
      displayNumber: (r.display_number as string | null) ?? null,
    };
  }
  for (const r of summaries as Array<Record<string, unknown>>) {
    rel(String(r.lead_id)).summary = readSummaryRow(r);
  }
  return out;
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

/**
 * The whole diary, for the standalone Appointments screen.
 *
 * ⚠️ WIDER THAN `crmMyDiary` IN THREE WAYS, and each one is the difference
 * between a rail and a screen:
 *
 *   · it reaches BACKWARDS, because the questions this page answers are "what
 *     did I promise last week" and "which visit have I still not written up";
 *   · it keeps `cancelled` and `rescheduled`, which the rail hides — a rail is
 *     a list of what to do next, and a diary is a record of what was arranged;
 *   · it carries the project, so somebody working three schemes can tell two
 *     "Block A" visits apart.
 *
 * ⚠️ ONE QUERY, FILTERED ON THE CLIENT AFTERWARDS. Rule Zero law 3: the tabs on
 * this screen are Upcoming / Needs recording / Done, and all three are subsets
 * of the same rows. Asking the server again to hide some of what it just sent
 * would be a round trip to Singapore to apply a `filter()`.
 *
 * ⚠️ AND IT IS WINDOWED RATHER THAN UNBOUNDED — law 5. A salesperson two years
 * in has hundreds of these and none of the old ones are being looked at. The
 * screen says which window it is showing rather than implying it is everything.
 */
export const APPOINTMENTS_BACK_DAYS = 60;
export const APPOINTMENTS_LIMIT = 300;

export interface CrmDiaryRow extends CrmDiaryEntry {
  readonly projectName: string | null;
  readonly outcomeAt: string | null;
}

export async function crmMyAppointments(
  actorId: string,
  backDays = APPOINTMENTS_BACK_DAYS,
): Promise<CrmDiaryRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select a.id, a.lead_id, a.kind::text, a.status::text, a.scheduled_at,
           a.duration_minutes, a.location, a.outcome, a.outcome_at,
           l.full_name as lead_name,
           /* ⚠️ THE DEFINER, NOT A JOIN TO public.projects. A bare join here runs
              under the caller's session, projects_select asks for membership,
              and a salesperson is a member of nothing — so every row would come
              back with a null project name and the screen would look merely
              sparse rather than broken. Invisible from an Admin session, which
              passes the predicate. This is migrations 105 / 121 / 125 / 129 /
              130 / 140, and it was written wrong here first.

              ⚠️ AND NO BACKTICKS IN THIS COMMENT — the warning 40 lines below in
              crmCloseAppointment, ignored here on the first attempt. This file is
              one template literal and a stray backtick ends the string; tsc then
              reports three missing commas on a line that has none. */
           app.crm_project_name(a.project_id) as project_name,
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
       and a.scheduled_at >= (date_trunc('day', now() at time zone 'Asia/Karachi')
                              - make_interval(days => ${backDays})) at time zone 'Asia/Karachi'
     order by a.scheduled_at desc
     limit ${APPOINTMENTS_LIMIT}
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    ...toDiaryEntry(r),
    projectName: (r.project_name as string | null) ?? null,
    outcomeAt: r.outcome_at ? new Date(r.outcome_at as string).toISOString() : null,
  }));
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

/* ============================================================================
 * QUOTATIONS — Phase D
 * ----------------------------------------------------------------------------
 * ⚠️ NO DEFINER. `crm_quotations`'s policies (151) are row-local — you may write
 * one on a lead you can read — so these run as the caller and RLS answers
 * exactly as it should. The approval rules are CHECK constraints in the table,
 * not something this layer can talk its way past.
 * ========================================================================= */

export interface RaiseQuotation {
  readonly leadId: string;
  readonly basePrice: number;
  readonly premiumCharges: number;
  readonly requestedDiscount: number;
  readonly validUntil: string | null;
  readonly terms: string | null;
  /** True when it goes straight out — only ever for a quotation at list price. */
  readonly sendNow: boolean;
}

/**
 * Raise one.
 *
 * ⚠️ THE PROJECT AND THE PROPERTY COME FROM THE LEAD, not from the caller —
 * the same rule as booking an appointment. Both are columns here and both could
 * have been arguments, and then a quotation could be filed under a project the
 * lead does not belong to, or priced against a plot nobody discussed.
 *
 * ⚠️ AND THE NUMBER IS TAKEN INSIDE THE TRANSACTION, from the highest already
 * used. Two salespeople raising a quotation in the same second would otherwise
 * both read the same maximum and both write it — and two documents sharing a
 * number is the one thing a client notices. `(lower(number), version)` is unique
 * in 151, so the second writer loses loudly rather than quietly.
 */
export async function crmRaiseQuotation(
  actorId: string,
  input: RaiseQuotation,
): Promise<{ id: string; number: string } | null> {
  return withUser(actorId, async (tx) => {
    const used = await tx`
      select number from public.crm_quotations order by created_at desc limit 200`;
    const number = nextQuotationNumber(
      (used as Array<Record<string, unknown>>).map((r) => String(r.number)),
    );

    const approved = false;
    const net = netAmount({
      basePrice: input.basePrice,
      premiumCharges: input.premiumCharges,
      requestedDiscount: input.requestedDiscount,
      approvedDiscount: 0,
      approved,
    });

    /* ⚠️ A DISCOUNT GOES FOR APPROVAL; LIST PRICE MAY GO STRAIGHT OUT. The
       owner's rule is about the discount, not about the document — see
       `needsApproval`. */
    const status = needsApproval(input.requestedDiscount)
      ? 'pending_approval'
      : input.sendNow
        ? 'sent'
        : 'draft';

    const rows = await tx`
      insert into public.crm_quotations
        (lead_id, project_id, property_id, number, version,
         base_price, premium_charges, requested_discount, approved_discount, net_amount,
         valid_until, status, terms, prepared_by_id, sent_at, is_test_data)
      select l.id, l.project_id, l.property_id, ${number}, 1,
             ${input.basePrice}::bigint, ${input.premiumCharges}::bigint,
             ${input.requestedDiscount}::bigint, 0, ${net}::bigint,
             ${input.validUntil}::date,
             ${status}::public.crm_quotation_status,
             ${input.terms}::text,
             ${actorId}::uuid,
             /* ⚠️ DECIDED IN SQL. The string now() sent as a parameter is not
                a timestamp Postgres can parse — the same trap that would have
                made every appointment completion fail with a cast error. */
             case when ${status}::text = 'sent' then now() end,
             l.is_test_data
        from public.crm_leads l
       where l.id = ${input.leadId}::uuid
      returning id, number`;

    /* Zero rows means RLS refused the lead — no exception to catch. */
    const row = (rows as Array<Record<string, unknown>>)[0];
    if (!row) return null;

    await tx`
      insert into public.crm_lead_activity (lead_id, actor_id, kind, occurred_at, detail)
      values (
        ${input.leadId}::uuid, ${actorId}::uuid, 'note_added', now(),
        ${tx.json({
          quotation: String(row.number),
          status,
          net,
          discount: input.requestedDiscount,
        })}
      )`;

    return { id: String(row.id), number: String(row.number) };
  });
}

/**
 * Approve or refuse a discount somebody asked for.
 *
 * ⚠️ THE APPROVER IS THE SESSION, NEVER AN ARGUMENT, and `crm_quotations_no_self_approval`
 * (151) refuses a row where the approver is the preparer. Passing it in would
 * make "who authorised this?" a claim the caller gets to make.
 *
 * ⚠️ AND THE APPROVED FIGURE CAN DIFFER FROM THE ASKED-FOR ONE. A manager who
 * can only say yes or no to 500,000 says no; one who can approve 200,000 keeps
 * the deal. The net is recomputed from what was actually approved, so the
 * document says the authorised price rather than the requested one.
 */
export async function crmDecideQuotation(
  actorId: string,
  quotationId: string,
  decision: 'approved' | 'rejected',
  approvedDiscount: number,
  note: string | null,
): Promise<boolean> {
  return withUser(actorId, async (tx) => {
    const found = await tx`
      select base_price, premium_charges, requested_discount, prepared_by_id, status::text
        from public.crm_quotations where id = ${quotationId}::uuid`;
    const q = (found as Array<Record<string, unknown>>)[0];
    if (!q) return false;

    if (decision === 'rejected') {
      const done = await tx`
        update public.crm_quotations
           set status = 'rejected', approval_note = ${note}::text, updated_at = now()
         where id = ${quotationId}::uuid
         returning id`;
      return (done as unknown[]).length > 0;
    }

    const net = netAmount({
      basePrice: Number(q.base_price),
      premiumCharges: Number(q.premium_charges),
      requestedDiscount: Number(q.requested_discount),
      approvedDiscount,
      approved: true,
    });

    const done = await tx`
      update public.crm_quotations
         set status = 'approved',
             approved_discount = ${approvedDiscount}::bigint,
             net_amount = ${net}::bigint,
             approved_by_id = ${actorId}::uuid,
             approved_at = now(),
             approval_note = ${note}::text,
             updated_at = now()
       where id = ${quotationId}::uuid
       returning id`;
    return (done as unknown[]).length > 0;
  });
}

/**
 * Mark it sent.
 *
 * ⚠️ ONLY FROM `approved` OR `draft`. Sending something still waiting for a
 * manager is the exact thing the approval step exists to prevent, and the guard
 * is in the WHERE clause rather than in a check above it — so a second caller,
 * or a retry, cannot slip past it between the read and the write.
 */
export async function crmMarkQuotationSent(
  actorId: string,
  quotationId: string,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_quotations
       set status = 'sent', sent_at = now(), updated_at = now()
     where id = ${quotationId}::uuid
       and status in ('approved', 'draft')
     returning id`);
  return (rows as unknown[]).length > 0;
}

export interface CrmApprovalRow {
  readonly id: string;
  readonly number: string;
  readonly leadId: string;
  readonly leadName: string | null;
  readonly preparedBy: string | null;
  readonly basePrice: number;
  readonly premiumCharges: number;
  readonly requestedDiscount: number;
  readonly netAmount: number;
  readonly validUntil: string | null;
  readonly createdAt: string;
}

/**
 * Quotations waiting on a decision from this person.
 *
 * ⚠️ IT EXCLUDES THEIR OWN, and not only because the constraint would refuse
 * them. A manager who also carries leads would otherwise see their own request
 * sitting in their approval queue every morning — an action they can never take,
 * offered repeatedly, which is how somebody learns to ignore a queue.
 */
export async function crmAwaitingApproval(actorId: string): Promise<CrmApprovalRow[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select q.id, q.number, q.lead_id, q.base_price, q.premium_charges,
           q.requested_discount, q.net_amount, q.valid_until, q.created_at,
           l.full_name as lead_name,
           (select o.full_name from app.crm_lead_owners() o where o.id = q.prepared_by_id)
             as prepared_by
      from public.crm_quotations q
      join public.crm_leads l on l.id = q.lead_id
     where q.status = 'pending_approval'
       and q.prepared_by_id is distinct from app.current_user_id()
     order by q.created_at
     limit 50
  `);
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    number: String(r.number),
    leadId: String(r.lead_id),
    leadName: (r.lead_name as string | null) ?? null,
    preparedBy: (r.prepared_by as string | null) ?? null,
    basePrice: Number(r.base_price ?? 0),
    premiumCharges: Number(r.premium_charges ?? 0),
    requestedDiscount: Number(r.requested_discount ?? 0),
    netAmount: Number(r.net_amount ?? 0),
    validUntil: r.valid_until ? new Date(r.valid_until as string).toISOString() : null,
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

/* ============================================================================
 * THE CATALOGUE — Phase C
 * ----------------------------------------------------------------------------
 * ⚠️ A SALESPERSON READS IT AND CANNOT CHANGE IT. Migration 150's policies are
 * explicit: select for anyone in the project's department, write only for
 * somebody who manages it. A price is the company's, not the seller's — so
 * there is no update path in this file at all, and adding one would be a
 * decision to make deliberately rather than by accident.
 * ========================================================================= */

export interface CrmUnitStage {
  readonly label: string;
  readonly amount: number;
  readonly percentage: number | null;
  readonly instalments: number | null;
}

export interface CrmUnit {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly status: string;
  readonly basePrice: number | null;
  readonly sizeMarla: number | null;
  readonly areaSqft: number | null;
  readonly facing: string | null;
  readonly isCorner: boolean;
  readonly isParkFacing: boolean;
  readonly possessionMonths: number | null;
  readonly developmentStatus: string | null;
  /** How many leads are currently looking at this unit. */
  readonly interested: number;
  readonly stages: readonly CrmUnitStage[];
}

/**
 * Every unit on a project, with its payment plan.
 *
 * ⚠️ SOLD AND HELD UNITS ARE INCLUDED, deliberately. A salesperson asked "what
 * about B-201?" needs to be able to say *that one is gone* — hiding it makes
 * the catalogue disagree with the board on the wall, and the reader assumes the
 * system is out of date rather than that the plot is sold.
 *
 * ⚠️ AND THE PAYMENT STAGES COME BACK WITH IT, in one query rather than one per
 * unit. Twenty stages over ten units is ten extra round trips if fetched
 * separately, for a screen somebody opens to compare two plots.
 */
export async function crmProjectUnits(
  actorId: string,
  projectId: string,
): Promise<CrmUnit[]> {
  const rows = await withUser(actorId, (tx) => tx`
    select
      p.id, p.code, p.status::text as status, p.base_price, p.size_marla, p.area_sqft,
      p.facing, p.is_corner, p.is_park_facing, p.possession_months, p.development_status,
      concat_ws(' · ',
        nullif(concat_ws(' ',
          case when p.size_marla is not null
               then trim(trailing '.' from to_char(p.size_marla, 'FM999999.99')) || ' Marla' end,
          initcap(substring(p.kind from '[^ ]+$'))), ''),
        nullif(concat_ws(', ', p.plot_number,
          case when p.block is not null then 'Block ' || p.block end), '')
      ) as label,
      (select count(*)::int from public.crm_leads l
        where l.property_id = p.id and l.stage not in ('won','lost')) as interested,
      coalesce((
        select jsonb_agg(jsonb_build_object(
                 'label', s.label, 'amount', s.amount,
                 'percentage', s.percentage, 'instalments', s.instalments)
               order by s.sort_order)
          from public.crm_payment_stages s where s.property_id = p.id
      ), '[]'::jsonb) as stages
      from public.crm_properties p
     where p.project_id = ${projectId}::uuid
     order by p.block nulls last, p.plot_number nulls last
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    code: String(r.code),
    label: String(r.label ?? r.code),
    status: String(r.status ?? 'available'),
    basePrice: r.base_price === null ? null : Number(r.base_price),
    sizeMarla: r.size_marla === null ? null : Number(r.size_marla),
    areaSqft: r.area_sqft === null ? null : Number(r.area_sqft),
    facing: (r.facing as string | null) ?? null,
    isCorner: r.is_corner === true,
    isParkFacing: r.is_park_facing === true,
    possessionMonths: r.possession_months === null ? null : Number(r.possession_months),
    developmentStatus: (r.development_status as string | null) ?? null,
    interested: Number(r.interested ?? 0),
    stages: (r.stages as CrmUnitStage[]) ?? [],
  }));
}

/**
 * Attach a unit to a lead, or take one off.
 *
 * ⚠️ THE UNIT MUST BELONG TO THE LEAD'S OWN PROJECT — the same rule
 * `app.crm_create_lead` enforces as CRM07, restated here because this is a
 * second way into the same column. Without it a Chitral plot could be attached
 * to an Executive Housing lead, and every quotation, payment plan and price
 * afterwards would describe a property the client was never shown.
 *
 * ⚠️ AND `property_id` IS NOT IN 116's UPDATE GRANT, so this needs the column
 * granted before it can run. Migration 166 does that and says why.
 */
export async function crmAttachUnit(
  actorId: string,
  leadId: string,
  propertyId: string | null,
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    update public.crm_leads l
       set property_id = ${propertyId}::uuid
     where l.id = ${leadId}::uuid
       and (
         ${propertyId}::uuid is null
         or exists (
           select 1 from public.crm_properties p
            where p.id = ${propertyId}::uuid and p.project_id = l.project_id
         )
       )
     returning l.id`);
  return (rows as unknown[]).length > 0;
}

/* ============================================================================
 * TO-DOS — what a salesperson owes somebody today
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-16: *"I want to create tasks for a salesperson according to
 * that day's data… all tasks, whether it's sending a quotation, sending a
 * proposal, responding back to some client, should be displayed as the next
 * action on the to-do's page… For the sales team you have to clear your to-dos,
 * then you can leave."*
 *
 * ── ⚠️ DERIVED, NEVER STORED. THIS IS THE WHOLE DESIGN DECISION ────────────
 * There is no `crm_todos` table and there must not be one. A stored to-do can be
 * ticked off separately from the thing it refers to, and the day somebody marks
 * "ring Faisal back" done without ringing Faisal, the list and the truth have
 * split — permanently, because nothing reconciles them. Every row below is a
 * QUESTION ASKED OF REAL STATE: a lead with no `first_contacted_at`, an
 * appointment with no outcome, a quotation still `pending_approval`. Doing the
 * work is what clears the item, because the item *is* the work.
 *
 * ── ⚠️ ONE QUERY, NOT SIX. Rule Zero, law 4 ────────────────────────────────
 * Six sources that owe each other nothing would be six round trips to Singapore
 * for one screen. A `union all` is one.
 *
 * ── ⚠️ AND IT IS BOUNDED. Law 5 ────────────────────────────────────────────
 * Everything overdue, everything uncontacted, and a week ahead. An unbounded
 * "everything you will ever owe" grows with the business and is the same list
 * with more scrolling.
 * ========================================================================= */

export type CrmTodoKind =
  | 'first_contact'
  | 'next_action'
  | 'appointment'
  | 'record_visit'
  | 'approve_quotation'
  | 'send_quotation'
  | 'follow_up';

export interface CrmTodo {
  /** Stable across refreshes: the kind plus the row it was derived from. */
  readonly id: string;
  readonly kind: CrmTodoKind;
  readonly leadId: string;
  readonly leadName: string | null;
  readonly projectName: string | null;
  /** What to do, already written as an instruction. */
  readonly detail: string | null;
  readonly dueAt: string | null;
}

export async function crmMyTodos(actorId: string, aheadDays = 7): Promise<CrmTodo[]> {
  const rows = await withUser(actorId, (tx) => tx`
    with me as (select app.current_user_id() as id),
         horizon as (
           select (date_trunc('day', now() at time zone 'Asia/Karachi')
                   + make_interval(days => ${aheadDays})) at time zone 'Asia/Karachi' as until
         )
    /* 1 · ⚠️ THE ONE THAT MATTERS MOST, and the one that did not exist before
       migration 169. A stranger asked to be contacted and nobody has. */
    select 'first_contact' as kind, l.id::text as source_id, l.id as lead_id,
           l.full_name as lead_name, l.project_id,
           null::text as detail,
           l.first_response_due_at as due_at
      from public.crm_leads l, me
     where l.owner_id = me.id
       and l.first_contacted_at is null
       and l.stage not in ('won', 'lost')

    union all
    /* 2 · The planned chase. ⚠️ Only once contact HAS been made, or it would sit
       beside its own first-contact row saying almost the same thing. */
    select 'next_action', l.id::text, l.id, l.full_name, l.project_id,
           l.next_action, l.next_action_at
      from public.crm_leads l, me, horizon
     where l.owner_id = me.id
       and l.first_contacted_at is not null
       and l.next_action_at is not null
       and l.stage not in ('won', 'lost')
       and l.next_action_at < horizon.until

    union all
    /* 3 · Somewhere to be. */
    select 'appointment', a.id::text, a.lead_id, l.full_name, a.project_id,
           initcap(replace(a.kind::text, '_', ' '))
             || coalesce(' · ' || nullif(a.location, ''), ''),
           a.scheduled_at
      from public.crm_appointments a
      join public.crm_leads l on l.id = a.lead_id, me, horizon
     where a.owner_id = me.id
       and a.status in ('scheduled', 'confirmed')
       and a.scheduled_at >= now()
       and a.scheduled_at < horizon.until

    union all
    /* 4 · ⚠️ A VISIT THAT HAPPENED AND WAS NEVER WRITTEN UP. The commonest way a
       lead goes quiet, and until the Appointments screen there was no screen anywhere
       that could list them. */
    select 'record_visit', a.id::text, a.lead_id, l.full_name, a.project_id,
           initcap(replace(a.kind::text, '_', ' ')), a.scheduled_at
      from public.crm_appointments a
      join public.crm_leads l on l.id = a.lead_id, me
     where a.owner_id = me.id
       and a.status in ('scheduled', 'confirmed')
       and a.scheduled_at < now()

    union all
    /* 5 · The manager's decision. ⚠️ "is distinct from" the preparer, so nobody
       is ever offered their own discount to approve — the same rule 151 enforces
       at two layers, restated here so the list never shows an impossible item.
       ⚠️ AND NO BACKTICKS IN THIS COMMENT: the file is one template literal and a
       stray one ends the string, surfacing as three missing commas on a line
       that has none. Written wrong here on the first attempt, again. */
    select 'approve_quotation', q.id::text, q.lead_id, l.full_name, q.project_id,
           q.number || ' · ' || to_char(q.requested_discount, 'FM999,999,999') || ' off',
           q.created_at
      from public.crm_quotations q
      join public.crm_leads l on l.id = q.lead_id, me
     where q.status = 'pending_approval'
       and q.prepared_by_id is distinct from me.id

    union all
    /* 6 · Approved and still sitting here. ⚠️ A quotation a manager has said yes
       to and nobody has sent is the most expensive row on this page. */
    select 'send_quotation', q.id::text, q.lead_id, l.full_name, q.project_id,
           q.number || ' · approved', q.approved_at
      from public.crm_quotations q
      join public.crm_leads l on l.id = q.lead_id, me
     where q.status = 'approved'
       and q.sent_at is null
       and q.prepared_by_id = me.id

    union all
    /* 7 · A sequence step the engine decided a HUMAN should handle — 170.
       ⚠️ auto_send IS DELIBERATELY ABSENT. Those go out by machine; putting
       them here would ask somebody to do work that is already being done, and a
       list with items nobody needs to action is a list people stop clearing.
       What lands here is a step on a channel the engine cannot send (a call), or
       free text outside the 24-hour window, which a real business number would
       refuse. */
    select 'follow_up', f.id::text, f.lead_id, l.full_name, l.project_id,
           coalesce(nullif(f.title, ''), initcap(replace(f.purpose::text, '_', ' '))),
           f.due_at
      from public.crm_follow_ups f
      join public.crm_leads l on l.id = f.lead_id, me
     where f.assigned_to_id = me.id
       and f.status = 'due'
       and f.mode in ('remind_me', 'review_first')
  `);

  /* ⚠️ THE PROJECT NAME COMES FROM THE DEFINER, resolved after the union rather
     than joined inside it. `projects_select` asks for membership and a
     salesperson is a member of nothing — a join would have blanked the project
     on every row, and the screen would have looked merely plain. Eighth time. */
  const ids = [...new Set((rows as Array<Record<string, unknown>>).map((r) => String(r.project_id)))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const named = await withUser(actorId, (tx) => tx`
      select p as id, app.crm_project_name(p) as name
        from unnest(${ids}::uuid[]) as p
    `);
    for (const n of named as Array<Record<string, unknown>>) {
      if (n.name) names.set(String(n.id), String(n.name));
    }
  }

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: `${String(r.kind)}:${String(r.source_id)}`,
    kind: String(r.kind) as CrmTodoKind,
    leadId: String(r.lead_id),
    leadName: (r.lead_name as string | null) ?? null,
    projectName: names.get(String(r.project_id)) ?? null,
    detail: (r.detail as string | null) ?? null,
    dueAt: r.due_at ? new Date(r.due_at as string).toISOString() : null,
  }));
}

/* ============================================================================
 * EMAIL — migration 175
 * ----------------------------------------------------------------------------
 * ⚠️ NO DEFINER. `crm_lead_messages`'s policies (138) are row-local — you may
 * write a message on a lead you can read — so these run as the caller and RLS
 * answers exactly as it should.
 * ========================================================================= */

export interface QuotationForEmail {
  readonly leadId: string;
  readonly leadName: string | null;
  readonly leadEmail: string | null;
  readonly number: string;
  readonly version: number;
  readonly netAmount: number;
  readonly validUntil: string | null;
  readonly itemLabel: string | null;
  readonly itemDetail: string | null;
  readonly projectName: string | null;
}

/**
 * Everything the quotation email needs, in one read.
 *
 * ⚠️ IT RETURNS NULL FOR "NOT YOURS" AND FOR "NO SUCH QUOTATION", identically.
 * A caller that behaved differently for the two would let somebody probe which
 * quotation ids exist — the same stance `getCrmLead` takes.
 */
export async function crmQuotationForEmail(
  actorId: string,
  quotationId: string,
): Promise<QuotationForEmail | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select q.number, q.version, q.net_amount, q.valid_until,
           l.id as lead_id, l.full_name as lead_name, l.email as lead_email,
           app.crm_project_name(l.project_id) as project_name,
           p.code as item_code, p.kind as item_kind, p.scope_note,
           p.plot_number, p.block, p.size_marla
      from public.crm_quotations q
      join public.crm_leads l on l.id = q.lead_id
      left join public.crm_properties p on p.id = q.property_id
     where q.id = ${quotationId}::uuid
     limit 1
  `);
  const r = (rows as Array<Record<string, unknown>>)[0];
  if (!r) return null;

  const marla = r.size_marla === null || r.size_marla === undefined
    ? null
    : String(Number(r.size_marla)).replace(/\.0+$/, '');

  return {
    leadId: String(r.lead_id),
    leadName: (r.lead_name as string | null) ?? null,
    leadEmail: (r.lead_email as string | null) ?? null,
    number: String(r.number),
    version: Number(r.version ?? 1),
    netAmount: Number(r.net_amount ?? 0),
    validUntil: r.valid_until ? new Date(r.valid_until as string).toISOString() : null,
    /* ⚠️ THE SAME SHAPE THE DESK AND THE DRAWER PRINT. A third expression for the
       same unit would render "5 Marla A-101" in the email and something else on
       screen, and the client would reasonably ask which plot they were sent. */
    itemLabel: r.item_code
      ? [marla ? `${marla} Marla` : null, r.item_kind].filter(Boolean).join(' ') || String(r.item_kind ?? '')
      : null,
    /* A service's scope, or a plot's address. ⚠️ Bracketed deliberately —
       `??` and `||` cannot be mixed, and the precedence somebody assumes here is
       usually not the one they get. */
    itemDetail:
      (r.scope_note as string | null) ??
      ([r.plot_number, r.block ? `Block ${r.block}` : null].filter(Boolean).join(', ') || null),
    projectName: (r.project_name as string | null) ?? null,
  };
}

/**
 * Put a sent email into the lead's own thread.
 *
 * ⚠️ RECORDED ONLY AFTER IT ACTUALLY WENT. A row written before the send would
 * show a quotation as delivered that the provider refused, and the salesperson
 * would stop chasing a client who never received a price.
 */
export async function crmRecordSentEmail(
  actorId: string,
  input: {
    leadId: string;
    subject: string;
    body: string;
    messageId: string | null;
  },
): Promise<boolean> {
  const rows = await withUser(actorId, (tx) => tx`
    insert into public.crm_lead_messages
      (lead_id, channel, direction, kind, subject, body, email_message_id,
       status, sent_by_id, occurred_at)
    select l.id, 'email', 'outbound', 'text',
           ${input.subject}::text, ${input.body}::text, ${input.messageId}::text,
           'sent', ${actorId}::uuid, now()
      from public.crm_leads l
     where l.id = ${input.leadId}::uuid
    returning id
  `);
  /* ⚠️ ZERO ROWS IS RLS REFUSING THE LEAD, not a fault — the insert...select
     simply selects nothing, so there is no exception to catch. */
  return (rows as unknown[]).length === 1;
}

/* ============================================================================
 * MOVING DOWN THE LADDER — migration 176
 * ----------------------------------------------------------------------------
 * Owner's own example: 2 lakh → 1.5 lakh → 1 lakh. The client's budget picks
 * which rung opens; tier 3 is the floor and nothing goes below it.
 * ========================================================================= */

export interface NextRung {
  readonly tier: number;
  readonly price: number;
  /** True when this is the last one. There is nowhere further to go. */
  readonly isFloor: boolean;
}

/**
 * What the next quotation for this client may cost.
 *
 * ⚠️ NULL MEANS ALREADY AT THE FLOOR, not "no answer". The screen shows the
 * revise control only when there is a rung, so nobody is offered a concession
 * the company has not agreed to.
 */
export async function crmNextRung(actorId: string, quotationId: string): Promise<NextRung | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select tier, price, is_floor from app.crm_next_rung(${quotationId}::uuid)
  `);
  const r = (rows as Array<Record<string, unknown>>)[0];
  return r ? { tier: Number(r.tier), price: Number(r.price), isFloor: r.is_floor === true } : null;
}

/**
 * Raise the next version of an existing quotation.
 *
 * ⚠️ THE NUMBER IS KEPT AND THE VERSION ADVANCES. QT-1042 v2 is a new row that
 * points at v1; 176's trigger retires v1 in the same statement, so two live
 * versions of one number are impossible by construction rather than by care.
 *
 * ⚠️ AND THE PRICE COMES FROM THE ITEM'S LADDER, never from the caller. A
 * salesperson chooses WHEN to move down, not HOW FAR — which is the same
 * separation 150 makes by keeping `base_price` out of their grant.
 */
export async function crmReviseQuotation(
  actorId: string,
  quotationId: string,
  validUntil: string | null,
): Promise<{ id: string; number: string; version: number; price: number } | null> {
  return withUser(actorId, async (tx) => {
    const rung = await tx`
      select tier, price from app.crm_next_rung(${quotationId}::uuid)`;
    const next = (rung as Array<Record<string, unknown>>)[0];
    /* Already at the floor, or the item carries no ladder. Either way there is
       no next price this company has agreed to. */
    if (!next) return null;

    const price = Number(next.price);

    const rows = await tx`
      insert into public.crm_quotations
        (lead_id, property_id, project_id, number, version, supersedes_id,
         base_price, premium_charges, requested_discount, approved_discount, net_amount,
         valid_until, status, terms, prepared_by_id, is_test_data)
      select q.lead_id, q.property_id, q.project_id, q.number, q.version + 1, q.id,
             ${price}::bigint, 0, 0, 0, ${price}::bigint,
             coalesce(${validUntil}::date, q.valid_until),
             /* ⚠️ A RUNG IS NOT A DISCOUNT. The price is one the company already
                set on the item, so it needs nobody's approval — the two-person
                rule exists for a salesperson inventing a number, which this is
                the opposite of. It goes out as a draft so a human still presses
                send. */
             'draft'::public.crm_quotation_status,
             q.terms, ${actorId}::uuid, q.is_test_data
        from public.crm_quotations q
       where q.id = ${quotationId}::uuid
      returning id, number, version`;

    /* ⚠️ ZERO ROWS IS RLS REFUSING THE QUOTATION — the insert...select selects
       nothing rather than raising, the same shape `setLeadStage` documents. */
    const r = (rows as Array<Record<string, unknown>>)[0];
    if (!r) return null;

    return {
      id: String(r.id),
      number: String(r.number),
      version: Number(r.version),
      price,
    };
  });
}

/* ============================================================================
 * WHO A REPLY COMES FROM — migration 179
 * ========================================================================= */

export interface CrmSender {
  /** Can this project send on WhatsApp at all? */
  readonly configured: boolean;
  /** What the client sees it as. Falls back to the project's own name. */
  readonly displayName: string;
  /** E.164, or null where nobody has set one. */
  readonly displayNumber: string | null;
}

/**
 * The number a reply would go from.
 *
 * ⚠️ CONFIGURATION, NOT ACCESS. 172 exists because `crm_project_can_whatsapp`
 * bundles the two and answers false from a sessionless caller. `configured` here
 * is a fact about the project, the same for everybody who asks.
 */
export async function crmProjectSender(
  actorId: string,
  projectId: string,
): Promise<CrmSender | null> {
  const rows = await withUser(actorId, (tx) => tx`
    select configured, display_name, display_number
      from app.crm_project_sender(${projectId}::uuid)
  `);
  const r = (rows as Array<Record<string, unknown>>)[0];
  if (!r) return null;
  return {
    configured: r.configured === true,
    displayName: String(r.display_name ?? ''),
    displayNumber: (r.display_number as string | null) ?? null,
  };
}
