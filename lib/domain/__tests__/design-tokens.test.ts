import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TYPE_SCALE, cn } from '../../utils';

/* ============================================================================
 * EVERY `token="…"` MUST NAME A REAL CUSTOM PROPERTY
 * ----------------------------------------------------------------------------
 * `<Badge token="x">` renders `color: var(--x)`. If `--x` does not exist, CSS
 * does not complain — the declaration is simply invalid and dropped, and the
 * badge inherits whatever colour is around it. It looks *almost* right, which is
 * the worst outcome: nobody files a bug against a badge that is the wrong shade.
 *
 * ── WHY THIS TEST EXISTS ─────────────────────────────────────────────────────
 * `token="brand-primary"` was written on 2026-08-18. There is no
 * `--brand-primary`; the real one is `--accent-primary`. TypeScript cannot catch
 * it — the prop is a `string`, and it has to be, because the tokens live in CSS.
 * So the check belongs here, where the two files can actually be compared.
 *
 * Owner had reported, the same day, that *"some things are getting very out of
 * the style or rhythm of the page"*. A token that silently does nothing is one
 * way that happens.
 * ========================================================================= */

const ROOT = join(import.meta.dirname, '..', '..', '..');

function filesUnder(dir: string, ext: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full, ext));
    else if (ext.some((e) => entry.endsWith(e))) found.push(full);
  }
  return found;
}

/** Every `--custom-property:` declared anywhere in the stylesheets. */
function declaredTokens(): Set<string> {
  const css = [
    readFileSync(join(ROOT, 'styles', 'tokens.css'), 'utf8'),
    readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8'),
  ].join('\n');

  const names = new Set<string>();
  for (const match of css.matchAll(/^\s*--([a-zA-Z0-9-]+)\s*:/gm)) names.add(match[1]);
  return names;
}

/** Every `token="…"` literal written in a component. */
function usedTokens(): Array<{ token: string; file: string }> {
  const used: Array<{ token: string; file: string }> = [];
  for (const file of filesUnder(join(ROOT, 'components'), ['.tsx'])) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\btoken="([a-zA-Z0-9-]+)"/g)) {
      used.push({ token: match[1], file: file.slice(ROOT.length + 1) });
    }
  }
  return used;
}

describe('design tokens', () => {
  it('declares a healthy number of custom properties', () => {
    /* A sanity check on the parser itself. If the regex ever stops matching, the
       real test below would pass vacuously and prove nothing. */
    expect(declaredTokens().size).toBeGreaterThan(50);
  });

  it('finds token="…" usages to check', () => {
    expect(usedTokens().length).toBeGreaterThan(0);
  });

  it('has a declaration behind every token="…" in every component', () => {
    const declared = declaredTokens();
    const missing = usedTokens().filter((u) => !declared.has(u.token));

    /* Named in the failure, because "a token is missing" is not actionable and
       "brand-primary in documents-workspace.tsx" is. */
    expect(
      missing.map((m) => `${m.token}  (${m.file})`),
      'these token="…" values name no custom property in styles/tokens.css or app/globals.css',
    ).toEqual([]);
  });
});

/* ============================================================================
 * THE TYPE SCALE IS DEFINED ONCE
 * ----------------------------------------------------------------------------
 * The control scale in `components/ui/control.ts` maps each size to one of these
 * utilities. If a utility named there is not defined in the stylesheet, the
 * control silently renders at the inherited size — which is exactly the ragged
 * row the control scale was created to prevent (owner, Session 08).
 * ========================================================================= */

/* ============================================================================
 * ⚠️ cn() MUST NOT EAT FONT SIZES
 * ----------------------------------------------------------------------------
 * Plain `twMerge` deleted every one of our named font sizes whenever a colour
 * class sat beside it, because it filed the unrecognised name as a colour:
 *
 *     twMerge('text-caption text-text-primary')  →  'text-text-primary'
 *
 * The element then inherited its parent's size. `<Button size="sm">` composes
 * exactly that pair, so every button in the application rendered at the wrong
 * size — the owner reported it twice, across every page, before it was found.
 *
 * `lib/utils.ts` registers the scale with tailwind-merge. These tests fail if
 * that registration is ever removed, or if a size is added to globals.css and
 * not to `TYPE_SCALE`.
 * ========================================================================= */

describe('cn() and the named type scale', () => {
  it('keeps the font size when a text colour is also applied', () => {
    /* The exact bug. Every one of these pairs lost its size before the fix. */
    for (const size of TYPE_SCALE) {
      const out = cn(`text-${size}`, 'text-text-primary');
      expect(out, `text-${size} was dropped when combined with a colour`).toContain(
        `text-${size}`,
      );
      expect(out).toContain('text-text-primary');
    }
  });

  it('keeps the font size alongside a weight, a colour and a layout class', () => {
    const out = cn('inline-flex items-center font-semibold', 'text-caption', 'text-text-brand');
    expect(out).toContain('text-caption');
    expect(out).toContain('text-text-brand');
    expect(out).toContain('font-semibold');
  });

  it('still resolves a genuine size conflict, last one winning', () => {
    expect(cn('text-caption', 'text-body-sm')).toContain('text-body-sm');
    expect(cn('text-caption', 'text-body-sm')).not.toContain('text-caption');
  });

  it('treats our sizes and Tailwind sizes as the same group', () => {
    /* A caller overriding with a stock Tailwind size must win, not end up with
       both applied and the outcome decided by stylesheet order. */
    expect(cn('text-caption', 'text-xs')).not.toContain('text-caption');
    expect(cn('text-xs', 'text-caption')).not.toContain('text-xs');
  });

  it('still resolves a genuine colour conflict', () => {
    expect(cn('text-text-primary', 'text-text-brand')).toBe('text-text-brand');
  });

  it('has a TYPE_SCALE entry for every text utility in globals.css', () => {
    /* The two lists are duplicated by necessity — one is CSS, one is JS. This is
       what stops them drifting. */
    const css = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');
    const defined = [...css.matchAll(/@utility\s+text-([a-zA-Z0-9-]+)\s*\{/g)].map((m) => m[1]);

    expect(defined.length).toBeGreaterThan(0);
    expect(
      defined.filter((name) => !(TYPE_SCALE as readonly string[]).includes(name)),
      'these text-* utilities exist in globals.css but are not registered in TYPE_SCALE in lib/utils.ts, so cn() will silently delete them',
    ).toEqual([]);
  });
});

/* ============================================================================
 * THE COLOUR LANGUAGE IS THE SAME ON EVERY TABLE
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-18: *"this delete button icon should be in a red color… in all
 * of this whole project… Please make sure that everything should be in a proper
 * color."*
 *
 * The colours live in the `VARIANTS` map so they are defined once. This is what
 * stops the NEXT table being built with a plain grey bin icon, or with a
 * hand-written `className="text-red-500"` that drifts from the token.
 * ========================================================================= */

describe('destructive actions are red everywhere', () => {
  it('gives every Trash2 IconButton the deleteGhost variant', () => {
    const offenders: string[] = [];

    for (const file of filesUnder(join(ROOT, 'components'), ['.tsx'])) {
      /* The gallery deliberately shows several variants side by side; it is a
         demonstration of the scale, not a delete control. */
      if (file.endsWith('control-gallery.tsx')) continue;

      const source = readFileSync(file, 'utf8');
      /* Each <IconButton …/> element, so a variant on a DIFFERENT button in the
         same file cannot make a missing one look present. */
      for (const element of source.matchAll(/<IconButton\b[\s\S]*?\/>/g)) {
        const jsx = element[0];
        if (!/icon=\{Trash2\}/.test(jsx)) continue;
        if (!/variant="deleteGhost"/.test(jsx)) {
          offenders.push(file.slice(ROOT.length + 1));
        }
      }
    }

    expect(
      offenders,
      'these delete buttons are not red — use variant="deleteGhost" from components/ui/button.tsx',
    ).toEqual([]);
  });

  it('defines the three semantic variants against feedback tokens, not raw colours', () => {
    const button = readFileSync(join(ROOT, 'components', 'ui', 'button.tsx'), 'utf8');

    /** One variant's declaration, stopping at the next one — a fixed-length
     *  window overruns into the following entry and reads its token as this
     *  one's, which is exactly the false pass this test exists to avoid. */
    const declarationOf = (variant: string): string =>
      new RegExp(`\\n  ${variant}:[\\s\\S]*?,\\n(?=  [a-zA-Z]+:|\\})`).exec(button)?.[0] ?? '';

    for (const [variant, token] of [
      ['approveGhost', 'feedback-success'],
      ['refuseGhost', 'feedback-warning'],
      ['deleteGhost', 'feedback-error'],
    ] as const) {
      const declaration = declarationOf(variant);
      expect(declaration, `${variant} was not found in the VARIANTS map`).not.toBe('');
      expect(declaration, `${variant} should be built from var(--${token})`).toContain(
        `var(--${token})`,
      );
    }

    /* Refusing must NOT share delete's colour: a refusal is reversible and a
       deletion is not, and one colour for both erases the distinction. */
    expect(declarationOf('refuseGhost')).not.toContain('feedback-error');
  });
});

/* ============================================================================
 * ⚠️ THE BOARD MUST NOT ASSUME A 16px ROOT
 * ----------------------------------------------------------------------------
 * `task-board.tsx` walks down a column adding `height + gap` per card to decide
 * where a dragged card lands. That arithmetic had `CARD_GAP = 8` and
 * `LIST_PAD = 10` hardcoded to mirror `space-y-2` and `p-2.5` — rem classes, so
 * correct only at the browser's default root size.
 *
 * The owner's Chrome runs at 20px, where the real values are 10 and 12.5. The
 * error compounds down the column, the chosen index stops matching the screen,
 * and the insertion gap flips between neighbours — which is trap 3 in that
 * file's header, reintroduced as a unit mismatch. Reported as *"very jittery and
 * very buggy"* on 2026-08-18.
 *
 * There is no jsdom in this suite by design (see vitest.config.ts), so this
 * cannot test the measurement itself. It pins the thing that actually broke:
 * spacing must be READ from the element, never written as a pixel constant.
 * ========================================================================= */

describe('the task board measures its spacing instead of assuming it', () => {
  const board = () =>
    readFileSync(join(ROOT, 'components', 'task', 'task-board.tsx'), 'utf8');

  it('derives the gap from real card positions, not from computed style', () => {
    const source = board();
    expect(source).toContain('readSpacing');

    /* ⚠️ Positions, not styles. The first fix read
       `getComputedStyle(child).marginTop`, which Tailwind v4 sets to 0 —
       `space-y-*` puts the spacing on `margin-block-end` of every child but the
       last. That produced gap = 0, worse than the constant it replaced.
       Measuring the distance between two settled cards does not care how the
       spacing was produced. */
    const fn = /function readSpacing[\s\S]*?\n\}/.exec(source)?.[0] ?? '';
    expect(fn, 'readSpacing was not found').not.toBe('');
    expect(fn).toContain('getBoundingClientRect');
    expect(
      fn,
      'readSpacing must not read computed styles — Tailwind decides which margin side carries the gap, and that is not ours to assume',
    ).not.toContain('getComputedStyle');
  });

  it('declares no hardcoded pixel constant for card spacing', () => {
    const source = board();

    /* Only DECLARATIONS are rejected. The header comment names the old constants
       while explaining the bug, and that prose must stay readable. */
    const declarations = [
      ...source.matchAll(/^\s*const\s+([A-Z_]*(?:GAP|PAD|PADDING)[A-Z_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;/gm),
    ];

    expect(
      declarations.map((m) => `${m[1]} = ${m[2]}`),
      'spacing must be measured from the element (readSpacing), not hardcoded — a px constant mirroring a rem class is wrong at any root font size but 16px',
    ).toEqual([]);
  });

  it('still has a fallback, so a missing element cannot produce NaN geometry', () => {
    /* NaN would propagate through `top += height + gap` and make every
       comparison false, silently sending the card to the end of the column. */
    expect(board()).toContain('SPACING_FALLBACK');
  });
});

/* ============================================================================
 * ⚠️ NO CLIENT COMPONENT MAY IMPORT A VALUE FROM A `server-only` MODULE
 * ----------------------------------------------------------------------------
 * `lib/db/queries/*` begins with `import 'server-only'`, whose entry point throws
 * if it reaches a client bundle. A `import type` is erased and harmless; a VALUE
 * import is not, and it fails at PRODUCTION BUILD time with:
 *
 *     You're importing a module that depends on "server-only"
 *
 * — which means `npm run dev` and `tsc` both pass and the break appears only when
 * you build. It has now happened twice: `lib/domain/folder-access.ts` and
 * `lib/domain/library.ts` both exist because of it.
 *
 * This catches it in a second rather than in a build.
 * ========================================================================= */

describe('client components never import values from server-only modules', () => {
  /** Every `import … from '@/lib/db/queries/…'` inside a `use client` file. */
  const queryImports = () => {
    const found: { file: string; clause: string }[] = [];
    for (const file of filesUnder(join(ROOT, 'components'), ['.tsx'])) {
      const source = readFileSync(file, 'utf8');
      if (!/^\s*['"]use client['"]/m.test(source)) continue;
      for (const statement of source.match(/^import\b[\s\S]*?;/gm) ?? []) {
        if (!/from\s*['"]@\/lib\/db\/queries\//.test(statement)) continue;
        found.push({
          file: file.slice(ROOT.length + 1),
          clause: statement
            .replace(/^import\s+/, '')
            .replace(/\s+from\s*['"][^'"]+['"];$/, '')
            .trim(),
        });
      }
    }
    return found;
  };

  it('actually finds the imports it is meant to police', () => {
    /* ⚠️ Guards against a VACUOUS PASS. If the statement regex ever stops
       matching — a formatting change, a missing semicolon — the real test below
       would report zero offenders out of zero imports and look like success. */
    expect(queryImports().length).toBeGreaterThan(0);
  });

  it('has no value import from lib/db/queries in a "use client" file', () => {
    const offenders: string[] = [];

    for (const file of filesUnder(join(ROOT, 'components'), ['.tsx'])) {
      const source = readFileSync(file, 'utf8');
      /* Only files that actually run in the browser. */
      if (!/^\s*['"]use client['"]/m.test(source)) continue;

      /* ⚠️ ONE STATEMENT AT A TIME. The first attempt matched
         `import\s+([\s\S]*?)from ['"]@/lib/db/queries/…` and reported 22 files —
         every one a false positive, because the lazy `[\s\S]*?` happily spanned
         from an earlier `import * as React` all the way to the queries import
         several statements later. Statements are isolated first, then examined. */
      for (const statement of source.match(/^import\b[\s\S]*?;/gm) ?? []) {
        if (!/from\s*['"]@\/lib\/db\/queries\//.test(statement)) continue;

        const clause = statement
          .replace(/^import\s+/, '')
          .replace(/\s+from\s*['"][^'"]+['"];$/, '')
          .trim();

        /* `import type { … }` — erased at compile time, always safe. */
        if (/^type\b/.test(clause)) continue;

        /* `import { type A, type B }` — every named binding is a type, so the
           whole import is erased too. Anything without `type` is a value. */
        const inner = /\{([\s\S]*)\}/.exec(clause)?.[1];
        if (inner) {
          const names = inner
            .split(',')
            .map((n) => n.trim())
            .filter(Boolean);
          if (names.length > 0 && names.every((n) => /^type\b/.test(n))) continue;
        }

        offenders.push(`${file.slice(ROOT.length + 1)} — ${clause.replace(/\s+/g, ' ')}`);
      }
    }

    expect(
      offenders,
      'these client components import VALUES from a server-only query module, which breaks the production build. Move the value into lib/domain/ (see lib/domain/library.ts)',
    ).toEqual([]);
  });
});

describe('the typography utilities the control scale depends on', () => {
  it('are all defined in globals.css', () => {
    const css = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');
    const defined = new Set(
      [...css.matchAll(/@utility\s+(text-[a-zA-Z0-9-]+)\s*\{/g)].map((m) => m[1]),
    );

    const control = readFileSync(join(ROOT, 'components', 'ui', 'control.ts'), 'utf8');
    const referenced = [...control.matchAll(/'(text-[a-zA-Z0-9-]+)'/g)].map((m) => m[1]);

    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((t) => !defined.has(t))).toEqual([]);
  });
});
