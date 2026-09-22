import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

import { ThemeProvider } from '@/components/brand/theme-provider';
import { APP_NAME, DIVISION_NAME, ORGANISATION_NAME } from '@/lib/domain/constants';
import { BROWSER_THEME_COLOR, THEME_PRE_PAINT_SCRIPT } from '@/lib/theme';

import './globals.css';

/* ⚠️ SELF-HOSTED, NOT FETCHED. Owner, 2026-09-22, of the Clients page: *"some
   bold boards have some blurred text … like it is blasting."* The dev server's
   log said why: "Failed to download Inter from Google Fonts. Using a fallback
   font instead." Every screen on the machine the owner reviews on was drawn in
   the size-adjusted Arial fallback, while production (which fetches at build
   time) had Inter. The same official files now live in app/fonts, so the page
   the owner reviews and the page that ships are the same page.

   Interface type — excellent at small sizes, wide weight range. */
const inter = localFont({
  src: './fonts/inter-latin.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
});

/* Display type — echoes the serif wordmark. Page titles and auth screens only. */
const playfair = localFont({
  src: './fonts/playfair-display-latin.woff2',
  weight: '500 700',
  variable: '--font-playfair',
  display: 'swap',
});

/* Task references should read as identifiers, not prose. */
const jetbrains = localFont({
  src: './fonts/jetbrains-mono-latin.woff2',
  weight: '400 500',
  variable: '--font-jetbrains',
  display: 'swap',
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
        /* ── ⚠️ `dvh` MULTIPLIED BY THE SCALE, AND EVERY WORD OF THAT MATTERS ──
           Owner, 2026-09-04: *"the page is scrolling down and nothing is here."*
           ~110px of dead page under any screen short enough to fit the window.

           `body` carries `zoom: 0.9` (the density scale — `--ui-scale` in
           styles/tokens.css). ANY length declared on a zoomed element is
           interpreted in PRE-ZOOM units, `dvh` included. So `min-h-dvh` computes
           to 1014px on a 1014px window and then lays that out as 1014 ÷ 0.9 =
           1127 real pixels. Multiplying by the scale first cancels it: 913
           declared, 1014 laid out, exactly the window.

           ── ⚠️ AND MY FIRST TWO ATTEMPTS BOTH "VERIFIED" CLEAN ──────────────
           I measured with `getBoundingClientRect()`, which reports PAINTED
           pixels — already divided by the zoom — so a box laid out 11% too tall
           came back as exactly 1014 and the bug was invisible to the test. The
           owner's DevTools reading of 1350 was right and mine was not.

           `offsetHeight` is the measurement that tells the truth here: it is in
           layout units, so on a correct page it reads ~913 against a 1014
           window, and on a broken one it read 1127. Anyone re-testing this must
           use offsetHeight, or they will confirm a fix that is not there. */
        className={`${inter.variable} ${playfair.variable} ${jetbrains.variable} flex min-h-[calc(100dvh*var(--ui-scale))] flex-col font-sans antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
