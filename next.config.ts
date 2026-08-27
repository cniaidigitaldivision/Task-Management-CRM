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
