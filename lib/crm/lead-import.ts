import 'server-only';

import { withAppRole } from '@/lib/db/client';
import { pageAccessToken } from '@/lib/meta/client';

import { toLeadPayload, type LeadPayload, type MetaLead } from './lead-fields';

/* ============================================================================
 * THE LEAD IMPORTER
 * ----------------------------------------------------------------------------
 * Pulls Meta lead-ad submissions into `crm_leads`. Step 2 of
 * docs/crm/08-TWELVE-STEPS.md.
 *
 * ── ⚠️ WHY THIS IS URGENT RATHER THAN MERELY USEFUL ────────────────────────
 * **Meta deletes lead data 90 days after submission.** On 2026-09-09 there were
 * 615 leads on the Chitral page and the newest lead on its largest form was
 * already 43 days old — so its oldest were at or past that edge. Every day
 * without this running is leads permanently gone, and no amount of interface
 * built later brings one back.
 *
 * ── ⚠️ IT NEVER TOUCHES A TABLE ─────────────────────────────────────────────
 * Reads go through `app.crm_lead_sources`, writes through
 * `app.crm_record_leads`, both SECURITY DEFINER (migration 112). This runs from
 * `pg_cron` with no session, and RLS fails CLOSED — a direct select would return
 * zero rows and a direct insert would write nothing, neither raising. The job
 * would report success having done nothing. That exact bug has been paid for
 * twice already in the Meta sync.
 *
 * ── ⚠️ AND IT USES `withAppRole`, NOT `withUser` ───────────────────────────
 * `withUser` refuses an empty id outright, on purpose — an empty one would set
 * `app.user_id` to '', which `current_user_id()` maps to NULL, and the caller
 * would get silence instead of an error. `withAppRole` is the existing helper
 * for exactly this: run as `cni_app` with no identity, reaching data only
 * through the small reviewed set of SECURITY DEFINER functions.
 *
 * Threading a user id through here would be worse than pointless — it would make
 * the cron's behaviour depend on which id happened to be passed, which is the
 * kind of difference that works in testing and fails at 3am.
 * ========================================================================= */

const GRAPH = 'https://graph.facebook.com';

/** ⚠️ Meta pages leads 25 at a time by default. 100 is its maximum and cuts a
 *  553-lead form from 23 round trips to 6. */
const PAGE_SIZE = 100;

/** ⚠️ A hard stop, so a paging bug cannot loop for ever against a live API. At
 *  100 per page this is 20,000 leads from one form — far beyond anything real. */
const MAX_PAGES = 200;

export interface ImportOutcome {
  readonly projectName: string;
  readonly pageId: string;
  readonly forms: number;
  readonly leadsSeen: number;
  readonly leadsNew: number;
  readonly leadsUpdated: number;
  readonly outcome: 'ok' | 'failed';
  readonly error: string | null;
}

export interface ImportResult {
  readonly sources: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly leadsNew: number;
  readonly leadsUpdated: number;
  readonly results: readonly ImportOutcome[];
}

interface LeadSource {
  readonly projectId: string;
  readonly projectName: string;
  readonly pageId: string;
  readonly portfolioName: string;
  readonly token: string | null;
  readonly expectsVaultToken: boolean;
  /**
   * Only take leads SUBMITTED on or after this — 213. Null takes everything,
   * which is what every project does until somebody sets one.
   */
  readonly leadsFrom: Date | null;
}

async function sources(projectId: string | null): Promise<LeadSource[]> {
  const rows = await withAppRole((tx) => tx`
    select * from app.crm_lead_sources(${projectId}::uuid)
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    projectId: String(r.project_id),
    projectName: String(r.project_name),
    pageId: String(r.page_id),
    portfolioName: String(r.portfolio_name),
    token: r.token === null || r.token === undefined ? null : String(r.token),
    expectsVaultToken: Boolean(r.expects_vault_token),
    leadsFrom: r.leads_from ? new Date(r.leads_from as string) : null,
  }));
}

async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${GRAPH}/${process.env.META_API_VERSION?.trim()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, {
    /* Never cached — Next.js caches `fetch` in a server context by default, and
       a cached lead list would freeze the importer at whatever it first saw. */
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });

  const body = (await response.json()) as { error?: { message?: string } };
  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `Meta returned ${response.status}`);
  }
  return body as T;
}

interface FormRow {
  readonly id: string;
  readonly name?: string;
  readonly status?: string;
}

/** Every lead on one form, following Meta's paging to the end. */
async function leadsForForm(formId: string, token: string, since: Date | null): Promise<MetaLead[]> {
  const out: MetaLead[] = [];
  const sinceMs = since ? since.getTime() : null;

  let next: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body: { data?: MetaLead[]; paging?: { next?: string } } = next
      ? ((await (await fetch(next, { cache: 'no-store' })).json()) as never)
      : await graph(`${formId}/leads`, {
          access_token: token,
          limit: String(PAGE_SIZE),
          /* ⚠️ ASKED FOR EXPLICITLY, OR IT DOES NOT COME. With no `fields` Graph
             returns its defaults — id, created_time, field_data — and `platform`
             is not among them. All 636 leads imported before 2026-09-15 have no
             platform recorded for exactly this reason, and it cannot be
             recovered for them.

             ⚠️ THE DEFAULTS MUST BE RESTATED. Naming any field REPLACES the
             default set rather than adding to it, so omitting `field_data` here
             would silently import every future lead with no answers at all. */
          fields: 'id,created_time,platform,field_data',
          /* ⚠️ 213 · ASK META TO STOP AT THE CUTOFF. Without this the loop
             follows paging to the END of the form — which is how 660 leads from
             two and three months ago arrived on the first connection. Owner:
             *"I don't want to dump a lot of data into my database."* */
          ...(since
            ? {
                filtering: JSON.stringify([
                  { field: 'time_created', operator: 'GREATER_THAN_OR_EQUAL',
                    value: Math.floor(since.getTime() / 1000) },
                ]),
              }
            : {}),
        });

    const page = body.data ?? [];
    /* ⚠️ AND CHECKED HERE AS WELL, WHICH IS NOT BELT AND BRACES. Graph's
       `filtering` on this edge is undocumented for `time_created` and has to be
       treated as a hint: if Meta ignores it we would silently import the whole
       history again, and the only symptom would be a database somebody has to
       clean by hand. The cutoff is decided from the row we were sent. */
    out.push(...(sinceMs === null
      ? page
      : page.filter((l) => {
          const at = Date.parse(l.created_time ?? '');
          return Number.isNaN(at) ? false : at >= sinceMs;
        })));

    next = body.paging?.next ?? null;
    if (!next) break;

    /* ⚠️ STOP PAGING ONCE THE PAGE IS ENTIRELY OLDER THAN THE CUTOFF. Meta
       returns newest first, so an older page means every page after it is older
       too — and walking the rest costs a round trip each for nothing. */
    if (sinceMs !== null && page.length > 0
        && page.every((l) => {
          const at = Date.parse(l.created_time ?? '');
          return Number.isNaN(at) || at < sinceMs;
        })) {
      break;
    }
  }

  return out;
}

/**
 * Import leads for one project, or for every readable page when `projectId` is
 * null.
 *
 * ⚠️ Scoped to Chitral Royal Homes today by the caller, on the owner's
 * instruction — *"just choose one project… I'm not saying that you carry 2 or 3
 * projects at a time."* The function itself is not narrowed, because the schema
 * is not narrowed: adding the second project is an argument, not a rewrite.
 */
export async function importLeads(
  options: { readonly projectId?: string | null; readonly trigger?: string } = {},
): Promise<ImportResult> {
  const list = await sources(options.projectId ?? null);

  const results: ImportOutcome[] = [];
  let leadsNew = 0;
  let leadsUpdated = 0;

  for (const source of list) {
    try {
      /* ⚠️ A SUITE THAT NAMES A VAULT ENTRY AND RESOLVES NOTHING IS A FAULT,
         not a fallback. Falling through to the environment token would ask Meta
         for this company's pages using another company's credentials; Graph
         refuses, and the error names the PAGE rather than the missing secret —
         a diagnosis that costs an hour. Same guard as the Meta sync. */
      if (source.expectsVaultToken && !source.token) {
        throw new Error(
          `The ${source.portfolioName} suite has no token in the vault. ` +
            'Add it with scripts/vault-secret.mjs, then import again.',
        );
      }

      /* ⚠️ A PAGE TOKEN, NOT THE SYSTEM-USER TOKEN. `leadgen_forms` refuses the
         system-user token outright: "(#190) This method must be called with a
         Page Access Token". Verified 2026-09-09. */
      const pageToken = await pageAccessToken(source.pageId, source.token);

      const formsBody = await graph<{ data?: FormRow[] }>(
        `${source.pageId}/leadgen_forms`,
        { access_token: pageToken, fields: 'id,name,status', limit: '100' },
      );
      const forms = formsBody.data ?? [];

      const payload: LeadPayload[] = [];
      for (const form of forms) {
        for (const lead of await leadsForForm(form.id, pageToken, source.leadsFrom)) {
          const mapped = toLeadPayload(lead, form.id);
          if (mapped) payload.push(mapped);
        }
      }

      const [written] = (await withAppRole((tx) => tx`
        select * from app.crm_record_leads(
          ${source.pageId},
          ${tx.json(
            forms.map((f) => ({
              meta_form_id: f.id,
              name: f.name ?? 'Untitled form',
              status: f.status ?? null,
            })) as never,
          )},
          ${tx.json(payload as never)}
        )
      `)) as Array<Record<string, unknown>>;

      const newCount = Number(written?.leads_new ?? 0);
      const updatedCount = Number(written?.leads_updated ?? 0);
      leadsNew += newCount;
      leadsUpdated += updatedCount;

      results.push({
        projectName: source.projectName,
        pageId: source.pageId,
        forms: forms.length,
        leadsSeen: payload.length,
        leadsNew: newCount,
        leadsUpdated: updatedCount,
        outcome: 'ok',
        error: null,
      });
    } catch (error) {
      /* ⚠️ ONE PAGE'S FAILURE IS NOT THE RUN'S FAILURE. A client who revoked
         access must not stop every other client's leads arriving — and the
         failure is recorded rather than swallowed, because a silent zero is the
         thing this whole design exists to avoid. */
      results.push({
        projectName: source.projectName,
        pageId: source.pageId,
        forms: 0,
        leadsSeen: 0,
        leadsNew: 0,
        leadsUpdated: 0,
        outcome: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const succeeded = results.filter((r) => r.outcome === 'ok').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;

  /* ── ⚠️ THE RUN IS RECORDED WHETHER OR NOT IT WENT WELL ──────────────────
     Without this a broken import is INVISIBLE: pg_cron gets a request id back
     and nothing more, the HTTP response lands asynchronously in a table that is
     garbage-collected, and leads simply stop arriving. In a CRM the first person
     to notice is whoever wonders why the list has gone quiet, which is weeks.

     ⚠️ And a failure to RECORD must not fail the import — the leads are already
     safely written by then, and losing them to a bookkeeping error would invert
     the whole point of this job. */
  try {
    await withAppRole((tx) => tx`
      select app.crm_record_sync_run(
        ${list.length}, ${succeeded}, ${failed}, ${leadsNew}, ${leadsUpdated},
        ${tx.json(
          results
            .filter((r) => r.outcome === 'failed')
            .map((r) => ({ project: r.projectName, page: r.pageId, error: r.error })) as never,
        )},
        ${options.trigger ?? 'cron'}
      )
    `);
  } catch {
    console.error('[crm] the lead import ran but its run record could not be written');
  }

  return { sources: list.length, succeeded, failed, leadsNew, leadsUpdated, results };
}
