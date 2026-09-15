import type { Metadata, Route } from 'next';
import { notFound } from 'next/navigation';

import { LeadRecord } from '@/components/crm/lead-record';
import { requireCrmAccess } from '@/lib/auth/current-user';
import {
  crmLeadInsight,
  crmProjectCanWhatsApp,
  crmProjectRoster,
  getCrmLead,
} from '@/lib/db/queries/crm-leads';
import { fingerprint } from '@/lib/ai/lead-insight';
import { nowMs } from '@/lib/now';

export const metadata: Metadata = { title: 'Lead' };

/* ============================================================================
 * ONE LEAD — Step 5 of docs/crm/08-TWELVE-STEPS.md
 * ----------------------------------------------------------------------------
 * ── ⚠️ `notFound()` FOR A LEAD THE CALLER MAY NOT READ, NOT A REFUSAL ──────
 * `getCrmLead` returns null for both "no such lead" and "not yours", and this
 * page renders the same 404 for both. A distinct "you are not allowed to see
 * this" page would confirm that a particular lead EXISTS to somebody with no
 * right to know it — and with a uuid in the URL, confirming existence is the
 * whole of what an attacker wants. The two cases are indistinguishable on
 * purpose, all the way from the policy to the screen.
 *
 * ── ⚠️ THE FLOOR IS `../layout.tsx`, AND THIS REPEATS IT ───────────────────
 * The same pattern as the desk: a page is reachable without its layout in some
 * render paths, and a floor that exists in only one of the two is not a floor.
 * Admin, Super Admin, or the Sales department — see migration 118.
 * ========================================================================= */

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  /* ⚠️ ONE WAVE — Rule Zero, law 4 (docs/20-UI-RESPONSIVENESS.md). */
  const [{ user }, { id }, query] = await Promise.all([
    requireCrmAccess(),
    params,
    searchParams,
  ]);

  /* ⚠️ THE THREAD IS NO LONGER READ HERE, because nothing on this page renders
     it since the floating chat was unmounted — and a query whose result is
     discarded is a round trip to Singapore for nobody. Rule Zero, law 3.

     ⚠️ WHEN THE CHAT COMES BACK, `crmLeadThread(user.id, id)` belongs in THIS
     Promise.all beside `getCrmLead` — it needs only the id, which is already in
     hand, so it must not become a second wave. `whatsAppTokenPresent()` goes
     back with it. The drawer on /my-leads already reads the thread this way. */
  const record = await getCrmLead(user.id, id);
  if (!record) notFound();

  /* ⚠️ EMPTY FOR SOMEBODY WHO DOES NOT MANAGE THIS PROJECT, by migration 124's
     guard inside `crm_project_roster()` rather than by a check here. So the
     reassign control is not drawn for them — and if it somehow were, 120's
     trigger would refuse the write. Two layers, and the database is the one
     that counts.

     ⚠️ SCOPED TO THIS LEAD'S PROJECT. A Chitral lead offers the Sales team; an
     ERP lead offers AI & Digital. Before migration 124 there was one team. */
  /* ⚠️ THESE THREE GENUINELY DO DEPEND ON THE RECORD — the roster and the
     WhatsApp check need its project, and the insight needs a fingerprint built
     from its own fields. So they are one wave AFTER it, rather than three. */
  const [roster, insight, canWhatsApp] = await Promise.all([
    crmProjectRoster(user.id, record.lead.projectId),
    crmLeadInsight(
      user.id,
      id,
      fingerprint({
        answers: record.lead.answers,
        stage: record.lead.stage,
        noteCount: record.notes.length,
        city: record.lead.city,
      }),
    ),
    crmProjectCanWhatsApp(user.id, record.lead.projectId),
  ]);

  /* ⚠️ `crmLeadInsight` above is A READ, NOT A GENERATION. Producing a reading
     costs money and happens only when somebody presses the button
     (`app/actions/crm-lead-ai.ts`). That call fetches whatever is already
     cached — null when nobody has asked, which is the state 627 of these leads
     will stay in. The fingerprint is recomputed so the panel can say whether the
     cached reading still matches the lead, rather than showing advice about a
     stage it has left.

     ⚠️ And this one is not a query at all — read on the SERVER, at render time.
     It says whether this deployment could send for any project, a different
     question from whether this project has a number, and the one that was being
     mistaken for it. */

  return (
    <>
      {/* ⚠️ MOUNTED BESIDE `LeadRecord`, NOT INSIDE IT, AND THE TESTS ARE WHY.
          This panel calls `useRouter` to refresh after a send; `LeadRecord` is
          rendered by 30 cases with `renderToStaticMarkup`, where no router is
          mounted, and putting it inside broke every one of them.

          It costs nothing structurally: the panel is `position: fixed`, so it
          docks to the viewport regardless of where it sits in the tree — and
          keeping `LeadRecord` free of router hooks is what keeps it testable
          without a harness. */}
    <LeadRecord
      lead={record.lead}
      notes={record.notes}
      activity={record.activity}
      alsoEnquired={record.alsoEnquired}
      insight={insight}
      backHref={backToDesk(query.from, record.lead.projectId)}
      /* ⚠️ Who is looking, for one decision only: whether a note carries a
         withdraw button. The DELETE itself is decided by 111's policy — author
         or Admin — so a viewer who got this wrong would be refused by the
         database rather than allowed by the screen. */
      viewerId={user.id}
      viewerIsAdmin={user.role === 'admin' || user.role === 'super_admin'}
      assignableOwners={roster.map((person) => ({
        id: person.id,
        name: person.name,
        openLeads: person.openLeads,
        isManager: person.isManager,
      }))}
      /* ⚠️ The SERVER's clock, so "3d ago" is the same for everyone — and so
         React cannot report a reader's wrong system time as a hydration error
         instead of the clock problem it is. Same as the desk. */
      nowMs={nowMs()}
      /* Step 8. Decides whether "WhatsApp" opens our recorded thread or falls
         back to the salesperson's own handset. */
      canWhatsApp={canWhatsApp}
    />
      {/* ── ⚠️ THE FLOATING CHAT IS PARKED, NOT DELETED ─────────────────────
          Owner, 2026-09-15: *"Please don't show the call in that way. I will
          tell you next how I want to chat with them. Don't have it pop up from
          the right bottom."*

          This superseded an earlier instruction of theirs — *"the proper chat
          will pop up and it should stick to the right bottom, like a proper
          chatbot"* — which is why the component and its whole send path still
          exist, and why this comment is here rather than a deletion. Somebody
          reading `whatsapp-chat.tsx` later will find a working component nobody
          mounts, and the only thing that explains that is a note saying it is
          waiting on a design rather than rotting.

          ⚠️ NOTHING ABOUT SENDING WAS REMOVED. The composer, the 24-hour window
          handling and the recorded thread are untouched; only the bubble that
          decided WHERE it appeared is unmounted. When the owner says how they
          want it, it mounts there.

          The conversation itself is still reachable — the drawer's
          Conversations tab shows the same thread, in the page, which is where
          the owner asked for lead detail to live. */}
    </>
  );
}

/**
 * Where "Back to the lead desk" goes.
 *
 * ⚠️ THE FILTERS COME BACK WITH IT. The desk keeps stage, owner, search, dates
 * and page in the query string, and a row opened from page 9 of a filtered list
 * has to return there — dropping somebody at an unfiltered page 1 is how a
 * person loses the set they had built and gives up on the filters.
 *
 * ⚠️ AND `from` IS AN ATTACKER-CONTROLLED STRING. It is never used as a URL:
 * it is appended after a literal `/leads?`, so the destination is always this
 * application's own desk however it is stuffed. Anything carrying a scheme, a
 * host or a path separator is dropped outright rather than sanitised, because
 * the useful values are only ever `key=value` pairs.
 */
function backToDesk(from: string | undefined, projectId: string): Route {
  const raw = (from ?? '').replace(/^\?/, '');

  if (raw !== '' && /^[A-Za-z0-9_%=&.+-]+$/.test(raw)) return `/leads?${raw}`;

  /* No usable filters — at least land on the project this lead belongs to,
     rather than on whichever one the desk would have defaulted to. */
  return `/leads?project=${encodeURIComponent(projectId)}`;
}
