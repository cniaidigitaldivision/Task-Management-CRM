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
    /* ⚠️ The address WITHOUT its scheme. The generic table draws text, so this is
       not clickable — and a column of "https://" prefixes costs eight characters
       of width that tell a reader nothing. The clickable copy lives on the
       poster layout, which is still reachable with `?poster=1`. */
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

    /* The glance lines and the notes, together: on the sheet they land in one
       "what this report counts" block, and both are plain statements of fact
       about the period. `people` goes in as prose because the generic table has
       one shape and this is a second, smaller list. */
    notes: [
      ...content.glance,
      ...content.people.map(
        (person) =>
          `${person.name} published ${person.posts} ` +
          `${person.posts === 1 ? 'post' : 'posts'}` +
          (person.done > 0 ? `, ${person.done} of them done.` : '.'),
      ),
      ...content.notes,
      'One row per task, counted on the day it was published rather than the day it was finished. A task cross-posted to several platforms is one row; the Platforms column names them all.',
    ],
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
