'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Activity as ActivityIcon,
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Clock3,
  Database,
  Eye,
  FileText,
  Info,
  Loader2,
  Lock,
  MoreVertical,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import { uploadCrmDocumentAction } from '@/app/actions/crm-documents';
import {
  addKnowledgeAction,
  askAgentAction,
  decideKnowledgeAction,
  deleteSourceAction,
  knowledgeBoardAction,
  readDocumentAction,
  saveAgentSettingsAction,
  setDocumentProductAction,
} from '@/app/actions/crm-knowledge';
import { ink, tint } from '@/components/crm/appointments-board-parts';
import { DocumentPreview } from '@/components/crm/document-preview';
import { TestAgentDrawer } from '@/components/crm/test-agent-drawer';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import type { KnowledgeBoard, KnowledgeDocument, KnowledgeEntry, ProductKey } from '@/lib/db/queries/crm-knowledge';
import {
  activity,
  counts,
  coverage,
  gaps as gapsOf,
  healthByProduct,
  matches,
  NO_FILTERS,
  PRODUCT_LABEL,
  productChoices,
  projectProducts,
  readiness,
  supportScore,
  supportTone,
  TABS,
  type Filters,
  type TabKey,
} from '@/lib/domain/crm-knowledge-health';
import { documentKindFromWords, productFromWords } from '@/lib/domain/crm-product-words';
import { cn } from '@/lib/utils';

/* ============================================================================
 * AI KNOWLEDGE — the owner's design, 2026-09-22
 * ----------------------------------------------------------------------------
 * *"I want the exact same UI, same colors, same design, same everything, but
 * wired up logically with each and everything … Make sure that everything is
 * properly visible, the same color is used for every same color, and everything
 * is isolated. Do not disturb any working thing."*
 *
 * ── ⚠️ EVERY NUMBER IS MEASURED ────────────────────────────────────────────
 * Readiness, coverage and the gaps count come from what the agent actually did
 * with this project's clients (`lib/domain/crm-knowledge-health.ts`), never
 * from a formula over how many answers exist. A project nobody has asked
 * anything shows "Not asked yet", not a hopeful percentage.
 *
 * ── ⚠️ ONE COLOUR PER MEANING ──────────────────────────────────────────────
 * green = approved and working · amber = waiting for a person · blue =
 * material the agent reads · red = a hole a client fell into. The cards, the
 * tabs, the chips and the bars all take their colour from `TONE` below, so the
 * same thing is never two colours on one screen.
 *
 * ── ⚠️ RULE ZERO ───────────────────────────────────────────────────────────
 * Tabs, filters, search and every panel are client state over one board. Only a
 * write reaches the server, and each decision moves its row in its own frame.
 * ========================================================================= */

type Tone = 'green' | 'amber' | 'blue' | 'red' | 'grey';

/** One meaning, one colour — used by every card, chip, bar and dial here. */
const TONE: Record<'approved' | 'review' | 'sources' | 'gaps' | 'readiness', Tone> = {
  approved: 'green',
  review: 'amber',
  sources: 'blue',
  gaps: 'red',
  readiness: 'green',
};

/** What the category pickers offer, for the project on screen. */
const ALL_PRODUCTS: ReadonlyArray<Exclude<ProductKey, 'any'>> = ['taskly', 'crm', 'erp', 'whatsapp'];

type Choices = ReadonlyArray<{ value: ProductKey; label: string }>;

const CONTROL =
  'h-9 rounded-xl border border-border-default bg-bg-surface text-body-sm text-text-primary transition-colors hover:border-border-strong focus:border-accent-primary focus:outline-none';

const PRODUCT_HINT: Record<ProductKey, string> = {
  any: 'True whatever they asked about',
  taskly: 'Tasks, projects, team, finance, attendance',
  crm: 'Leads, pipeline, follow-ups',
  erp: 'Inventory and stock',
  whatsapp: 'WhatsApp Business automation',
};

export function KnowledgeScreen({
  projects,
  board: first,
  nowMs,
}: {
  projects: ReadonlyArray<{ id: string; name: string }>;
  board: KnowledgeBoard | null;
  nowMs: number;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();

  /* ── Which project, without a server render to change it ──────────────── */
  const urlProject = search.get('project');
  const [wish, setWish] = React.useState<string | null | undefined>(undefined);
  if (wish !== undefined && wish === urlProject) setWish(undefined);
  const projectId = (wish === undefined ? urlProject : wish) ?? first?.projectId ?? projects[0]?.id ?? null;

  const [boards, setBoards] = React.useState<Record<string, KnowledgeBoard>>(
    first ? { [first.projectId]: first } : {},
  );
  const loaded = projectId ? boards[projectId] ?? null : null;
  /* ⚠️ A REF, NOT STATE. Marking "already asking" in state would be a setState
     inside the effect and a second render for nothing; the ref only exists to
     stop a second request for the same project. */
  const asking = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (!projectId || boards[projectId] || asking.current.has(projectId)) return;
    asking.current.add(projectId);
    void knowledgeBoardAction(projectId).then((b) => {
      if (b) setBoards((prev) => ({ ...prev, [b.projectId]: b }));
    });
  }, [projectId, boards]);

  const reload = React.useCallback(async () => {
    if (!projectId) return;
    const b = await knowledgeBoardAction(projectId);
    if (b) setBoards((prev) => ({ ...prev, [b.projectId]: b }));
  }, [projectId]);

  const pick = (id: string) => {
    setWish(id);
    const next = new URLSearchParams(search.toString());
    next.set('project', id);
    React.startTransition(() => router.replace(`?${next.toString()}`, { scroll: false }));
  };

  /* ── What this screen has just decided, over the server's rows ────────── */
  const [moved, setMoved] = React.useState<Record<string, KnowledgeEntry['status']>>({});
  /* 248 · sources somebody has just deleted, gone from the screen at once,
     and the answers taken out with them. */
  const [gone, setGone] = React.useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = React.useState<KnowledgeDocument | null>(null);
  const [dropped, setDropped] = React.useState<ReadonlySet<string>>(new Set());
  const entries = React.useMemo(
    () =>
      (loaded?.entries ?? [])
        .filter((e) => !dropped.has(e.id))
        .map((e) => (moved[e.id] ? { ...e, status: moved[e.id] } : e)),
    [loaded, moved, dropped],
  );

  /* ⚠️ THE BOARD AS THE SCREEN SHOWS IT — a deleted source is gone in this
     frame, before the server has answered (Rule Zero). */
  const board = React.useMemo(
    () => (loaded && gone.size ? { ...loaded, documents: loaded.documents.filter((d) => !gone.has(d.id)) } : loaded),
    [loaded, gone],
  );

  const [tab, setTab] = React.useState<TabKey>('overview');
  const [filters, setFilters] = React.useState<Filters>(NO_FILTERS);
  const set = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  const card = React.useMemo(
    () => counts(entries, board?.documents ?? [], board?.runs ?? [], nowMs),
    [entries, board, nowMs],
  );
  const cover = React.useMemo(() => coverage(board?.runs ?? []), [board]);
  const ready = readiness(cover.percent);
  /* ⚠️ THIS PROJECT'S PRODUCTS, not the business's. A plots project gets no
     bars about Taskly and ERP (owner, 2026-09-22). */
  const products = React.useMemo(
    () =>
      projectProducts({
        sells: board?.settings.product ?? null,
        entries,
        documents: board?.documents ?? [],
        runs: board?.runs ?? [],
      }),
    [board, entries],
  );
  const choices = React.useMemo(() => productChoices(products), [products]);
  const health = React.useMemo(() => healthByProduct(board?.runs ?? [], products), [board, products]);
  const gapRows = React.useMemo(() => gapsOf(board?.runs ?? []), [board]);
  const feed = React.useMemo(
    () => activity(entries, board?.documents ?? [], board?.runs ?? [], 60),
    [entries, board],
  );

  const review = entries.filter((e) => e.status === 'draft' && matches(e, filters));
  const approved = entries.filter((e) => e.status === 'approved' && matches(e, filters));
  const sources = [...new Set(entries.map((e) => e.sourceTitle).filter((t): t is string => Boolean(t)))].sort();

  const [dialog, setDialog] = React.useState<'write' | 'upload' | 'policy' | null>(null);
  const [testing, setTesting] = React.useState(false);
  /* The reply mode the person just chose, until the board catches up. */
  const [modeWish, setModeWish] = React.useState<'off' | 'suggest' | 'agent' | null>(null);
  const shownMode = modeWish ?? board?.settings.agentModeDefault ?? 'off';
  const [preview, setPreview] = React.useState<KnowledgeDocument | null>(null);

  const removeSource = async (d: KnowledgeDocument, withAnswers: boolean) => {
    const drawn = (loaded?.entries ?? []).filter((e) => e.sourceDocumentId === d.id).map((e) => e.id);
    /* ⚠️ GONE IN THIS FRAME — the source, and its answers if they go with it. */
    setDeleting(null);
    if (preview?.id === d.id) setPreview(null);
    setGone((g) => new Set(g).add(d.id));
    if (withAnswers) setDropped((x) => new Set([...x, ...drawn]));

    const r = await deleteSourceAction({ documentId: d.id, withAnswers });
    if (!r.ok) {
      setGone((g) => {
        const next = new Set(g);
        next.delete(d.id);
        return next;
      });
      if (withAnswers) {
        setDropped((x) => {
          const next = new Set(x);
          for (const id of drawn) next.delete(id);
          return next;
        });
      }
      toast({ tone: 'error', text: r.error ?? 'That source could not be deleted.' });
      return;
    }
    const took = (r.approved ?? 0) + (r.drafts ?? 0);
    toast({
      tone: 'ok',
      text:
        `Deleted “${d.title}”` +
        (withAnswers && took > 0
          ? ` and the ${took} answer${took === 1 ? '' : 's'} drawn from it — the agent will not say ${took === 1 ? 'it' : 'them'} again.`
          : '.') +
        (r.steps ? ` It was taken off ${r.steps} follow-up step${r.steps === 1 ? '' : 's'}.` : '') +
        (r.fileLeft ? ' (The file itself could not be removed from storage.)' : ''),
    });
    await reload();
  };

  const decide = async (e: KnowledgeEntry, status: 'approved' | 'rejected') => {
    /* ⚠️ THE ROW MOVES FIRST. Fifteen decisions is fifteen clicks, and a screen
       that waits on each one is a screen nobody finishes. */
    setMoved((m) => ({ ...m, [e.id]: status }));
    const r = await decideKnowledgeAction({ id: e.id, status });
    if (!r.ok) {
      setMoved((m) => {
        const next = { ...m };
        delete next[e.id];
        return next;
      });
      toast({ tone: 'error', text: r.error ?? 'That did not save.' });
      return;
    }
    void reload();
  };

  if (!projectId) {
    return (
      <div className="mx-auto max-w-[var(--content-max)]">
        <PageHeader title="AI Knowledge" description="Control what the agent can say for each project." />
        <p className="mt-6 text-body-sm text-text-secondary">No project has leads assigned to you yet.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      <PageHeader
        title="AI Knowledge"
        description="Control what the agent can say for each project."
        actions={
          <>
            <button
              type="button"
              onClick={() => setDialog('upload')}
              className="inline-flex items-center gap-2 rounded-xl border border-border-default px-4 py-2.5 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
            >
              <Upload className="size-4" aria-hidden="true" /> Upload source
            </button>
            <button
              type="button"
              onClick={() => setDialog('write')}
              className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-body-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
            >
              <Plus className="size-4" aria-hidden="true" /> Add answer
            </button>
          </>
        }
      />

      {/* ── The project, and how ready it is ───────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-subtle bg-bg-surface px-4 py-3 shadow-sm">
        <span className="text-body-sm font-semibold text-text-primary">Project</span>
        <label className={cn(CONTROL, 'flex min-w-[16rem] max-w-full flex-1 items-center gap-2 px-3')}>
          <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <select
            aria-label="Project"
            value={projectId}
            onChange={(e) => pick(e.target.value)}
            className="min-w-0 flex-1 bg-transparent focus:outline-none"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {board && (
          <>
            <Pill tone={shownMode === 'agent' ? 'green' : shownMode === 'suggest' ? 'amber' : 'grey'} dot>
              {shownMode === 'agent' ? 'Active' : shownMode === 'suggest' ? 'Suggesting' : 'Off'}
            </Pill>
            <span className="text-caption text-text-secondary">
              {feed[0] ? `Updated ${shortDay(feed[0].at)}` : 'No changes yet'}
            </span>
            <span className="flex-1" />
            <span className="inline-flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ background: ink(ready.tone) }} aria-hidden="true" />
              <span className="text-body-sm font-semibold" style={{ color: ink(ready.tone) }}>
                {ready.label}
                {cover.percent !== null && ` · ${cover.percent}% coverage`}
              </span>
            </span>
          </>
        )}
      </div>

      {/* ── Five cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card label="Approved answers" value={card.approved} tone={TONE.approved} icon={FileText} />
        <Card label="To review" value={card.review} tone={TONE.review} icon={Clock3} />
        <Card label="Sources" value={card.sources} tone={TONE.sources} icon={Database} />
        <Card label="Knowledge gaps" value={card.gaps} tone={TONE.gaps} icon={AlertTriangle} />
        <Card
          label="Agent readiness"
          value={cover.percent === null ? '—' : `${cover.percent}%`}
          tone={TONE.readiness}
          icon={BarChart3}
        />
      </div>

      {/* ── The policy ─────────────────────────────────────────────────── */}
      {board && (
        <Policy
          board={board}
          onSaved={reload}
          onEdit={() => setDialog('policy')}
          editing={dialog === 'policy'}
          onClose={() => setDialog(null)}
          onOptimistic={setModeWish}
        />
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-6 border-b border-border-subtle" role="tablist" aria-label="What to look at">
        {TABS.map((t) => {
          const n =
            t.key === 'approved' ? card.approved
              : t.key === 'review' ? card.review
                : t.key === 'sources' ? card.sources
                  : t.key === 'gaps' ? card.gaps
                    : null;
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={cn(
                '-mb-px inline-flex items-center gap-2 pb-2.5 pt-1 text-body-sm transition-colors',
                on ? 'font-semibold text-accent-primary' : 'font-medium text-text-secondary hover:text-text-primary',
              )}
              style={{
                borderBottomStyle: 'solid',
                borderBottomWidth: '4px',
                borderBottomColor: on ? 'var(--accent-primary)' : 'transparent',
              }}
            >
              {t.label}
              {n !== null && (
                <span
                  className="grid min-w-5 place-items-center rounded-full px-1.5 text-caption font-semibold leading-5"
                  style={
                    on
                      ? { background: tint('blue', 16), color: ink('blue') }
                      : { background: 'var(--bg-subtle)', color: 'var(--text-secondary)' }
                  }
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Search and the test button ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <label className={cn(CONTROL, 'flex min-w-[14rem] flex-1 items-center gap-2 px-3')}>
          <Search className="size-4 shrink-0 text-text-tertiary" aria-hidden="true" />
          <input
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Search questions, answers or sources…"
            aria-label="Search questions, answers or sources"
            className="min-w-0 flex-1 bg-transparent placeholder:text-text-tertiary focus:outline-none"
          />
        </label>
        <select
          aria-label="Category"
          value={filters.product}
          onChange={(e) => set({ product: e.target.value as Filters['product'] })}
          className={cn(CONTROL, 'w-[10rem] px-2.5')}
        >
          <option value="all">All categories</option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select
          aria-label="Source"
          value={filters.source}
          onChange={(e) => set({ source: e.target.value })}
          className={cn(CONTROL, 'w-[11rem] px-2.5')}
        >
          <option value="all">All sources</option>
          {sources.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {/* ⚠️ A DRAWER, NOT A SCROLL. Owner, 2026-09-22: *"Test agent: opens a
            wider test drawer with conversation preview, selected project,
            answer source and handoff result."* It opens in this frame; only a
            question asked inside it reaches the server. */}
        <button
          type="button"
          disabled={!board}
          onClick={() => setTesting(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-40"
        >
          <Play className="size-4" aria-hidden="true" /> Test agent
        </button>
      </div>

      {!board ? (
        <div className="grid place-items-center gap-2 rounded-2xl border border-border-subtle bg-bg-surface py-16 text-center shadow-sm">
          <Loader2 className="size-5 animate-spin text-text-tertiary" aria-hidden="true" />
          <p className="text-body-sm text-text-secondary">Reading this project&rsquo;s knowledge…</p>
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          {/* ── Left ─────────────────────────────────────────────────── */}
          <div className="min-w-0 space-y-4">
            {(tab === 'overview' || tab === 'review') && (
              <Panel
                title="Review queue"
                chip={{ text: `${card.review} pending`, tone: TONE.review }}
                action={tab === 'overview' && card.review > 0 ? { label: 'View all', onClick: () => setTab('review') } : undefined}
              >
                {review.length === 0 ? (
                  <Empty text="Nothing is waiting for a decision." />
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {(tab === 'overview' ? review.slice(0, 3) : review).map((e) => (
                      <ReviewRow key={e.id} entry={e} choices={choices} onDecide={decide} />
                    ))}
                  </ul>
                )}
              </Panel>
            )}

            {(tab === 'overview' || tab === 'approved') && (
              <Panel
                title="Approved knowledge"
                chip={{ text: `${card.approved} answers`, tone: TONE.approved }}
                action={tab === 'overview' && card.approved > 0 ? { label: 'View all', onClick: () => setTab('approved') } : undefined}
              >
                {approved.length === 0 ? (
                  <Empty text="Nothing is approved yet — the agent hands every question to a person." />
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {(tab === 'overview' ? approved.slice(0, 3) : approved).map((e) => (
                      <ApprovedRow key={e.id} entry={e} choices={choices} nowMs={nowMs} onDecide={decide} />
                    ))}
                  </ul>
                )}
              </Panel>
            )}

            {tab === 'sources' && (
              <Sources
                board={board}
                choices={choices}
                onDelete={setDeleting}
                onPreview={setPreview}
                onChanged={reload}
                onUpload={() => setDialog('upload')}
              />
            )}

            {tab === 'gaps' && (
              <Panel title="Knowledge gaps" chip={{ text: `${gapRows.length} found`, tone: TONE.gaps }}>
                {gapRows.length === 0 ? (
                  <Empty text="No client has asked something the agent could not answer." />
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {gapRows.map((g) => (
                      <li key={g.key} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                        <span
                          className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg"
                          style={{ background: tint('red', 14) }}
                        >
                          <AlertTriangle className="size-4" style={{ color: ink('red') }} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-body-sm font-semibold text-text-primary">{g.question}</span>
                          <span className="block text-caption text-text-secondary">
                            {g.leadName ?? 'A client'} · {shortDay(g.lastAt)}
                            {g.asked > 1 && ` · asked ${g.asked} times`}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setDialog('write')}
                          className="shrink-0 rounded-lg bg-accent-primary px-3 py-1.5 text-caption font-semibold text-white hover:opacity-90"
                        >
                          Write an answer
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}

            {tab === 'activity' && (
              <Panel title="Activity" chip={{ text: `${feed.length} events`, tone: 'grey' }}>
                {feed.length === 0 ? (
                  <Empty text="Nothing has happened here yet." />
                ) : (
                  <ul className="divide-y divide-border-subtle">
                    {feed.map((m) => (
                      <li key={m.id} className="flex items-start gap-3 px-5 py-3">
                        <span
                          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg"
                          style={{ background: tint(momentTone(m.kind), 14) }}
                        >
                          <MomentIcon kind={m.kind} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-body-sm text-text-primary">
                            <strong className="font-semibold">{momentVerb(m.kind)}</strong> {m.text}
                          </span>
                          <span className="block text-caption text-text-secondary">
                            {m.who ? `${m.who} · ` : ''}{shortDay(m.at)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
          </div>

          {/* ── Right ────────────────────────────────────────────────── */}
          <div className="min-w-0 space-y-4">
            <Panel
              title="Knowledge health"
              action={gapRows.length > 0 ? { label: 'View gaps', onClick: () => setTab('gaps') } : undefined}
            >
              <div className="flex flex-wrap items-center gap-5 px-5 pb-1">
                <span className="grid shrink-0 place-items-center gap-1">
                  <Dial percent={cover.percent} tone={ready.tone} />
                  <span className="text-caption font-medium text-text-secondary">Agent readiness</span>
                </span>
                <ul className="min-w-[10rem] flex-1 space-y-2">
                  {health.length === 0 && (
                    <li className="text-caption text-text-secondary">
                      {board.entries.length === 0
                        ? 'No answers yet for this project. Upload a source or add an answer to start.'
                        : 'Every answer here is about this project, so there is nothing to split by product.'}
                    </li>
                  )}
                  {health.map((h) => (
                    <li key={h.product} className="flex items-center gap-2.5">
                      <span className="w-16 shrink-0 truncate text-caption font-medium text-text-primary">
                        {PRODUCT_LABEL[h.product]}
                      </span>
                      <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-subtle">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${h.cover.percent ?? 0}%`,
                            background: ink(readiness(h.cover.percent).tone),
                          }}
                        />
                      </span>
                      <span className="w-12 shrink-0 text-right text-caption font-semibold text-text-secondary">
                        {h.cover.percent === null ? '—' : `${h.cover.percent}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="px-5 pb-1 pt-3 text-caption text-text-secondary">
                {cover.percent === null
                  ? 'No client has asked this agent anything yet.'
                  : `Of ${cover.answered + cover.gaps} questions in the last 90 days, it answered ${cover.answered} from approved knowledge.`}
              </p>
            </Panel>

            <Panel
              title="Source documents"
              chip={{ text: `${card.sources} sources`, tone: TONE.sources }}
              action={{ label: 'Manage sources', onClick: () => setTab('sources') }}
            >
              {board.documents.length === 0 ? (
                <Empty text="Nothing uploaded yet." />
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {board.documents.slice(0, 4).map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2.5 px-5 py-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: tint('red', 12) }}>
                        <FileText className="size-4" style={{ color: ink('red') }} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-sm font-semibold text-text-primary">{d.title}</span>
                        <span className="block truncate text-caption text-text-secondary">
                          {PRODUCT_LABEL[d.product]} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB
                        </span>
                      </span>
                      <Pill tone={d.readAt ? 'green' : 'grey'}>
                        {d.readAt ? `Read ${shortDay(d.readAt)}` : 'Not read'}
                      </Pill>
                      <button
                        type="button"
                        onClick={() => setPreview(d)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1.5 text-caption font-semibold text-text-primary hover:bg-bg-subtle"
                      >
                        <Eye className="size-3.5" aria-hidden="true" /> View
                      </button>
                      <SourceMenu
                        canDelete={board.canDelete}
                        onRead={() => setTab('sources')}
                        onDelete={() => setDeleting(d)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <AskBox board={board} onOpenDrawer={() => setTesting(true)} />
          </div>
        </div>
      )}

      {dialog === 'write' && board && (
        <WriteAnswer
          board={board}
          choices={choices}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await reload();
            toast({ tone: 'ok', text: 'Answer approved — the agent may say it now.' });
          }}
        />
      )}
      {dialog === 'upload' && board && (
        <UploadSource
          board={board}
          choices={choices}
          onClose={() => setDialog(null)}
          onDone={async () => {
            setDialog(null);
            await reload();
          }}
        />
      )}
      {testing && board && (
        <TestAgentDrawer
          board={board}
          modeLabel={shownMode === 'agent' ? 'AI agent' : shownMode === 'suggest' ? 'Suggestions' : 'My reply'}
          onClose={() => setTesting(false)}
          onWriteAnswer={() => {
            setTesting(false);
            setDialog('write');
          }}
        />
      )}
      {deleting && board && (
        <DeleteSource
          doc={deleting}
          answers={(loaded?.entries ?? []).filter((e) => e.sourceDocumentId === deleting.id)}
          onClose={() => setDeleting(null)}
          onConfirm={(withAnswers) => void removeSource(deleting, withAnswers)}
        />
      )}
      {preview && (
        <Shell title={preview.title} subtitle="The file the agent reads from." onClose={() => setPreview(null)}>
          {/* ⚠️ `DocumentPreview` draws itself INLINE and has no close of its
              own — it is the same component the drawer uses, given a dialog to
              sit in rather than a second copy written for this screen. */}
          <DocumentPreview documentId={preview.id} mime={preview.mime} title={preview.title} />
        </Shell>
      )}
    </div>
  );
}

/* ── Small pieces ────────────────────────────────────────────────────────── */

function Card({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  tone: Tone;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-bg-surface px-4 py-3.5 shadow-sm">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: tint(tone, 14) }}>
        <Icon className="size-5" style={{ color: ink(tone) }} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-caption font-medium text-text-secondary">{label}</span>
        <span className="block text-[1.6rem] font-bold leading-tight tabular-nums" style={{ color: ink(tone) }}>
          {value}
        </span>
      </span>
    </div>
  );
}

function Pill({ children, tone, dot = false }: { children: React.ReactNode; tone: Tone; dot?: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold"
      style={{ background: tint(tone, 14), color: ink(tone) }}
    >
      {dot && <span className="size-1.5 rounded-full" style={{ background: ink(tone) }} aria-hidden="true" />}
      {children}
    </span>
  );
}

function Panel({
  title,
  chip,
  action,
  children,
}: {
  title: string;
  chip?: { text: string; tone: Tone };
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-border-subtle bg-bg-surface py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
        <h2 className="text-h3 font-semibold text-text-primary">{title}</h2>
        {chip && <Pill tone={chip.tone}>{chip.text}</Pill>}
        <span className="flex-1" />
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="text-caption font-semibold text-text-brand hover:underline"
          >
            {action.label}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-body-sm text-text-secondary">{text}</p>;
}

function Dial({ percent, tone }: { percent: number | null; tone: Tone }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const shown = percent ?? 0;
  return (
    <span className="relative grid size-28 shrink-0 place-items-center">
      <svg viewBox="0 0 110 110" className="size-28 -rotate-90" aria-hidden="true">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--bg-subtle)" strokeWidth="10" />
        {/* ⚠️ NO ARC AT ZERO. A zero-length dash with a round cap still paints
            a dot, which read as a reading of "a little" on a project nobody has
            asked anything. */}
        {shown > 0 && (
          <circle
            cx="55"
            cy="55"
            r={r}
            fill="none"
            stroke={ink(tone)}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${(shown / 100) * c} ${c}`}
          />
        )}
      </svg>
      {/* ⚠️ THE WORD GOES UNDER THE RING, NOT INSIDE IT. "Agent readiness" was
          wider than the hole in the middle and came out as "agent readines". */}
      <span className="absolute grid place-items-center">
        <span className="text-[1.35rem] font-bold leading-none text-text-primary">
          {percent === null ? '—' : `${percent}%`}
        </span>
      </span>
    </span>
  );
}

/* ── The two row kinds ───────────────────────────────────────────────────── */

function ReviewRow({
  entry,
  choices,
  onDecide,
}: {
  entry: KnowledgeEntry;
  choices: Choices;
  onDecide: (e: KnowledgeEntry, status: 'approved' | 'rejected') => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const score = supportScore(entry.answer, entry.sourceQuote);
  const tone = supportTone(score);

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <Pill tone="blue">{PRODUCT_LABEL[entry.product]}</Pill>
        <span className="min-w-0 flex-1">
          <span className="block text-body-sm font-semibold text-text-primary">{entry.question}</span>
          <span className="block truncate text-caption text-text-secondary">{entry.answer}</span>
        </span>
        {entry.sourceTitle && (
          <span className="shrink-0 text-caption text-text-secondary">{entry.sourceTitle}</span>
        )}
        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-caption font-semibold"
          style={{ background: tint(tone, 14), color: ink(tone) }}
          title={
            score === null
              ? 'This draft has no quoted source to check it against.'
              : 'How much of this answer appears in the quoted source. Low means read it before approving — not that it is wrong.'
          }
        >
          {score === null ? (
            <>
              <Info className="size-3.5" aria-hidden="true" /> no quote
            </>
          ) : (
            <>
              <CheckCircle2 className="size-3.5" aria-hidden="true" /> {score}% from source
            </>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onDecide(entry, 'approved');
              setBusy(false);
            }}
            className="rounded-lg bg-accent-primary px-3 py-1.5 text-caption font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-lg border border-border-default px-3 py-1.5 text-caption font-semibold text-text-primary hover:bg-bg-subtle"
          >
            Edit
          </button>
          <button
            type="button"
            aria-label="Reject"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onDecide(entry, 'rejected');
              setBusy(false);
            }}
            className="grid size-8 place-items-center rounded-lg border transition-colors hover:bg-bg-subtle disabled:opacity-50"
            style={{ borderColor: 'color-mix(in oklab, var(--feedback-error) 45%, var(--border-default))' }}
          >
            <X className="size-4" style={{ color: ink('red') }} aria-hidden="true" />
          </button>
        </span>
      </div>
      {entry.sourceQuote && (
        <p className="mt-2 rounded-lg bg-bg-subtle/60 px-3 py-2 text-caption italic text-text-secondary">
          “{entry.sourceQuote}”
        </p>
      )}
      {editing && <EditRow entry={entry} choices={choices} onDone={() => setEditing(false)} />}
    </li>
  );
}

function ApprovedRow({
  entry,
  choices,
  nowMs,
  onDecide,
}: {
  entry: KnowledgeEntry;
  choices: Choices;
  nowMs: number;
  onDecide: (e: KnowledgeEntry, status: 'approved' | 'rejected') => Promise<void>;
}) {
  const [editing, setEditing] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const today = new Date(nowMs + 5 * 3_600_000).toISOString().slice(0, 10);
  const expired = entry.expiresAt !== null && entry.expiresAt < today;

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full" style={{ background: tint(expired ? 'grey' : 'green', 18) }}>
          <Check className="size-3.5" style={{ color: ink(expired ? 'grey' : 'green') }} aria-hidden="true" />
        </span>
        <Pill tone="blue">{PRODUCT_LABEL[entry.product]}</Pill>
        <span className="min-w-0 flex-1">
          <span className="block text-body-sm font-semibold text-text-primary">{entry.question}</span>
          <span className="block truncate text-caption text-text-secondary">{entry.answer}</span>
        </span>
        {entry.sourceTitle && <span className="shrink-0 text-caption text-text-secondary">{entry.sourceTitle}</span>}
        <span className="shrink-0 text-caption text-text-secondary">
          {entry.approvedByName ? `Approved by ${entry.approvedByName}` : 'Approved'}
          <br />
          {entry.approvedAt ? shortDay(entry.approvedAt) : ''}
        </span>
        {expired && <Pill tone="grey">Expired</Pill>}
        <span className="relative flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-lg border border-border-default px-3 py-1.5 text-caption font-semibold text-text-primary hover:bg-bg-subtle"
          >
            Edit
          </button>
          <button
            type="button"
            aria-label="More"
            onClick={() => setMenu((v) => !v)}
            className="grid size-8 place-items-center rounded-lg border border-border-default text-text-secondary hover:bg-bg-subtle"
          >
            <MoreVertical className="size-4" aria-hidden="true" />
          </button>
          {menu && (
            <span className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-xl border border-border-subtle bg-bg-surface py-1 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  void onDecide(entry, 'rejected');
                }}
                className="block w-full px-3 py-2 text-left text-body-sm text-text-primary hover:bg-bg-subtle"
              >
                Withdraw this answer
              </button>
            </span>
          )}
        </span>
      </div>
      {editing && <EditRow entry={entry} choices={choices} onDone={() => setEditing(false)} />}
    </li>
  );
}

/** Edit the question, the answer, the product and when it goes stale. */
function EditRow({ entry, choices, onDone }: { entry: KnowledgeEntry; choices: Choices; onDone: () => void }) {
  const toast = useToast();
  const [question, setQuestion] = React.useState(entry.question);
  const [answer, setAnswer] = React.useState(entry.answer);
  const [product, setProduct] = React.useState<ProductKey>(entry.product);
  const [expires, setExpires] = React.useState(entry.expiresAt ?? '');
  const [busy, setBusy] = React.useState(false);

  const save = async (status: 'approved' | 'draft') => {
    setBusy(true);
    const r = await decideKnowledgeAction({
      id: entry.id,
      status,
      question: question.trim(),
      answer: answer.trim(),
      product,
      expiresAt: expires || null,
    });
    setBusy(false);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'That did not save.' });
      return;
    }
    toast({ tone: 'ok', text: status === 'approved' ? 'Saved and approved.' : 'Saved.' });
    onDone();
  };

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border-subtle p-3">
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        aria-label="Question"
        className={cn(CONTROL, 'w-full px-3')}
      />
      <textarea
        value={answer}
        rows={3}
        onChange={(e) => setAnswer(e.target.value)}
        aria-label="Answer"
        className="w-full resize-y rounded-xl border border-border-default bg-bg-base px-3 py-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
      />
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-caption text-text-secondary">Category</span>
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value as ProductKey)}
            className={cn(CONTROL, 'w-[10rem] px-2.5')}
          >
            {choices.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-caption text-text-secondary">Goes stale on</span>
          <input
            type="date"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            className={cn(CONTROL, 'w-[10rem] px-2.5')}
          />
        </label>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onDone}
          className="rounded-xl border border-border-default px-3 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !question.trim() || !answer.trim()}
          onClick={() => void save('approved')}
          className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Save &amp; approve
        </button>
      </div>
      <p className="text-caption text-text-secondary">
        {PRODUCT_HINT[product]}. A stale date makes the agent stop saying it on that day.
      </p>
    </div>
  );
}

/* ── The policy strip ────────────────────────────────────────────────────── */

const MODES: ReadonlyArray<{ key: 'agent' | 'suggest' | 'off'; label: string }> = [
  { key: 'agent', label: 'AI agent' },
  { key: 'suggest', label: 'Suggestions' },
  { key: 'off', label: 'My reply' },
];

function Policy({
  board,
  onSaved,
  onEdit,
  editing,
  onClose,
  onOptimistic,
}: {
  board: KnowledgeBoard;
  onSaved: () => Promise<void>;
  onEdit: () => void;
  editing: boolean;
  onClose: () => void;
  /** Tell the page at once, so the project pill does not lag the click. */
  onOptimistic: (mode: 'off' | 'suggest' | 'agent' | null) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = React.useState(board.settings.agentModeDefault);
  const [product, setProduct] = React.useState<ProductKey | ''>(board.settings.product ?? '');
  const [busy, setBusy] = React.useState(false);
  const [seen, setSeen] = React.useState(board.settings);
  if (seen !== board.settings) {
    setSeen(board.settings);
    setMode(board.settings.agentModeDefault);
    setProduct(board.settings.product ?? '');
  }

  const save = async (next: typeof mode, nextProduct: ProductKey | '' = product) => {
    if (!board.canManage) {
      toast({
        tone: 'error',
        text: 'Only a manager can change the reply mode for this project.',
      });
      return;
    }
    /* ⚠️ REFUSED HERE, NOT AFTER A ROUND TRIP. The database refuses an AI
       agent with nothing approved to say (`crm_set_agent_settings`), and this
       screen already knows the count — so it says so in this frame instead of
       showing "Active" for two seconds and taking it back. Measured on Chitral
       Royal Homes, 2026-09-22, before this: Active → Active → Off. */
    if (next === 'agent' && board.approvedCount === 0) {
      toast({
        tone: 'error',
        text: 'Nothing is approved for this project yet, so the agent would have nothing to say. Approve or add an answer first.',
      });
      return;
    }
    setMode(next);
    setProduct(nextProduct);
    /* ⚠️ THE WHOLE STRIP MOVES NOW, not after the round trip. The pill beside
       the project name reads the board, which takes 2–5 seconds to come back —
       so it still said "Off" after the owner had switched to AI agent, and the
       policy looked broken when the write had already succeeded. */
    onOptimistic(next);
    setBusy(true);
    const r = await saveAgentSettingsAction({
      projectId: board.projectId,
      product: nextProduct === '' || nextProduct === 'any' ? null : nextProduct,
      mode: next,
    });
    setBusy(false);
    if (!r.ok) {
      setMode(board.settings.agentModeDefault);
      setProduct(board.settings.product ?? '');
      onOptimistic(null);
      toast({ tone: 'error', text: r.error ?? 'That did not save.' });
      return;
    }
    toast({
      tone: 'ok',
      text:
        next === 'agent'
          ? 'New leads here are answered by the AI agent.'
          : next === 'suggest'
            ? 'The agent drafts a reply for you to send.'
            : 'You answer new leads here yourself.',
    });
    await onSaved();
    onOptimistic(null);
  };

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-surface px-5 py-4 shadow-sm">
      <h2 className="text-h3 font-semibold text-text-primary">Agent response policy</h2>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
        {/* ⚠️ LOCKED, AND IT SAYS SO WHEN YOU PRESS IT. These two were drawn as
            a switch and a dropdown and did nothing at all — the owner pressed
            them and reported the policy broken, which was fair: a control that
            looks alive and is not IS broken. They are real controls now, marked
            disabled for assistive tech, carrying a lock, and pressing either
            explains why it cannot move rather than swallowing the click.

            Why they cannot move: the agent may state only approved, unexpired
            answers (`app.crm_knowledge_for` returns nothing else), and when it
            has none it hands over. That is the fence the owner asked for, not a
            preference. */}
        <button
          type="button"
          role="switch"
          aria-checked
          aria-disabled
          onClick={() =>
            toast({
              tone: 'ok',
              text: 'Always on: the agent may only ever say an answer somebody approved here.',
            })
          }
          className="flex items-center gap-2.5 rounded-xl px-1 py-1 text-left transition-colors hover:bg-bg-subtle"
        >
          <span className="inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-accent-primary p-0.5">
            <span className="size-5 translate-x-5 rounded-full bg-white shadow-sm" />
          </span>
          <span className="text-body-sm font-medium text-text-primary">Use approved knowledge only</span>
          <Lock className="size-3.5 text-text-tertiary" aria-hidden="true" />
        </button>

        <span className="hidden h-6 w-px bg-border-subtle sm:block" aria-hidden="true" />

        <span className="flex items-center gap-2.5">
          <span className="text-body-sm text-text-secondary">When no answer exists</span>
          <button
            type="button"
            aria-disabled
            onClick={() =>
              toast({
                tone: 'ok',
                text: 'Always a hand-off: with nothing approved to say, the agent passes the client to you rather than guessing.',
              })
            }
            className={cn(CONTROL, 'inline-flex items-center gap-2 px-3 text-text-primary hover:bg-bg-subtle')}
          >
            Hand off to salesperson
            <Lock className="size-3.5 text-text-tertiary" aria-hidden="true" />
          </button>
        </span>

        <span className="hidden h-6 w-px bg-border-subtle sm:block" aria-hidden="true" />

        <span className="flex items-center gap-2.5">
          <span className="text-body-sm text-text-secondary">Reply mode</span>
          <span className="inline-flex rounded-xl border border-border-default bg-bg-surface p-1">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                disabled={busy || !board.canManage}
                onClick={() => void save(m.key)}
                aria-pressed={mode === m.key}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-caption font-semibold transition-colors disabled:opacity-60',
                  mode === m.key ? 'bg-accent-primary text-white' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {m.label}
              </button>
            ))}
          </span>
        </span>

        <span className="flex-1" />
        <button
          type="button"
          onClick={editing ? onClose : onEdit}
          className="inline-flex items-center gap-2 rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
        >
          <Settings2 className="size-4" aria-hidden="true" /> {editing ? 'Done' : 'Edit policy'}
        </button>
      </div>

      <p className="mt-2.5 text-caption text-text-secondary">
        Draft and review items are never sent to customers. The two locked settings are how the agent is built; the
        reply mode is yours to change.
        {!board.canManage && ' Only a manager can change it.'}
      </p>

      {editing && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border-subtle pt-3">
          <label className="block">
            <span className="mb-1 block text-caption text-text-secondary">What this project sells</span>
            <select
              value={product}
              disabled={!board.canManage}
              onChange={(e) => void save(mode, e.target.value as ProductKey | '')}
              className={cn(CONTROL, 'w-[12rem] px-2.5')}
            >
              <option value="">Not set</option>
              {/* ⚠️ THE FULL LIST, DELIBERATELY. Everywhere else offers only the
                  project's own products — this is the one control that DECIDES
                  what the project sells, so it cannot be limited by the answer. */}
              {ALL_PRODUCTS.map((k) => (
                <option key={k} value={k}>{PRODUCT_LABEL[k]}</option>
              ))}
            </select>
          </label>
          <p className="min-w-[14rem] flex-1 text-caption text-text-secondary">
            New leads on this project start in the reply mode above. “Use approved knowledge only” and “hand off when
            nothing answers” are how the agent is built and cannot be switched off here.
          </p>
        </div>
      )}
    </section>
  );
}

/* ── Sources ─────────────────────────────────────────────────────────────── */

function Sources({
  board,
  choices,
  onPreview,
  onChanged,
  onUpload,
  onDelete,
}: {
  board: KnowledgeBoard;
  choices: Choices;
  onPreview: (d: KnowledgeDocument) => void;
  onChanged: () => Promise<void>;
  onUpload: () => void;
  onDelete: (d: KnowledgeDocument) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  const read = async (d: KnowledgeDocument) => {
    setBusy(d.id);
    const r = await readDocumentAction({ projectId: board.projectId, documentId: d.id });
    setBusy(null);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'That document could not be read.' });
      return;
    }
    toast({
      tone: 'ok',
      text: `${r.added ?? 0} drafted${r.dropped ? `, ${r.dropped} discarded` : ''}${
        r.invented ? `, ${r.invented} invented and dropped` : ''
      }.`,
    });
    await onChanged();
  };

  return (
    <Panel
      title="Source documents"
      chip={{ text: `${board.documents.length} files`, tone: TONE.sources }}
      action={{ label: 'Upload source', onClick: onUpload }}
    >
      {board.documents.length === 0 ? (
        <Empty text="Nothing uploaded yet. The agent can only read PDFs." />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {board.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2.5 px-5 py-3.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: tint('red', 12) }}>
                <FileText className="size-4.5" style={{ color: ink('red') }} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-sm font-semibold text-text-primary">{d.title}</span>
                <span className="block truncate text-caption text-text-secondary">
                  {d.kind.replace(/_/g, ' ')} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB
                  {d.mime !== 'application/pdf' && ' · the agent cannot read this kind'}
                </span>
              </span>
              <select
                aria-label={`What ${d.title} is about`}
                value={d.product}
                onChange={async (e) => {
                  const r = await setDocumentProductAction(d.id, e.target.value);
                  if (!r.ok) {
                    toast({ tone: 'error', text: r.error ?? 'That did not save.' });
                    return;
                  }
                  await onChanged();
                }}
                className={cn(CONTROL, 'w-[9rem] shrink-0 px-2.5')}
              >
                {choices.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <Pill tone={d.readAt ? 'green' : 'grey'}>{d.readAt ? `Read ${shortDay(d.readAt)}` : 'Not read'}</Pill>
              <button
                type="button"
                onClick={() => onPreview(d)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1.5 text-caption font-semibold text-text-primary hover:bg-bg-subtle"
              >
                <Eye className="size-3.5" aria-hidden="true" /> View
              </button>
              {d.mime === 'application/pdf' && (
                <button
                  type="button"
                  disabled={busy === d.id}
                  onClick={() => void read(d)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent-primary px-2.5 py-1.5 text-caption font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {busy === d.id ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                  )}
                  {d.readAt ? 'Read again' : 'Read it'}
                </button>
              )}
              {board.canDelete && (
                <button
                  type="button"
                  aria-label={`Delete ${d.title}`}
                  onClick={() => onDelete(d)}
                  className="grid size-8 shrink-0 place-items-center rounded-lg border transition-colors hover:bg-bg-subtle"
                  style={{ borderColor: 'color-mix(in oklab, var(--feedback-error) 45%, var(--border-default))' }}
                >
                  <Trash2 className="size-4" style={{ color: ink('red') }} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ── Deleting a source ──────────────────────────────────────────────────── */

function SourceMenu({
  canDelete,
  onRead,
  onDelete,
}: {
  canDelete: boolean;
  onRead: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <span ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label="More"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid size-8 place-items-center rounded-lg border border-border-default text-text-secondary hover:bg-bg-subtle"
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </button>
      {open && (
        <span className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-border-subtle bg-bg-surface py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onRead();
            }}
            className="block w-full px-3 py-2 text-left text-body-sm text-text-primary hover:bg-bg-subtle"
          >
            Read again or change product
          </button>
          {canDelete ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
              className="block w-full px-3 py-2 text-left text-body-sm hover:bg-bg-subtle"
              style={{ color: ink('red') }}
            >
              Delete source…
            </button>
          ) : (
            <span className="block px-3 py-2 text-caption text-text-secondary">Only an admin can delete a source.</span>
          )}
        </span>
      )}
    </span>
  );
}

/**
 * Confirm a delete, and say exactly what goes with it.
 *
 * ⚠️ THE ANSWERS GO TOO, BY DEFAULT. Owner, 2026-09-22: *"This information is
 * old information and I want to delete it. I want my agent to respond with the
 * latest information."* An answer drawn from the document would otherwise stay
 * approved and the agent would keep saying it — the column is ON DELETE SET
 * NULL. The box can be unticked for the rare answer a person has since made
 * true in their own words.
 */
function DeleteSource({
  doc,
  answers,
  onClose,
  onConfirm,
}: {
  doc: KnowledgeDocument;
  answers: readonly KnowledgeEntry[];
  onClose: () => void;
  onConfirm: (withAnswers: boolean) => void;
}) {
  const [withAnswers, setWithAnswers] = React.useState(true);
  const approved = answers.filter((a) => a.status === 'approved').length;
  const drafts = answers.filter((a) => a.status === 'draft').length;

  return (
    <Shell title="Delete this source?" subtitle={doc.title} onClose={onClose}>
      <p className="text-body-sm text-text-primary">
        The file is removed from this project and the agent will not read it again.
      </p>

      {answers.length > 0 ? (
        <label className="mt-3 flex items-start gap-2.5 rounded-xl border border-border-subtle p-3">
          <input
            type="checkbox"
            checked={withAnswers}
            onChange={(e) => setWithAnswers(e.target.checked)}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="block text-body-sm font-semibold text-text-primary">
              Also remove the {answers.length} answer{answers.length === 1 ? '' : 's'} drawn from it
            </span>
            <span className="block text-caption text-text-secondary">
              {approved} approved{drafts ? ` and ${drafts} waiting for review` : ''}.{' '}
              {withAnswers
                ? 'The agent will stop saying them straight away.'
                : 'Left unticked, the approved ones stay and the agent keeps saying them, with no source behind them.'}
            </span>
          </span>
        </label>
      ) : (
        <p className="mt-3 text-caption text-text-secondary">No answer on this page was drawn from it.</p>
      )}

      <p className="mt-3 text-caption text-text-secondary">This cannot be undone. Upload the new version to replace it.</p>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={() => onConfirm(withAnswers)}
          className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-body-sm font-semibold text-white hover:opacity-90"
          style={{ background: 'var(--feedback-error)' }}
        >
          <Trash2 className="size-4" aria-hidden="true" /> Delete source
        </button>
      </div>
    </Shell>
  );
}

/* ── Ask as a customer ───────────────────────────────────────────────────── */

function AskBox({ board, onOpenDrawer }: { board: KnowledgeBoard; onOpenDrawer: () => void }) {
  const [question, setQuestion] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof askAgentAction>> | null>(null);

  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setResult(null);
    const r = await askAgentAction(board.projectId, question);
    setBusy(false);
    setResult(r);
  };

  return (
    <section id="ask-as-a-customer" className="rounded-2xl border border-border-subtle bg-bg-surface px-5 py-4 shadow-sm">
      <h2 className="text-h3 font-semibold text-text-primary">Ask as a customer</h2>
      {/* ⚠️ THE REAL AGENT, AND NOTHING IS SENT. It builds the same brief the
          live runner builds and calls the same model; there is no lead, no
          WhatsApp and no record. A look-up over the approved answers would pass
          questions the live agent fails. */}
      <p className="mt-0.5 text-caption text-text-secondary">
        The real agent answers, using only this project&rsquo;s approved knowledge. Nothing is sent to anybody.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void ask();
          }}
          placeholder="Can your CRM connect to WhatsApp?"
          aria-label="Ask the agent a question"
          className={cn(CONTROL, 'min-w-[10rem] flex-1 px-3')}
        />
        <button
          type="button"
          disabled={busy || !question.trim()}
          onClick={() => void ask()}
          className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
          Ask agent
        </button>
      </div>

      {result && (
        <div className="mt-3 rounded-xl border border-border-subtle p-3">
          {result.error ? (
            <p className="text-body-sm" style={{ color: ink('red') }}>{result.error}</p>
          ) : result.answer ? (
            <>
              <div className="flex flex-wrap items-start gap-2">
                <p className="min-w-0 flex-1 whitespace-pre-line text-body-sm text-text-primary">{result.answer}</p>
                <Pill tone="green">
                  <CheckCircle2 className="size-3.5" aria-hidden="true" /> Approved answer
                </Pill>
              </div>
              {result.documents && result.documents.length > 0 && (
                <p className="mt-2 text-caption text-text-secondary">Would also send: {result.documents.join(', ')}</p>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-start gap-2">
              <p className="min-w-0 flex-1 text-body-sm text-text-primary">{result.handover}</p>
              <Pill tone="amber">Hand off</Pill>
            </div>
          )}
        </div>
      )}

      <p className="mt-2.5 flex items-start gap-1.5 text-caption text-text-secondary">
        <Info className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
        No approved answer → hand off to salesperson.
        <span className="flex-1" />
        <button type="button" onClick={onOpenDrawer} className="shrink-0 font-semibold text-text-brand hover:underline">
          Test a whole conversation
        </button>
      </p>
    </section>
  );
}

/* ── Writing an answer, and uploading a source ───────────────────────────── */

function Shell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  /* ⚠️ The page column carries a transform, which becomes the containing block
     for anything `fixed` inside it — so the veil is portalled, like every other
     dialog in the CRM. */
  const body = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 bg-black/45" />
      <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col rounded-2xl border border-border-subtle bg-bg-surface shadow-xl">
        <div className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-body font-semibold text-text-primary">{title}</h2>
            <p className="mt-0.5 text-caption text-text-secondary">{subtitle}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}

function WriteAnswer({
  board,
  choices,
  onClose,
  onSaved,
}: {
  board: KnowledgeBoard;
  choices: Choices;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [question, setQuestion] = React.useState('');
  const [answer, setAnswer] = React.useState('');
  /* The project's own product, or the catch-all — never one it does not sell. */
  const [product, setProduct] = React.useState<ProductKey>(
    board.settings.product && choices.some((c) => c.value === board.settings.product)
      ? board.settings.product
      : 'any',
  );
  const [expires, setExpires] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    const r = await addKnowledgeAction({
      projectId: board.projectId,
      product,
      question: question.trim(),
      answer: answer.trim(),
      expiresAt: expires || null,
      approve: true,
    });
    setBusy(false);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'That did not save.' });
      return;
    }
    await onSaved();
  };

  return (
    <Shell title="Add an answer" subtitle="Write it once, and the agent may say it from now on." onClose={onClose}>
      <label className="block">
        <span className="mb-1 block text-caption font-semibold text-text-secondary">What a client asks</span>
        <input
          autoFocus
          value={question}
          onChange={(e) => {
            setQuestion(e.target.value);
            const guess = productFromWords(e.target.value);
            /* ⚠️ Only a product THIS project has. A plots project must not have
               an answer quietly filed under CRM because the word appeared. */
            if (guess && choices.some((c) => c.value === guess)) setProduct(guess as ProductKey);
          }}
          placeholder="How long does deployment take?"
          className={cn(CONTROL, 'w-full px-3')}
        />
      </label>
      <label className="mt-3 block">
        <span className="mb-1 block text-caption font-semibold text-text-secondary">What the agent may answer</span>
        <textarea
          rows={4}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Two to three weeks from the signed order."
          className="w-full resize-y rounded-xl border border-border-default bg-bg-base px-3 py-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-caption font-semibold text-text-secondary">Category</span>
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value as ProductKey)}
            className={cn(CONTROL, 'w-[11rem] px-2.5')}
          >
            {choices.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-semibold text-text-secondary">Goes stale on (optional)</span>
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={cn(CONTROL, 'w-[11rem] px-2.5')} />
        </label>
      </div>
      <p className="mt-2 text-caption text-text-secondary">{PRODUCT_HINT[product]}.</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !question.trim() || !answer.trim()}
          onClick={() => void save()}
          className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Save &amp; approve
        </button>
      </div>
      {/* ⚠️ A person writing the answer IS the approval. They are the source;
          asking them to approve their own sentence on a second screen is
          ceremony (the rule `addKnowledgeAction` already carries). */}
    </Shell>
  );
}

function UploadSource({
  board,
  choices,
  onClose,
  onDone,
}: {
  board: KnowledgeBoard;
  choices: Choices;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const toast = useToast();
  /* ⚠️ AS MANY AS THEY LIKE. Owner, 2026-09-22: *"… and upload as many."*
     One title box when there is one file; each file's own name when there are
     several, because nobody wants to name eight files one by one. */
  const [files, setFiles] = React.useState<File[]>([]);
  const [progress, setProgress] = React.useState<string | null>(null);
  const file = files[0] ?? null;
  const [title, setTitle] = React.useState('');
  /* The project's own product, or the catch-all — never one it does not sell. */
  const [product, setProduct] = React.useState<ProductKey>(
    board.settings.product && choices.some((c) => c.value === board.settings.product)
      ? board.settings.product
      : 'any',
  );
  const [kind, setKind] = React.useState('brochure');
  const [busy, setBusy] = React.useState(false);
  const [readNow, setReadNow] = React.useState(true);

  const go = async () => {
    if (files.length === 0) return;
    setBusy(true);
    let uploaded = 0;
    let drafted = 0;
    const failed: string[] = [];
    for (const [i, f] of files.entries()) {
      setProgress(`Uploading ${i + 1} of ${files.length}…`);
      const r = await uploadOne(f, files.length === 1 ? title.trim() : '');
      if (!r.ok) {
        failed.push(`${f.name}: ${r.error}`);
        continue;
      }
      uploaded += 1;
      drafted += r.drafted;
    }
    setProgress(null);
    setBusy(false);
    if (uploaded > 0) {
      toast({
        tone: failed.length ? 'error' : 'ok',
        text:
          `Uploaded ${uploaded} source${uploaded === 1 ? '' : 's'}` +
          (readNow ? ` and drafted ${drafted} answer${drafted === 1 ? '' : 's'} for review` : '') +
          (failed.length ? `. ${failed.length} failed — ${failed[0]}` : '.'),
      });
      await onDone();
    } else {
      toast({ tone: 'error', text: failed[0] ?? 'Nothing could be uploaded.' });
    }
  };

  const uploadOne = async (f: File, named: string): Promise<{ ok: true; drafted: number } | { ok: false; error: string }> => {
    const form = new FormData();
    form.set('projectId', board.projectId);
    form.set('title', named || f.name.replace(/\.[^.]+$/, ''));
    form.set('kind', kind);
    form.set('product', product);
    form.set('file', f);
    /* ⚠️ IT IS A `useActionState` ACTION, so the previous state comes first.
       Passing only the form silently loses the file on some builds. */
    const up = await uploadCrmDocumentAction({ ok: false }, form);
    if (!up.ok) return { ok: false, error: up.error ?? 'it could not be uploaded' };
    if (readNow && up.id && f.type === 'application/pdf') {
      const r = await readDocumentAction({ projectId: board.projectId, documentId: up.id });
      return { ok: true, drafted: r.ok ? r.added ?? 0 : 0 };
    }
    return { ok: true, drafted: 0 };
  };

  return (
    <Shell title="Upload sources" subtitle="PDFs the agent may draft answers from — choose as many as you like." onClose={onClose}>
      <input
        type="file"
        multiple
        accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          setFiles(list);
          const f = list[0] ?? null;
          if (f) {
            const base = f.name.replace(/\.[^.]+$/, '');
            setTitle(base);
            const p = productFromWords(base);
            if (p && choices.some((c) => c.value === p)) setProduct(p as ProductKey);
            const k = documentKindFromWords(base);
            if (k) setKind(k);
          }
        }}
        className="block w-full rounded-xl border border-dashed border-border-default px-3 py-6 text-body-sm text-text-secondary"
      />
      {files.length > 1 ? (
        <ul className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded-xl border border-border-subtle p-2">
          {files.map((f) => (
            <li key={f.name} className="flex items-center gap-2 text-caption text-text-primary">
              <FileText className="size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{f.name.replace(/\.[^.]+$/, '')}</span>
              <span className="shrink-0 text-text-secondary">{Math.max(1, Math.round(f.size / 1024))} KB</span>
            </li>
          ))}
        </ul>
      ) : (
        <label className="mt-3 block">
          <span className="mb-1 block text-caption font-semibold text-text-secondary">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={cn(CONTROL, 'w-full px-3')} />
        </label>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-caption font-semibold text-text-secondary">What it is about</span>
          <select value={product} onChange={(e) => setProduct(e.target.value as ProductKey)} className={cn(CONTROL, 'w-[11rem] px-2.5')}>
            {choices.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-semibold text-text-secondary">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={cn(CONTROL, 'w-[11rem] px-2.5')}>
            {/* ⚠️ THE DATABASE'S OWN KINDS. This list offered "proposal", which
                is not one, so every upload marked that way was refused. */}
            {[
              ['brochure', 'Brochure or proposal'],
              ['price_list', 'Price list'],
              ['quotation', 'Quotation'],
              ['site_plan', 'Site plan'],
              ['legal', 'Legal'],
              ['letterhead', 'Letterhead'],
              ['other', 'Other'],
            ].map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-body-sm text-text-primary">
        <input type="checkbox" checked={readNow} onChange={(e) => setReadNow(e.target.checked)} />
        Read it now and draft answers for review
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle"
        >
          Cancel
        </button>
        {progress && <span className="mr-auto self-center text-caption text-text-secondary">{progress}</span>}
        <button
          type="button"
          disabled={busy || !file}
          onClick={() => void go()}
          className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {files.length > 1 ? `Upload ${files.length} files` : 'Upload'}
        </button>
      </div>
    </Shell>
  );
}

/* ── Words ───────────────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "22 Sep 2026" — built by hand, because ICU writes "Sept" in en-GB. */
function shortDay(iso: string): string {
  const d = new Date(Date.parse(iso) + 5 * 3_600_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const momentTone = (kind: string): Tone =>
  kind === 'approved' ? 'green' : kind === 'drafted' ? 'amber' : kind === 'gap' ? 'red' : 'blue';

const momentVerb = (kind: string) =>
  kind === 'approved' ? 'Approved' : kind === 'drafted' ? 'Drafted' : kind === 'gap' ? 'Could not answer' : kind === 'read' ? 'Read' : 'Uploaded';

function MomentIcon({ kind }: { kind: string }) {
  const tone = momentTone(kind);
  const style = { color: ink(tone) };
  if (kind === 'approved') return <Check className="size-3.5" style={style} aria-hidden="true" />;
  if (kind === 'drafted') return <Clock3 className="size-3.5" style={style} aria-hidden="true" />;
  if (kind === 'gap') return <AlertTriangle className="size-3.5" style={style} aria-hidden="true" />;
  if (kind === 'read') return <ActivityIcon className="size-3.5" style={style} aria-hidden="true" />;
  return <Upload className="size-3.5" style={style} aria-hidden="true" />;
}
