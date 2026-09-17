/* ============================================================================
 * DOCUMENT KINDS — pure
 * ----------------------------------------------------------------------------
 * ⚠️ HERE RATHER THAN IN `lib/db/queries/crm-documents.ts`, and a test caught it.
 * That module is `server-only`; the upload form is a client component, and a
 * `'use client'` file importing a VALUE from it drags server code into the
 * browser bundle. `design-tokens.test.ts` asserts exactly this and failed the
 * moment the shelf was written — which is why the labels live in `lib/domain/`
 * with every other pure vocabulary in this codebase.
 * ========================================================================= */

export const DOCUMENT_KINDS = [
  /* ⚠️ The blocking one. A quotation cannot be printed without it — readiness
     reports it on every project that has none. */
  'letterhead',
  'brochure',
  'site_plan',
  'price_list',
  /* ⚠️ UPLOADED, NEVER GENERATED. A plausible NOC with a filename is a forged
     government document whatever the intent — the owner's standing rule. */
  'legal',
  'quotation',
  'other',
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

const KIND_LABEL: Record<string, string> = {
  letterhead: 'Letterhead',
  brochure: 'Brochure',
  site_plan: 'Site plan',
  price_list: 'Price list',
  legal: 'Legal document',
  quotation: 'Quotation',
  other: 'Other',
};

/** ⚠️ An unrecognised kind shows itself rather than "Other" — a value added to
 *  the enum and forgotten here should look odd on screen, not vanish. Same rule
 *  as `stageLabel` and `appointmentStatusLabel`. */
export function documentKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}
