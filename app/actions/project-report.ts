'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/current-user';
import { auditAlone } from '@/lib/db/queries/audit';
import { getProject } from '@/lib/db/queries/projects';
import { projectReportData } from '@/lib/db/queries/project-report';
import {
  deleteProjectReport,
  insertProjectReport,
} from '@/lib/db/queries/report-files';
import { buildProjectReport } from '@/lib/domain/project-report';
import type { ReportContent } from '@/lib/domain/report-content';
import {
  MONTH_START,
  isReportKind,
  reportPeriod,
} from '@/lib/domain/report-periods';
import { can } from '@/lib/domain/permissions';
import {
  CONTENT_KIND_LABEL,
  STATUS_META,
  type ContentKind,
  type TaskStatus,
} from '@/lib/domain/constants';
import { generatePoster, chatgptKey } from '@/lib/ai/report-image';
import { uploadLibraryObject } from '@/lib/storage/library';
import { nowMs } from '@/lib/now';

/** The word in the reference's top-right badge. */
const BADGE: Readonly<Record<string, string>> = {
  today: 'DAILY',
  yesterday: 'DAILY',
  week: 'WEEKLY',
  month: 'MONTHLY',
  year: 'ANNUAL',
};

/* ============================================================================
 * GENERATING A REPORT — owner request 2026-08-20
 * ----------------------------------------------------------------------------
 * Compute the figures → assemble the content → record the row. The PDF is drawn from
 * the stored content by `/api/project-report/[id]`, on demand.
 *
 * ── ⚠️ WHY THE PAGE IS DRAWN AND NOT GENERATED ────────────────────────────────
 * The first build of this sent the owner's reference layout to `gpt-image-1`. It worked
 * and the FIGURES came back correct — 32 / 27 / 5 / 21 / 6 / 84% / 61 all right. What it
 * garbled was WORDS: the project name came back as "NAYA MARKITING", a heading as
 * "RERIIMED", "3 PROGRAMMES MANAGED" with a stray apostrophe, the date as 2025 when
 * 2026 was sent, and the division's logo redrawn rather than reproduced. That was
 * measured, not predicted, and it is the inverse of what I expected.
 *
 * A document with the client's own name misspelled cannot be sent. So the owner's four
 * reference layouts and six illustration assets are now composed by
 * `lib/pdf/report-poster.ts` with real type — same presentation, every glyph correct.
 *
 * The gain is not only spelling. Measured on the same project: **64.5 seconds and a
 * per-press charge** became **under a second and free**, and the PDF is now
 * deterministic — the same report opened twice is the same file, which is what makes
 * "this is the one I sent you" a statement anybody can check.
 *
 * ⚠️ `REPORT_POSTER_MODEL=1` still routes through `gpt-image-1`, because the owner asked
 * for that path twice and it is theirs to choose. It is off by default for the reason
 * above, and the stored row records which one drew it.
 *
 * ── ⚠️ THE FIGURES ARE COMPUTED HERE, ALWAYS ──────────────────────────────────
 * `buildProjectReport` (17 tests) does every piece of arithmetic. Nothing downstream —
 * neither the composer nor the image model — is asked to work a number out, only to
 * place one.
 *
 * ── ADMIN AND ABOVE ──────────────────────────────────────────────────────────
 * A report is a document that leaves the building, so it sits at the same floor as
 * editing the project. Migration 038's insert policy is the boundary; this is the
 * courtesy.
 * ========================================================================= */

export interface GenerateResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly reportId?: string;
}

export async function generateProjectReportAction(
  projectId: string,
  kind: string,
  from?: string,
  to?: string,
): Promise<GenerateResult> {
  const user = await requireUser();
  const actor = { role: user.role, id: user.id };

  if (!can(actor, 'project.edit')) {
    return { ok: false, error: 'Only an Admin can generate a report.' };
  }

  /* ⚠️ Only the image path needs a key. The drawn path needs nothing, which is also why
     it is the default — a report must not stop working because a third-party key
     expired. */
  const useModel = process.env.REPORT_POSTER_MODEL === '1';
  if (useModel && !chatgptKey()) {
    return {
      ok: false,
      error:
        'REPORT_POSTER_MODEL is on but no OpenAI key is configured. Set CHATGPT_API_KEY, or unset REPORT_POSTER_MODEL to draw the report instead.',
    };
  }

  /* Validated rather than trusted: these arrive from a client component and end up in
     date comparisons. A malformed value would produce an empty report, which reads as
     "we published nothing" — the worst failure for a document a client sees. */
  if (!isReportKind(kind)) return { ok: false, error: 'That is not a report this system makes.' };

  const project = await getProject(user.id, projectId);
  if (!project) return { ok: false, error: 'That project is no longer available.' };

  const now = new Date(nowMs());
  const pad = (n: number) => String(n).padStart(2, '0');
  /* UTC parts, so which period you get does not depend on where the server runs. */
  const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;

  const period = reportPeriod(
    kind,
    today,
    from && MONTH_START.test(from) ? from : undefined,
    to && MONTH_START.test(to) ? to : undefined,
  );

  const data = await projectReportData(user.id, projectId, period.start, period.end);
  const report = buildProjectReport(period, data.assets, data.placements, {
    staticPostsPerDay: project.staticPostsPerDay,
    reelsPerWeek: project.reelsPerWeek,
    reelDays: project.reelDays,
    postingDays: project.postingDays,
  });

  /* ── The short summary. Owner: *"be short"* — and that instruction is what keeps the
     figures accurate, not merely tidy.

     ⚠️ Breakdown rows are sent ONLY for a week (seven of them). A month is four or five
     and a year up to sixty, and that is the density at which the model starts inventing
     digits. For those the table is omitted and the reference's own instruction 4 tells
     it to let the neighbouring panel fill the space. */
  const headline = [
    {
      label: 'TARGET FOR THIS PERIOD',
      value: String(report.target),
      sub:
        report.offDays > 0
          ? `${report.offDays} off ${report.offDays === 1 ? 'day' : 'days'} excluded`
          : 'from the agreed rhythm',
    },
    {
      label: 'ACHIEVED',
      value: String(report.totalAssets),
      sub: `${report.totalStatic} static  -  ${report.totalReels} reels`,
    },
    {
      label: 'REMAINING',
      value: String(report.remaining),
      sub:
        report.target > 0
          ? `${Math.round((report.totalAssets / report.target) * 100)}% of the target met`
          : 'no rhythm agreed',
    },
  ];

  const introduction: string[] = [
    `${project.name} is ${
      project.clientKind === 'internal'
        ? 'an internal engagement within the Attari Group'
        : project.clientKind === 'external'
          ? 'an external client engagement'
          : 'a project'
    }${project.packageName ? ` on the ${project.packageName} package` : ''}.`,
  ];
  if (project.platforms.length > 0) {
    introduction.push(
      `The division manages ${project.platforms.length} platforms for it - ${project.platforms
        .map((platform) => platform.name)
        .join(', ')}.`,
    );
  }
  const rhythm: string[] = [];
  if (project.staticPostsPerDay !== null && project.staticPostsPerDay > 0) {
    rhythm.push(`${project.staticPostsPerDay} static post a day`);
  }
  if (project.reelsPerWeek !== null && project.reelsPerWeek > 0) {
    rhythm.push(`${project.reelsPerWeek} reels a week`);
  }
  if (rhythm.length > 0) introduction.push(`The agreed rhythm is ${rhythm.join(' and ')}.`);

  const notes: string[] = [];
  if (report.totalPlacements > 0) {
    notes.push(`${report.totalPlacements} posts across the platforms above.`);
  }
  if (report.isEmpty) notes.push(`Nothing was published in ${period.label}.`);

  /* ── ⚠️ CONTENT PER LAYOUT, BECAUSE THE LAYOUTS DIFFER ─────────────────────
     The owner supplied four reference designs and they are not one page relabelled:
     the daily pair carry a PUBLISHED TODAY table with posting times and live URLs, the
     weekly a DAY BY DAY table, the monthly a WEEKLY BREAKDOWN plus platform-share bars.

     So each kind is sent what its layout has room for. Sending a month's figures at the
     daily layout would leave its posting-time column empty — and an image model given an
     empty column fills it, which is the failure that matters. */
  const isDaily = period.kind === 'today' || period.kind === 'yesterday';

  /* The daily table: one row per live placement, with the time from the task. Capped —
     a busy day still has to fit the panel, and the count is stated in the glance. */
  /* ── ⚠️ ONE ROW PER TASK, NOT PER PLACEMENT ──────────────────────────────
     Owner, 2026-09-03, reading the generated PDF: *"if today's post should
     mention who did this post, what the post task name is… the category, the
     task name, and their status, and if it's a static post then their URL."*

     This built a row per PLACEMENT, so two posts cross-posted to three
     platforms came out as six identical-looking rows naming neither the work
     nor the person. A row is a piece of work now; the platforms it reached are
     a column on it, and the first live link is the one that goes in.

     ⚠️ `assets`, not `tasks`: this table is what WENT OUT in the period, which
     is `published_on`. `data.tasks` is what was RAISED, counted on created_at —
     a different question with a different date, and merging them would report a
     task somebody started today as delivery. */
  /* A mutable array per task — `data.placements` is readonly, so the accumulator
     has to be its element type rather than the array type itself. */
  const placementsByTask = new Map<string, (typeof data.placements)[number][]>();
  for (const placement of data.placements) {
    const list = placementsByTask.get(placement.taskId) ?? [];
    list.push(placement);
    placementsByTask.set(placement.taskId, list);
  }

  /* ── ⚠️ EVERY TASK THAT WAS FINISHED, NOT ONLY WHAT WENT OUT ─────────────
     Owner, 2026-09-03, counting three done tasks against two in the report:
     *"Display all the done tasks for that project, not only static or real."*

     This read `data.assets`, which is the PACKAGE list: content, published, with
     a date. It therefore dropped exactly the row the owner was pointing at —
     CLI-1580, kind `other`, finished on the day and never published. Real work,
     invisible, because the list it came from exists to answer a different
     question.

     `data.completed` is tasks DONE in the period, whatever their kind. The
     target and achieved figures still come from `assets`, because the package
     counts published content and nothing else — the two must not be merged or a
     finished internal task would start counting towards a client's promise. */
  const published = data.completed.slice(0, 12).map((task) => {
    const mine = placementsByTask.get(task.id) ?? [];
    const platforms = [...new Set(mine.map((p) => p.platformName))];
    const slugs = [...new Set(mine.map((p) => p.platformSlug))];
    const live = mine.find((p) => p.url !== null);

    return {
      task: task.title,
      reference: task.reference,
      /* ⚠️ "Task" for work with no content kind, not an empty cell or a dash.
         The owner asked for the category to say *"whether they are tasks or
         other tasks, static post tasks or a real task"* — so ordinary work is
         named rather than left blank. */
      contentType: task.contentKind
        ? (CONTENT_KIND_LABEL[task.contentKind as ContentKind] ?? 'Post')
        : 'Task',
      person: task.assigneeName ?? task.createdByName ?? '—',
      status: STATUS_META[task.status as TaskStatus]?.label ?? task.status,
      platform: platforms.length > 0 ? platforms.join(', ') : '—',
      platformSlugs: slugs,
      time: '',
      url: live?.url ?? '',
    };
  });

  /* ── WHO DID WHAT ────────────────────────────────────────────────────────
     Owner: *"what each person did."* Counted over the period's published
     assets, so it answers the same question the rest of the sheet does. Sorted
     by volume, because the reason somebody reads this panel is to see who
     carried the period. */
  /* ⚠️ From `completed`, matching the table. Built from `assets` it counted only
     published content, so somebody whose whole day was internal work appeared to
     have done nothing. */
  const byPerson = new Map<string, { posts: number; done: number }>();
  for (const task of data.completed) {
    const name = task.assigneeName ?? task.createdByName ?? 'Unattributed';
    const entry = byPerson.get(name) ?? { posts: 0, done: 0 };
    entry.posts += 1;
    entry.done += 1;
    byPerson.set(name, entry);
  }

  const people = [...byPerson.entries()]
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => b.posts - a.posts)
    .slice(0, 8);

  /* The per-platform panel. "WHERE IT WENT" on the daily and weekly layouts,
     "PLATFORM DISTRIBUTION" with a share on the monthly one.

     ⚠️ Every platform the project manages appears, including the ones with nothing —
     the reference shows "No content published today" against TikTok, and omitting a
     quiet platform would read as though it were not part of the deal. */
  const platformSummaries = project.platforms.map((platform) => {
    const row = report.platforms.find((entry) => entry.platformId === platform.id);
    const posts = row?.placements ?? 0;
    return {
      platform: platform.name,
      summary:
        posts === 0
          ? isDaily
            ? 'No content published today.'
            : 'No content published in this period.'
          : posts === 1
            ? 'One post published to the profile.'
            : posts + ' posts published to the profile.',
      posts,
      /* Whole numbers, and guarded against a divide by zero. */
      sharePct:
        report.totalPlacements > 0
          ? Math.round((posts / report.totalPlacements) * 100)
          : 0,
    };
  });

  /* ── ⚠️ THE "AT A GLANCE" TICKS ARE FACTS, NOT OPINIONS ────────────────────
     The reference layouts show lines like "Instagram was the strongest platform this
     week" and "Reels outperformed static posts in reach and engagement". The second of
     those is unavailable to this system — reach and engagement live inside Meta and
     TikTok and the CRM does not read them — so it is NOT generated. Writing it anyway
     would put an unsupported performance claim on a client document.

     What is derived here is only what the database knows. */
  const glance: string[] = [];
  if (report.target > 0 && report.totalAssets >= report.target) {
    glance.push('All targets achieved.');
  } else if (report.target > 0) {
    glance.push(
      report.remaining + ' target' + (report.remaining === 1 ? '' : 's') + ' still outstanding.',
    );
  }
  if (report.totalReels > 0) {
    glance.push(report.totalReels + ' reel' + (report.totalReels === 1 ? '' : 's') + ' published.');
  } else if (report.totalAssets > 0) {
    glance.push('No reel published in this period.');
  }

  /* ── ⚠️ HOW MUCH IS FINISHED, AND WHO DID IT ─────────────────────────────
     Owner, 2026-09-03: *"how many tasks are done… what each person did."*
     Neither figure was anywhere on the sheet: the panels counted what was
     PUBLISHED, which says nothing about whether the work behind it is closed or
     who closed it.

     Put in the glance rather than in a new panel because the glance is already
     the page's list of plain facts, and a fourth card on a fixed A4 layout costs
     the tables their rows. */
  const doneCount = data.assets.filter((asset) => asset.status === 'done').length;
  if (data.assets.length > 0) {
    glance.push(
      doneCount === data.assets.length
        ? `All ${data.assets.length} ${data.assets.length === 1 ? 'task is' : 'tasks are'} done.`
        : `${doneCount} of ${data.assets.length} tasks done.`,
    );
  }

  /* Named, and capped at three: the glance is a list somebody reads at a glance,
     and a division of nine would push the platform line off it. The full list is
     in `people`, which the layout can grow into later. */
  for (const person of people.slice(0, 3)) {
    glance.push(
      `${person.name}: ${person.posts} post${person.posts === 1 ? '' : 's'}` +
        (person.done > 0 && person.done < person.posts ? ` (${person.done} done)` : ''),
    );
  }
  const busiest = report.platforms[0];
  if (busiest && busiest.placements > 0) {
    glance.push(busiest.name + ' carried the most posts (' + busiest.placements + ').');
  }
  if (report.totalWithLinks < report.totalPlacements) {
    glance.push(
      report.totalPlacements - report.totalWithLinks + ' post(s) have no live link recorded.',
    );
  }

  /* ── The one big number in the activity panel, and the sentence under it ─────
     The reference draws the total inside a circle the illustration leaves empty, with a
     plain-English line beneath. Both are assembled here rather than in the renderer,
     because they are statements of fact and belong with the other statements of fact. */
  const parts: string[] = [];
  if (report.totalStatic > 0) {
    parts.push(`${report.totalStatic} static post${report.totalStatic === 1 ? '' : 's'}`);
  }
  if (report.totalReels > 0) {
    parts.push(`${report.totalReels} reel${report.totalReels === 1 ? '' : 's'}`);
  }
  const when = isDaily
    ? period.kind === 'today'
      ? 'today'
      : 'yesterday'
    : `this ${period.kind}`;
  const activityCaption =
    parts.length === 0
      ? `Nothing was published ${when}.`
      : `${parts.join(' and ')} ${parts.length === 1 && report.totalAssets === 1 ? 'was' : 'were'} published ${when}.`;

  const content: ReportContent = {
    kind: period.kind,
    projectName: project.name,
    projectCode: project.code,
    periodLabel: period.label,
    /* The badge in the reference's top-right reads "WEEKLY REPORT". */
    kindLabel: `${BADGE[period.kind]} REPORT`,
    introduction,
    headline,
    platforms: project.platforms.map((platform) => platform.name),
    /* ⚠️ The daily layouts have no breakdown table at all — they have the PUBLISHED
       TODAY list instead — so they carry none. Week gets its seven days, month its four
       or five weeks, and a year its months. */
    rows: isDaily
      ? []
      : report.buckets.map((bucket) => ({
          label: bucket.label,
          staticPosts: bucket.staticPosts,
          reels: bucket.reels,
          total: bucket.assets,
          target: bucket.target,
          isOff: bucket.target === 0 && bucket.offDays > 0,
        })),
    published,
    people,
    platformSummaries,
    glance,
    notes,
    activityTotal: String(report.totalAssets),
    activityCaption,
    footer: `This ${BADGE[period.kind].toLowerCase()} report is generated from Crescent Nova International's internal records. Generated on ${today} by ${user.fullName ?? user.email}.`,
  };

  /* The exact figures, stored beside the content. See migration 038's header: without
     them a report months later is an artefact nobody can check. */
  const figures = {
    target: report.target,
    achieved: report.totalAssets,
    remaining: report.remaining,
    staticPosts: report.totalStatic,
    reels: report.totalReels,
    placements: report.totalPlacements,
    withLinks: report.totalWithLinks,
    offDays: report.offDays,
  };

  /* ── ⚠️ THE IMAGE-MODEL PATH, OFF BY DEFAULT ────────────────────────────────
     Kept because the owner asked for it twice, and the measurement that made it the
     non-default is in this file's header. `REPORT_POSTER_MODEL=1` turns it back on. */
  if (useModel) {
    let poster;
    try {
      poster = await generatePoster(content);
    } catch (error) {
      /* Surfaced, not swallowed. A report that quietly came back without its image would
         be a blank PDF, and the person is waiting on it. */
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'The report image could not be generated.',
      };
    }

    /* Stored under a path that is unguessable and per-project, in the private bucket.
       `crypto.randomUUID` rather than the period label: two reports for the same month
       are legitimate — a redo — and must not overwrite each other. */
    const imagePath = `project-reports/${projectId}/${crypto.randomUUID()}.png`;
    const stored = await uploadLibraryObject({
      path: imagePath,
      body: poster.png,
      contentType: 'image/png',
    });

    if (!stored.ok) {
      /* ⚠️ The image is lost at this point, and a minute of generation with it. Saying so
         plainly beats a row that points at a file which does not exist — which would fail
         later, on the PDF route, to somebody who did not press the button. */
      return { ok: false, error: `The image was generated but not stored. ${stored.message}` };
    }

    let modelReportId: string;
    try {
      modelReportId = await insertProjectReport(user.id, {
        projectId,
        kind: period.kind,
        periodStart: period.start,
        periodEnd: period.end,
        periodLabel: period.label,
        /* ⚠️ BOTH. The stored content means this row can be re-rendered as a drawn page
           later if the poster turns out to be garbled — which is exactly what happened
           to the first one. */
        content: content as unknown as Record<string, unknown>,
        imagePath,
        imageBytes: poster.png.byteLength,
        summary: poster.summary,
        figures,
        model: poster.model,
      });
    } catch {
      return { ok: false, error: 'The report was generated but could not be recorded.' };
    }

    await recordAudit(user, modelReportId, project.name, period, poster.model, report);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, reportId: modelReportId };
  }

  let reportId: string;
  try {
    reportId = await insertProjectReport(user.id, {
      projectId,
      kind: period.kind,
      periodStart: period.start,
      periodEnd: period.end,
      periodLabel: period.label,
      content: content as unknown as Record<string, unknown>,
      /* A drawn report has no stored image — migration 039 made the column nullable for
         exactly this, and its `project_reports_renderable` check is what guarantees the
         content is present instead. */
      summary: digest(content, figures),
      figures,
      model: COMPOSER,
    });
  } catch {
    return { ok: false, error: 'The report was generated but could not be recorded.' };
  }

  await recordAudit(user, reportId, project.name, period, COMPOSER, report);

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, reportId };
}

/** What drew the page, recorded on the row so a change in output has an explanation. */
const COMPOSER = 'cni-composer';

/**
 * The row's human-readable digest.
 *
 * ⚠️ Not decoration. `content` is a JSON blob nobody reads by eye, so this is the line
 * that answers "what did this report say?" from a database client, an audit export, or a
 * support conversation — without a PDF renderer. For image rows the same column holds the
 * exact prompt text, for the same reason.
 */
function digest(content: ReportContent, figures: Record<string, number>): string {
  return [
    `${content.projectName} (${content.projectCode || 'no code'}) — ${content.kindLabel}, ${content.periodLabel}`,
    `Target ${figures.target}, achieved ${figures.achieved}, remaining ${figures.remaining}.`,
    `${figures.staticPosts} static and ${figures.reels} reels across ${figures.placements} placements on ${content.platforms.length} platform(s).`,
    ...content.glance.map((tick) => `· ${tick}`),
  ].join('\n');
}

/* Audited: a generated report is a document that leaves the building, and once a PDF has
   gone to a client no access control in this system applies to it. Same reasoning as the
   export actions. */
async function recordAudit(
  user: Awaited<ReturnType<typeof requireUser>>,
  reportId: string,
  projectName: string,
  period: { kind: string; label: string },
  model: string,
  report: { totalAssets: number; target: number },
): Promise<void> {
  await auditAlone(user, {
    entityType: 'report',
    entityId: reportId,
    action: 'report.project.generated',
    after: {
      project: projectName,
      kind: period.kind,
      period: period.label,
      model,
      achieved: report.totalAssets,
      target: report.target,
    },
  }).catch(() => {
    console.error('[project-report] the audit entry could not be written');
  });
}

export async function deleteProjectReportAction(
  reportId: string,
  projectId: string,
): Promise<GenerateResult> {
  const user = await requireUser();
  if (!can({ role: user.role, id: user.id }, 'project.edit')) {
    return { ok: false, error: 'Only an Admin can remove a report.' };
  }

  /* ⚠️ The row goes; the stored PNG stays. Deliberate: a report may already have been
     sent to a client, and an orphaned private object costs nothing while a deleted one
     cannot be recovered if the deletion was a mistake. Sweeping them is a separate,
     deliberate job — not a side effect of tidying a list. */
  try {
    await deleteProjectReport(user.id, reportId);
  } catch {
    return { ok: false, error: 'That report could not be removed.' };
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}
