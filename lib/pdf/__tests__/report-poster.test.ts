import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { composeReportPdf } from '../report-poster';
import type { ReportContent } from '@/lib/domain/report-content';
import type { ReportKind } from '@/lib/domain/report-periods';

/* ============================================================================
 * THE COMPOSED REPORT PAGE
 * ----------------------------------------------------------------------------
 * ⚠️ What can and cannot be asserted here, stated plainly: this renders a picture, and
 * a test cannot see whether a card is in the right place. What it CAN prove is that
 * every layout renders at all, on the inputs that would otherwise throw — and those are
 * the failures that would reach a client, because they turn a report into a 500.
 *
 * The cases below are the ones that actually broke something during the build:
 *
 *   · a name with a curly quote or an em dash — `drawText` THROWS on any character
 *     outside WinAnsi, so one apostrophe from a client's real name would lose the
 *     whole PDF. `safe()` exists for this and this test is what holds it in place.
 *   · twelve breakdown rows (a year) against seven (a week) — the table computes its
 *     own row height, and a wrong sign there overflows the card off the page.
 *   · no platforms, no rows, no ticks — every panel has to survive an empty period,
 *     which is exactly the report somebody runs on their first day.
 *
 * ── LOOKING AT IT ────────────────────────────────────────────────────────────
 * `REPORT_POSTER_DUMP=1 npx vitest run lib/pdf` writes each layout to
 * `.report-preview/` so it can be opened. That is not a nicety — a renderer nobody
 * looks at drifts, and there is no assertion that substitutes for opening the file.
 * ========================================================================= */

const DUMP = process.env.REPORT_POSTER_DUMP === '1';
const DUMP_DIR = path.join(process.cwd(), '.report-preview');

async function dump(name: string, bytes: Uint8Array): Promise<void> {
  if (!DUMP) return;
  await mkdir(DUMP_DIR, { recursive: true });
  await writeFile(path.join(DUMP_DIR, `${name}.pdf`), bytes);
}

const META = { generatedOn: '2026-08-20', generatedBy: 'Habiba Minhas' };

function content(overrides: Partial<ReportContent> = {}): ReportContent {
  return {
    kind: 'week',
    projectName: 'Daniyal Marketing',
    projectCode: 'CLI',
    periodLabel: '17 Aug – 23 Aug 2026',
    kindLabel: 'WEEKLY REPORT',
    introduction: [
      'Daniyal Marketing is an internal engagement within the Attari Group on the STARTER package.',
      'The division manages 3 platforms for it - Facebook, Instagram, TikTok.',
      'The agreed rhythm is 1 static post a day and 2 reels a week.',
    ],
    headline: [
      { label: 'TARGET FOR THIS WEEK', value: '7', sub: '7 off days excluded' },
      { label: 'ACHIEVED', value: '5', sub: '3 static  -  2 reels' },
      { label: 'REMAINING', value: '2', sub: '71% of the target met' },
    ],
    platforms: ['Facebook', 'Instagram', 'TikTok'],
    rows: [
      { label: 'Monday 17 Aug', staticPosts: 1, reels: 0, total: 1, target: 1, isOff: false },
      { label: 'Tuesday 18 Aug', staticPosts: 0, reels: 1, total: 1, target: 1, isOff: false },
      { label: 'Wednesday 19 Aug', staticPosts: 1, reels: 1, total: 2, target: 1, isOff: false },
      { label: 'Thursday 20 Aug', staticPosts: 0, reels: 0, total: 0, target: 1, isOff: false },
      { label: 'Friday 21 Aug', staticPosts: 1, reels: 0, total: 1, target: 1, isOff: false },
      { label: 'Saturday 22 Aug', staticPosts: 0, reels: 0, total: 0, target: 1, isOff: false },
      { label: 'Sunday 23 Aug', staticPosts: 0, reels: 0, total: 0, target: 0, isOff: true },
    ],
    published: [],
    platformSummaries: [
      { platform: 'Facebook', summary: '2 posts published to the profile.', posts: 2, sharePct: 40 },
      { platform: 'Instagram', summary: '3 posts published to the profile.', posts: 3, sharePct: 60 },
      { platform: 'TikTok', summary: 'No content published in this period.', posts: 0, sharePct: 0 },
    ],
    glance: [
      '2 targets still outstanding.',
      '2 reels published.',
      'Instagram carried the most posts (3).',
      '1 post(s) have no live link recorded.',
    ],
    notes: [],
    activityTotal: '5',
    activityCaption: '3 static posts and 2 reels were published this week.',
    footer:
      "This weekly report is generated from Crescent Nova International's internal records.",
    ...overrides,
  };
}

/** A PDF, checked by its header rather than by its length alone. */
function isPdf(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
}

describe('composeReportPdf', () => {
  it('renders the weekly layout', async () => {
    const pdf = await composeReportPdf(content(), META);
    await dump('week', pdf);

    expect(isPdf(pdf)).toBe(true);
    /* Well above an empty page: the background, logo and activity illustration are all
       embedded, so a PDF this small would mean the assets silently failed to load. */
    expect(pdf.byteLength).toBeGreaterThan(200_000);
  });

  it('renders the daily layout, with its posted rows and links', async () => {
    const pdf = await composeReportPdf(
      content({
        kind: 'today',
        kindLabel: 'DAILY REPORT',
        periodLabel: '23 Aug 2026',
        rows: [],
        headline: [
          { label: 'TARGET FOR TODAY', value: '2', sub: '1 static  -  1 reel' },
          { label: 'ACHIEVED TODAY', value: '2', sub: '1 static  -  1 reel' },
          { label: 'REMAINING TODAY', value: '0', sub: 'All targets achieved' },
        ],
        published: [
          {
            platform: 'Facebook',
            contentType: 'Static Post',
            time: '10:00',
            url: 'https://facebook.com/daniyalmarketing/posts/12345',
          },
          {
            platform: 'Instagram',
            contentType: 'Reel',
            time: '15:30',
            url: 'https://instagram.com/reel/Cuabc12345',
          },
        ],
        activityTotal: '2',
        activityCaption: '1 static post and 1 reel published today.',
      }),
      META,
    );
    await dump('today', pdf);
    expect(isPdf(pdf)).toBe(true);
  });

  it('renders a year, whose twelve rows must fit the same card as a week’s seven', async () => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const pdf = await composeReportPdf(
      content({
        kind: 'year',
        kindLabel: 'ANNUAL REPORT',
        periodLabel: 'Sep 2025 – Aug 2026',
        rows: months.map((month, index) => ({
          label: `${month} 2026`,
          staticPosts: 20 + index,
          reels: 8,
          total: 28 + index,
          target: 30,
          isOff: false,
        })),
        activityTotal: '402',
        activityCaption: '336 static posts and 96 reels were published this year.',
      }),
      META,
    );
    await dump('year', pdf);
    expect(isPdf(pdf)).toBe(true);
  });

  it('renders a month', async () => {
    const pdf = await composeReportPdf(
      content({
        kind: 'month',
        kindLabel: 'MONTHLY REPORT',
        periodLabel: 'August 2026',
        rows: [
          { label: '1 – 7 Aug', staticPosts: 6, reels: 2, total: 8, target: 9, isOff: false },
          { label: '8 – 14 Aug', staticPosts: 7, reels: 2, total: 9, target: 9, isOff: false },
          { label: '15 – 21 Aug', staticPosts: 5, reels: 1, total: 6, target: 9, isOff: false },
          { label: '22 – 28 Aug', staticPosts: 7, reels: 2, total: 9, target: 9, isOff: false },
          { label: '29 – 31 Aug', staticPosts: 3, reels: 1, total: 4, target: 4, isOff: false },
        ],
        activityTotal: '36',
        activityCaption: '28 static posts and 8 reels were published this month.',
      }),
      META,
    );
    await dump('month', pdf);
    expect(isPdf(pdf)).toBe(true);
  });

  /* ⚠️ The case that would otherwise 500. `drawText` throws on any character outside
     WinAnsi, and a real client name carrying a curly apostrophe or an em dash is not
     unusual — "Naya Marketing – Attari's" would have lost the entire document. */
  it('survives characters Helvetica cannot encode', async () => {
    const pdf = await composeReportPdf(
      content({
        projectName: 'Ｄaniyal — Attari’s “Naya” 🎯 Marketing',
        periodLabel: '17 Aug – 23 Aug 2026',
        introduction: ['Contains ✓ ticks, → arrows, 中文 and an emoji 🚀 that WinAnsi has no glyph for.'],
        platformSummaries: [
          { platform: 'Instagram', summary: 'Reels → profile ✓', posts: 3, sharePct: 100 },
        ],
        glance: ['Targets ✓ met — 100 %'],
        activityCaption: 'Everything ✓ published — on time.',
      }),
      META,
    );
    await dump('unicode', pdf);
    expect(isPdf(pdf)).toBe(true);
  });

  /* The first report anybody runs on a new project: nothing has happened yet. Every
     panel has to render an honest empty state rather than a hole. */
  it('renders an empty period', async () => {
    const pdf = await composeReportPdf(
      content({
        kind: 'today',
        kindLabel: 'DAILY REPORT',
        periodLabel: '20 Aug 2026',
        introduction: [],
        platforms: [],
        rows: [],
        published: [],
        platformSummaries: [],
        glance: [],
        headline: [
          { label: 'TARGET FOR TODAY', value: '0', sub: 'no rhythm agreed' },
          { label: 'ACHIEVED TODAY', value: '0', sub: '0 static  -  0 reels' },
          { label: 'REMAINING TODAY', value: '0', sub: 'no rhythm agreed' },
        ],
        activityTotal: '0',
        activityCaption: 'Nothing was published today.',
        projectCode: '',
      }),
      META,
    );
    await dump('empty', pdf);
    expect(isPdf(pdf)).toBe(true);
  });

  /* A project on nine platforms, with a name long enough to force the title to shrink.
     Both are real: the platform row caps at five and the title scales to fit. */
  it('renders a crowded project without overflowing', async () => {
    const pdf = await composeReportPdf(
      content({
        projectName: 'Crescent Nova International Digital Retainer Programme',
        platforms: [
          'Facebook', 'Instagram', 'TikTok', 'YouTube', 'WhatsApp',
          'LinkedIn', 'X (Twitter)', 'Threads', 'Pinterest',
        ],
        platformSummaries: [
          { platform: 'Facebook', summary: '9 posts published to the profile.', posts: 9, sharePct: 22 },
          { platform: 'Instagram', summary: '12 posts published to the profile.', posts: 12, sharePct: 30 },
          { platform: 'TikTok', summary: '6 posts published to the profile.', posts: 6, sharePct: 15 },
          { platform: 'YouTube', summary: '4 posts published to the profile.', posts: 4, sharePct: 10 },
          { platform: 'LinkedIn', summary: '5 posts published to the profile.', posts: 5, sharePct: 12 },
          { platform: 'X (Twitter)', summary: '4 posts published to the profile.', posts: 4, sharePct: 10 },
          { platform: 'Threads', summary: 'No content published in this period.', posts: 0, sharePct: 0 },
        ],
        glance: [
          'All targets achieved.',
          '18 reels published.',
          'Instagram carried the most posts (12).',
          'Every published post has a live link recorded, which makes the placement column verifiable end to end.',
          'A fifth tick that should be dropped rather than overflow the card.',
        ],
      }),
      META,
    );
    await dump('crowded', pdf);
    expect(isPdf(pdf)).toBe(true);
  });

  /* Determinism is the point of storing the content and rebuilding the PDF: the same
     report viewed twice must be the same file, or "which one did I send?" has no
     answer. ⚠️ This is why `composeReportPdf` sets no creation date. */
  it('is byte-for-byte deterministic', async () => {
    const once = Buffer.from(await composeReportPdf(content(), META));
    const twice = Buffer.from(await composeReportPdf(content(), META));
    if (!twice.equals(once)) {
      let at = 0;
      while (at < once.length && once[at] === twice[at]) at++;
      console.log(
        `differs at ${at} of ${once.length}\n  A: ${JSON.stringify(once.subarray(Math.max(0, at - 60), at + 60).toString('latin1'))}\n  B: ${JSON.stringify(twice.subarray(Math.max(0, at - 60), at + 60).toString('latin1'))}`,
      );
    }
    expect(twice.equals(once)).toBe(true);
  });

  it('renders every kind', async () => {
    const kinds: ReportKind[] = ['today', 'yesterday', 'week', 'month', 'year'];
    for (const kind of kinds) {
      const pdf = await composeReportPdf(content({ kind }), META);
      expect(isPdf(pdf), kind).toBe(true);
    }
  });
});
