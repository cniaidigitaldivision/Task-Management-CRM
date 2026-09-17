'use client';

import * as React from 'react';
import Link from 'next/link';
import { CalendarClock, CheckCircle2, ClipboardCheck, FileCheck2, PhoneCall, Send } from 'lucide-react';

import { PageHeader } from '@/components/ui/page-header';
import type { CrmTodo } from '@/lib/db/queries/crm-leads';
import { DIVISION_NAME } from '@/lib/domain/constants';
import { groupTodos, todoIsUrgent, todoLabel, todoSummary, todoToken } from '@/lib/domain/crm-todos';
import { cn } from '@/lib/utils';

/* ============================================================================
 * MY TO-DOS — the sales team's own list
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-16: *"I want a separate thing for the sales team with the name
 * 'to-dos' where sales-related to-dos will just be displayed… For the sales team
 * you have to clear your to-dos, then you can leave today."*
 *
 * ── ⚠️ NOTHING HERE IS TICKED OFF. THAT IS THE POINT ───────────────────────
 * There is no checkbox and no "done" button, because there is no `crm_todos`
 * table behind this — every row is a question asked of real state. An item
 * leaves the list when the WORK is done: the lead gets contacted, the visit gets
 * written up, the quotation gets sent. A tick that could be pressed without
 * doing the thing would let the list and the truth drift apart on day one, and
 * nothing would ever reconcile them.
 *
 * ── ⚠️ SO EVERY ROW IS A LINK TO WHERE THE WORK HAPPENS ────────────────────
 * The only affordance is "go and do it". That is not a limitation of the design,
 * it is the design.
 * ========================================================================= */

const ICON: Record<string, typeof CalendarClock> = {
  first_contact: PhoneCall,
  next_action: ClipboardCheck,
  appointment: CalendarClock,
  record_visit: ClipboardCheck,
  approve_quotation: FileCheck2,
  send_quotation: Send,
  follow_up: Send,
};

/* ⚠️ WHERE EACH KIND IS ACTUALLY DONE. A to-do that opened the wrong screen
   would be worse than none — somebody would stop trusting the list after the
   second one. The appointment kinds go to the diary; everything else opens the
   lead's own drawer, which is where the work lives.

   ⚠️ A URL OBJECT, NOT A STRING. `Route` is typed against the real route tree,
   so a link to a page that does not exist is a compile error rather than a 404
   somebody finds in production — and a template string defeats that check. */
function hrefFor(todo: CrmTodo): React.ComponentProps<typeof Link>['href'] {
  if (todo.kind === 'record_visit' || todo.kind === 'appointment') {
    return { pathname: '/appointments' };
  }
  return { pathname: '/my-leads', query: { lead: todo.leadId } };
}

export function TodoList({ todos, nowMs }: { todos: readonly CrmTodo[]; nowMs: number }) {
  const groups = groupTodos(todos, nowMs);
  const firstContacts = todos.filter((t) => t.kind === 'first_contact').length;

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4">
      <PageHeader
        eyebrow={DIVISION_NAME}
        title="My to-dos"
        description={todoSummary(groups, firstContacts)}
      />

      {todos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-5 py-10 text-center">
          <CheckCircle2 className="mx-auto size-7 text-feedback-success" aria-hidden="true" />
          <p className="mx-auto mt-2 max-w-[44ch] text-body-sm leading-relaxed text-text-secondary">
            {/* ⚠️ AN EMPTY LIST IS GOOD NEWS AND SAYS SO. The same panel on the
                clients page had to explain that nothing was broken; here the
                owner's own rule gives it a sentence worth reading. */}
            Nothing owed. Every lead has been contacted, every visit written up
            and every quotation dealt with.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <Group title="Overdue" tone="error" items={groups.overdue} nowMs={nowMs} />
          <Group title="Today" items={groups.today} nowMs={nowMs} />
          <Group title="Coming up" items={groups.later} nowMs={nowMs} muted />
        </div>
      )}

      <p className="text-caption text-text-secondary">
        {/* ⚠️ SAYS WHY THERE IS NO TICK BOX, because the absence is the first
            thing somebody will ask about. */}
        These are not tasks you tick off — each one clears itself the moment the
        work is done. Everything overdue is shown; ahead, the next seven days.
      </p>
    </div>
  );
}

function Group({
  title,
  items,
  nowMs,
  tone,
  muted = false,
}: {
  title: string;
  items: readonly CrmTodo[];
  nowMs: number;
  tone?: 'error';
  muted?: boolean;
}) {
  /* ⚠️ AN EMPTY GROUP IS NOT RENDERED. A permanent "Overdue (0)" heading is dead
     space that teaches the eye to skip exactly the strip that matters on the day
     it is not zero — the same reasoning that keeps Today's plan absent when the
     diary is empty. */
  if (items.length === 0) return null;

  return (
    <section>
      <h2
        className={cn(
          'mb-1.5 flex items-center gap-2 text-micro font-semibold uppercase tracking-wide',
          tone === 'error' ? 'text-feedback-error' : 'text-text-secondary',
        )}
      >
        {title}
        <span className="tabular-nums">{items.length}</span>
      </h2>
      <ul className={cn('space-y-1.5', muted && 'opacity-80')}>
        {items.map((t) => (
          <Row key={t.id} todo={t} nowMs={nowMs} />
        ))}
      </ul>
    </section>
  );
}

function Row({ todo, nowMs }: { todo: CrmTodo; nowMs: number }) {
  const Icon = ICON[todo.kind] ?? ClipboardCheck;
  /* ⚠️ NO DATE COUNTS AS LATE, exactly as `groupTodos` treats it. Written the
     other way round first, and the screenshot showed the fault: a lead nobody
     had ever planned a moment for sat under the red "Overdue" heading rendered
     as calmly as next Tuesday's call. The row and the group it is in cannot
     disagree about urgency — that is how somebody learns to ignore the heading. */
  const late = todo.dueAt === null || Date.parse(todo.dueAt) < nowMs;
  const urgent = late && todoIsUrgent(todo.kind);

  return (
    <li>
      <Link
        href={hrefFor(todo)}
        className={cn(
          'flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border bg-bg-surface px-3.5 py-2.5 transition-colors hover:border-border-default',
          urgent ? 'border-feedback-error/40' : 'border-border-subtle',
        )}
      >
        <Icon
          className="mt-0.5 size-4 shrink-0"
          style={{ color: `var(--${todoToken(todo.kind)})` }}
          aria-hidden="true"
        />

        <span className="min-w-0 flex-1">
          <span className="block text-body-sm font-medium text-text-primary">
            {todoLabel(todo.kind)}
            {' — '}
            <span className="font-semibold">{todo.leadName ?? 'Unnamed lead'}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-secondary">
            {todo.detail && <span className="truncate">{todo.detail}</span>}
            {todo.projectName && (
              <>
                {todo.detail && <span aria-hidden="true" className="text-text-tertiary">·</span>}
                <span className="truncate">{todo.projectName}</span>
              </>
            )}
          </span>
        </span>

        <span
          className={cn(
            'shrink-0 text-caption tabular-nums',
            urgent ? 'font-semibold text-feedback-error' : 'text-text-secondary',
          )}
        >
          {/* ⚠️ NO DATE MEANS NOBODY PLANNED ONE, and the row says that rather
              than printing a dash. A lead with no next action is the single
              commonest fault in this database — 640 of 641 of them. */}
          {todo.dueAt === null
            ? 'no time set'
            : new Date(todo.dueAt).toLocaleString('en-GB', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Karachi',
              })}
        </span>
      </Link>
    </li>
  );
}
