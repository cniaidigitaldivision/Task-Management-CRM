'use server';

/* ============================================================================
 * ⚠️⚠️ TEMPORARY — DELETE THIS WHOLE FILE WHEN THE TESTING IS DONE ⚠️⚠️
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-12: *"give me just one form in the admin panel for testing
 * purposes… when I click Send I want to see whether it drops into a CRM exactly
 * instantly and how intelligently the system assigns that lead to someone…
 * this is just for testing purposes. I will remove this once I make sure that
 * the thing or the system is working smartly."*
 *
 * It stands in for a Meta lead arriving, so the rota can be watched deciding
 * without waiting for a real campaign to produce one.
 *
 * ── TO REMOVE IT, ENTIRELY ──────────────────────────────────────────────────
 *   1. delete this file
 *   2. delete `components/crm/test-lead-modal.tsx`
 *   3. delete the one `<TestLeadButton …>` line in `components/crm/lead-desk.tsx`
 *      and its import
 * Nothing else anywhere refers to any of it.
 *
 * ── ⚠️ IT CANNOT TOUCH A REAL PROJECT, AND THAT IS ENFORCED HERE ────────────
 * Not by hiding the button — a hidden button is not a permission. Every call
 * re-reads the project and refuses unless its name ends in the seeder's `[demo]`
 * marker. So the day the demo project is removed, this stops working entirely
 * rather than quietly becoming a way to inject leads into Chitral.
 *
 * ⚠️ AND IT IS ADMIN-ONLY ON TOP OF THAT. A salesperson who could invent leads
 * could game the rota — the fewest-open-leads rule is arithmetic over a table
 * anybody on the desk can add rows to, if you let them.
 * ========================================================================= */

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { withUser } from '@/lib/db/client';
import { notify } from '@/lib/db/queries/feed';
import { assignLead, crmNextOwner, crmProjectRoster } from '@/lib/db/queries/crm-leads';
import { toE164 } from '@/lib/domain/phone';

/** The marker `scripts/seed-crm-demo.mjs` puts on everything it makes. */
const DEMO_MARK = '[demo]';

export interface TestLeadResult {
  readonly ok: boolean;
  readonly error?: string;
  /** Who the rota chose, and the arithmetic that chose them. */
  readonly assignedTo?: string;
  readonly because?: string;
  readonly leadId?: string;
}

/** The forms on a demo project — ALL of them, including ones with no leads yet. */
export async function listDemoFormsAction(
  projectId: string,
): Promise<Array<{ id: string; name: string }>> {
  const user = await requireUser();
  if (user.role !== 'admin' && user.role !== 'super_admin') return [];

  try {
    const rows = await withUser(user.id, (tx) => tx`
      select f.id, f.name
        from public.crm_lead_forms f
        join public.projects p on p.id = f.project_id
       where f.project_id = ${projectId}::uuid
         and p.name like ${'%' + DEMO_MARK}
       order by f.name
    `);
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      name: String(r.name),
    }));
  } catch {
    return [];
  }
}

/**
 * Drop a lead onto the desk as though Meta had just delivered it, then let the
 * rota decide who gets it — and say why.
 *
 * ⚠️ THE "WHY" IS READ BEFORE THE ASSIGNMENT, NOT AFTER. `crm_next_owner()`
 * picks whoever holds the fewest OPEN leads, and the moment the lead lands that
 * person's count has already changed. Reading the roster afterwards would
 * explain the decision with the numbers that the decision itself produced, which
 * is how a correct rota comes to look wrong to the person watching it.
 */
export async function createTestLeadAction(input: {
  projectId: string;
  formId: string | null;
  fullName: string;
  phone: string;
  city: string;
  product: string;
  note: string;
}): Promise<TestLeadResult> {
  const user = await requireUser();
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return { ok: false, error: 'Only an Admin can add a test lead.' };
  }

  const fullName = input.fullName.trim();
  if (!fullName) return { ok: false, error: 'Give the lead a name.' };

  /* ⚠️ RE-READ, NOT TRUSTED. The client sends a project id; this decides whether
     it is one this tool may write to. */
  let projectName: string | null = null;
  try {
    const rows = await withUser(user.id, (tx) => tx`
      select name from public.projects where id = ${input.projectId}::uuid
    `);
    projectName = rows[0] ? String((rows[0] as Record<string, unknown>).name) : null;
  } catch {
    return { ok: false, error: 'That project could not be read.' };
  }

  if (!projectName || !projectName.endsWith(DEMO_MARK)) {
    return {
      ok: false,
      error: 'Test leads can only be added to the demo project. This is deliberate.',
    };
  }

  /* The counts BEFORE anything lands, so the explanation is the one the rota
     actually reasoned from. */
  let before: Awaited<ReturnType<typeof crmProjectRoster>> = [];
  try {
    before = await crmProjectRoster(user.id, input.projectId);
  } catch {
    /* Not fatal — the lead still arrives, it just lands without an explanation. */
  }

  /* ⚠️ `phone_e164` IS COMPUTED HERE. Nothing in the database derives it, and a
     lead without it draws no call or WhatsApp button at all — which is correct
     for a made-up number and wrong for a real one. Same trap the seeder hit. */
  const phone = input.phone.trim();
  const phoneE164 = phone ? toE164(phone) : null;

  let leadId: string;
  try {
    const rows = await withUser(user.id, (tx) => tx`
      insert into public.crm_leads
        (project_id, form_id, source, external_id, full_name, phone, phone_e164,
         city, answers, stage, submitted_at, created_by_id)
      values
        (${input.projectId}::uuid,
         ${input.formId ? input.formId : null},
         'manual',
         ${'demo:test-' + Date.now().toString(36)},
         ${fullName},
         ${phone || '(demo — no number)'},
         ${phoneE164},
         ${input.city.trim() || null},
         ${JSON.stringify({
           which_product_are_you_interested_in: input.product || 'Not stated',
           what_are_you_trying_to_solve: input.note || 'Not stated',
           city: input.city.trim() || 'Not stated',
           submitted_via: 'Test form (demo)',
         })}::jsonb,
         'new',
         now(),
         ${user.id}::uuid)
      returning id
    `);
    leadId = String((rows[0] as Record<string, unknown>).id);
  } catch {
    return { ok: false, error: 'The lead could not be created.' };
  }

  /* ── Now the part being tested: who does the rota give it to? ───────────── */
  let owner: string | null = null;
  try {
    owner = await crmNextOwner(user.id, input.projectId);
  } catch {
    return { ok: true, leadId, error: 'The lead arrived, but the rota could not be read.' };
  }

  if (!owner) {
    revalidatePath('/leads');
    return {
      ok: true,
      leadId,
      because: 'It arrived unassigned — nobody in this project’s department can hold a lead.',
    };
  }

  try {
    await assignLead(user.id, leadId, owner);
    await tellThem(user.id, owner, leadId);
  } catch {
    revalidatePath('/leads');
    return { ok: true, leadId, error: 'The lead arrived but could not be handed out.' };
  }

  const chosen = before.find((p) => p.id === owner);
  const rivals = before.filter((p) => p.id !== owner && !p.isManager);
  const because = chosen
    ? rivals.length
      ? `${chosen.name} held ${chosen.openLeads} open ${chosen.openLeads === 1 ? 'lead' : 'leads'} — fewest on the team (${rivals
          .map((r) => `${r.name} ${r.openLeads}`)
          .join(', ')}).`
      : `${chosen.name} held ${chosen.openLeads}, and is the only person who can take it.`
    : 'The rota chose them.';

  revalidatePath('/leads');
  return { ok: true, leadId, assignedTo: chosen?.name ?? 'a salesperson', because };
}

/** The same bell entry a real assignment sends — so the test exercises that too. */
async function tellThem(actorId: string, ownerId: string, leadId: string): Promise<void> {
  try {
    await withUser(actorId, (tx) =>
      notify(tx, actorId, {
        userId: ownerId,
        kind: 'lead_assigned',
        title: 'A lead is yours to work',
        /* ⚠️ NO PHONE NUMBER IN THE BODY, for the same reason as the real one:
           a notification can sit on a lock screen, and the lead's own page is
           one tap away behind the access rules. */
        body: 'Open the lead to see the full record and log your first call.',
        linkTo: `/leads/${leadId}`,
        entityId: leadId,
      }),
    );
  } catch {
    /* A missing bell entry must not make the assignment look like it failed. */
  }
}
