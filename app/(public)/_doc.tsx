import * as React from 'react';

/* ============================================================================
 * SHARED CHROME FOR THE THREE POLICY DOCUMENTS
 * ----------------------------------------------------------------------------
 * Underscore-prefixed so the App Router treats it as a private folder file and
 * never as a route. Kept in one place so the three pages cannot drift into three
 * slightly different typographic treatments of the same kind of document.
 * ========================================================================= */

/** The date the three documents were last substantively changed. */
export const LAST_UPDATED = '3 September 2026';

/** Where a person writes about any of this. */
export const CONTACT_EMAIL = 'admin@aidigitaldivision.com';

export function DocTitle({
  title,
  summary,
}: {
  title: string;
  /** One sentence, plain, above the fold — what this document is for. */
  summary: string;
}) {
  return (
    <header className="mb-8 border-b border-border-subtle pb-6">
      <h1 className="text-h1 font-semibold leading-tight text-text-primary [text-wrap:balance]">
        {title}
      </h1>
      <p className="mt-3 text-body text-text-secondary">{summary}</p>
      <p className="mt-4 text-micro uppercase tracking-[0.08em] text-text-tertiary">
        Last updated {LAST_UPDATED}
      </p>
    </header>
  );
}

export function Section({
  n,
  title,
  children,
}: {
  /* Numbered because these are documents people cite at each other — "section 4
     of your privacy policy" has to land somewhere specific. */
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 first:mt-0">
      <h2
        id={`section-${n}`}
        className="scroll-mt-6 text-h3 font-semibold text-text-primary [text-wrap:balance]"
      >
        <span className="mr-2 tabular-nums text-text-tertiary">{n}.</span>
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-body-sm leading-relaxed text-text-secondary">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="space-y-2 pl-1">
      {React.Children.map(children, (child) => (
        <li className="flex gap-2.5 text-body-sm leading-relaxed text-text-secondary">
          <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-border-strong" />
          <span className="min-w-0">{child}</span>
        </li>
      ))}
    </ul>
  );
}

/** A short definition list — the clearest shape for "what we hold, and why". */
export function Rows({
  rows,
}: {
  rows: readonly { readonly term: string; readonly detail: React.ReactNode }[];
}) {
  return (
    <dl className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-default">
      {rows.map((row) => (
        <div key={row.term} className="grid gap-1 px-4 py-3 sm:grid-cols-[13rem_1fr] sm:gap-4">
          <dt className="text-body-sm font-semibold text-text-primary">{row.term}</dt>
          <dd className="text-body-sm leading-relaxed text-text-secondary">{row.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Something a reader must not miss — a deletion consequence, a hard limit. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-default bg-bg-surface-sunken px-4 py-3">
      <p className="text-body-sm leading-relaxed text-text-secondary">{children}</p>
    </div>
  );
}

export function Mail() {
  return (
    <a
      href={`mailto:${CONTACT_EMAIL}`}
      className="font-medium text-text-brand underline-offset-4 hover:underline"
    >
      {CONTACT_EMAIL}
    </a>
  );
}
