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
        className={`${inter.variable} ${playfair.variable} ${jetbrains.variable} flex min-h-full flex-col font-sans antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
