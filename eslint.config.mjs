import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/* ============================================================================
 * CNI CRM — LINT CONFIGURATION
 * ----------------------------------------------------------------------------
 * Beyond the Next.js defaults, this enforces two architectural rules that are
 * easy to violate accidentally and expensive to unwind later.
 * ========================================================================= */

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'node_modules/**']),

  {
    /* ------------------------------------------------------------------
     * BR-025 · BR-026 — components reference semantic tokens, never raw
     * colour values.
     *
     * A component hard-coding #0E5C63 looks correct in light theme and
     * breaks in dark. This is the single most common source of dark-mode
     * bugs, and it is caught here rather than by someone noticing
     * unreadable text in production.
     * ---------------------------------------------------------------- */
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message:
            'Raw hex colours are not permitted in components (BR-025). Use a semantic token from styles/tokens.css — e.g. text-text-primary, bg-bg-surface, or var(--accent-primary). New colours are added to docs/18 first.',
        },
        {
          selector:
            "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\b/]",
          message:
            'Raw hex colours are not permitted in components (BR-025). Use a semantic token from styles/tokens.css.',
        },
        {
          selector:
            "Literal[value=/\\b(?:rgb|rgba|hsl|hsla)\\s*\\(/]",
          message:
            'Raw colour functions are not permitted in components (BR-025). Use a semantic token from styles/tokens.css.',
        },
      ],
    },
  },

  {
    /* ------------------------------------------------------------------
     * LAYER 2 PURITY — docs/20-IMPLEMENTATION-CONTRACTS.md §1
     *
     * lib/domain/ holds the workload and assignment engines. Keeping it
     * free of database, framework and React imports is what makes those
     * engines exhaustively unit-testable and immune to a UI or schema
     * change breaking them. Dependencies point downward, never up.
     * ---------------------------------------------------------------- */
    files: ['lib/domain/**/*.ts'],
    ignores: ['lib/domain/**/__tests__/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'next',
                'next/*',
                'react',
                'react-dom',
                '@/lib/db',
                '@/lib/db/*',
                '@/components',
                '@/components/*',
                '@/app',
                '@/app/*',
                '@supabase/*',
                'drizzle-orm',
                'drizzle-orm/*',
              ],
              message:
                'lib/domain/ must stay pure — no database, framework or React imports (docs/20 §1). Pass data in as arguments and return a value; the caller does the I/O.',
            },
          ],
        },
      ],
      /* Determinism: `now` is always a parameter, never read from the clock.
         This is what allows the timer engine's working-hours arithmetic to be
         tested across midnights, Sundays and leave without waiting for time
         to pass. docs/20 §5. */
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message:
            'lib/domain/ must be deterministic. Accept `now` as a parameter instead of reading the clock (docs/20 §5).',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'lib/domain/ must be deterministic. Pass randomness in as a parameter.',
        },
      ],
    },
  },
]);

export default eslintConfig;
