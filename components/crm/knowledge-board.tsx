'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, FileText, Loader2, Plus, RefreshCw, Sparkles, X } from 'lucide-react';

import {
  addKnowledgeAction,
  decideKnowledgeAction,
  knowledgeBoardAction,
  readDocumentAction,
} from '@/app/actions/crm-knowledge';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import type { KnowledgeBoard, KnowledgeEntry, ProductKey } from '@/lib/db/queries/crm-knowledge';
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
    const next = new URLSearchParams(search.toString());
    next.set('project', id);
    router.replace(`/knowledge?${next.toString()}` as never, { scroll: false });
    void knowledgeBoardAction(id).then((b) => setBoard(b));
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

  const read = async (documentId: string, product: ProductKey) => {
    setReading(documentId);
    try {
      const r = await readDocumentAction({ projectId: chosen!, documentId, product });
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

      {!board ? (
        <p className="flex items-center gap-2 rounded-2xl border border-border-subtle bg-bg-surface p-6 text-body-sm text-text-secondary">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Reading this project&rsquo;s knowledge…
        </p>
      ) : (
        <>
          <Documents board={board} reading={reading} onRead={read} />

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

/* ---- The documents there are to read ------------------------------------ */

function Documents({
  board,
  reading,
  onRead,
}: {
  board: KnowledgeBoard;
  reading: string | null;
  onRead: (documentId: string, product: ProductKey) => void;
}) {
  const [product, setProduct] = React.useState<ProductKey>('crm');

  return (
    <section className="rounded-2xl border border-border-subtle bg-bg-surface p-4">
      <h2 className="text-body font-semibold text-text-primary">Documents</h2>
      <p className="mt-0.5 text-caption text-text-secondary">
        Reading one drafts answers from it. Every answer keeps the sentence it came from, and none of them can be
        used until you approve it.
      </p>

      {board.documents.length === 0 ? (
        <p className="mt-3 text-body-sm text-text-secondary">
          No shared PDFs on this project yet. Upload a proposal from a lead&rsquo;s Related items → Files.
        </p>
      ) : (
        <>
          <label className="mt-3 block text-caption text-text-secondary">
            These answers are about
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value as ProductKey)}
              className="ml-2 rounded-lg border border-border-default bg-bg-surface px-2.5 py-1.5 text-body-sm text-text-primary"
            >
              {PRODUCTS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </label>
          {/* ⚠️ THE PRODUCT IS ASKED BEFORE READING, NOT GUESSED FROM THE FILE
              NAME. A proposal titled "CRM Solution" in a folder called Taskly is
              how the extractor invented "Taskly CRM" in the first place. */}
          <ul className="mt-2 divide-y divide-border-subtle">
            {board.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2.5">
                <FileText className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-medium text-text-primary">{d.title}</span>
                  <span className="block text-caption text-text-secondary">
                    {d.readAt ? 'Already read — reading again adds only what is new.' : 'Not read yet.'}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={reading !== null}
                  onClick={() => onRead(d.id, product)}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle disabled:opacity-50"
                >
                  {reading === d.id ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : d.readAt ? (
                    <RefreshCw className="size-4" aria-hidden="true" />
                  ) : (
                    <Sparkles className="size-4" aria-hidden="true" />
                  )}
                  {reading === d.id ? 'Reading…' : d.readAt ? 'Read again' : 'Read it'}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
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
