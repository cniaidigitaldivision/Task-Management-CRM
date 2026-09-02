import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Hosts permitted to load dev-server resources cross-origin.
   *
   * Development only — Next.js ignores this in production builds. It exists so
   * the app can be opened from another device on the LAN (a phone, for testing
   * the responsive layout) without the JS chunks being blocked, which silently
   * prevents hydration rather than failing loudly.
   *
   * Private ranges only. Never add a public host here.
   */
  allowedDevOrigins: ['192.168.100.131', '127.0.0.1', '192.168.*.*', '10.*.*.*'],

  // Route hrefs are type-checked against the actual route tree, so a typo in a
  // link becomes a compile error rather than a 404 someone finds later.
  typedRoutes: true,

  experimental: {
    /**
     * ── ⚠️ WHY LEAVING TAB, COMING BACK, AND WAITING AGAIN WAS THE DEFAULT ──
     * Owner, 2026-09-02: *"when I switch from tabs and switch back to the same
     * page, it instantly loads... The thing is definitely missing because each
     * page is taking the same time to load."*
     *
     * It was missing. This is Next's Client Cache, and since v15 the `dynamic`
     * stale time DEFAULTS TO 0 - meaning a page already visited is never
     * reusable, so every return to /tasks re-ran the server render, the queries
     * and the payload transfer from Singapore. Nothing about this application
     * asked for that; it is simply the framework default.
     *
     * Every link in the sidebar leaves `prefetch` unspecified, which per Next's
     * docs is exactly the case `dynamic` governs - so this one number decides
     * whether switching tabs is instant.
     *
     * ── ⚠️ WHY 60 SECONDS AND NOT MORE ────────────────────────────────────
     * A cache means somebody can read a figure that has since changed, and this
     * product has writers other than the reader: a colleague moving a task, and
     * the attendance terminal on the wall pushing a scan every few seconds. Those
     * cannot invalidate a browser's cache.
     *
     * What CAN is any write made through the application: every server action
     * here ends in `revalidatePath`, which drops this cache for those routes
     * immediately. So the owner's own mental model - *"cached unless there are
     * some new changes in the database"* - holds for their own edits, and 60
     * seconds bounds how stale somebody ELSE's change can look. Long enough that
     * a trip to Finance and back is free; short enough that nobody plans a day
     * around a minute-old attendance board.
     *
     * NOT `cacheComponents`/`cachedNavigations`, which is the newer Next 16 route
     * to the same feeling: it requires `use cache` and Suspense boundaries
     * through every page that reads the database, and the owner's constraint for
     * this change was *"please do not break anything."* This is three lines of
     * configuration and no change to a single query.
     */
    staleTimes: {
      dynamic: 60,
      static: 300,
    },

    /**
     * ⚠️ WITHOUT THIS, EVERY UPLOAD OVER 1 MB FAILS. Observed 2026-08-24:
     *
     *     ⨯ Error: Body exceeded 1 MB limit.
     *       statusCode: 413
     *     POST /projects/7ebdb4fc-… 500
     *
     * Next.js caps a Server Action's request body at 1 MB by default, and every
     * upload in this application goes through one — `requestDocumentAction` for
     * documents, `uploadAttachmentAction` for task files. So the limits stated
     * everywhere else were fiction above 1 MB: the bucket accepts 50 MB, the
     * upload form promises 50 MB, `MAX_BYTES_QUEUED` refuses politely at 50 MB,
     * and the framework rejected anything past 1 MB before a byte of that code
     * ran. A 500 with no message anybody could act on.
     *
     * ── WHY 52 AND NOT 50 ─────────────────────────────────────────────────────
     * The cap applies to the RAW request body, which for `multipart/form-data`
     * includes boundaries, part headers and the other form fields — so a file at
     * exactly the 50 MB bucket limit produces a body slightly over it. Next's own
     * documentation suggests 10–20 KB of headroom; 2 MB is more than enough and
     * keeps the number readable.
     *
     * ⚠️ THIS IS THE CEILING, NOT THE POLICY. It must stay ABOVE the bucket's
     * `file_size_limit` (50 MB on `CNI-Task Management Docs`), never at or below
     * it — otherwise the framework starts refusing files before our own check
     * does, and the person gets a 413 instead of a sentence explaining the limit.
     * The real limits live in `MAX_BYTES_QUEUED` (documents) and
     * `MAX_ATTACHMENT_BYTES` (attachments), which say why.
     */
    serverActions: {
      bodySizeLimit: '52mb',
    },
  },
};

export default nextConfig;
