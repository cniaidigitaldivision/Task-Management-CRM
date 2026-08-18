import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
