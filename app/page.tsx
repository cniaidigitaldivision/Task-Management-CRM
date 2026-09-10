import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import { redirect } from 'next/navigation';

import { Homepage } from '@/components/marketing/homepage';
import { getCurrentUser } from '@/lib/auth/current-user';
import { APP_NAME, DIVISION_NAME, ORGANISATION_NAME } from '@/lib/domain/constants';

/* ============================================================================
 * THE ROOT ROUTE — the homepage for a stranger, the dashboard for a colleague
 * ----------------------------------------------------------------------------
 * This used to redirect to /dashboard unconditionally, which was right while
 * the only people who could reach it were signed in. With a public homepage
 * living here, the redirect has to become conditional or nobody outside the
 * company can ever see the page.
 *
 * ── ⚠️ THIS IS NOT AN AUTHENTICATION BOUNDARY ──────────────────────────────
 * It decides which of two pages to render, nothing more. `getCurrentUser()`
 * returns null rather than throwing, and every protected route keeps its own
 * `requireUser()` — see the note in app/(public)/layout.tsx about why this
 * project has no middleware. Nothing here may grow into a guard.
 *
 * An anonymous visitor costs no database query at all: `getCurrentUser()` looks
 * for the session cookie first and returns null without a round-trip when there
 * is not one, which is every visitor this page is written for.
 * ========================================================================= */

/* ── ⚠️ CALLED HERE, NOT IN THE ROOT LAYOUT, AND THAT IS THE POINT ──────────
   next/font preloads on the routes where it is used: from a page, only that
   page's route; from the root layout, every route in the application. Archivo
   is the homepage's face and is used nowhere else, so declaring it in the
   layout would make every screen in the product preload a font it never
   renders. `wdth` is requested because the headlines are set at font-stretch
   108–112%; only `wght` ships by default, and without the width axis the
   browser synthesises it and the letterforms distort. */
const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
  axes: ['wdth'],
});

export const metadata: Metadata = {
  title: `${APP_NAME} — the whole agency, on one thread`,
  description:
    `${APP_NAME} follows a piece of work from the moment a stranger fills in a form to the ` +
    `month it is invoiced: leads, tasks, projects, credentials, documents, attendance and ` +
    `reporting in one system. Built and run by the ${DIVISION_NAME} of ${ORGANISATION_NAME}.`,
  /* ⚠️ Overrides the application-wide `index: false` in app/layout.tsx, and only
     here. That rule is right for an internal tool and wrong for the one page
     whose entire job is to be found — the same exception app/(public) makes for
     the published policies. Every screen behind the login stays unindexed. */
  robots: { index: true, follow: true },
};

/* ⚠️ ONE COLOUR, NOT THE APPLICATION'S PAIR. app/layout.tsx sets `themeColor`
   per colour-scheme because the product follows the reader's theme. This page
   does not — it is dark only — so a light entry would tell a phone to paint its
   browser chrome pale above a dark page. This overrides it for this route. */
export const viewport: Viewport = {
  themeColor: '#04161a',
};

export default async function RootPage() {
  const user = await getCurrentUser();

  /* Somebody with a live session has no use for the marketing page; send them
     where they were going. Members land on /dashboard too — ADR-003 routes them
     onward from there, and duplicating that decision here would give the
     product two places to disagree about where a role starts. */
  if (user) redirect('/dashboard');

  return <Homepage fontClassName={archivo.variable} />;
}
