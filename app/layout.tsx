import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Playfair_Display } from 'next/font/google';

import { ThemeProvider } from '@/components/brand/theme-provider';
import { APP_NAME, DIVISION_NAME, ORGANISATION_NAME } from '@/lib/domain/constants';
import { BROWSER_THEME_COLOR, THEME_PRE_PAINT_SCRIPT } from '@/lib/theme';

import './globals.css';

/* Interface type — excellent at small sizes, wide weight range. */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

/* Display type — echoes the serif wordmark. Page titles and auth screens only. */
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
  weight: ['500', '600', '700'],
});

/* Task references should read as identifiers, not prose. */
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s · ${APP_NAME}`,
  },
  description: `Task management CRM for ${ORGANISATION_NAME} — ${DIVISION_NAME}.`,
  applicationName: APP_NAME,
  icons: {
    icon: [{ url: '/brand/favicon.svg', type: 'image/svg+xml' }],
  },
  // Internal tool — never index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Mirrors --bg-base per theme so mobile browser chrome blends into the page.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: BROWSER_THEME_COLOR.light },
    { media: '(prefers-color-scheme: dark)', color: BROWSER_THEME_COLOR.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // suppressHydrationWarning: the pre-paint script sets data-theme before
    // React hydrates, so server and client markup differ by design.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* FR-204 — resolve and apply the theme before first paint. Must stay
            synchronous and inline; deferring it reintroduces the flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT_SCRIPT }} />
      </head>
      <body
        /* ── ⚠️ `min-h-full` IS WRONG ON THE ELEMENT THAT CARRIES THE ZOOM ────
           Owner, 2026-09-04: *"after the cards end, the page height is too
           much… the page is scrolling down and nothing is here."*

           `body` has `zoom: 0.9` (the density scale — `--ui-scale` in
           styles/tokens.css). A percentage min-height resolves against the
           PRE-ZOOM box, so `min-h-full` on a 1040px window computes to
           1155.56px — measured, not inferred. The page is therefore forced 11%
           taller than the viewport on every screen, and a page short enough to
           fit shows the remainder as dead space that scrolls to reach nothing.

           ⚠️ I FIXED THE WRONG ELEMENTS FIRST. The previous attempt corrected
           the two `min-h-full`s inside `app-shell.tsx`, which are real but
           DOWNSTREAM — the floor was already set here, above them, so the gap
           survived. Measuring the live DOM found it; reasoning about the shell
           did not.

           `min-h-dvh` is the fix rather than a scaled calc: a viewport unit is
           resolved by the browser against the real window and is not subject to
           the parent's percentage basis. The (auth) and (public) layouts already
           divide `100dvh` by the scale for the same reason, one level down. */
        className={`${inter.variable} ${playfair.variable} ${jetbrains.variable} flex min-h-dvh flex-col font-sans antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
