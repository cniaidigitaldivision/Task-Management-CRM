/* ============================================================================
 * WHAT THE AGENT KNOWS — the numbers, and where each one comes from
 * ----------------------------------------------------------------------------
 * Owner's design, 2026-09-22: five cards, a knowledge-health dial, a gaps list.
 *
 * ── ⚠️ NOT ONE FIGURE HERE IS INVENTED ─────────────────────────────────────
 * "Agent readiness 80%" is the sort of number a screen can print without
 * anybody being able to say what it means. It means one thing here and only
 * one: **of the client questions this agent was given, the share it could
 * answer from approved knowledge instead of handing over for a missing fact.**
 * It is measured from `crm_agent_runs`, it is null when nothing has been asked,
 * and the screen says "not asked yet" rather than showing a hopeful number.
 *
 * ── ⚠️ A GAP IS A REAL QUESTION SOMEBODY REALLY ASKED ──────────────────────
 * Not a guess about what a document failed to cover. A gap is a handover the
 * agent made BECAUSE nothing approved answered the client — so every row in
 * that list is a sentence a client typed, and filling it is worth doing.
 * `notGap` keeps out the handovers that are somebody's job rather than a hole
 * in the knowledge: a call, a discount, a decision, an appointment change.
 *
 * ── PURE ───────────────────────────────────────────────────────────────────
 * No React, no SQL, no clock of its own — `nowMs` is a parameter (docs/20 §5).
 * ========================================================================= */

export type ProductKey = 'any' | 'taskly' | 'crm' | 'erp' | 'whatsapp';

export const SELLABLE: ReadonlyArray<Exclude<ProductKey, 'any'>> = ['taskly', 'crm', 'erp', 'whatsapp'];

export const PRODUCT_LABEL: Record<ProductKey, string> = {
  any: 'All products',
  taskly: 'Taskly',
  crm: 'CRM',
  erp: 'ERP',
  whatsapp: 'WhatsApp',
};

export interface RunLike {
  readonly id: string;
  readonly action: string;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly leadId: string;
  readonly leadName: string | null;
  readonly product: ProductKey | null;
  readonly question: string | null;
}

export interface EntryLike {
  readonly id: string;
  readonly product: ProductKey;
  readonly question: string;
  readonly answer: string;
  readonly sourceQuote: string | null;
  readonly sourceTitle: string | null;
  readonly status: 'draft' | 'approved' | 'rejected';
  readonly approvedByName: string | null;
  readonly approvedAt: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

export interface DocumentLike {
  readonly id: string;
  readonly title: string;
  readonly mime: string;
  readonly kind: string;
  readonly product: ProductKey;
  readonly sizeBytes: number;
  readonly createdAt: string;
  readonly readAt: string | null;
}

/* ── Which handovers are holes in the knowledge ──────────────────────────── */

/**
 * A handover that is somebody's JOB, not a missing fact.
 *
 * ⚠️ THESE MUST NEVER COUNT AGAINST READINESS. The agent handing a discount to
 * a salesperson is the fence working exactly as the owner asked; counting it as
 * a gap would push the team to approve answers about things they have decided a
 * person must handle.
 */
const NOT_A_GAP = [
  /person|human|salesperson|colleague|call(?:back)?|phone|speak to|talk to/i,
  /discount|lower price|cheaper|negotiat|payment terms|instal|budget/i,
  /appointment|visit|meeting|reschedul|cancel|book/i,
  /ready to (?:buy|pay|sign)|purchase|hold|reserve/i,
  /complain|upset|angry|unhappy/i,
  /decision|decide|approve|which one|quotation (?:is )?(?:right|correct)/i,
  /voice note|audio|photo|image|document|file/i,
  /not connected|could not reach|ai service|missing\b/i,
];

/**
 * A handover that happened because nothing approved answered the client.
 *
 * The positive list is deliberately generous, because the reason is partly the
 * model's own words; the negative list above is what keeps that honest.
 */
const IS_A_GAP = [
  /not covered|no information|not (?:in|part of) (?:our )?(?:knowledge|approved)|does not (?:state|cover|mention)/i,
  /* ⚠️ "not in our product line" is the same hole as "not covered" — checked
     against all eleven real handovers this project has, 2026-09-22. */
  /not in (?:our|the)\b[^.]{0,30}\b(?:product|line|scope|catalogue|offering)/i,
  /cannot answer|could not answer|unable to answer|no approved answer|nothing approved/i,
  /not sure|unsure|unknown|do(?:es)? not know|outside (?:our|the) (?:scope|products)/i,
  /specific (?:question|detail|fact)|hard fact|exact (?:number|figure|date)/i,
];

export function isKnowledgeGap(run: RunLike): boolean {
  if (run.action !== 'handed_over') return false;
  const why = (run.reason ?? '').trim();
  if (!why) return false;
  if (NOT_A_GAP.some((re) => re.test(why))) return false;
  return IS_A_GAP.some((re) => re.test(why));
}

/* ── Readiness ───────────────────────────────────────────────────────────── */

export interface Coverage {
  readonly answered: number;
  readonly gaps: number;
  /** null when nothing has been asked — the screen must not print a number. */
  readonly percent: number | null;
}

export function coverage(runs: readonly RunLike[]): Coverage {
  let answered = 0;
  let gaps = 0;
  for (const r of runs) {
    if (r.action === 'replied') answered += 1;
    else if (isKnowledgeGap(r)) gaps += 1;
  }
  const seen = answered + gaps;
  return { answered, gaps, percent: seen === 0 ? null : Math.round((answered / seen) * 100) };
}

/** The same question, per product — the health bars. */
export function healthByProduct(runs: readonly RunLike[]): Array<{ product: Exclude<ProductKey, 'any'>; cover: Coverage }> {
  return SELLABLE.map((product) => ({
    product,
    cover: coverage(runs.filter((r) => r.product === product)),
  }));
}

/** Ready, nearly, or not — the words beside the dial. */
export function readiness(percent: number | null): { label: string; tone: 'green' | 'amber' | 'red' | 'grey' } {
  if (percent === null) return { label: 'Not asked yet', tone: 'grey' };
  if (percent >= 80) return { label: 'Ready', tone: 'green' };
  if (percent >= 50) return { label: 'Getting there', tone: 'amber' };
  return { label: 'Needs answers', tone: 'red' };
}

/* ── The gaps list ───────────────────────────────────────────────────────── */

export interface Gap {
  readonly key: string;
  /** What the client actually typed, or the agent's reason if we have no message. */
  readonly question: string;
  readonly reason: string;
  readonly product: ProductKey | null;
  readonly asked: number;
  readonly lastAt: string;
  readonly leadName: string | null;
  readonly leadId: string;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Every gap, newest first, with the same question asked twice counted once.
 *
 * ⚠️ GROUPED ON THE CLIENT'S WORDS, not the model's reason — two clients asking
 * the same thing in the same words is one answer to write, and the reason text
 * varies run to run.
 */
export function gaps(runs: readonly RunLike[]): Gap[] {
  const by = new Map<string, Gap>();
  for (const r of runs) {
    if (!isKnowledgeGap(r)) continue;
    const asked = (r.question ?? '').trim();
    const text = asked || (r.reason ?? '').trim();
    if (!text) continue;
    const key = norm(text).slice(0, 80) || r.id;
    const seen = by.get(key);
    if (seen) {
      by.set(key, {
        ...seen,
        asked: seen.asked + 1,
        lastAt: seen.lastAt > r.createdAt ? seen.lastAt : r.createdAt,
      });
      continue;
    }
    by.set(key, {
      key,
      question: text.slice(0, 300),
      reason: (r.reason ?? '').slice(0, 300),
      product: r.product,
      asked: 1,
      lastAt: r.createdAt,
      leadName: r.leadName,
      leadId: r.leadId,
    });
  }
  return [...by.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

/* ── How much of a drafted answer the document actually supports ─────────── */

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'it', 'its',
  'this', 'that', 'with', 'as', 'by', 'be', 'can', 'will', 'you', 'your', 'we', 'our', 'from', 'at',
]);

const words = (t: string) => norm(t).split(' ').filter((w) => w.length > 2 && !STOP.has(w));

/**
 * The share of an answer's own words that appear in the quoted source.
 *
 * ⚠️ IT IS NOT A CONFIDENCE SCORE AND MUST NOT BE CALLED ONE. It says one
 * checkable thing: how much of this sentence is backed by the text it was drawn
 * from. A low number means read it before approving, not that it is wrong.
 * `null` when there is no quote to compare against — then the screen says so
 * rather than showing a zero that looks like a judgement.
 */
export function supportScore(answer: string, quote: string | null): number | null {
  if (!quote || !quote.trim()) return null;
  const have = new Set(words(quote));
  const want = words(answer);
  if (want.length === 0) return null;
  const hit = want.filter((w) => have.has(w)).length;
  return Math.round((hit / want.length) * 100);
}

export function supportTone(score: number | null): 'green' | 'amber' | 'red' | 'grey' {
  if (score === null) return 'grey';
  if (score >= 70) return 'green';
  if (score >= 40) return 'amber';
  return 'red';
}

/* ── The cards ───────────────────────────────────────────────────────────── */

export interface KnowledgeCounts {
  readonly approved: number;
  readonly review: number;
  readonly sources: number;
  readonly gaps: number;
  readonly readiness: number | null;
  readonly expired: number;
}

export function counts(
  entries: readonly EntryLike[],
  documents: readonly DocumentLike[],
  runs: readonly RunLike[],
  nowMs: number,
): KnowledgeCounts {
  const today = new Date(nowMs + 5 * 3_600_000).toISOString().slice(0, 10);
  let approved = 0;
  let review = 0;
  let expired = 0;
  for (const e of entries) {
    if (e.status === 'draft') review += 1;
    else if (e.status === 'approved') {
      /* ⚠️ AN EXPIRED ANSWER IS NOT AN APPROVED ONE. The agent's own door
         (`app.crm_knowledge_for`) drops it, so counting it here would tell the
         team they are covered for something the agent will not say. */
      if (e.expiresAt && e.expiresAt < today) expired += 1;
      else approved += 1;
    }
  }
  const cover = coverage(runs);
  return {
    approved,
    review,
    sources: documents.filter((d) => d.mime === 'application/pdf').length,
    gaps: gaps(runs).length,
    readiness: cover.percent,
    expired,
  };
}

/* ── The tabs and the filters ────────────────────────────────────────────── */

export type TabKey = 'overview' | 'approved' | 'review' | 'sources' | 'gaps' | 'activity';

export const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'approved', label: 'Approved' },
  { key: 'review', label: 'Review queue' },
  { key: 'sources', label: 'Sources' },
  { key: 'gaps', label: 'Gaps' },
  { key: 'activity', label: 'Activity' },
];

export interface Filters {
  readonly q: string;
  readonly product: ProductKey | 'all';
  readonly source: string;
}

export const NO_FILTERS: Filters = { q: '', product: 'all', source: 'all' };

export function matches(e: EntryLike, f: Filters): boolean {
  if (f.product !== 'all' && e.product !== f.product) return false;
  if (f.source !== 'all' && (e.sourceTitle ?? '') !== f.source) return false;
  const terms = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = `${e.question} ${e.answer} ${e.sourceTitle ?? ''}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/* ── Activity ────────────────────────────────────────────────────────────── */

export interface Moment {
  readonly id: string;
  readonly at: string;
  readonly kind: 'approved' | 'drafted' | 'read' | 'uploaded' | 'gap';
  readonly text: string;
  readonly who: string | null;
}

/**
 * What has happened to this project's knowledge, newest first.
 *
 * ⚠️ BUILT FROM THE ROWS THEMSELVES, not from an audit table nobody writes to.
 * Every line here can be pointed at: an entry's `approved_at` and approver, its
 * `created_at`, a document's upload and the moment it was last read.
 */
export function activity(
  entries: readonly EntryLike[],
  documents: readonly DocumentLike[],
  runs: readonly RunLike[],
  limit = 60,
): Moment[] {
  const out: Moment[] = [];
  for (const e of entries) {
    if (e.approvedAt) {
      out.push({
        id: `a-${e.id}`,
        at: e.approvedAt,
        kind: 'approved',
        text: e.question,
        who: e.approvedByName,
      });
    }
    if (e.status === 'draft') {
      out.push({
        id: `d-${e.id}`,
        at: e.createdAt,
        kind: 'drafted',
        text: e.question,
        who: e.sourceTitle,
      });
    }
  }
  for (const d of documents) {
    out.push({ id: `u-${d.id}`, at: d.createdAt, kind: 'uploaded', text: d.title, who: null });
    if (d.readAt) out.push({ id: `r-${d.id}`, at: d.readAt, kind: 'read', text: d.title, who: null });
  }
  for (const g of gaps(runs).slice(0, 20)) {
    out.push({ id: `g-${g.key}`, at: g.lastAt, kind: 'gap', text: g.question, who: g.leadName });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
