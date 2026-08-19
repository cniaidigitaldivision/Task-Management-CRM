'use server';

import { requireRole } from '@/lib/auth/current-user';
import { auditAlone } from '@/lib/db/queries/audit';
import { ceoReportData } from '@/lib/db/queries/ceo-report';
import {
  MONTH_START_PATTERN,
  buildReport,
  currentMonthStart,
  type ReportModel,
} from '@/lib/domain/ceo-report';
import { chatgptKey, writeNarrative, type Narrative } from '@/lib/ai/narrative';
import { nowMs } from '@/lib/now';

/* ============================================================================
 * THE CEO REPORT — owner request 2026-08-19
 * ----------------------------------------------------------------------------
 * Gathers the figures, shapes them with the pure engine, and — only when asked —
 * sends the resulting fact sheet to OpenAI for the written commentary.
 *
 * ── ⚠️ WHY THE COMMENTARY IS A SEPARATE ACTION FROM THE FIGURES ───────────────
 * The page renders its figures on the server and arrives with the report already
 * on it. The commentary is fetched by a second, explicit call.
 *
 * That split is not tidiness. Composing it takes a few seconds and depends on a
 * third party that can be down, rate-limited, or slow. Folding it into the page
 * render would mean the CEO waits on OpenAI to see figures that were ready
 * immediately, and an OpenAI outage would present as a broken reports page rather
 * than as a report without its commentary.
 *
 * It also means the model is only ever called because somebody pressed a button. A
 * page that called it on render would bill the owner for every navigation and
 * every refresh.
 *
 * ── ADMIN AND ABOVE ──────────────────────────────────────────────────────────
 * Higher than the rest of `/reports`, which admits a Coordinator. This one totals
 * recurring fees across every client, and revenue is not a coordinator's business.
 * The queries still run under RLS as the reader, so this floor narrows the
 * audience rather than being the only thing protecting the rows (ADR-003).
 * ========================================================================= */

export interface CeoReportResponse {
  readonly ok: true;
  readonly report: ReportModel;
}

export interface CeoReportFailure {
  readonly ok: false;
  readonly error: string;
}

export interface NarrativeResponse {
  readonly ok: true;
  readonly narrative: Narrative;
}

/** The figures. No model involved, so this cannot fail for a third party's
 *  reasons — which is exactly why it is the part the page renders. */
export async function ceoReportAction(
  monthStart?: string,
): Promise<CeoReportResponse | CeoReportFailure> {
  const user = await requireRole('admin');

  /* Validated rather than trusted: it arrives from a select, is compared against a
     date column, and a malformed value would produce an empty report — which reads
     as "a quiet month" rather than as the fault it is. */
  const month = monthStart ?? currentMonthStart(nowMs());
  if (!MONTH_START_PATTERN.test(month)) {
    return { ok: false, error: 'That is not a month this report can be run for.' };
  }

  const data = await ceoReportData(user.id, month);
  return { ok: true, report: buildReport(data) };
}

/**
 * The written commentary for a month.
 *
 * ── ⚠️ THE FACT SHEET IS REBUILT HERE, NOT ACCEPTED FROM THE CALLER ───────────
 * The obvious shape is to let the page post the fact sheet it already holds. That
 * would make the prompt caller-controlled: anybody able to reach this action could
 * put arbitrary text in front of the model on the owner's key, and could have a
 * report composed from figures that were never in the database. So only a month
 * crosses the wire and the figures are gathered again, under the reader's own RLS.
 */
export async function ceoNarrativeAction(
  monthStart: string,
): Promise<NarrativeResponse | CeoReportFailure> {
  const user = await requireRole('admin');

  if (!MONTH_START_PATTERN.test(monthStart)) {
    return { ok: false, error: 'That is not a month this report can be run for.' };
  }

  if (!chatgptKey()) {
    return {
      ok: false,
      error:
        'No OpenAI key is configured, so the written analysis is unavailable. The figures above are complete without it.',
    };
  }

  const report = buildReport(await ceoReportData(user.id, monthStart));

  /* Nothing to narrate. Asking a model to comment on an empty month invites it to
     fill the silence, which is the one thing it must not do here. */
  if (report.isEmpty) {
    return {
      ok: false,
      error: 'There are no active projects in this period, so there is nothing to analyse.',
    };
  }

  let narrative: Narrative;
  try {
    narrative = await writeNarrative(report.factSheet);
  } catch (error) {
    /* Surfaced, not swallowed. A report quietly missing its analysis looks like a
       report that had nothing to say. */
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The analysis could not be composed.',
    };
  }

  /* Audited because the division's figures left the building — the same reasoning
     as the export actions: once a fact sheet has gone to a third party, no access
     control in this system applies to it any more, so "when did this leave, and who
     sent it" needs an answer.
     The prose itself is not stored. It is regenerated on demand, and keeping it
     would be a second copy of the same figures, free to drift from the first. */
  await auditAlone(user, {
    entityType: 'report',
    entityId: null,
    action: 'report.ceo.analysed',
    after: {
      month: monthStart,
      model: narrative.model,
      projects: report.totals.projectCount,
      assets: report.totals.assetsPublished,
      unverifiedFigures: narrative.unverifiedFigures.length,
    },
  }).catch(() => {
    /* An audit failure must not lose the report the owner is waiting on, but it is
       not silent either — same trade as the export actions make. */
    console.error('[ceo-report] the audit entry could not be written');
  });

  return { ok: true, narrative };
}
