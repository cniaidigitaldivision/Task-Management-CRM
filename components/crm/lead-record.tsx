import * as React from 'react';
import type { Route } from 'next';
import Link from 'next/link';
import { ArrowLeft, MessageCircle, Phone, Radio } from 'lucide-react';

import {
  LogContactControl,
  NextActionControl,
  NoteComposer,
  NoteDeleteButton,
  StageControl,
  TemperatureControl,
} from '@/components/crm/lead-actions';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  CrmLeadEvent,
  CrmLeadNote,
  CrmLeadRecord,
  CrmLeadSibling,
} from '@/lib/db/queries/crm-leads';
import { orderedAnswers } from '@/lib/domain/crm-answers';
import {
  activityLabel,
  lostReasonLabel,
  stageLabel,
  stageToken,
  temperatureLabel,
  temperatureToken,
} from '@/lib/domain/crm-stages';
import { displayPhone, whatsAppDigits } from '@/lib/domain/phone';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';

/* ============================================================================
 * ONE LEAD, WHOLE — Step 5 of docs/crm/08-TWELVE-STEPS.md
 * ----------------------------------------------------------------------------
 * *"Click a row, get the whole person: every answer Meta captured, the note
 * thread, the activity timeline, the campaign and form that produced them."*
 *
 * ── ⚠️ THIS SCREEN READS. IT DOES NOT WRITE, AND IT SAYS SO ────────────────
 * Changing the stage, logging a call and adding a note are Step 6. The
 * temptation here is to draw the controls now and wire them later — a stage
 * dropdown that does not save, an empty note box with a Post button. That is
 * the worst possible state: somebody types what they quoted a client, presses
 * the button, and the record silently does not have it. So the note thread is a
 * thread with nothing in it and a sentence saying where writing will appear, and
 * there is no control on this page that looks like it does something.
 *
 * ── ⚠️ NO 'use client' ─────────────────────────────────────────────────────
 * Nothing here is interactive: every action is an anchor — `tel:`, `wa.me`, a
 * link back to the desk. Marking it a Client Component would ship the whole tree
 * to the browser to render text that never changes.
 *
 * ── WHY A ROUTE AND NOT A DRAWER ───────────────────────────────────────────
 * The same reasoning as the project page. A lead is a destination somebody is
 * SENT to: "ring this person" is a link pasted into WhatsApp, and Step 7's
 * assignment notification needs a URL to point the bell at. The desk keeps its
 * filters in the query string, so `backHref` returns to the exact list that was
 * left — a drawer would preserve that too, but nothing else would.
 * ========================================================================= */

export function LeadRecord({
  lead,
  notes,
  activity,
  alsoEnquired,
  backHref,
  viewerId,
  viewerIsAdmin,
  nowMs,
}: {
  lead: CrmLeadRecord;
  notes: readonly CrmLeadNote[];
  activity: readonly CrmLeadEvent[];
  alsoEnquired: readonly CrmLeadSibling[];
  /* ⚠️ `Route`, not `string` — typedRoutes is on (next.config.ts), so a link
     this component cannot verify would be a build error rather than a 404 a
     reader finds. The detail route builds it; see `backToDesk` there. */
  backHref: Route;
  /** Who is looking — a note is withdrawable by its author, or by an Admin. */
  viewerId: string;
  viewerIsAdmin: boolean;
  nowMs: number;
}) {
  const phone = displayPhone(lead.phoneE164, lead.phone);
  const wa = whatsAppDigits(lead.phoneE164 ?? lead.phone);
  const answers = orderedAnswers(lead.answers);

  return (
    <div className="mx-auto max-w-[var(--content-max)] space-y-4 pb-16">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the lead desk
      </Link>

      {/* ── Who they are, and how to reach them ────────────────────────────── */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h2 className="text-h2 tracking-tight text-text-primary">
                {/* ⚠️ Not "Unknown". A lead arrives without a name when the form
                    did not ask for one — the form failed, not the person. */}
                {lead.fullName ?? 'Name not given'}
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-text-secondary">
                <span className="tabular-nums">{phone}</span>
                {lead.city && (
                  <>
                    <Dot />
                    <span>{lead.city}</span>
                  </>
                )}
                {lead.email && (
                  <>
                    <Dot />
                    <span className="truncate">{lead.email}</span>
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Badge token={stageToken(lead.stage)}>{stageLabel(lead.stage)}</Badge>
              {lead.temperature && (
                <Badge token={temperatureToken(lead.temperature)}>
                  {temperatureLabel(lead.temperature)}
                </Badge>
              )}
            </div>
          </div>

          {/* ⚠️ LINKS, NOT ACTIONS — the same rule as the desk's row. `tel:` and
              `wa.me` hand the number to the device and record NOTHING. Logging
              the attempt is Step 6, and a button that looked like it logged a
              call while logging nothing would make the timeline below lie about
              work that was actually done. */}
          <div className="flex flex-wrap items-center gap-2">
            {lead.phoneE164 ? (
              <>
                <ReachButton href={`tel:${lead.phoneE164}`} icon={Phone}>
                  Call {phone}
                </ReachButton>
                {wa && (
                  <ReachButton
                    href={`https://wa.me/${wa}?text=${encodeURIComponent(whatsAppOpener(lead.fullName, lead.projectName))}`}
                    icon={MessageCircle}
                    external
                  >
                    WhatsApp
                  </ReachButton>
                )}
              </>
            ) : (
              /* ⚠️ The raw value is still shown above. What is refused is a tel:
                 link built from a guess, which would ring a stranger. */
              <p className="text-caption leading-relaxed text-text-secondary">
                This number could not be read as a mobile, so there is no dialling link. What they
                typed is shown above, exactly as they typed it.
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── ⚠️ THE CONTROLS SIT IN ONE PLACE, ABOVE THE FOLD AND ABOVE THE
          READING. A salesperson opens this between two calls: what they came to
          do is change a stage and write down what was said, and hunting for
          those among the answers is what makes people keep a separate
          spreadsheet. Everything that saves is in `lead-actions.tsx`. */}
      <Card>
        <CardHeader>
          <CardTitle>Work this lead</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <StageControl leadId={lead.id} stage={lead.stage} lostReason={lead.lostReason} />
          <TemperatureControl leadId={lead.id} temperature={lead.temperature} />
          <NextActionControl
            leadId={lead.id}
            action={lead.nextAction}
            /* ⚠️ KARACHI, resolved here rather than in the browser. The input is
               a calendar date; slicing the ISO string would show the UTC day,
               which for anything set after 7pm local is yesterday. */
            dueDate={lead.nextActionAt ? karachiInputDate(lead.nextActionAt) : null}
          />
          <LogContactControl leadId={lead.id} />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="min-w-0 space-y-4">
          {/* ── What they actually asked for ──────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>What they told the form</CardTitle>
            </CardHeader>
            <CardBody>
              {answers.length === 0 ? (
                <Nothing>Meta sent no answers with this lead — only the submission itself.</Nothing>
              ) : (
                <dl className="divide-y divide-border-subtle">
                  {answers.map((a) => (
                    <div
                      key={a.key}
                      /* ⚠️ The question column is CAPPED, not a fraction. As `1fr` it grew
                         with the card and left a hand-span of empty space between
                         "Are you looking for plots & villa?" and "plots" — a
                         definition list whose two halves stop reading as a pair. */
                      className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:gap-4"
                    >
                      {/* ⚠️ SECONDARY, NOT TERTIARY, even for the answers that
                          are already in the header above. Measured on this page:
                          tertiary is **3.94:1 in light** against a 4.5:1 floor,
                          and a question label is what tells a reader what the
                          value beside it means — it cannot be the quiet half.
                          The de-emphasis those answers still get is ORDER: they
                          sort to the bottom (see `alsoOnRecord`), which costs no
                          contrast at all. */}
                      <dt className="text-caption text-text-secondary">{a.question}</dt>
                      <dd
                        className="text-body-sm text-text-primary"
                        /* The stored value, when tidying changed it. Meta's own
                           `10_marla_(commercial)` stays reachable as evidence. */
                        title={a.raw === a.answer ? undefined : a.raw}
                      >
                        {a.answer}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardBody>
          </Card>

          {/* ── The note thread ───────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardBody>
              <div className="space-y-4">
                {notes.length === 0 ? (
                  <Nothing>
                    Nothing has been written about this lead yet — what was discussed, what
                    quotation was given.
                  </Nothing>
                ) : (
                  <ul className="space-y-3">
                    {notes.map((n) => (
                      <li key={n.id} className="flex gap-2.5">
                        <Person name={n.authorName} avatarUrl={n.authorAvatarUrl} />
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline gap-x-1.5">
                            <span className="text-body-sm font-semibold text-text-primary">
                              {/* ⚠️ Null means the account is GONE, not hidden —
                                  migration 114 is what makes that true. Before
                                  it, a colleague across the room read as this. */}
                              {n.authorName ?? 'Former member'}
                            </span>
                            <Stamp iso={n.createdAt} nowMs={nowMs} />
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap text-body-sm leading-relaxed text-text-secondary">
                            {n.body}
                          </p>
                        </div>
                        <NoteDeleteButton
                          leadId={lead.id}
                          noteId={n.id}
                          canDelete={viewerIsAdmin || n.authorId === viewerId}
                        />
                      </li>
                    ))}
                  </ul>
                )}

                <NoteComposer leadId={lead.id} />
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {/* ── Where it came from, and who has it ────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>The record</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="divide-y divide-border-subtle">
                <Fact label="Project">{lead.projectName}</Fact>

                <Fact label="Owner">
                  {lead.ownerName ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar name={lead.ownerName} size="xs" />
                      {lead.ownerName}
                    </span>
                  ) : (
                    <Nothing>Unassigned</Nothing>
                  )}
                </Fact>

                {/* ⚠️ "Came from", not "Campaign" — the same label as the desk's
                    column, and for the same reason. `crm_campaigns` is empty:
                    the import reads FORMS, and linking them to the campaigns
                    that paid for them is Step 8. A heading saying "Campaign"
                    over a form name is how spend gets judged by the wrong
                    figure. The campaign appears here the day it is linked. */}
                <Fact label="Came from">
                  {lead.campaignName ?? lead.formName ?? <Nothing>Not recorded</Nothing>}
                  {lead.campaignName && lead.formName && (
                    <span className="mt-0.5 block text-micro text-text-tertiary">
                      {lead.formName}
                    </span>
                  )}
                </Fact>

                <Fact label="Enquired">
                  <Stamp iso={lead.submittedAt} nowMs={nowMs} absolute />
                </Fact>

                {/* ⚠️ SEPARATE FROM "Enquired", ALWAYS. The backfill pulled three
                    months of leads in one afternoon; showing the import time as
                    the enquiry time would have made 615 people look like they
                    all arrived at once, and response time is the number this
                    desk exists to improve. */}
                <Fact label="Imported">
                  <Stamp iso={lead.importedAt} nowMs={nowMs} absolute />
                </Fact>

                {lead.firstContactedAt && (
                  <Fact label="First contacted">
                    <Stamp iso={lead.firstContactedAt} nowMs={nowMs} absolute />
                  </Fact>
                )}

                <Fact label="Next action">
                  {lead.nextAction ? (
                    <>
                      {lead.nextAction}
                      {lead.nextActionAt && (
                        <span
                          className={cn(
                            'mt-0.5 block text-caption tabular-nums',
                            Date.parse(lead.nextActionAt) < nowMs
                              ? 'font-semibold text-feedback-error'
                              : 'text-text-secondary',
                          )}
                        >
                          {Date.parse(lead.nextActionAt) < nowMs ? 'Overdue · ' : 'Due · '}
                          {karachiDate(lead.nextActionAt)}
                        </span>
                      )}
                    </>
                  ) : (
                    <Nothing>Not set</Nothing>
                  )}
                </Fact>

                {lead.lostReason && (
                  <Fact label="Lost because">{lostReasonLabel(lead.lostReason)}</Fact>
                )}

                {/* Meta's own id, so a row can be traced back to the account it
                    came from without opening the database. */}
                {lead.externalId && (
                  <Fact label="Meta lead id">
                    <span className="break-all font-mono text-micro text-text-secondary">
                      {lead.externalId}
                    </span>
                  </Fact>
                )}
              </dl>
            </CardBody>
          </Card>

          {/* ⚠️ RENDERED ONLY WHEN THERE IS SOMETHING TO SHOW. See the note on
              the query: a sales member sees only the sibling leads assigned to
              them, so a count printed here would be a number this page cannot
              stand behind. Nothing is claimed when nothing is found. */}
          {alsoEnquired.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>This number enquired before</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="mb-2.5 text-caption leading-relaxed text-text-secondary">
                  The same number is on {alsoEnquired.length} other{' '}
                  {alsoEnquired.length === 1 ? 'lead' : 'leads'}. Worth reading before ringing —
                  somebody may already have spoken to them.
                </p>
                <ul className="space-y-1.5">
                  {alsoEnquired.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/leads/${s.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle px-2.5 py-1.5 transition-colors hover:border-border-default hover:bg-bg-subtle"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-caption text-text-primary">
                            {s.formName ?? s.projectName}
                          </span>
                          <span className="block text-micro text-text-secondary">
                            {karachiDate(s.submittedAt)}
                          </span>
                        </span>
                        <Badge token={stageToken(s.stage)} size="sm">
                          {stageLabel(s.stage)}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {/* ── The timeline ──────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardBody>
              {activity.length === 0 ? (
                <Nothing>Nothing has happened to this lead yet.</Nothing>
              ) : (
                <ol className="space-y-3">
                  {activity.map((event) => (
                    <li key={event.id} className="flex gap-2.5">
                      {/* ⚠️ A null actor on an imported row is the IMPORTER, not
                          somebody who left. Labelling it "Former member" would
                          accuse a cron job of resigning — and every activity row
                          held today is exactly this. */}
                      {event.actorId === null ? (
                        <span
                          aria-hidden="true"
                          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-bg-subtle text-text-tertiary"
                        >
                          <Radio className="size-3" />
                        </span>
                      ) : (
                        <Person name={event.actorName} avatarUrl={event.actorAvatarUrl} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-1.5">
                          <span className="text-body-sm font-medium text-text-primary">
                            {activityLabel(event.kind)}
                          </span>
                          <Stamp iso={event.occurredAt} nowMs={nowMs} />
                        </p>
                        <p className="mt-0.5 text-caption text-text-secondary">
                          {event.actorId === null
                            ? 'By the importer'
                            : (event.actorName ?? 'Former member')}
                          {event.outcome && ` · ${event.outcome}`}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---- Parts --------------------------------------------------------------- */

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
      {/* ⚠️ SECONDARY — 3.94:1 measured in light for tertiary at this size. The
          key of a key/value pair is load-bearing: "Owner" is what makes the name
          beside it mean anything. */}
      <dt className="text-caption text-text-secondary">{label}</dt>
      <dd className="min-w-0 text-body-sm text-text-primary">{children}</dd>
    </div>
  );
}

function Person({ name, avatarUrl }: { name: string | null; avatarUrl: string | null }) {
  return (
    <span className="mt-0.5 shrink-0">
      <Avatar name={name ?? '?'} src={avatarUrl ?? undefined} size="xs" />
    </span>
  );
}

/**
 * A time, relative for reading and exact on hover.
 *
 * ⚠️ ASIA/KARACHI EVERYWHERE, never the browser's zone. Measured on the live
 * table: 109 of 615 leads have a different UTC date from their Karachi date, so
 * a record headed with the wrong day is not a rounding detail — it is a fifth of
 * this table.
 */
function Stamp({ iso, nowMs, absolute }: { iso: string; nowMs: number; absolute?: boolean }) {
  const exact = new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  /* ⚠️ SECONDARY, EVERY STAMP, INCLUDING THE BARE RELATIVE ONES. Measured on
     this page: tertiary is 3.94:1 in light against a 4.5:1 floor.
     The desk's rows keep relative ages at tertiary and are right to — there the
     age is a supporting detail on a row that already carries the enquiry date.
     Here it is the ONLY time on its line: "Spoke · 12h ago" is when the call
     happened, and a timeline whose timestamps are the hardest thing on it to
     read is not a timeline. One ink, no exception to remember. */
  return (
    <time dateTime={iso} title={exact} className="text-caption text-text-secondary">
      {absolute ? `${exact} · ${relativeAge(iso, nowMs) ?? ''}` : relativeAge(iso, nowMs)}
    </time>
  );
}

function karachiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
  });
}

/**
 * The first line, waiting in the WhatsApp box for somebody to edit and send.
 *
 * ⚠️ IT SAYS ONLY WHAT IS TRUE. Their name, and the project they actually
 * enquired about — no price, no offer, no claim about availability, because a
 * pre-filled sentence is the one somebody sends without reading when they are
 * in a hurry, and it goes out under the division's name.
 *
 * ⚠️ AND IT IS PRE-FILL, NOT A SEND. `wa.me?text=` drops the text into the input
 * on the person's own device; nothing leaves until they press send. That is the
 * whole difference between this and the auto-sending the AI plan refuses.
 */
function whatsAppOpener(name: string | null, project: string): string {
  const greeting = name ? `Hello ${name}` : 'Hello';
  return `${greeting}, this is regarding your enquiry about ${project}.`;
}

/**
 * The date input's value, in Karachi.
 *
 * ⚠️ NOT `iso.slice(0, 10)`. That is the UTC day, and 109 of the 615 leads
 * already prove those are different days — a next action set for Friday evening
 * would open the picker on Friday and save as Saturday, or the other way round,
 * depending on the hour somebody looked.
 */
function karachiInputDate(iso: string): string {
  /* en-CA gives YYYY-MM-DD, which is what <input type="date"> wants. */
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-text-disabled">
      ·
    </span>
  );
}

/**
 * ⚠️ SECONDARY INK, NOT TERTIARY — the same measurement as the desk's `Nothing`.
 * These read like placeholders but they are the record's actual value; tertiary
 * came back at 3.94:1 in light against a 4.5:1 floor.
 */
function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="text-caption leading-relaxed text-text-secondary">{children}</p>;
}

function ReachButton({
  href,
  icon: Icon,
  external,
  children,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="inline-flex min-h-[2.4rem] items-center gap-2 rounded-xl border border-border-subtle bg-bg-surface px-3 text-body-sm font-medium text-text-primary transition-colors hover:border-border-default hover:bg-bg-subtle"
    >
      <Icon className="size-4" aria-hidden={true} />
      {children}
    </a>
  );
}
