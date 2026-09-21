'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Eye, FileText, Loader2, Plus, RefreshCw, Sparkles, Upload, X } from 'lucide-react';

import { uploadCrmDocumentAction } from '@/app/actions/crm-documents';
import {
  addKnowledgeAction,
  decideKnowledgeAction,
  knowledgeBoardAction,
  readDocumentAction,
  saveAgentSettingsAction,
  setDocumentProductAction,
} from '@/app/actions/crm-knowledge';
import { DocumentPreview } from '@/components/crm/document-preview';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import type { KnowledgeBoard, KnowledgeDocument, KnowledgeEntry, ProductKey } from '@/lib/db/queries/crm-knowledge';
import { cn } from '@/lib/utils';

/* ============================================================================
 * WHAT THE AGENT KNOWS
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-20: *"give me some chatbot or something like that where I can
 * guide, instruct, or give knowledge to my AI agent."*
 *
 * A list somebody can finish. Every drafted answer shows the sentence it came
 * from, because approving an answer you cannot check is not approval.
 *
 * ── ⚠️ EVERY DECISION IS OPTIMISTIC ────────────────────────────────────────
 * Approving fifteen answers is fifteen clicks, and a screen that waits for a
 * round trip on each one is a screen nobody finishes. The row moves in its own
 * frame and the write follows; if it fails the row goes back and says so.
 * ========================================================================= */

const PRODUCTS: ReadonlyArray<{ key: ProductKey; label: string; hint: string }> = [
  { key: 'any', label: 'All products', hint: 'True whatever they asked about — including that we can merge them' },
  { key: 'taskly', label: 'Taskly', hint: 'Tasks, projects, team, finance, expenses, attendance' },
  { key: 'crm', label: 'CRM', hint: 'Lead management' },
  { key: 'erp', label: 'ERP', hint: 'Inventory management' },
  { key: 'whatsapp', label: 'WhatsApp', hint: 'WhatsApp Business API automation' },
];

const productLabel = (key: ProductKey) => PRODUCTS.find((p) => p.key === key)?.label ?? key;

export function KnowledgeBoardScreen({
  projects,
  board: initial,
}: {
  projects: ReadonlyArray<{ id: string; name: string }>;
  board: KnowledgeBoard | null;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();

  const [board, setBoard] = React.useState<KnowledgeBoard | null>(initial);
  const [reading, setReading] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [gaps, setGaps] = React.useState<readonly string[]>([]);

  /**
   * ⚠️ "LOADING" AND "THERE IS NOTHING" ARE DIFFERENT ANSWERS AND LOOKED THE
   * SAME. `board === null` meant both, so when the server legitimately returned
   * nothing the screen sat on *"Reading this project's knowledge…"* with no end
   * — the owner watched it do exactly that. Rule Zero's honesty rule, inverted:
   * a spinner shown for an answer that has already arrived is a lie the same way
   * an empty state shown for data still in flight is.
   *
   * This is only true while a fetch is genuinely in flight.
   */
  const [loading, setLoading] = React.useState(false);

  /* ⚠️ THE URL RECORDS WHICH PROJECT IS OPEN; IT DOES NOT DECIDE WHEN IT OPENS.
     Rule Zero law 2 — the board is replaced in the click's own frame and the
     address bar catches up behind it.

     ⚠️ AND THE SERVER'S BOARD IS ADOPTED DURING RENDER, NOT IN AN EFFECT. A
     `useEffect` that calls setState renders twice for every arrival and trips
     `react-hooks/set-state-in-effect`; comparing the prop to what was last seen
     does the same job in one pass. */
  const urlProject = search.get('project');
  const [seen, setSeen] = React.useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    if (initial) setBoard(initial);
  }

  const chosen = board?.projectId ?? urlProject ?? projects[0]?.id ?? null;

  const switchProject = (id: string) => {
    if (id === chosen) return;
    setBoard(null);
    setLoading(true);
    const next = new URLSearchParams(search.toString());
    next.set('project', id);
    router.replace(`/knowledge?${next.toString()}` as never, { scroll: false });
    void knowledgeBoardAction(id)
      .then((b) => setBoard(b))
      .finally(() => setLoading(false));
  };

  const refresh = React.useCallback(async () => {
    if (!chosen) return;
    const next = await knowledgeBoardAction(chosen);
    if (next) setBoard(next);
  }, [chosen]);

  /** Move a row now; put it back if the server disagrees. */
  const decide = (entry: KnowledgeEntry, status: KnowledgeEntry['status'], patch?: Partial<KnowledgeEntry>) => {
    if (!board) return;
    const before = board.entries;
    setBoard({
      ...board,
      entries: board.entries.map((e) => (e.id === entry.id ? { ...e, ...patch, status } : e)),
    });
    void decideKnowledgeAction({
      id: entry.id,
      status,
      question: patch?.question,
      answer: patch?.answer,
      product: patch?.product,
    }).then((r) => {
      if (r.ok) return;
      setBoard((b) => (b ? { ...b, entries: before } : b));
      toast({ tone: 'error', text: r.error ?? 'That did not save.' });
    });
  };

  /* 231 · read as the product the document is filed under — chosen once, at
     upload, not again every time it is read. */
  const read = async (documentId: string) => {
    setReading(documentId);
    try {
      const r = await readDocumentAction({ projectId: chosen!, documentId });
      if (!r.ok) {
        toast({ tone: 'error', text: r.error ?? 'That document could not be read.' });
        return;
      }
      setGaps(r.gaps ?? []);
      await refresh();
      /* ⚠️ SAY WHAT WAS DISCARDED. An extractor that keeps three of fifteen and
         reports only the three looks like a thin document rather than a broken
         read — which is exactly how the two-column bug hid. */
      const aside = [
        r.dropped ? `${r.dropped} could not be traced to a sentence` : null,
        r.invented ? `${r.invented} named a product we do not sell` : null,
      ].filter(Boolean).join(', ');
      toast({
        tone: 'ok',
        text: `${r.added} new answer${r.added === 1 ? '' : 's'} to review${aside ? ` · ${aside}` : ''}.`,
      });
    } finally {
      setReading(null);
    }
  };

  const drafts = board?.entries.filter((e) => e.status === 'draft') ?? [];
  const approved = board?.entries.filter((e) => e.status === 'approved') ?? [];
  const rejected = board?.entries.filter((e) => e.status === 'rejected') ?? [];

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      <PageHeader
        eyebrow="AI agent"
        title="What the agent knows"
        description="The agent may only state a fact that is approved here. Everything else, it hands to you."
        actions={
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2.5 text-body-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" aria-hidden="true" /> Write an answer
          </button>
        }
      />

      {projects.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => switchProject(p.id)}
              className={cn(
                'rounded-xl border px-3 py-1.5 text-body-sm transition-colors',
                p.id === chosen
                  ? 'border-transparent bg-accent-primary text-white'
                  : 'border-border-default text-text-primary hover:bg-bg-subtle',
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {!board && loading ? (
        <p className="flex items-center gap-2 rounded-2xl border border-border-subtle bg-bg-surface p-6 text-body-sm text-text-secondary">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Reading this project&rsquo;s knowledge…
        </p>
      ) : !board ? (
        /* ⚠️ A REASON, NOT A SPINNER. The board is null when there is no project
           to read or the caller may not read it — both are answers, and both
           used to show as "Reading…" for ever. */
        <div className="rounded-2xl border border-border-subtle bg-bg-surface p-6">
          <p className="text-body-sm font-medium text-text-primary">
            {projects.length === 0
              ? 'No project is visible to you yet.'
              : 'That project could not be opened.'}
          </p>
          <p className="mt-1 text-caption text-text-secondary">
            {projects.length === 0
              ? 'The knowledge base belongs to a project, so one has to exist before there is anything to teach the agent.'
              : 'Pick another project above, or ask an admin whether this one is yours to work on.'}
          </p>
        </div>
      ) : (
        <>
          <AgentSettings key={`settings-${board.projectId}`} board={board} onSaved={refresh} />

          <Documents
            key={`docs-${board.projectId}`}
            board={board}
            reading={reading}
            onRead={(id) => void read(id)}
            onUploaded={async (id, isPdf) => {
              await refresh();
              /* ⚠️ READ AS SOON AS IT ARRIVES. Owner: *"Once I upload the CRM
                 the agent will read them and keep that in our knowledge."* A
                 separate "now press Read" step is a step somebody forgets. */
              if (isPdf) await read(id);
              else toast({ tone: 'ok', text: 'Uploaded. It can be sent from a lead’s Files.' });
            }}
          />

          {gaps.length > 0 && <Gaps gaps={gaps} projectId={board.projectId} onWritten={refresh} onDismiss={() => setGaps([])} />}

          <Section
            title={`To review (${drafts.length})`}
            note="Drafted from your documents. Nothing here can be said to a client yet."
            empty="Nothing waiting. Read a document above to draft more."
          >
            {drafts.map((e) => (
              <Row key={e.id} entry={e} onDecide={decide} />
            ))}
          </Section>

          <Section
            title={`Approved (${approved.length})`}
            note="The agent may state these, word for word or in its own words."
            empty="Nothing approved yet."
          >
            {approved.map((e) => (
              <Row key={e.id} entry={e} onDecide={decide} />
            ))}
          </Section>

          {rejected.length > 0 && (
            <Section title={`Rejected (${rejected.length})`} note="Kept, so nobody drafts them again." empty="">
              {rejected.map((e) => (
                <Row key={e.id} entry={e} onDecide={decide} />
              ))}
            </Section>
          )}
        </>
      )}

      {adding && chosen && (
        <WriteAnswer
          projectId={chosen}
          onClose={() => setAdding(false)}
          onWritten={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

/* ---- What this campaign sells, and who answers its new leads ------------ */

const MODES: ReadonlyArray<{ key: 'off' | 'suggest' | 'agent'; label: string; hint: string }> = [
  { key: 'agent', label: 'AI agent', hint: 'Answers new leads by itself, and hands over when unsure' },
  { key: 'suggest', label: 'Suggestions', hint: 'Drafts a reply; a salesperson sends it' },
  { key: 'off', label: 'My reply', hint: 'No AI — salespeople answer' },
];

function AgentSettings({ board, onSaved }: { board: KnowledgeBoard; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [product, setProduct] = React.useState<string>(board.settings.product ?? '');
  const [mode, setMode] = React.useState(board.settings.agentModeDefault);
  const [saving, setSaving] = React.useState(false);
  const changed = product !== (board.settings.product ?? '') || mode !== board.settings.agentModeDefault;

  const save = async () => {
    setSaving(true);
    try {
      const r = await saveAgentSettingsAction({ projectId: board.projectId, product: product || null, mode });
      if (!r.ok) {
        toast({ tone: 'error', text: r.error ?? 'That did not save.' });
        return;
      }
      toast({ tone: 'ok', text: 'Saved for every new lead on this project.' });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const ready = board.approvedCount > 0;
  const tint = ready ? 'var(--feedback-success)' : 'var(--feedback-warning)';

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold text-text-primary">The agent for this campaign</h2>
          {/* ⚠️ READY OR NOT, SAID IN WORDS. The agent only speaks from approved
              answers, so "0 approved" is the difference between an agent that
              answers and one that hands every message straight to you. */}
          <p className="mt-0.5 text-caption text-text-secondary">
            {ready
              ? `Ready — it may use ${board.approvedCount} approved answer${board.approvedCount === 1 ? '' : 's'}. Anything else, it hands to a salesperson.`
              : 'Not ready yet — approve at least one answer below and it can start.'}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-caption font-semibold"
          style={{ color: tint, background: `color-mix(in oklab, ${tint} 12%, transparent)` }}
        >
          {ready ? '● Ready' : '● Not ready'}
        </span>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <label className="block text-caption text-text-secondary">
          This campaign sells
          <select
            value={product}
            disabled={!board.canManage}
            onChange={(e) => setProduct(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary disabled:opacity-60"
          >
            <option value="">Work it out from each lead&rsquo;s campaign</option>
            {PRODUCTS.filter((p) => p.key !== 'any').map((p) => (
              <option key={p.key} value={p.key}>{p.label} — {p.hint}</option>
            ))}
          </select>
        </label>

        <fieldset className="min-w-0">
          <legend className="text-caption text-text-secondary">New leads are answered by</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                disabled={!board.canManage}
                onClick={() => setMode(m.key)}
                aria-pressed={mode === m.key}
                title={m.hint}
                className={cn(
                  'rounded-xl border px-3 py-1.5 text-body-sm transition-colors disabled:opacity-60',
                  mode === m.key
                    ? 'border-transparent bg-accent-primary text-white'
                    : 'border-border-default text-text-primary hover:bg-bg-subtle',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-caption text-text-secondary">{MODES.find((m) => m.key === mode)?.hint}</p>
        </fieldset>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-caption text-text-secondary">
          {board.canManage
            ? 'Leads already in the CRM keep their own setting — change one from its chat.'
            : 'Only a sales manager or an admin can change these.'}
        </p>
        {board.canManage && (
          <button
            type="button"
            disabled={!changed || saving}
            onClick={() => void save()}
            className="shrink-0 rounded-xl bg-accent-primary px-4 py-2 text-body-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
    </section>
  );
}

/* ---- The documents this project sends and the agent reads --------------- */

const KINDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'brochure', label: 'Proposal / brochure' },
  { key: 'quotation', label: 'Quotation' },
  { key: 'price_list', label: 'Price list' },
  { key: 'legal', label: 'Terms / legal' },
  { key: 'site_plan', label: 'Plan / drawing' },
  { key: 'other', label: 'Other' },
  /* ⚠️ MOVED HERE WITH THE REST OF THE SHELF (2026-09-21). It prints on every
     quotation PDF and is never sent to a client — the agent and the drawer
     both leave it out. One per project (178's unique index). */
  { key: 'letterhead', label: 'Letterhead (prints on quotations)' },
];
const kindLabel = (k: string) => KINDS.find((x) => x.key === k)?.label ?? k;

function Documents({
  board,
  reading,
  onRead,
  onUploaded,
}: {
  board: KnowledgeBoard;
  reading: string | null;
  onRead: (documentId: string) => void;
  onUploaded: (documentId: string, isPdf: boolean) => Promise<void>;
}) {
  const toast = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [picked, setPicked] = React.useState<File | null>(null);
  const [kind, setKind] = React.useState('brochure');
  const [product, setProduct] = React.useState<ProductKey>(board.settings.product ?? 'any');
  const [uploading, setUploading] = React.useState(false);
  const [viewing, setViewing] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<ProductKey | 'all'>('all');

  const upload = async () => {
    if (!picked) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', picked);
      form.set('projectId', board.projectId);
      form.set('title', picked.name.replace(/\.[a-z0-9]+$/i, ''));
      form.set('kind', kind);
      form.set('product', product);
      const done = await uploadCrmDocumentAction({ ok: false }, form);
      if (!done.ok || !done.id) {
        toast({ tone: 'error', text: done.error ?? 'That file could not be uploaded.' });
        return;
      }
      const isPdf = picked.type === 'application/pdf';
      setPicked(null);
      if (fileRef.current) fileRef.current.value = '';
      await onUploaded(done.id, isPdf);
    } finally {
      setUploading(false);
    }
  };

  const shown = board.documents.filter((d) => filter === 'all' || d.product === filter);

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-surface p-4">
      <h2 className="text-body font-semibold text-text-primary">Documents</h2>
      {/* ⚠️ WHERE EACH ONE GOES, SAID BEFORE UPLOADING. The owner's own rule
          (2026-09-21): a quotation appears in a lead's Quotations tab, every
          other document in its Files — each for leads interested in its product. */}
      <p className="mt-0.5 text-caption text-text-secondary">
        Everything a salesperson or the agent may send. Quotations appear in a lead&rsquo;s Quotations tab, everything
        else in its Files — shown to leads interested in that product. PDFs are read into answers for you to approve.
      </p>

      {/* ── Add one ─────────────────────────────────────────────────── */}
      <div className="mt-3 grid gap-2 rounded-xl border border-dashed border-border-default p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_minmax(0,10rem)_auto] sm:items-end">
        <label className="block min-w-0 text-caption text-text-secondary">
          File
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setPicked(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-body-sm text-text-primary file:mr-3 file:rounded-lg file:border-0 file:bg-bg-subtle file:px-3 file:py-1.5 file:text-body-sm file:text-text-primary"
          />
        </label>
        <label className="block text-caption text-text-secondary">
          What it is
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 w-full rounded-lg border border-border-default bg-bg-surface px-2.5 py-2 text-body-sm text-text-primary">
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </label>
        <label className="block text-caption text-text-secondary">
          About
          <select value={product} onChange={(e) => setProduct(e.target.value as ProductKey)} className="mt-1 w-full rounded-lg border border-border-default bg-bg-surface px-2.5 py-2 text-body-sm text-text-primary">
            {PRODUCTS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          disabled={!picked || uploading}
          onClick={() => void upload()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-primary px-4 py-2 text-body-sm font-semibold text-white disabled:opacity-40"
        >
          {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {/* ── Filter by product ───────────────────────────────────────── */}
      {board.documents.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(['all', ...PRODUCTS.map((p) => p.key)] as Array<ProductKey | 'all'>).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-caption transition-colors',
                filter === k ? 'border-transparent bg-accent-primary text-white' : 'border-border-default text-text-secondary hover:bg-bg-subtle',
              )}
            >
              {k === 'all' ? 'All' : productLabel(k)}{' '}
              ({k === 'all' ? board.documents.length : board.documents.filter((d) => d.product === k).length})
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="mt-3 text-body-sm text-text-secondary">
          {board.documents.length === 0 ? 'Nothing uploaded for this project yet.' : 'Nothing for this product yet.'}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border-subtle">
          {shown.map((d) => (
            <li key={d.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <FileText className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-medium text-text-primary">{d.title}</span>
                  <span className="block text-caption text-text-secondary">
                    {kindLabel(d.kind)}
                    {d.mime === 'application/pdf'
                      ? d.readAt ? ' · read into answers' : ' · not read yet'
                      : ' · not a PDF, so not read'}
                  </span>
                </span>
                <ProductPicker document={d} />
                <button
                  type="button"
                  onClick={() => setViewing(viewing === d.id ? null : d.id)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border-default px-3 py-1.5 text-caption font-medium text-text-primary hover:bg-bg-subtle"
                >
                  <Eye className="size-3.5" aria-hidden="true" /> {viewing === d.id ? 'Close' : 'View'}
                </button>
                {d.mime === 'application/pdf' && (
                  <button
                    type="button"
                    disabled={reading !== null}
                    onClick={() => onRead(d.id)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-border-default px-3 py-1.5 text-caption font-medium text-text-primary hover:bg-bg-subtle disabled:opacity-50"
                  >
                    {reading === d.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : d.readAt ? (
                      <RefreshCw className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Sparkles className="size-3.5" aria-hidden="true" />
                    )}
                    {reading === d.id ? 'Reading…' : d.readAt ? 'Read again' : 'Read it'}
                  </button>
                )}
              </div>
              {viewing === d.id && (
                <div className="mt-2">
                  <DocumentPreview documentId={d.id} mime={d.mime} title={d.title} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Which product a document is about — changeable in place. */
function ProductPicker({ document }: { document: KnowledgeDocument }) {
  const toast = useToast();
  const [value, setValue] = React.useState<ProductKey>(document.product);
  return (
    <select
      value={value}
      aria-label={`What ${document.title} is about`}
      onChange={(e) => {
        const before = value;
        const next = e.target.value as ProductKey;
        setValue(next);
        void setDocumentProductAction(document.id, next).then((r) => {
          if (r.ok) return;
          setValue(before);
          toast({ tone: 'error', text: r.error ?? 'That did not save.' });
        });
      }}
      className="shrink-0 rounded-lg border border-border-default bg-bg-surface px-2 py-1 text-caption text-text-primary"
    >
      {PRODUCTS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
    </select>
  );
}

/* ---- The questions a document could not answer -------------------------- */

function Gaps({
  gaps,
  projectId,
  onWritten,
  onDismiss,
}: {
  gaps: readonly string[];
  projectId: string;
  onWritten: () => Promise<void>;
  onDismiss: () => void;
}) {
  const toast = useToast();
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<Set<string>>(new Set());

  const save = async (question: string, product: ProductKey) => {
    const answer = (answers[question] ?? '').trim();
    if (!answer) return;
    setSaving(question);
    try {
      const r = await addKnowledgeAction({ projectId, product, question, answer, approve: true });
      if (!r.ok) {
        toast({ tone: 'error', text: r.error ?? 'That did not save.' });
        return;
      }
      setDone((d) => new Set(d).add(question));
      await onWritten();
    } finally {
      setSaving(null);
    }
  };

  const left = gaps.filter((g) => !done.has(g));

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold text-text-primary">
            Questions the document could not answer ({left.length})
          </h2>
          {/* ⚠️ THIS IS THE "ASK ME SO I CAN PROVIDE THEM" THE OWNER ASKED FOR —
              a finishable list rather than a conversation to remember. */}
          <p className="mt-0.5 text-caption text-text-secondary">
            Clients ask these. Answer one and the agent may use it; leave it blank and the agent hands that question
            to a salesperson.
          </p>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Hide these" className="shrink-0 rounded-lg p-1 hover:bg-bg-subtle">
          <X className="size-4 text-text-secondary" aria-hidden="true" />
        </button>
      </div>

      <ul className="mt-3 space-y-3">
        {left.map((q) => (
          <li key={q}>
            <p className="text-body-sm font-medium text-text-primary">{q}</p>
            <div className="mt-1.5 flex gap-2">
              <input
                value={answers[q] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q]: e.target.value }))}
                placeholder="Your answer, in the words you would send a client"
                className="min-w-0 flex-1 rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
              />
              <button
                type="button"
                disabled={saving !== null || !(answers[q] ?? '').trim()}
                onClick={() => void save(q, 'crm')}
                className="shrink-0 rounded-xl bg-accent-primary px-3.5 py-2 text-body-sm font-semibold text-white disabled:opacity-40"
              >
                {saving === q ? 'Saving…' : 'Save'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---- One answer --------------------------------------------------------- */

function Section({
  title,
  note,
  empty,
  children,
}: {
  title: string;
  note: string;
  empty: string;
  children: React.ReactNode;
}) {
  const has = React.Children.count(children) > 0;
  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-surface p-4">
      <h2 className="text-body font-semibold text-text-primary">{title}</h2>
      <p className="mt-0.5 text-caption text-text-secondary">{note}</p>
      {has ? (
        <ul className="mt-3 divide-y divide-border-subtle">{children}</ul>
      ) : empty ? (
        <p className="mt-3 text-body-sm text-text-secondary">{empty}</p>
      ) : null}
    </section>
  );
}

function Row({
  entry,
  onDecide,
}: {
  entry: KnowledgeEntry;
  onDecide: (e: KnowledgeEntry, status: KnowledgeEntry['status'], patch?: Partial<KnowledgeEntry>) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [question, setQuestion] = React.useState(entry.question);
  const [answer, setAnswer] = React.useState(entry.answer);
  const [product, setProduct] = React.useState<ProductKey>(entry.product);

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-md bg-bg-subtle px-2 py-0.5 text-caption text-text-secondary">
          {productLabel(entry.product)}
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <>
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm font-medium text-text-primary focus:border-accent-primary focus:outline-none"
              />
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                className="mt-1.5 w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
              />
              <select
                value={product}
                onChange={(e) => setProduct(e.target.value as ProductKey)}
                className="mt-1.5 rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 text-caption text-text-primary"
              >
                {PRODUCTS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </>
          ) : (
            <>
              <p className="text-body-sm font-medium text-text-primary">{entry.question}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-body-sm text-text-secondary">{entry.answer}</p>
            </>
          )}

          {/* ⚠️ THE SENTENCE IT CAME FROM, ALWAYS VISIBLE. Approving an answer
              you cannot check is not approval — it is a signature on somebody
              else's paragraph. */}
          {entry.sourceQuote && (
            <p className="mt-1.5 border-l-2 border-border-default pl-2.5 text-caption italic text-text-secondary">
              &ldquo;{entry.sourceQuote}&rdquo;
              {entry.sourceTitle ? <span className="not-italic"> · {entry.sourceTitle}</span> : null}
            </p>
          )}
          {entry.status === 'approved' && entry.approvedByName && (
            <p className="mt-1 text-caption text-text-secondary">Approved by {entry.approvedByName}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  onDecide(entry, 'approved', { question, answer, product });
                }}
                className="rounded-xl bg-accent-primary px-3 py-1.5 text-caption font-semibold text-white"
              >
                Save &amp; approve
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setQuestion(entry.question);
                  setAnswer(entry.answer);
                }}
                className="rounded-xl border border-border-default px-3 py-1.5 text-caption text-text-primary"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {entry.status !== 'approved' && (
                <button
                  type="button"
                  onClick={() => onDecide(entry, 'approved')}
                  title="Approve"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border-default px-3 py-1.5 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
                >
                  <Check className="size-3.5" aria-hidden="true" /> Approve
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-xl border border-border-default px-3 py-1.5 text-caption text-text-primary transition-colors hover:bg-bg-subtle"
              >
                Edit
              </button>
              {entry.status !== 'rejected' && (
                <button
                  type="button"
                  onClick={() => onDecide(entry, 'rejected')}
                  title="Reject"
                  className="rounded-xl border border-border-default p-1.5 text-text-secondary transition-colors hover:bg-bg-subtle"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/* ---- Writing one by hand ------------------------------------------------ */

function WriteAnswer({
  projectId,
  onClose,
  onWritten,
}: {
  projectId: string;
  onClose: () => void;
  onWritten: () => Promise<void>;
}) {
  const toast = useToast();
  const [product, setProduct] = React.useState<ProductKey>('crm');
  const [question, setQuestion] = React.useState('');
  const [answer, setAnswer] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const r = await addKnowledgeAction({ projectId, product, question, answer, approve: true });
      if (!r.ok) {
        toast({ tone: 'error', text: r.error ?? 'That did not save.' });
        return;
      }
      await onWritten();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Write an answer"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[34rem] rounded-2xl border border-border-subtle bg-bg-surface p-5 shadow-2xl"
      >
        <h2 className="text-body font-semibold text-text-primary">Write an answer</h2>
        <p className="mt-0.5 text-caption text-text-secondary">
          You are the source, so this is approved as soon as you save it.
        </p>

        <label className="mt-3 block text-caption text-text-secondary">
          About
          <select
            value={product}
            onChange={(e) => setProduct(e.target.value as ProductKey)}
            className="mt-1 w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary"
          >
            {PRODUCTS.map((p) => (
              <option key={p.key} value={p.key}>{p.label} — {p.hint}</option>
            ))}
          </select>
        </label>

        <label className="mt-3 block text-caption text-text-secondary">
          The question a client asks
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            autoFocus
            placeholder="How long does setup take?"
            className="mt-1 w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
          />
        </label>

        <label className="mt-3 block text-caption text-text-secondary">
          What the agent should say
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            placeholder="Two to three weeks from the day requirements are confirmed."
            className="mt-1 w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
          />
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-border-default px-4 py-2.5 text-body-sm text-text-primary">
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !question.trim() || !answer.trim()}
            onClick={() => void save()}
            className="rounded-xl bg-accent-primary px-4 py-2.5 text-body-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
