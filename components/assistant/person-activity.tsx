'use client';

import * as React from 'react';
import { Loader2, Lock, MessageSquare } from 'lucide-react';

import { assistantPersonActivityAction } from '@/app/actions/assistant';
import { AnswerText } from '@/components/assistant/answer-text';
import { Avatar } from '@/components/ui/avatar';
import { Drawer } from '@/components/ui/dialog';
import type { TranscriptLine } from '@/lib/db/queries/assistant';

/* ============================================================================
 * ONE PERSON'S ACTIVITY, IN FULL
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"when I click on someone's specific chat or something
 * like activity, I can see more and every detail should be properly and
 * logically implemented."*
 *
 * ── ⚠️ WHAT "EVERY DETAIL" HONESTLY MEANS HERE, AND WHY IT IS NOT EVERYTHING ─
 * Migration 069 settled the history rule on the owner's own instruction: an
 * Admin reads everybody's QUESTIONS and nobody else's ANSWERS. So this screen
 * can show, for another person: every question they asked, when, how their
 * conversations were grouped, and — through migration 072's aggregate function
 * on the panel behind this — what it all cost.
 *
 * It cannot show what the assistant told them, and it does not try. The
 * database will not return those rows, so there is no version of this component
 * that could display them by accident.
 *
 * ⚠️ Opened on YOURSELF it shows both sides, because the same policy admits you
 * to your own answers. That is not a special case in the code — the SQL is
 * identical and the policy returns more. The banner below reads the RESULT
 * (`isSelf` from the server) rather than comparing ids in the browser, so the
 * screen can never claim to be showing a full transcript while holding half of
 * one.
 *
 * ── A DRAWER, NOT A PAGE ────────────────────────────────────────────────────
 * This is read while scanning a list, and coming back to the same scroll
 * position matters more than a URL does. The drawer brings the tested focus
 * trap, Escape handling, ref-counted scroll lock and backdrop dismiss.
 * ========================================================================= */

export interface ActivityPerson {
  readonly id: string;
  readonly fullName: string;
  readonly avatarUrl: string | null;
  readonly roleTitle: string | null;
}

interface Conversation {
  readonly threadId: string;
  readonly lines: readonly TranscriptLine[];
}

/**
 * Contiguous runs would be enough in practice — one person's messages arrive in
 * order — but a Map keyed by thread is correct even when two conversations
 * overlap, which is what happens the moment somebody opens the launcher on one
 * page while a thread is still going on another.
 */
function byConversation(lines: readonly TranscriptLine[]): Conversation[] {
  const groups = new Map<string, TranscriptLine[]>();
  for (const line of lines) {
    const existing = groups.get(line.threadId);
    if (existing) existing.push(line);
    else groups.set(line.threadId, [line]);
  }
  return [...groups.entries()].map(([threadId, grouped]) => ({ threadId, lines: grouped }));
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `26 Aug, 14:32`.
 *
 * ⚠️ Formatted from the ISO parts rather than through `toLocaleString`, which
 * would render differently on the server and in the browser and trip a
 * hydration mismatch — the same reason every money helper in this codebase pins
 * its locale.
 */
function shortWhen(iso: string): string {
  const [date, time = ''] = iso.split('T');
  const [, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m)] ?? ''}, ${time.slice(0, 5)}`;
}

function dayOf(iso: string): string {
  const [, m, d] = iso.split('T')[0].split('-');
  return `${Number(d)} ${MONTHS[Number(m)] ?? ''}`;
}

export function PersonActivity({
  person,
  onClose,
}: {
  person: ActivityPerson | null;
  onClose: () => void;
}) {
  /* ── ⚠️ ONE STATE OBJECT, STAMPED WITH WHO IT IS ABOUT ─────────────────────
     The obvious shape is three pieces of state and a `setLines(null)` at the
     top of the effect to clear the previous person while the next one loads.
     The react-hooks lint refuses that, correctly: a synchronous setState in an
     effect body is a second render triggered by the first, and the compiler
     cannot see through it.

     Carrying `forId` on the result removes the need to clear anything. A result
     is only shown when it is ABOUT the person currently open, so switching
     names is loading again without a single reset — and a slow reply for the
     previous person can never paint over the current one, which is the bug the
     `cancelled` flag below only half prevents. */
  const [result, setResult] = React.useState<{
    readonly forId: string;
    readonly isSelf: boolean;
    readonly lines: readonly TranscriptLine[];
    readonly error: string | null;
  } | null>(null);

  const personId = person?.id ?? null;

  /* ⚠️ Fetched on open, not held for every row on the page. A roster of seven
     people with two hundred messages each is a payload nobody asked for, and it
     would be built on every navigation to this screen whether or not anybody
     clicked a name. */
  React.useEffect(() => {
    if (personId === null) return;

    let cancelled = false;

    void assistantPersonActivityAction(personId).then((answer) => {
      if (cancelled) return;
      setResult(
        answer.ok
          ? { forId: personId, isSelf: answer.isSelf, lines: answer.lines, error: null }
          : { forId: personId, isSelf: false, lines: [], error: answer.error },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [personId]);

  if (person === null) return null;

  /* Null while this person's reply is still in flight — including when a
     PREVIOUS person's reply is sitting in state. See above. */
  const loaded = result !== null && result.forId === person.id ? result : null;
  const lines = loaded?.lines ?? null;
  const error = loaded?.error ?? null;
  const isSelf = loaded?.isSelf ?? false;

  const questions = (lines ?? []).filter((line) => line.role === 'user');
  const answers = (lines ?? []).filter((line) => line.role === 'assistant');
  const conversations = byConversation(lines ?? []);

  return (
    <Drawer
      open
      onClose={onClose}
      title={`${person.fullName} — assistant activity`}
      subtitle={
        <div className="flex items-center gap-2">
          <Avatar name={person.fullName} src={person.avatarUrl} size="xs" />
          <span className="text-caption text-text-secondary">
            {person.roleTitle ?? 'Team member'}
          </span>
        </div>
      }
    >
      <div className="space-y-5 px-5 py-4">
        {/* ── The shape of it, before the detail ───────────────────────────
            Three figures rather than a paragraph: how much they asked, over how
            many conversations, and when they last did. Somebody scanning for
            "who is using all the credits" gets an answer without reading a
            single question. */}
        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Questions" value={lines === null ? '—' : String(questions.length)} />
          <Stat
            label="Conversations"
            value={lines === null ? '—' : String(conversations.length)}
          />
          <Stat
            label="Last asked"
            value={
              lines === null
                ? '—'
                : questions.length === 0
                  ? 'Never'
                  : dayOf(questions[questions.length - 1].createdAt)
            }
          />
        </dl>

        {/* ⚠️ Says what is NOT here, at the top, before somebody scrolls a
            list of questions looking for the replies and concludes the feature
            is broken. */}
        {!isSelf && lines !== null && lines.length > 0 && (
          <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface-sunken px-3 py-2.5 text-micro text-text-secondary">
            <Lock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Their questions, not their answers. What the assistant told them stays with
              them — the database refuses those rows to everybody else, including a Super
              Admin. What it cost is on the panel behind this.
            </span>
          </p>
        )}

        {error !== null && (
          <p className="text-caption" style={{ color: 'var(--feedback-error)' }}>
            {error}
          </p>
        )}

        {lines === null && (
          <p className="flex items-center gap-2 py-10 text-caption text-text-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading their activity…
          </p>
        )}

        {lines !== null && lines.length === 0 && error === null && (
          <p className="py-10 text-center text-caption text-text-tertiary">
            {person.fullName.split(' ')[0]} has not asked the assistant anything.
          </p>
        )}

        {conversations.map((conversation, index) => (
          <section key={conversation.threadId} className="space-y-2">
            <h3 className="flex items-center gap-2 text-micro font-semibold tracking-wide text-text-tertiary uppercase">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              Conversation {conversations.length - index}
              <span className="font-normal normal-case">
                · {shortWhen(conversation.lines[0].createdAt)}
              </span>
            </h3>

            <ol className="space-y-2">
              {conversation.lines.map((line) => (
                <li
                  key={line.id}
                  className={
                    line.role === 'user'
                      ? 'rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface-sunken px-3 py-2'
                      : 'rounded-[var(--radius-md)] border border-border-subtle px-3 py-2'
                  }
                >
                  <p className="flex items-baseline justify-between gap-3 text-micro text-text-tertiary">
                    <span className="font-semibold text-text-secondary">
                      {line.role === 'user' ? 'Asked' : 'Answered'}
                    </span>
                    <span className="tabular shrink-0">{shortWhen(line.createdAt)}</span>
                  </p>

                  {line.role === 'user' ? (
                    <p className="mt-1 text-caption whitespace-pre-wrap text-text-primary">
                      {line.content}
                    </p>
                  ) : (
                    <div className="mt-1 text-text-secondary">
                      <AnswerText text={line.content} />
                    </div>
                  )}

                  {/* Only ever present on your own rows — the cost column is on
                      the answer, and answers are yours alone. */}
                  {line.costUsd !== null && (
                    <p className="tabular mt-1.5 text-micro text-text-tertiary">
                      ${line.costUsd.toFixed(4)}
                      {line.latencyMs !== null && ` · ${(line.latencyMs / 1000).toFixed(1)}s`}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}

        {/* Only meaningful on your own view, where both sides are present. */}
        {isSelf && answers.length > 0 && (
          <p className="border-t border-border-subtle pt-3 text-micro text-text-tertiary">
            {questions.length} asked · {answers.length} answered
            {questions.length > answers.length &&
              ` · ${questions.length - answers.length} did not get a reply`}
          </p>
        )}
      </div>
    </Drawer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border-subtle px-3 py-2.5">
      <dt className="text-micro text-text-tertiary">{label}</dt>
      <dd className="tabular mt-0.5 text-h3 leading-none font-semibold text-text-primary">
        {value}
      </dd>
    </div>
  );
}
