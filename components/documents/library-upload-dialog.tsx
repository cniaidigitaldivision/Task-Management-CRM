'use client';

import * as React from 'react';
import { AlertTriangle, Eye, EyeOff, Loader2, Users } from 'lucide-react';

import { uploadLibraryDocumentAction, type LibraryResult } from '@/app/actions/library';
import {
  LIBRARY_ACCEPT,
  LIBRARY_CATEGORIES,
  LIBRARY_CATEGORY_LABEL,
  LIBRARY_MAX_LABEL,
  isLibraryViewable,
  suggestLibraryCategory,
  validateLibraryUpload,
  type LibraryCategory,
} from '@/lib/domain/library';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import { FileTypeIcon } from './file-type-icon';
import { formatFileSize } from './file-viewer';

/* ============================================================================
 * ADD TO THE COMPANY LIBRARY — owner request 2026-08-29
 * ----------------------------------------------------------------------------
 * *"Add a proper form modal or popup which will let me upload only to this
 * company library… just a modal which will pop up to let me add any documentation
 * in this company library."*
 *
 * ── ⚠️ WHY THIS IS NOT `UploadDialog` WITH ONE MORE OPTION ───────────────────
 * That dialogue's first question is *where it goes* — Google Drive or this
 * system's storage — and every field under it changes with the answer: the size
 * limit, whether a folder is required, whether there is an approval step. The
 * library is none of those. There is no destination to choose (one bucket), no
 * approval to explain (there is none), no project to file against (company
 * collateral belongs to no client), and no folder (the CATEGORY is the grouping,
 * which is the whole argument in migration 035's header).
 *
 * Adding a third destination to that form would mean five fields that mean
 * nothing on this route and a footnote that has already been wrong twice. So the
 * two forms are separate and share what they actually share: the pure rules in
 * `lib/domain/library.ts`, which the server action runs again.
 *
 * ── ⚠️ THE FORM ASKS FOR EXACTLY WHAT THE ROW RENDERS, AND NOTHING ELSE ──────
 * Every field here is a column the library panel puts on screen: the title is the
 * link, the category is the badge and the chip that filters it, the summary is
 * the second line and the thing search reads, the page count is the right-hand
 * column. `is_viewable` is deliberately NOT a field — it is a fact about the file
 * and is derived (see `isLibraryViewable`), because a checkbox for it is a way to
 * promise a viewer that does not exist.
 *
 * ── ⚠️ IT VALIDATES ON PICK, NOT ON SUBMIT ──────────────────────────────────
 * A 40 MB upload that is refused on arrival wastes a minute of somebody's time
 * and their bandwidth to tell them something knowable the moment they chose the
 * file. So the check runs in `onChange`, the button disables, and the reason sits
 * under the field. The server runs the same function — this is a courtesy, not a
 * gate.
 * ========================================================================= */

const EMPTY: LibraryResult = { ok: false };

export function LibraryUploadDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (result: LibraryResult) => void;
}) {
  const [state, formAction, pending] = React.useActionState(uploadLibraryDocumentAction, EMPTY);
  const seen = React.useRef(false);

  const [file, setFile] = React.useState<File | null>(null);
  const [category, setCategory] = React.useState<LibraryCategory>('other');
  /* Whether the person has touched the category themselves. Once they have, the
     suggestion below stops overriding them — picking a second file must not
     silently undo a choice they made about the first. */
  const [categoryTouched, setCategoryTouched] = React.useState(false);
  const [title, setTitle] = React.useState('');

  /* The local refusal, from the same pure function the server uses. Null when
     there is no file yet or the file is fine. */
  const problem = React.useMemo(() => {
    if (!file) return null;
    const check = validateLibraryUpload({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    return check.ok ? null : check.message;
  }, [file]);

  React.useEffect(() => {
    if (state.ok && !seen.current) {
      seen.current = true;
      onDone(state);
    }
  }, [state, onDone]);

  function onPick(chosen: File | null) {
    setFile(chosen);
    if (!chosen) return;
    /* A `.ai` is a design source by definition — see `suggestLibraryCategory`.
       Only ever a pre-selection, and only until the person picks for themselves. */
    if (!categoryTouched) setCategory(suggestLibraryCategory(chosen.name));
  }

  /* What the library will show for this file if it is accepted, said before the
     upload rather than discovered afterwards. `is_viewable` is not a control, so
     this is the only place its consequence can be stated. */
  const viewable = file ? isLibraryViewable(file.type, file.name) : null;

  return (
    <Dialog
      open
      onClose={onClose}
      size="md"
      title="Add to the company library"
      description="Reference material everybody signed in can read — rate cards, package decks, booklets."
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            type="submit"
            form="library-upload-form"
            disabled={pending || !file || problem !== null}
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Add to library
          </Button>
        </>
      }
    >
      <form id="library-upload-form" action={formAction} className="space-y-4">
        {!state.ok && state.error && (
          <p
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-caption"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--feedback-error)' }}
          >
            <AlertTriangle
              className="mt-px h-4 w-4 shrink-0"
              strokeWidth={2.25}
              aria-hidden="true"
            />
            {state.error}
          </p>
        )}

        <Field
          label="File"
          htmlFor="library-file"
          hint={`PDF, image, design source (.ai, .eps) or a zip, up to ${LIBRARY_MAX_LABEL}.`}
          error={problem ?? undefined}
        >
          <input
            id="library-file"
            name="file"
            type="file"
            required
            /* A filter on the picker, not a rule — the same three-layer
               arrangement `lib/domain/attachments.ts` describes. It stops the
               dialogue offering a .exe; `validateLibraryUpload` produces the
               sentence; the bucket's own allow-list is the enforcement. */
            accept={LIBRARY_ACCEPT}
            onChange={(event) => onPick(event.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-border-default bg-bg-surface px-3 py-2 text-caption text-text-primary"
          />
        </Field>

        {/* What was chosen, and what the library will make of it. Only once a
            file is picked and only when it is acceptable — repeating the refusal
            that is already under the field would be noise. */}
        {file && !problem && (
          <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-bg-subtle px-3 py-2.5">
            <FileTypeIcon mimeType={file.type} name={file.name} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm font-semibold text-text-primary">
                {file.name}
              </span>
              <span className="block text-micro text-text-secondary">
                {formatFileSize(file.size)}
              </span>
            </span>
            {/* ⚠️ Stated, because it cannot be chosen. A design source and an SVG
                both download instead of opening, for two different reasons — see
                `isLibraryViewable` — and finding that out only after publishing
                looks like the library is broken. */}
            <span className="flex shrink-0 items-center gap-1.5 text-micro font-semibold text-text-secondary">
              {viewable ? (
                <>
                  <Eye className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  Opens in a tab
                </>
              ) : (
                <>
                  <EyeOff className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  Download only
                </>
              )}
            </span>
          </div>
        )}

        <Field
          label="Title"
          htmlFor="library-title"
          hint="What the library lists it as, and what a download is called. Leave empty to use the file's own name."
        >
          <Input
            id="library-title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={file?.name ?? 'Rate Card — 2026'}
            maxLength={200}
          />
        </Field>

        {/* ⚠️ THE CATEGORY IS THE FILING, AND IT IS THE OWNER'S OWN VOCABULARY.
            There are no folders here on purpose (migration 035): a path is a
            string somebody has to get right and nothing can group by, while this
            is the enum the filter chips are built from. Choosing well is what
            makes "show me the packages" one click later. */}
        <Field
          label="What kind of document"
          htmlFor="library-category"
          hint="It becomes the badge on the row and the chip that filters to it."
        >
          <Select
            id="library-category"
            name="category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as LibraryCategory);
              setCategoryTouched(true);
            }}
            options={LIBRARY_CATEGORIES.map((key) => ({
              value: key,
              label: LIBRARY_CATEGORY_LABEL[key],
            }))}
          />
        </Field>

        {/* ⚠️ THE SUMMARY IS SEARCHED, WHICH IS WHY IT IS WORTH TYPING. The panel
            matches on the title AND this — the owner's *"which document has which
            thing"* — so a booklet whose summary names the packages inside it is
            found by somebody searching for one of them. */}
        <Field
          label="What is in it"
          htmlFor="library-summary"
          hint="Optional. Shown under the title, and searched — name what it covers, not what it is."
        >
          <Textarea
            id="library-summary"
            name="summary"
            rows={2}
            placeholder="Every package with its monthly rate, deliverables and turnaround."
          />
        </Field>

        <Field
          label="Pages"
          htmlFor="library-pages"
          hint="Optional, and only for something paginated. Left empty the row shows the file size instead."
        >
          <Input
            id="library-pages"
            name="pageCount"
            type="number"
            min={1}
            max={10000}
            step={1}
            inputMode="numeric"
            placeholder="14"
          />
        </Field>

        {/* ── ⚠️ WHO WILL SEE THIS, SAID BEFORE THE BUTTON IS PRESSED ────────
            The library has no approval step and no per-project scoping — that is
            the point of it, and it is the one thing about this form somebody
            could get wrong by assuming it works like the upload queue next door,
            where a Member's file waits for a decision. A client's contract does
            not belong here; it belongs on the project. */}
        <p className="flex items-start gap-2 border-t border-border-subtle pt-3 text-micro leading-relaxed text-text-tertiary">
          <Users className="mt-px size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          <span>
            Everybody signed in can read the company library the moment this is added — there is no
            approval step. Client work belongs on its project instead, where only that project&rsquo;s
            people see it.
          </span>
        </p>
      </form>
    </Dialog>
  );
}
