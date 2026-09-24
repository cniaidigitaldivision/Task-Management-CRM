'use client';

import * as React from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ArrowRight, CheckCircle2, Clock3, FileText, Info, RefreshCw, Users } from 'lucide-react';

import { Nothing, Panel, StatCard } from '@/components/performance/performance-ui';
import { Avatar } from '@/components/ui/avatar';
import type {
  BucketRow,
  WorkRow,
  PersonStat,
  ProjectRow,
  QualitySummary,
  TeamRow,
  WorkloadRow,
} from '@/lib/db/queries/performance';
import { rate } from '@/lib/domain/performance';

/* ============================================================================
 * THE TABS BEHIND THE OVERVIEW — the owner's 2026-09-23 description
 * ----------------------------------------------------------------------------
 * *"Their project and team will display which project they are working on and
 * which team they are working in. The workload tab shows how much workload is
 * on it. The assessment will assess their performances with the help of AI. The
 * report page will generate a report and the compare page will compare their
 * performance against month-wise performance."*
 *
 * ── ⚠️ EVERY TAB SAYS WHAT IT CANNOT MEASURE ──────────────────────────────
 * Same rule as the Overview, and it bites hardest here. Measured on the live
 * database: 5 of 917 closures were made by somebody other than the person who
 * did the work, and every completed task falls inside three weeks of one month.
 * So Quality does not print a first-pass score over nothing, and Compare counts
 * in weeks and says why. A page read as a judgement about a named person must
 * never let a gap in the record look like a bad result.
 *
 * ── RULE ZERO ──────────────────────────────────────────────────────────────
 * These are pure components over rows the server already sent. Switching a tab
 * touches no network.
 * ========================================================================= */

const num = (n: number) => n.toLocaleString('en-GB');

/* ── A bar, drawn in CSS. No chart library for eight numbers. ─────────────── */

function Bars({
  rows,
  label,
}: {
  rows: ReadonlyArray<{ key: string; caption: string; value: number; sub?: string }>;
  label: string;
}) {
  const top = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-[0.6rem] px-[1.22rem] pb-[1.22rem]" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-[0.8rem]">
          <span
            className="w-[8rem] shrink-0 truncate text-[0.82rem]"
            style={{ color: 'var(--pf-soft)' }}
            title={r.caption}
          >
            {r.caption}
          </span>
          <span className="relative h-[1.35rem] min-w-0 flex-1 overflow-hidden rounded-[0.35rem]" style={{ background: 'var(--pf-grid)' }}>
            <span
              className="absolute inset-y-0 left-0 rounded-[0.35rem]"
              style={{ width: `${Math.round((r.value / top) * 100)}%`, background: 'var(--pf-teal)' }}
            />
          </span>
          <span
            /* ⚠️ nowrap AND WIDE ENOUGH FOR "95% on time" — at 6.5rem the
               caption broke onto a second line and every bar row grew. */
            className="w-[9.2rem] shrink-0 whitespace-nowrap text-right text-[0.82rem] tabular-nums"
            style={{ color: 'var(--pf-ink)' }}
          >
            {num(r.value)}
            {r.sub && (
              <span className="ml-[0.4rem]" style={{ color: 'var(--pf-mute)' }}>
                {r.sub}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A plain table shell, so every tab's grid reads the same. */
function Grid({
  head,
  children,
  minWidth = '34rem',
}: {
  head: ReadonlyArray<{ label: string; w?: string; align?: 'left' | 'center' }>;
  children: React.ReactNode;
  minWidth?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse" style={{ minWidth }}>
        <thead>
          <tr
            className="whitespace-nowrap border-y text-[0.76rem]"
            style={{ background: 'var(--pf-head)', borderColor: 'var(--pf-grid)', color: 'var(--pf-soft)' }}
          >
            {head.map((h, i) => (
              <th
                key={h.label}
                className={`py-[0.72rem] font-medium ${h.align === 'center' ? 'text-center' : 'text-left'} ${
                  i === 0 ? 'pl-[1.22rem]' : ''
                } ${i === head.length - 1 ? 'pr-[1.22rem]' : ''}`}
                style={h.w ? { width: h.w } : undefined}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => (
  <tr className="border-b last:border-0" style={{ borderColor: 'var(--pf-grid)', height: '3.35rem' }}>
    {children}
  </tr>
);

const Cell = ({
  children,
  align = 'left',
  first,
  last,
  title,
}: {
  children: React.ReactNode;
  align?: 'left' | 'center';
  first?: boolean;
  last?: boolean;
  title?: string;
}) => (
  <td
    className={`text-[0.87rem] ${align === 'center' ? 'text-center tabular-nums' : ''} ${
      first ? 'pl-[1.22rem]' : ''
    } ${last ? 'pr-[1.22rem]' : 'pr-[0.6rem]'}`}
    style={{ color: 'var(--pf-body)' }}
    title={title}
  >
    {children}
  </td>
);

/** A number that is a gap rather than a zero. */
const Dash = ({ why }: { why: string }) => (
  <span style={{ color: 'var(--pf-mute)' }} title={why}>
    —
  </span>
);

/** The line a panel uses to say what the record does and does not cover. */
export function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mx-[1.22rem] mb-[1.22rem] flex items-start gap-[0.7rem] rounded-[0.7rem] px-[1rem] py-[0.8rem] text-[0.85rem] leading-[1.45]"
      style={{ background: 'var(--pf-strip)', color: 'var(--pf-faint)' }}
    >
      <Info className="mt-[0.1rem] size-[1.1rem] shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/* ── Projects & teams ────────────────────────────────────────────────────── */

export function ProjectsTab({
  projects,
  teams,
  personName,
  ownOnly = false,
}: {
  projects: readonly ProjectRow[];
  teams: readonly TeamRow[];
  personName: string | null;
  /** The reader is looking at their own record, so address them directly. */
  ownOnly?: boolean;
}) {
  return (
    <div className="space-y-[1.25rem]">
      <Panel
        title={
          ownOnly
            ? 'Where your work goes'
            : personName
              ? `Where ${personName.split(' ')[0]}’s work goes`
              : 'Projects'
        }
        description={
          ownOnly
            ? 'Every project you have a task in, and what has come of it.'
            : personName
              ? 'Every project they have a task in, and what has come of it.'
              : 'Every project with work in this scope.'
        }
      >
        {projects.length === 0 ? (
          <Nothing>
            No project has a task in this scope. Widen the period, the team or the project above.
          </Nothing>
        ) : (
          <Grid
            head={[
              { label: 'Project' },
              { label: 'Assigned', w: '6.4rem', align: 'center' },
              { label: 'Completed', w: '6.6rem', align: 'center' },
              { label: 'On time', w: '6.4rem', align: 'center' },
              { label: 'Open', w: '5.2rem', align: 'center' },
              { label: 'Overdue', w: '6.2rem', align: 'center' },
              { label: 'People', w: '5.4rem', align: 'center' },
            ]}
          >
            {projects.map((p) => (
              <Row key={p.id}>
                <Cell first title={p.name}>
                  <span className="block truncate font-medium" style={{ color: 'var(--pf-ink)' }}>
                    {p.name}
                  </span>
                </Cell>
                <Cell align="center">{num(p.assigned)}</Cell>
                <Cell align="center">{num(p.completed)}</Cell>
                <Cell align="center">
                  {p.judged === 0 ? (
                    <Dash why="Nothing completed here had a deadline" />
                  ) : (
                    `${p.onTime} of ${p.judged}`
                  )}
                </Cell>
                <Cell align="center">{num(p.openNow)}</Cell>
                <Cell align="center">
                  <span style={p.overdue > 0 ? { color: 'var(--pf-red-ink)' } : undefined}>
                    {num(p.overdue)}
                  </span>
                </Cell>
                <Cell align="center" last>
                  {num(p.people)}
                </Cell>
              </Row>
            ))}
          </Grid>
        )}
      </Panel>

      <Panel
        title="Teams"
        description="The departments people belong to, and what they are carrying."
      >
        {teams.length === 0 ? (
          <Nothing>Nobody in this scope belongs to a department yet.</Nothing>
        ) : (
          <>
            <Grid
              head={[
                { label: 'Team' },
                { label: 'People', w: '6rem', align: 'center' },
                { label: 'Completed', w: '7rem', align: 'center' },
                { label: 'Open', w: '5.6rem', align: 'center' },
                { label: 'Overdue', w: '6.6rem', align: 'center' },
              ]}
              minWidth="28rem"
            >
              {teams.map((t) => (
                <Row key={t.id}>
                  <Cell first title={t.name}>
                    <span className="flex items-center gap-[0.6rem]">
                      <Users className="size-[1rem] shrink-0" style={{ color: 'var(--pf-mute)' }} aria-hidden="true" />
                      <span className="truncate font-medium" style={{ color: 'var(--pf-ink)' }}>
                        {t.name}
                      </span>
                    </span>
                  </Cell>
                  <Cell align="center">{num(t.people)}</Cell>
                  <Cell align="center">{num(t.completed)}</Cell>
                  <Cell align="center">{num(t.openNow)}</Cell>
                  <Cell align="center" last>
                    <span style={t.overdue > 0 ? { color: 'var(--pf-red-ink)' } : undefined}>
                      {num(t.overdue)}
                    </span>
                  </Cell>
                </Row>
              ))}
            </Grid>
            {/* ⚠️ A DEPARTMENT IS NOT A JOB TITLE — migration 117 exists because
                `role_title` is free text with three spellings of "sales". Teams
                here are the structured department, which is the one a rule can
                be written against. */}
            <Caveat>
              A team is the department on somebody’s record, not their job title — the title is free
              text and is spelled several ways. Somebody with no department is not counted in any row.
            </Caveat>
          </>
        )}
      </Panel>
    </div>
  );
}

/* ── Workload ────────────────────────────────────────────────────────────── */

export function WorkloadTab({ rows }: { rows: readonly WorkloadRow[] }) {
  const totals = React.useMemo(
    () => ({
      open: rows.reduce((n, r) => n + r.openNow, 0),
      overdue: rows.reduce((n, r) => n + r.overdue, 0),
      today: rows.reduce((n, r) => n + r.dueToday, 0),
      blocked: rows.reduce((n, r) => n + r.blocked, 0),
    }),
    [rows],
  );

  return (
    <div className="space-y-[1.25rem]">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11.4rem,1fr))] gap-[0.7rem]">
        <StatCard label="Open now" value={num(totals.open)} sub="Not done, not cancelled" tone="blue" icon={FileText} />
        <StatCard
          label="Past due"
          value={num(totals.overdue)}
          sub={totals.overdue === 0 ? 'Nothing is late' : 'Open and past the date'}
          tone="red"
          icon={Clock3}
        />
        <StatCard label="Due today" value={num(totals.today)} sub="Falls due in this day" tone="amber" icon={Clock3} />
        <StatCard
          label="Blocked"
          value={num(totals.blocked)}
          sub={totals.blocked === 0 ? 'Nothing is blocked' : 'Waiting on something'}
          tone="green"
          icon={Info}
        />
      </div>

      <Panel title="Who is carrying what" description="Open work per person, against the capacity on their record.">
        {rows.length === 0 ? (
          <Nothing>Nobody in this scope has any work.</Nothing>
        ) : (
          <>
            <Grid
              head={[
                { label: 'Person' },
                { label: 'Open', w: '5rem', align: 'center' },
                { label: 'Due today', w: '6.4rem', align: 'center' },
                { label: 'Overdue', w: '6.2rem', align: 'center' },
                { label: 'In review', w: '6.2rem', align: 'center' },
                { label: 'Points open', w: '9.5rem', align: 'center' },
              ]}
              minWidth="40rem"
            >
              {rows.map((r) => {
                const pct =
                  r.weeklyCapacityPoints > 0
                    ? Math.round((r.openPoints / r.weeklyCapacityPoints) * 100)
                    : null;
                const over = pct !== null && pct > 100;
                return (
                  <Row key={r.id}>
                    <Cell first>
                      <span className="flex min-w-0 items-center gap-[0.82rem]">
                        <Avatar name={r.name} src={r.avatarUrl} size="lg" />
                        <span className="min-w-0 flex-1">
                          <span
                            className="block truncate text-[0.86rem] font-semibold"
                            style={{ color: 'var(--pf-ink)' }}
                          >
                            {r.name}
                          </span>
                          <span className="block truncate text-[0.74rem]" style={{ color: 'var(--pf-mute)' }}>
                            {r.departmentName ?? r.roleTitle ?? r.role.replace('_', ' ')}
                          </span>
                        </span>
                      </span>
                    </Cell>
                    <Cell align="center">{num(r.openNow)}</Cell>
                    <Cell align="center">{num(r.dueToday)}</Cell>
                    <Cell align="center">
                      <span style={r.overdue > 0 ? { color: 'var(--pf-red-ink)' } : undefined}>
                        {num(r.overdue)}
                      </span>
                    </Cell>
                    <Cell align="center">{num(r.inReview)}</Cell>
                    <Cell align="center" last>
                      {/* ⚠️ POINTS, NOT HOURS. No timer entry exists in this
                          system, so "how busy" is an estimate total against the
                          capacity on the person's record — never a measured day. */}
                      {r.weeklyCapacityPoints === 0 ? (
                        <Dash why="No weekly capacity is set on their record" />
                      ) : (
                        <span style={over ? { color: 'var(--pf-red-ink)' } : undefined}>
                          {num(r.openPoints)} / {num(r.weeklyCapacityPoints)}
                          <span className="ml-[0.35rem] text-[0.76rem]" style={{ color: over ? 'var(--pf-red-ink)' : 'var(--pf-mute)' }}>
                            {pct}%
                          </span>
                        </span>
                      )}
                    </Cell>
                  </Row>
                );
              })}
            </Grid>
            <Caveat>
              Load is counted in estimate points against the weekly capacity on each person’s record.
              No hours are logged anywhere in this system, so this is what was planned, not what was
              worked — and a person with no capacity set shows a dash rather than a percentage.
            </Caveat>
          </>
        )}
      </Panel>
    </div>
  );
}

/* ── Quality ─────────────────────────────────────────────────────────────── */

/**
 * Reviews — and there is no "verified" in it.
 *
 * ⚠️ Owner, 2026-09-24: *"There is no term you can say 'verified' ... you can
 * say in the review how many tasks are in a review and how many tasks are
 * done."* So this counts what is IN review, what went THROUGH review, and what
 * is done. The reviewer is the person who assigned the task — the owner's own
 * rule, and the only reviewer the schema can name.
 */
export function QualityTab({ quality, nowMs }: { quality: QualitySummary; nowMs: number }) {
  const { completed, reviewed, inReview, reopened, resubmitted, queue } = quality;
  const wentThrough = rate(reviewed, completed);
  const selfRaised = queue.filter((q) => q.selfRaised).length;

  return (
    <div className="space-y-[1.25rem]">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(11.4rem,1fr))] gap-[0.7rem]">
        <StatCard
          label="In review now"
          value={num(inReview)}
          sub={inReview === 0 ? 'Nothing is waiting' : 'Submitted and waiting on a reviewer'}
          tone="blue"
          icon={Users}
        />
        <StatCard
          label="Done"
          value={num(completed)}
          sub={
            completed === 0
              ? 'Nothing closed in this period'
              : wentThrough.value === null
                ? 'Reached done in the period'
                : `${reviewed} of them went through review`
          }
          tone="green"
          icon={CheckCircle2}
        />
        <StatCard
          label="Sent back"
          value={num(resubmitted)}
          sub={resubmitted === 0 ? 'Nothing was resubmitted' : 'Submitted more than once'}
          tone="green"
          icon={RefreshCw}
        />
        <StatCard
          label="Reopened"
          value={num(reopened)}
          sub={reopened === 0 ? 'Nothing came back' : 'Moved again after being done'}
          tone="red"
          icon={Info}
        />
      </div>

      <Panel title="Review queue" description="Work that has been submitted and is waiting on somebody.">
        {queue.length === 0 ? (
          <Nothing>Nothing is waiting on a reviewer in this scope.</Nothing>
        ) : (
          <>
            <Grid
              head={[
                { label: 'Task' },
                { label: 'Who did it', w: '10rem' },
                { label: 'Who reviews it', w: '10.5rem' },
                { label: 'Waiting', w: '6.4rem' },
                { label: 'Action', w: '8rem' },
              ]}
              minWidth="42rem"
            >
              {queue.map((r) => {
                const hours = r.submittedAt
                  ? Math.floor((nowMs - Date.parse(r.submittedAt)) / 3_600_000)
                  : null;
                const stale = hours !== null && hours >= 48;
                return (
                  <Row key={r.taskId}>
                    <Cell first title={`${r.reference} · ${r.title} · ${r.projectName}`}>
                      <span className="block truncate font-medium" style={{ color: 'var(--pf-ink)' }}>
                        {r.title}
                      </span>
                      <span className="block truncate text-[0.74rem]" style={{ color: 'var(--pf-mute)' }}>
                        {r.reference} · {r.projectName}
                      </span>
                    </Cell>
                    <Cell>
                      {r.ownerName ? (
                        <span className="flex min-w-0 items-center gap-[0.6rem]">
                          <Avatar name={r.ownerName} src={r.ownerAvatarUrl} size="md" />
                          <span className="min-w-0 flex-1 truncate">{r.ownerName}</span>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--pf-mute)' }}>Nobody</span>
                      )}
                    </Cell>
                    {/* ⚠️ THE ASSIGNER REVIEWS IT — the owner's rule. When they
                        raised it themselves there is nobody else, and saying so
                        is the finding: most work here is self-raised. */}
                    <Cell title={r.selfRaised ? 'They raised this task themselves' : undefined}>
                      {r.reviewerName ? (
                        <span className="block truncate" style={{ color: 'var(--pf-ink)' }}>
                          {r.reviewerName}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--pf-amber)' }}>Self-raised</span>
                      )}
                    </Cell>
                    <Cell>
                      {hours === null ? (
                        <Dash why="No submission was recorded in the log" />
                      ) : (
                        <span style={stale ? { color: 'var(--pf-red-ink)' } : undefined}>
                          {hours}h
                        </span>
                      )}
                    </Cell>
                    <Cell last>
                      <Link
                        href={`/tasks?task=${r.taskId}` as Route}
                        className="inline-flex items-center gap-[0.45rem] whitespace-nowrap font-semibold hover:underline"
                        style={{ color: 'var(--pf-link)' }}
                      >
                        Review now <ArrowRight className="size-[0.95rem] shrink-0" aria-hidden="true" />
                      </Link>
                    </Cell>
                  </Row>
                );
              })}
            </Grid>
            {/* ⚠️ THE REFERENCE HAS A REVIEWER COLUMN. WE CANNOT FILL IT. Nothing
                in this schema assigns a reviewer to a task; the only reviewer we
                can name is whoever eventually moved it, after the fact. Drawing
                the column with a guess in it would be worse than not having it. */}
            <Caveat>
              The reviewer is whoever assigned the task.
              {selfRaised > 0
                ? ` ${selfRaised} of these ${queue.length} were raised by the same person who did them, so there is nobody else to review those.`
                : ''}
            </Caveat>
          </>
        )}
      </Panel>

      {/* ⚠️ THE HEADLINE THIS TAB EXISTS TO SAY. Measured live: 5 of 917
          closures were made by somebody other than the person who did the work.
          A "first-pass acceptance rate" over that is a number with nothing
          behind it, so the tab states the practice instead of scoring it. */}
      <Panel title="What these figures can and cannot tell you">
        <div className="space-y-[0.7rem] border-t px-[1.22rem] py-[1.15rem] text-[0.88rem] leading-[1.5]" style={{ borderColor: 'var(--pf-grid)' }}>
          <p style={{ color: 'var(--pf-ink)' }}>
            A task enters review when somebody asks for one, and the person who assigned it is the
            one who reviews it. {reviewed} of {completed} tasks done in this period went through
            review on the way.
          </p>
          <p style={{ color: 'var(--pf-soft)' }}>
            Most work in this division is raised by the same person who does it, so for those tasks
            there is nobody else to review them — that is a fact about how work is handed out, not a
            score against anybody.
          </p>
          <p style={{ color: 'var(--pf-soft)' }}>
            Written feedback is not recorded: there are almost no comments on tasks, so nothing here
            can say <em>why</em> something was sent back. {resubmitted > 0 ? `${resubmitted} were submitted more than once.` : ''}{' '}
            {reopened > 0 ? `${reopened} were reopened after being closed.` : ''}
          </p>
        </div>
      </Panel>
    </div>
  );
}

/* ── Compare ─────────────────────────────────────────────────────────────── */

export function CompareTab({
  weekly,
  monthly,
  board,
  picked,
  personName,
}: {
  weekly: readonly BucketRow[];
  monthly: readonly BucketRow[];
  board: readonly PersonStat[];
  picked: ReadonlySet<string>;
  personName: string | null;
}) {
  const [by, setBy] = React.useState<'week' | 'month'>('week');
  const rows = by === 'week' ? weekly : monthly;
  const chosen = board.filter((p) => picked.has(p.id));
  const compare = chosen.length > 1 ? chosen : board.filter((p) => p.completed > 0).slice(0, 8);

  return (
    <div className="space-y-[1.25rem]">
      <Panel
        title={personName ? `${personName.split(' ')[0]} over time` : 'The team over time'}
        description="Tasks completed in each period, from the date each one was closed."
        action={
          <div className="flex items-center gap-[0.4rem]">
            {(['week', 'month'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setBy(k)}
                className="rounded-[0.6rem] px-[0.8rem] py-[0.5rem] text-[0.78rem] font-semibold leading-none capitalize"
                style={
                  by === k
                    ? { background: 'var(--pf-mint)', color: 'var(--pf-mint-ink)' }
                    : { color: 'var(--pf-soft)' }
                }
              >
                By {k}
              </button>
            ))}
          </div>
        }
      >
        {rows.length === 0 ? (
          <Nothing>Nothing has been completed in this scope, so there is no trend to draw.</Nothing>
        ) : (
          <>
            <div className="border-t pt-[1rem]" style={{ borderColor: 'var(--pf-grid)' }}>
              <Bars
                label="Completed per period"
                rows={rows.map((r) => ({
                  key: r.bucket,
                  caption: r.bucket,
                  value: r.completed,
                  sub: r.judged > 0 ? `${Math.round((r.onTime / r.judged) * 100)}% on time` : undefined,
                }))}
              />
            </div>
            {/* ⚠️ WHY WEEKS ARE THE DEFAULT. The owner asked for month-wise; the
                record holds one month, so month-wise is a single bar. Saying so
                is the difference between "flat" and "we only have one month". */}
            {by === 'month' && monthly.length < 2 && (
              <Caveat>
                Only {monthly.length === 1 ? 'one month' : 'no month'} of completed work is recorded,
                so there is nothing to compare month against month yet. By week shows the same range
                as {weekly.length} periods.
              </Caveat>
            )}
          </>
        )}
      </Panel>

      {!personName && (
        <Panel
          title={chosen.length > 1 ? `Comparing ${chosen.length} people` : 'Person against person'}
          description={
            chosen.length > 1
              ? 'The people ticked on the Overview.'
              : 'Tick people on the Overview to compare only those; this shows everybody with completed work.'
          }
        >
          {compare.length === 0 ? (
            <Nothing>Nobody in this scope completed anything in the period.</Nothing>
          ) : (
            <div className="border-t pt-[1rem]" style={{ borderColor: 'var(--pf-grid)' }}>
              <Bars
                label="Completed per person"
                rows={compare.map((p) => ({
                  key: p.id,
                  caption: p.name,
                  value: p.completed,
                  sub: p.judged > 0 ? `${p.onTime}/${p.judged} on time` : undefined,
                }))}
              />
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

/* ── Reports ─────────────────────────────────────────────────────────────── */

export function ReportsTab({
  board,
  periodLabel,
}: {
  board: readonly PersonStat[];
  periodLabel: string;
}) {
  const completed = board.reduce((n, p) => n + p.completed, 0);
  const overdue = board.reduce((n, p) => n + p.overdue, 0);
  const open = board.reduce((n, p) => n + p.openNow, 0);

  return (
    <Panel title="Reports" description="Documents you can send, and what is in them.">
      <div className="space-y-[1rem] border-t px-[1.22rem] py-[1.15rem]" style={{ borderColor: 'var(--pf-grid)' }}>
        <p className="text-[0.88rem] leading-[1.5]" style={{ color: 'var(--pf-ink)' }}>
          {periodLabel}: <strong>{num(completed)}</strong> completed, <strong>{num(open)}</strong>{' '}
          still open, <strong>{num(overdue)}</strong> past their date, across{' '}
          <strong>{board.length}</strong> people.
        </p>
        {/* ⚠️ THE EXPORT LIVES ON /reports AND IS NOT DUPLICATED HERE. Owner,
            2026-09-23: *"For right now I don't want to change the export of the
            report page but I want to change the UI."* A second exporter would be
            a second thing to keep in step with the first. */}
        <p className="text-[0.88rem] leading-[1.5]" style={{ color: 'var(--pf-soft)' }}>
          The document itself is produced by the Reports page, which already exports CSV, Excel and
          PDF on the company letterhead. It is deliberately unchanged — this tab is the way into it,
          not a second copy of it.
        </p>
        <Link
          href={'/reports' as Route}
          className="inline-flex items-center gap-[0.5rem] rounded-[0.7rem] px-[1.05rem] py-[0.72rem] text-[0.87rem] font-semibold leading-none"
          style={{ background: 'var(--pf-teal)', color: 'var(--pf-on-solid)' }}
        >
          Open Reports <ArrowRight className="size-[1rem]" aria-hidden="true" />
        </Link>
      </div>
    </Panel>
  );
}

/* ── The work itself — owner, 2026-09-24 ─────────────────────────────────── */

const STATUS_LOOK: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'grey' }> = {
  backlog: { label: 'Backlog', tone: 'grey' },
  todo: { label: 'Not started', tone: 'grey' },
  in_progress: { label: 'In progress', tone: 'amber' },
  in_review: { label: 'In review', tone: 'amber' },
  revisions: { label: 'In revision', tone: 'amber' },
  blocked: { label: 'Blocked', tone: 'red' },
  done: { label: 'Completed', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
};

const ACTION_WORD: Record<string, string> = {
  created: 'Raised',
  backlog: 'Backlog',
  todo: 'Not started',
  in_progress: 'Started',
  in_review: 'Submitted',
  revisions: 'Sent back',
  blocked: 'Blocked',
  done: 'Completed',
  cancelled: 'Cancelled',
  updated: 'Edited',
  attachment_added: 'Attached a file',
  'task.handoff': 'Handed over',
  'task.placement_recorded': 'Placement recorded',
};

/** How long since the last thing happened to it. */
function since(iso: string | null, nowMs: number): string {
  if (!iso) return '';
  const h = Math.floor((nowMs - Date.parse(iso)) / 3_600_000);
  if (!Number.isFinite(h) || h < 0) return '';
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

const STATUS_BG = {
  green: 'var(--pf-green-bg)',
  amber: 'var(--pf-amber-bg)',
  red: 'var(--pf-red-bg)',
  grey: 'var(--pf-strip)',
} as const;

const STATUS_INK = {
  green: 'var(--pf-green)',
  amber: 'var(--pf-amber)',
  red: 'var(--pf-red-ink)',
  grey: 'var(--pf-soft)',
} as const;

/**
 * What each person is actually doing.
 *
 * ⚠️ THE PAGE COUNTED EVERYTHING AND SHOWED NOTHING. Owner, 2026-09-24: *"The
 * task exactly what he is doing is not showing ... nothing you can say is
 * meaningful."* Eight tabs of totals, and real task titles appeared in exactly
 * two places on the whole screen. This panel answers "what is Najamullah doing
 * today": the activity, the person on it, the project, and the last thing that
 * happened to it — in that order, because that is the order it gets asked in.
 */
export function WorkPanel({
  rows,
  total,
  nowMs,
  today,
  title,
  description,
  onOpenTask,
  showAssignee = true,
}: {
  rows: readonly WorkRow[];
  total: number;
  nowMs: number;
  today: string;
  title: string;
  description: string;
  onOpenTask: (taskId: string) => void;
  showAssignee?: boolean;
}) {
  return (
    <Panel title={title} description={description}>
      {rows.length === 0 ? (
        <Nothing>Nothing is open or was closed in this scope. Widen the period above.</Nothing>
      ) : (
        <>
          <Grid
            /* ⚠️ THE TITLE IS THE COLUMN THAT MATTERS AND IT MUST BE THE WIDEST.
               Budgeted from the design rule that already bit twice on this page:
               the flexible column gets what is left, so the fixed ones are sized
               from their own headers, not generously. At the first attempt they
               totalled 758px of an 840px table and the task title — the whole
               point of this panel — rendered as "KSA ...". */
            head={[
              { label: 'Task / activity' },
              ...(showAssignee ? [{ label: 'Who is on it', w: '10rem' }] : []),
              { label: 'Project', w: '9.4rem' },
              { label: 'Status', w: '7.2rem' },
              { label: 'Due', w: '5.5rem' },
              /* 10.6rem, not 9.4: "6 days ago · Rafay abbasi" measures 144px and
                 was cut at 131. Taken from Task/activity, which has the slack. */
              { label: 'Last move', w: '10.6rem' },
            ]}
            minWidth="52rem"
          >
            {rows.map((r) => {
              const look = STATUS_LOOK[r.status] ?? { label: r.status, tone: 'grey' as const };
              const late =
                r.status !== 'done' && r.status !== 'cancelled' && r.dueDate !== null && r.dueDate < today;
              return (
                <Row key={r.taskId}>
                  <Cell first title={r.description ? `${r.title}\n\n${r.description}` : r.title}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(r.taskId)}
                      className="block w-full truncate text-left font-medium hover:underline"
                      style={{ color: 'var(--pf-ink)' }}
                    >
                      {r.title}
                    </button>
                    <span className="block truncate text-[0.72rem]" style={{ color: 'var(--pf-mute)' }}>
                      {r.reference}
                      {r.description ? ` \u00b7 ${r.description.replace(/\s+/g, ' ')}` : ''}
                    </span>
                  </Cell>
                  {showAssignee && (
                    <Cell>
                      {r.assigneeName ? (
                        <span className="flex min-w-0 items-center gap-[0.6rem]">
                          <Avatar name={r.assigneeName} src={r.assigneeAvatarUrl} size="md" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate" style={{ color: 'var(--pf-ink)' }}>
                              {r.assigneeName}
                            </span>
                            {r.assigneeRole && (
                              <span
                                className="block truncate text-[0.72rem]"
                                style={{ color: 'var(--pf-mute)' }}
                              >
                                {r.assigneeRole}
                              </span>
                            )}
                          </span>
                        </span>
                      ) : (
                        /* ⚠️ "Nobody" IS A FINDING, NOT A BLANK. An unassigned
                           task is the thing a manager most needs to see. */
                        <span style={{ color: 'var(--pf-red-ink)' }}>Nobody assigned</span>
                      )}
                    </Cell>
                  )}
                  <Cell title={r.projectName}>
                    <span className="block truncate">{r.projectName}</span>
                  </Cell>
                  <Cell>
                    <span
                      className="inline-flex items-center rounded-full px-[0.6rem] py-[0.2rem] text-[0.74rem] font-semibold"
                      style={{ background: STATUS_BG[look.tone], color: STATUS_INK[look.tone] }}
                    >
                      {look.label}
                    </span>
                  </Cell>
                  <Cell>
                    {r.dueDate ? (
                      <span style={late ? { color: 'var(--pf-red-ink)' } : undefined}>
                        {new Date(`${r.dueDate}T00:00:00Z`).toLocaleDateString('en-GB', {
                          timeZone: 'UTC',
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                    ) : (
                      <Dash why="No due date is set on this task" />
                    )}
                  </Cell>
                  <Cell
                    last
                    title={
                      r.lastAction
                        ? [ACTION_WORD[r.lastAction] ?? r.lastAction, since(r.lastActionAt, nowMs), r.lastActorName]
                            .filter(Boolean)
                            .join(' · ')
                        : undefined
                    }
                  >
                    {r.lastAction ? (
                      <span className="block">
                        <span className="block truncate" style={{ color: 'var(--pf-ink)' }}>
                          {ACTION_WORD[r.lastAction] ?? r.lastAction}
                        </span>
                        <span
                          className="block truncate text-[0.72rem]"
                          style={{ color: 'var(--pf-mute)' }}
                        >
                          {[since(r.lastActionAt, nowMs), r.lastActorName].filter(Boolean).join(' \u00b7 ')}
                        </span>
                      </span>
                    ) : (
                      <Dash why="Nothing is recorded in the log for this task" />
                    )}
                  </Cell>
                </Row>
              );
            })}
          </Grid>
          {total > rows.length && (
            <Caveat>
              Showing {rows.length} of {total}. Narrow by person, project or period to see the rest —
              drawing all {total} would make the page slower than it is useful.
            </Caveat>
          )}
        </>
      )}
    </Panel>
  );
}
