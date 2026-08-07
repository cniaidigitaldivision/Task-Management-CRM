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

  {
    /* ------------------------------------------------------------------
     * THE STORAGE KEY LIVES IN ONE FILE
     *
     * `SUPABASE_STORAGE_KEY` is a privileged credential. It exists only
     * because a private bucket cannot be authorised the way everything
     * else in this system is: Supabase Storage is a separate HTTP
     * service and cannot see `app.user_id`, the transaction-local
     * setting our row-level security is built on.
     *
     * lib/storage/bucket.ts reads it, exports four narrow functions, and
     * never returns a client. That containment is the entire reason the
     * key is acceptable — so it is enforced here rather than left as a
     * comment somebody removes in eight months.
     *
     * If a second file ever legitimately needs storage access, it calls
     * lib/storage/bucket.ts. It does not read the key.
     *
     * scripts/check-storage.mjs is the one exemption, and it is a real one
     * rather than a convenience: it is a standalone diagnostic run by hand
     * from a terminal, it is never bundled and never served, and it
     * cannot import the TypeScript module because plain node does not
     * resolve the `@/` alias. It exists precisely so a failing key
     * produces a readable answer instead of a rejected upload in a
     * drawer, and it never prints the key.
     * ---------------------------------------------------------------- */
    files: ['**/*.{ts,tsx,mjs}'],
    ignores: [
      'lib/storage/**',
      'eslint.config.mjs',
      'scripts/check-db.mjs',
      'scripts/check-storage.mjs',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][property.name=/^SUPABASE_(STORAGE_KEY|SERVICE_ROLE_KEY|SECRET_KEY)$/]",
          message:
            'The storage credential is read in lib/storage/bucket.ts and nowhere else. Call that module instead — it already performs the request. See its header for why the containment matters.',
        },
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env'][computed=true][property.value=/^SUPABASE_(STORAGE_KEY|SERVICE_ROLE_KEY|SECRET_KEY)$/]",
          message:
            'The storage credential is read in lib/storage/bucket.ts and nowhere else, including through a computed lookup.',
        },
      ],
    },
  },
]);

export default eslintConfig;
