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
