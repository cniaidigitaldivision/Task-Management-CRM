import { LogoMark } from '@/components/brand/logo';

/* ============================================================================
 * WHILE A REPORT IS BEING PUT TOGETHER
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-03: *"when the reports are generating, show a loader. You can
 * say the logo that will be flipping clockwise or anti-clockwise on the screen
 * so let them know that something is generating."*
 *
 * ── ⚠️ WHY A `loading.tsx` AND NOT A SPINNER IN THE MENU ────────────────────
 * The menu already spins its own button, and that only covers the moment before
 * the navigation starts. The wait the owner is describing is the one AFTER it:
 * the report page reads every asset, placement and task in the period and builds
 * the buckets, and a year report is the slowest page in the product.
 *
 * Next renders this the instant the navigation begins and swaps the real page in
 * when the server is done — no state, no effect, and nothing to get wrong. A
 * spinner driven from the menu could not do this at all: that component has
 * already unmounted by the time the new page is rendering.
 *
 * ── IT SAYS WHAT IS HAPPENING, NOT JUST THAT SOMETHING IS ───────────────────
 * "Putting the report together" rather than "Loading…". The reader asked for a
 * specific document a moment ago and the wording should agree with what they
 * pressed, so a slow one reads as work rather than as a page that has hung.
 * ========================================================================= */

export default function ProjectReportLoading() {
  return (
    <div
      className="mx-auto flex min-h-[60vh] max-w-[var(--content-max)] flex-col items-center justify-center gap-4"
      /* Announced politely: somebody using a screen reader is told the report is
         being prepared rather than meeting silence until it arrives. */
      role="status"
      aria-live="polite"
    >
      <div className="logo-flip-stage">
        <LogoMark width={56} className="logo-flip" />
      </div>

      <div className="space-y-1 text-center">
        <p className="text-body-sm font-semibold text-text-primary">
          Putting the report together
        </p>
        <p className="text-caption text-text-secondary">
          Reading everything this project published and worked on in the period.
        </p>
      </div>
    </div>
  );
}
