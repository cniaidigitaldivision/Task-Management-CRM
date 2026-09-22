'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, FileText, Info, Loader2, RotateCcw, Send, Sparkles, UserRound, X } from 'lucide-react';

import { askAgentAction, type AskAgentResult, type TestTurn } from '@/app/actions/crm-knowledge';
import { ink, tint } from '@/components/crm/appointments-board-parts';
import { WA_BUBBLE_INK, WA_GREEN } from '@/components/crm/whatsapp-mark';
import type { KnowledgeBoard } from '@/lib/db/queries/crm-knowledge';
import { PRODUCT_LABEL } from '@/lib/domain/crm-knowledge-health';
import { cn } from '@/lib/utils';

/* ============================================================================
 * TEST AGENT — the drawer
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-22: *"Test agent: opens a wider test drawer with conversation
 * preview, selected project, answer source and handoff result."*
 *
 * ── ⚠️ THE REAL AGENT, AND NOTHING LEAVES THIS SCREEN ──────────────────────
 * Every turn goes through `askAgentAction`, which builds the same brief the
 * live runner builds and calls the same model. There is no lead, no WhatsApp
 * send and no run row — the conversation lives in this component and is gone
 * when the drawer closes.
 *
 * ── ⚠️ "ANSWER SOURCE" IS A MATCH, AND IT SAYS SO ──────────────────────────
 * The agent does not report which approved answers it used. The drawer shows
 * the approved answers the reply is CLOSEST to (`closestAnswers`), labelled as
 * that, rather than claiming to know what the model was thinking.
 *
 * ── ⚠️ A HAND-OFF SHOWS BOTH SIDES ─────────────────────────────────────────
 * What the salesperson would be told (the reason) and what the CLIENT would
 * actually be sent (`holdingLine`, the same line the live agent sends).
 * ========================================================================= */

interface Turn {
  readonly id: number;
  readonly from: 'client' | 'agent';
  readonly text: string;
  readonly result?: AskAgentResult;
}

const STARTERS = ['What does your CRM do?', 'Can it connect to WhatsApp?', 'How much does it cost?', 'Can I get a discount?'];

export function TestAgentDrawer({
  board,
  modeLabel,
  onClose,
  onWriteAnswer,
}: {
  board: KnowledgeBoard;
  modeLabel: string;
  onClose: () => void;
  /** A hand-off for a missing fact is a gap — offer to fill it right here. */
  onWriteAnswer: () => void;
}) {
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [draft, setDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const seq = React.useRef(0);
  const end = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    input.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = was;
    };
  }, [onClose]);

  React.useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns, busy]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    /* The client's line appears in this frame; the agent's arrives underneath. */
    const history: TestTurn[] = turns.map((t) => ({ from: t.from, text: t.text }));
    setTurns((t) => [...t, { id: (seq.current += 1), from: 'client', text: q }]);
    setDraft('');
    setBusy(true);
    const r = await askAgentAction(board.projectId, q, history);
    setBusy(false);
    setTurns((t) => [
      ...t,
      {
        id: (seq.current += 1),
        from: 'agent',
        text: r.error ? r.error : r.answer ?? r.clientWouldSee ?? r.handover ?? '',
        result: r,
      },
    ]);
  };

  const approved = board.entries.filter((e) => e.status === 'approved').length;

  const body = (
    <div className="fixed inset-0 z-[75] flex justify-end" role="dialog" aria-modal="true" aria-label="Test agent">
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 bg-black/40" />
      <aside className="relative flex h-full w-full max-w-[44rem] flex-col border-l border-border-subtle bg-bg-surface shadow-2xl">
        {/* ── The project under test ─────────────────────────────────── */}
        <header className="border-b border-border-subtle px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl" style={{ background: tint('blue', 14) }}>
              <Sparkles className="size-5" style={{ color: ink('blue') }} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-h3 font-semibold text-text-primary">Test agent</h2>
              <p className="truncate text-body-sm text-text-secondary">{board.projectName}</p>
            </div>
            <button
              type="button"
              onClick={() => setTurns([])}
              disabled={turns.length === 0 || busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1.5 text-caption font-semibold text-text-primary hover:bg-bg-subtle disabled:opacity-40"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" /> Start over
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Fact label="Project" value={board.projectName} />
            <Fact label="Sells" value={board.settings.product ? PRODUCT_LABEL[board.settings.product] : 'Not set'} />
            <Fact label="Approved answers" value={String(approved)} />
            <Fact label="Reply mode" value={modeLabel} />
          </dl>
        </header>

        {/* ── The conversation ───────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-bg-subtle/40 px-5 py-4">
          {turns.length === 0 ? (
            <div className="grid place-items-center gap-3 py-10 text-center">
              <p className="max-w-sm text-body-sm text-text-secondary">
                Write as a client would. The real agent answers from this project&rsquo;s approved knowledge, and
                nothing is sent to anybody.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void ask(q)}
                    className="rounded-full border border-border-default bg-bg-surface px-3 py-1.5 text-caption font-medium text-text-primary hover:bg-bg-subtle"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ol className="space-y-4">
              {turns.map((t) =>
                t.from === 'client' ? (
                  <li key={t.id} className="flex justify-start">
                    <div className="max-w-[80%]">
                      <p className="mb-1 flex items-center gap-1 text-caption text-text-secondary">
                        <UserRound className="size-3" aria-hidden="true" /> Client
                      </p>
                      <p className="whitespace-pre-line rounded-2xl rounded-tl-sm border border-border-subtle bg-bg-surface px-3.5 py-2.5 text-body-sm text-text-primary">
                        {t.text}
                      </p>
                    </div>
                  </li>
                ) : (
                  <li key={t.id} className="flex justify-end">
                    <div className="w-full max-w-[88%]">
                      <p className="mb-1 flex items-center justify-end gap-1 text-caption text-text-secondary">
                        <Sparkles className="size-3" aria-hidden="true" /> Agent
                      </p>
                      <AgentTurn turn={t} onWriteAnswer={onWriteAnswer} />
                    </div>
                  </li>
                ),
              )}
              {busy && (
                <li className="flex justify-end">
                  <p className="inline-flex items-center gap-2 rounded-2xl bg-bg-surface px-3.5 py-2.5 text-caption text-text-secondary">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> The agent is thinking…
                  </p>
                </li>
              )}
            </ol>
          )}
          <div ref={end} />
        </div>

        {/* ── Ask ────────────────────────────────────────────────────── */}
        <footer className="border-t border-border-subtle px-5 py-3.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
            className="flex gap-2"
          >
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={500}
              placeholder="Type as the client…"
              aria-label="Type as the client"
              className="h-10 min-w-0 flex-1 rounded-xl border border-border-default bg-bg-base px-3 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              <Send className="size-4" aria-hidden="true" /> Ask
            </button>
          </form>
          <p className="mt-2 flex items-start gap-1.5 text-caption text-text-secondary">
            <Info className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
            Booking is off in a test, and nothing is sent or recorded.
          </p>
        </footer>
      </aside>
    </div>
  );

  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}

function AgentTurn({ turn, onWriteAnswer }: { turn: Turn; onWriteAnswer: () => void }) {
  const r = turn.result;

  if (r?.error) {
    return (
      <p className="rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-body-sm" style={{ background: tint('red', 12), color: ink('red') }}>
        {r.error}
      </p>
    );
  }

  /* ── A hand-off: both sides of it ─────────────────────────────────────── */
  if (r && !r.answer) {
    return (
      <div className="space-y-2">
        <p
          className="whitespace-pre-line rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-body-sm"
          style={{ background: WA_GREEN, color: WA_BUBBLE_INK }}
        >
          {r.clientWouldSee ?? turn.text}
        </p>
        <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: tint('amber', 45), background: tint('amber', 10) }}>
          <p className="flex items-center gap-1.5 text-caption font-semibold" style={{ color: ink('amber') }}>
            <AlertTriangle className="size-3.5" aria-hidden="true" /> Handed off to a salesperson
          </p>
          <p className="mt-1 text-caption text-text-primary">
            <span className="text-text-secondary">They would be told: </span>
            {r.handover}
          </p>
          <p className="mt-1 text-caption text-text-secondary">
            The bubble above is what the client would actually receive.
          </p>
          <button
            type="button"
            onClick={onWriteAnswer}
            className="mt-2 rounded-lg bg-accent-primary px-2.5 py-1 text-caption font-semibold text-white hover:opacity-90"
          >
            Write an answer for this
          </button>
        </div>
      </div>
    );
  }

  /* ── A reply, and where it most likely came from ──────────────────────── */
  const drawn = r?.drawnFrom ?? [];
  return (
    <div className="space-y-2">
      <p
        className="whitespace-pre-line rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-body-sm"
        style={{ background: WA_GREEN, color: WA_BUBBLE_INK }}
      >
        {turn.text}
      </p>
      <div className="rounded-xl border border-border-subtle bg-bg-surface px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-caption font-semibold" style={{ color: ink('green') }}>
          <CheckCircle2 className="size-3.5" aria-hidden="true" /> Answered by the agent
        </p>
        {drawn.length > 0 ? (
          <>
            <p className="mt-1.5 text-caption text-text-secondary">Closest approved answers:</p>
            <ul className="mt-1 space-y-1">
              {drawn.map((d) => (
                <li key={d.id} className="flex items-start gap-2 text-caption">
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 font-semibold"
                    style={{ background: tint('green', 14), color: ink('green') }}
                  >
                    {d.score}%
                  </span>
                  <span className="min-w-0 flex-1 text-text-primary">
                    {d.question}
                    {d.sourceTitle && (
                      <span className="text-text-secondary">
                        {' '}
                        · <FileText className="inline size-3" aria-hidden="true" /> {d.sourceTitle}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-caption text-text-secondary">
            Not close to any one approved answer — usually a greeting, a question back, or small talk.
          </p>
        )}
        {r?.documents && r.documents.length > 0 && (
          <p className="mt-1.5 text-caption text-text-secondary">Would also send: {r.documents.join(', ')}</p>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn('min-w-0 rounded-lg bg-bg-subtle/60 px-2.5 py-1.5')}>
      <dt className="text-caption text-text-secondary">{label}</dt>
      <dd className="truncate text-body-sm font-semibold text-text-primary">{value}</dd>
    </div>
  );
}
