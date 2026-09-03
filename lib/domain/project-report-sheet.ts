import type { Report } from './reports';
import type { ReportContent } from './report-content';

/* ============================================================================
 * ONE PROJECT'S REPORT, AS THE REPORTS-PAGE SHEET
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03, for the third time and with the /reports PDF export open
 * beside it: *"I told you that I want this template of the PDF that I have here
 * with you as a screenshot. It's the same template which is in the /report
 * page… in the same way, a sleek way, I want a project individual report in
 * which each task is mentioned separately, who did it, what their status is,
 * and which platforms have been done."*
 *
 * ── ⚠️ THIS IS THE THIRD TIME, AND THE PATTERN WAS ALREADY HERE ─────────────
 * The note on `Report['type']` records the same request twice before: *"the PDF
 * template should be the same as on the report page"* (2026-08-25) and *"make
 * sure the report template is the same as the report pages' PDF template"*
 * (2026-08-26). Attendance and finance both answered it by building a `Report`
 * and handing it to `composeReportSheet`, which is the masthead, the figure
 * cards, the ruled table and the notes block in the screenshot.
 *
 * The project report went its own way instead — `lib/pdf/report-poster.ts`, a
 * bespoke A4 layout with illustration panels. It is a nice page and it is not
 * the one that was asked for, three times. This function puts the project on the
 * same road as attendance and finance.
 *
 * ── ⚠️ ONE ROW PER TASK, WHICH IS THE POINT ─────────────────────────────────
 * The work report is one row per project-and-person. Asked for here is one row
 * per TASK: *"each task is mentioned separately."* So the rows are built from
 * `content.published`, which since 2026-09-03 carries the task, its reference,
 * its category, who did it, its status and its link.
 *
 * ── ⚠️ BUILT FROM THE STORED CONTENT, NEVER RE-QUERIED ──────────────────────
 * The same reasoning the route already documents: a report is a document that
 * may have been sent to a client, and re-reading the database would let today's
 * data rewrite yesterday's letter. Everything here comes from the row.
 * ========================================================================= */

/**
 * The project's name and its promise, for the sheet's banner.
 *
 * Owner, 2026-09-03: *"make the project name more prominent… it should be in the
 * center but in bold"*, and *"show what the promise or target is, that is, 1
 * post daily or 2 posts a week."*
 *
 * ⚠️ The rhythm line is FOUND in the introduction rather than rebuilt. The
 * sentence "The agreed rhythm is 1 static post a day and 2 reels a week" is
 * already composed from the project's own columns when the report is generated;
 * writing it a second time here would be a second phrasing of one fact, and they
 * would disagree the first time either changed.
 */
export function projectBanner(content: ReportContent): {
  title: string;
  lines: readonly string[];
} {
  const rhythm = content.introduction.filter((line) => /rhythm|package|platform/i.test(line));
  return {
    title: content.projectName,
    lines: rhythm.length > 0 ? rhythm : [content.periodLabel],
  };
}

export function buildProjectReportSheet(
  content: ReportContent,
  period: { start: string; end: string },
): Report {
  const rows = content.published.map((row) => [
    { kind: 'text' as const, value: row.task },
    { kind: 'text' as const, value: row.reference },
    { kind: 'text' as const, value: row.contentType },
    { kind: 'text' as const, value: row.person },
    { kind: 'text' as const, value: row.platform },
    { kind: 'text' as const, value: row.status },
    /* ⚠️ The address WITHOUT its scheme — a column of "https://" prefixes costs
       eight characters of width that tell a reader nothing. It IS clickable: the
       route passes the full hrefs as `linkColumn`, and the annotation carries
       the complete address while the cell shows the readable part.

       (An earlier version of this comment said it was not clickable and pointed
       at `?poster=1` for a copy that was. Both halves were wrong by the time it
       was written: the links landed in the same change, and the poster is
       `?layout=poster`.) */
    { kind: 'text' as const, value: row.url ? row.url.replace(/^https?:\/\//, '') : '-' },
  ]);

  return {
    /* Not one of the four analytical reports — see the note on `Report['type']`,
       which is where attendance and finance are also excused. */
    type: 'project',

    title: 'Project report',
    /* The project's name as it was WHEN THE REPORT WAS MADE, from the content.
       The route deliberately does not substitute the current name. */
    subtitle: `${content.projectName}  -  ${content.periodLabel}`,
    period,

    columns: [
      { key: 'task', label: 'Task', kind: 'text', width: 34 },
      { key: 'reference', label: 'Reference', kind: 'text', width: 12 },
      { key: 'category', label: 'Category', kind: 'text', width: 14 },
      { key: 'person', label: 'Who did it', kind: 'text', width: 18 },
      { key: 'platform', label: 'Platforms', kind: 'text', width: 20 },
      { key: 'status', label: 'Status', kind: 'text', width: 12 },
      { key: 'url', label: 'Live link', kind: 'text', width: 34 },
    ],
    rows,

    /* ⚠️ The figures come from the content's own headline, which is what the
       arithmetic in `buildProjectReport` produced — not recomputed here. Two
       places working out the same number is how a PDF and a screen come to
       disagree about a target. */
    figures: [
      ...content.headline.map((figure) => ({
        label: figure.label,
        value: { kind: 'number' as const, value: numberIn(figure.value) },
        hint: figure.sub,
      })),
      {
        label: 'Tasks listed',
        value: { kind: 'number' as const, value: content.published.length },
        hint: 'each one a row below',
      },
    ],

    /* ── ⚠️ A SUMMARY, NOT A LIST OF THE SAME FACT ────────────────────────
       Owner, 2026-09-03: *"what the report count, the text or a summary, you
       are saying that that's not a correct summary. You are repeating the same
       thing again and again. Give a proper report or you can say a summary…
       some tips."*

       Fair, and it was my doing. The first version of this poured in
       `content.glance` AND `content.people` AND `content.notes` — and I had
       already put the per-person lines into `glance` an hour earlier, so every
       person appeared twice, once as "Abdul Moiz: 1 post" and again as "Abdul
       Moiz published 1 post". Three sources of overlapping prose is not a
       summary; it is three summaries stacked.

       So it is written once, in three parts that answer different questions:
         · WHERE IT STANDS   the promise, what came of it, in prose
         · WHAT WOULD HELP   advice, and only where a figure asks for it
         · WHAT THIS COUNTS  the one definitional line, stated once
       `content.glance` is deliberately NOT included: those same facts are the
       figure cards at the top of the sheet. */
    notes: summaryFor(content),

  };
}

/**
 * The leading number out of a headline value.
 *
 * ⚠️ `content.headline` stores its values as STRINGS — "5", and occasionally
 * something like "5 of 7" — because the poster layout draws them as type. The
 * sheet's figure cards want a number so a percent or a total can be formatted,
 * so the digits are taken off the front rather than the whole string coerced:
 * `Number('5 of 7')` is NaN, which draws as "NaN" on a client's document.
 */
function numberIn(value: string): number {
  const match = /-?\d+(\.\d+)?/.exec(value);
  return match ? Number(match[0]) : 0;
}

/**
 * The notes block: where the project stands, what would help, and what the
 * figures mean.
 *
 * ⚠️ EVERY LINE IS DRAWN FROM THIS REPORT'S OWN NUMBERS. Advice that could have
 * been written before the data arrived — "maintain consistency", "keep up the
 * good work" — reads as filler and teaches people to skip the block. Each tip
 * here names a figure, and none appears unless that figure asks for it.
 */
function summaryFor(content: ReportContent): string[] {
  const notes: string[] = [];

  const target = figure(content, /target/i);
  const achieved = figure(content, /achieved/i);
  const remaining = figure(content, /remaining/i);

  const tasks = content.published.length;
  const noLink = content.published.filter((row) => !row.url).length;

  /* ── Where it stands ───────────────────────────────────────────────────── */
  /* ⚠️ THE RHYTHM IS NOT REPEATED HERE. It is the banner's second line, directly
     above the figure cards — printing it again as note one is the same
     duplication the owner objected to, arrived at from the other direction. A
     test asserts the notes do not restate a figure card. */

  if (target !== null) {
    notes.push(
      remaining !== null && remaining > 0
        ? `Against that, ${content.periodLabel} asked for ${target} and ${achieved ?? 0} went out — ${remaining} short.`
        : `Against that, ${content.periodLabel} asked for ${target} and ${achieved ?? 0} went out. The target is met.`,
    );
  } else {
    notes.push(
      `No posting rhythm is agreed for this project, so ${content.periodLabel} has nothing to be measured against.`,
    );
  }

  if (tasks > 0) {
    const owners = content.people.map((person) => person.name);
    const who =
      owners.length === 0
        ? ''
        : owners.length === 1
          ? ` All of it was ${owners[0]}'s.`
          : ` ${owners.slice(0, -1).join(', ')} and ${owners[owners.length - 1]} did the work.`;

    /* ⚠️ "finished", not "on the list, N of them finished". Every row in this
       table IS finished since 2026-09-03 — the table lists completed work — so
       the second half of that sentence always read "2 of them finished" out of
       2 and told the reader nothing. */
    notes.push(
      `${tasks} ${tasks === 1 ? 'task' : 'tasks'} finished in this period.${who}`,
    );
  }

  /* ── What would help ──────────────────────────────────────────────────── */
  if (remaining !== null && remaining > 0) {
    notes.push(
      `To close the gap: ${remaining} more ${remaining === 1 ? 'post' : 'posts'} in this period. ` +
        'Raising them against the days that are still open is the difference between catching up and carrying it into the next period.',
    );
  }

  if (noLink > 0) {
    notes.push(
      `${noLink} ${noLink === 1 ? 'task has' : 'tasks have'} no live link recorded. ` +
        'A post without its link cannot be checked by the client, and does not count towards delivery until it has one.',
    );
  }

  /* ⚠️ THE "STILL OPEN" TIP IS GONE. It counted `tasks - done` over a table that
     now contains only completed work, so it could never fire — a branch that is
     dead by construction is worse than no branch, because the next reader takes
     it as evidence that open work appears here and it does not. Open work is
     visible on the board and in the target figures; this table is what was
     finished. */

  if (target !== null && remaining === 0 && noLink === 0 && tasks > 0) {
    /* The one case with nothing to advise. Said plainly rather than padded — a
       clean period deserves a sentence, not a paragraph of generic tips. */
    notes.push('Nothing outstanding: the target is met, every task is closed and every post has its link.');
  }

  /* ── What this counts ─────────────────────────────────────────────────── */
  notes.push(
    'One row per task, counted on the day it was published rather than the day it was finished. ' +
      'A task cross-posted to several platforms is one row, and the Platforms column shows each one it reached.',
  );

  return notes;
}

/** A headline figure by label, as a number, or null when it is absent.
 *
 *  ⚠️ The digits are taken off the FRONT of the stored string: `content.headline`
 *  keeps its values as text for the poster layout, and `Number('5 of 7')` is NaN,
 *  which would print "NaN" in a sentence on a client's document. */
function figure(content: ReportContent, label: RegExp): number | null {
  const found = content.headline.find((entry) => label.test(entry.label));
  if (!found) return null;
  const match = /-?\d+(\.\d+)?/.exec(found.value);
  return match ? Number(match[0]) : null;
}
