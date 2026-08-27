'use client';

import * as React from 'react';
import { FileText, X } from 'lucide-react';

import { Field, Input } from '@/components/ui/input';
import { ACCEPT_ATTRIBUTE, MAX_ATTACHMENT_BYTES, formatBytes } from '@/lib/domain/attachments';

/* ============================================================================
 * ATTACHING EVIDENCE, AND SEEING WHAT YOU ATTACHED
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-27: *"at the time of adding some expense or some project
 * income, when I upload some image, that image should still be displayed as
 * what you have uploaded instead of just displaying the name."*
 *
 * ── ⚠️ WHY A FILENAME IS NOT ENOUGH, IN THIS PRODUCT SPECIFICALLY ──────────
 * The receipts filed here are overwhelmingly phone screenshots, and a phone
 * names them `IMG_20260827_114512.jpg` or `Screenshot_2026-08-27.png`. Two of
 * those are indistinguishable, so the one check that matters — "is this the
 * right slip?" — cannot be made from the name. The whole point of the receipt
 * rule was accuracy; a control that accepts a file sight-unseen undermines it.
 *
 * ── ⚠️ `URL.createObjectURL`, AND IT MUST BE REVOKED ───────────────────────
 * Each call pins the file's bytes in memory until the URL is released. Choosing
 * a different file five times in one form therefore holds five images — which
 * on a page where a 5MB attachment is legal is 25MB of leaked heap. The cleanup
 * below is not tidiness; it is the difference between a form and a slow leak.
 *
 * ⚠️ Revoked in an EFFECT's cleanup rather than in the change handler, because
 * the URL has to outlive the handler — it is what the <img> renders from.
 *
 * ── ⚠️ NO PREVIEW FOR A PDF, DELIBERATELY ──────────────────────────────────
 * An object URL for a PDF renders in an <iframe> at the cost of loading the
 * browser's whole viewer inside a form. The name, type and size answer "did I
 * pick the right one" for a document; only an image genuinely needs to be seen.
 * ========================================================================= */

export function ProofField({
  name,
  label,
  hint,
  required = false,
}: {
  /** The form field name — `receipt` for an expense, `proof` for a payment. */
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
}) {
  const [chosen, setChosen] = React.useState<File | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  /* ⚠️ Derived from the file with `useMemo`, not stored in state and set from
     the change handler. Two pieces of state for one fact is how a preview ends
     up showing the previous file — and the react-compiler lint objects to the
     effect-driven version for the same reason. */
  const preview = React.useMemo(
    () => (chosen && chosen.type.startsWith('image/') ? URL.createObjectURL(chosen) : null),
    [chosen],
  );

  React.useEffect(() => {
    if (preview === null) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const clear = () => {
    setChosen(null);
    /* ⚠️ The <input type="file"> keeps its own value, which React does not
       control. Without this the field still reads "IMG_1234.jpg" after the
       preview is gone, and the form would submit a file the person believes
       they removed. */
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <Field
      label={label}
      htmlFor={name}
      hint={hint ?? `The bill, slip or screenshot. Up to ${formatBytes(MAX_ATTACHMENT_BYTES)}.`}
    >
      <Input
        ref={inputRef}
        id={name}
        name={name}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        required={required}
        onChange={(event) => setChosen(event.target.files?.[0] ?? null)}
        className="cursor-pointer file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-bg-surface-sunken file:px-3 file:py-1.5 file:text-caption file:text-text-secondary"
      />

      {chosen && (
        <div className="mt-2 flex items-start gap-3 rounded-[var(--radius-md)] border border-border-subtle bg-bg-surface-sunken p-2">
          {preview ? (
            /* eslint-disable-next-line @next/next/no-img-element -- a blob: URL
               from the local file; the optimiser cannot fetch it and has no
               reason to. */
            <img
              src={preview}
              alt={`Preview of ${chosen.name}`}
              className="h-20 w-20 shrink-0 rounded-[var(--radius-sm)] border border-border-subtle object-cover"
            />
          ) : (
            <span className="grid h-20 w-20 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-border-subtle bg-bg-surface">
              <FileText className="h-6 w-6 text-text-tertiary" aria-hidden="true" />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-caption font-medium text-text-primary">{chosen.name}</p>
            <p className="mt-0.5 text-micro text-text-tertiary">
              {formatBytes(chosen.size)}
              {chosen.type ? ` · ${chosen.type}` : ''}
            </p>
            {/* ⚠️ Warns rather than blocks. The server checks the size again and
                is the authority; refusing here would only mean somebody has to
                guess why the button did nothing. */}
            {chosen.size > MAX_ATTACHMENT_BYTES && (
              <p className="mt-1 text-micro" style={{ color: 'var(--feedback-error)' }}>
                Too large — the limit is {formatBytes(MAX_ATTACHMENT_BYTES)}.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={clear}
            aria-label="Remove the attached file"
            className="shrink-0 rounded-full p-1 text-text-tertiary transition-colors hover:bg-bg-surface hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </Field>
  );
}
