'use client';

import * as React from 'react';
import { FileText, Loader2, Upload } from 'lucide-react';

import { crmDocumentLinkAction, uploadCrmDocumentAction } from '@/app/actions/crm-documents';
import { useToast } from '@/components/ui/toast';
import type { CrmDocument } from '@/lib/db/queries/crm-documents';
import { documentKindLabel, DOCUMENT_KINDS } from '@/lib/domain/crm-documents';
import { relativeAge } from '@/lib/view/relative-age';
import { cn } from '@/lib/utils';

/* ============================================================================
 * SALES DOCUMENTS — the letterhead, the brochures, the papers on a lead
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-17: *"Provide me, please, in the management/document page, so
 * properly add that tab and that will only be visible to salespersons only."*
 *
 * ── ⚠️ THE TAB IS GATED WHERE THE PAGE GATES EVERYTHING ELSE ───────────────
 * The workspace decides whether to offer this tab from `crmIsOpenTo()`, computed
 * on the server — the same capability that opens the lead desk. ⚠️ And that is
 * convenience, never security: 178's policies are the real boundary, and they
 * are what stops a Development member reading a lead's booking form even if they
 * reach this component some other way.
 *
 * ── ⚠️ A LEAD'S DOCUMENT IS NOT A PROJECT'S ───────────────────────────────
 * A letterhead is shared with everyone on the desk; a signed booking form
 * belongs to one lead and is visible only to whoever owns it. That is 178's
 * policy, not this list's filtering — so a colleague's papers are absent from
 * the query, not hidden by the component.
 * ========================================================================= */

export function DocumentShelf({
  documents,
  projects,
  nowMs,
}: {
  documents: readonly CrmDocument[];
  projects: ReadonlyArray<{ id: string; name: string }>;
  nowMs: number;
}) {
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const [opening, setOpening] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  /* ⚠️ THE PROJECT FILTER IS CLIENT STATE. Every document is already on the
     page; asking the server to hide some of them would be a round trip to
     perform a `filter()` — Rule Zero, law 3. */
  const [project, setProject] = React.useState<string>('all');
  const shown = project === 'all' ? documents : documents.filter((d) => d.projectId === project);

  /* ⚠️ THE MISSING LETTERHEADS ARE THE HEADLINE, because that is the one thing
     blocking every quotation in the system. A list of what IS here would not
     have told the owner what to do next. */
  const withLetterhead = new Set(
    documents.filter((d) => d.kind === 'letterhead').map((d) => d.projectId),
  );
  const missing = projects.filter((p) => !withLetterhead.has(p.id));

  function submit(form: FormData) {
    startTransition(async () => {
      const result = await uploadCrmDocumentAction({ ok: false }, form);
      if (!result.ok) {
        toast({ tone: 'error', text: result.error ?? 'That did not upload.' });
        return;
      }
      formRef.current?.reset();
      toast({ tone: 'ok', text: 'Uploaded.' });
    });
  }

  async function open(id: string) {
    setOpening(id);
    const result = await crmDocumentLinkAction(id);
    setOpening(null);
    if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer');
    else toast({ tone: 'error', text: result.error ?? 'That could not be opened.' });
  }

  return (
    <div className="space-y-4">
      {/* ── What is still missing ──────────────────────────────────────── */}
      {missing.length > 0 && (
        <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-4 py-3">
          <p className="text-body-sm font-medium text-text-primary">
            {missing.length} project{missing.length === 1 ? '' : 's'} still{' '}
            {missing.length === 1 ? 'has' : 'have'} no letterhead
          </p>
          {/* ⚠️ NAMES THEM, up to a point. A count tells the owner there is work;
              the names tell them which upload to do next. */}
          <p className="mt-1 text-caption leading-relaxed text-text-secondary">
            A quotation or proposal cannot be printed for{' '}
            {missing.slice(0, 4).map((p) => p.name).join(', ')}
            {missing.length > 4 && ` and ${missing.length - 4} more`}.
          </p>
        </div>
      )}

      {/* ── Upload ─────────────────────────────────────────────────────── */}
      <form
        ref={formRef}
        action={submit}
        className="rounded-xl border border-border-subtle bg-bg-surface px-4 py-3.5"
      >
        <h3 className="text-body-sm font-semibold text-text-primary">Upload a document</h3>
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
          <label className="block">
            <span className="text-caption font-medium text-text-primary">Project</span>
            <select
              name="projectId"
              required
              className="mt-1 w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-1.5 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
            >
              <option value="">— choose —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-caption font-medium text-text-primary">What is it?</span>
            <select
              name="kind"
              defaultValue="letterhead"
              className="mt-1 w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-1.5 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
            >
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>{documentKindLabel(k)}</option>
              ))}
            </select>
          </label>

          <label className="block sm:col-span-2">
            <span className="text-caption font-medium text-text-primary">
              Title <span className="font-normal text-text-secondary">— optional, the file name is used otherwise</span>
            </span>
            <input
              name="title"
              maxLength={200}
              placeholder="Chitral Royal Homes letterhead"
              className="mt-1 w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-1.5 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
            />
          </label>

          <label className="block sm:col-span-2">
            <span className="text-caption font-medium text-text-primary">File</span>
            <input
              type="file"
              name="file"
              required
              accept=".pdf,.png,.jpg,.jpeg,.webp,.svg,.doc,.docx,.xls,.xlsx"
              className="mt-1 w-full rounded-lg border border-border-default bg-bg-base px-2.5 py-1.5 text-caption text-text-primary file:mr-3 file:rounded-md file:border-0 file:bg-bg-subtle file:px-2.5 file:py-1 file:text-caption file:font-medium file:text-text-primary"
            />
            {/* ⚠️ THE LIMITS ARE STATED BEFORE THE UPLOAD, not discovered by it.
                A 30 MB brochure refused after a two-minute wait is a worse
                experience than one refused in the file picker. */}
            <span className="mt-1 block text-caption text-text-secondary">
              PDF, image or Office document. Up to 20 MB. One letterhead per project.
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={pending}
          className={cn(
            'mt-3 inline-flex items-center gap-2 rounded-lg bg-accent-primary px-3 py-2 text-body-sm font-semibold text-white transition-opacity',
            pending && 'opacity-40',
          )}
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
          {pending ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {/* ── The shelf ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="doc-project" className="text-caption font-medium text-text-secondary">
          Show
        </label>
        <select
          id="doc-project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className="rounded-lg border border-border-default bg-bg-base px-2.5 py-1 text-caption text-text-primary focus:border-accent-primary focus:outline-none"
        >
          <option value="all">Every project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <span className="text-caption text-text-secondary">
          {shown.length} document{shown.length === 1 ? '' : 's'}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-default bg-bg-surface px-5 py-8 text-center">
          <FileText className="mx-auto size-6 text-text-secondary" aria-hidden="true" />
          <p className="mx-auto mt-2 max-w-[44ch] text-body-sm leading-relaxed text-text-secondary">
            Nothing here yet. Upload a letterhead above and every quotation for that
            project can be printed on it.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => void open(d.id)}
                disabled={opening === d.id}
                aria-busy={opening === d.id}
                className={cn(
                  'flex w-full flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border border-border-subtle bg-bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-border-default',
                  opening === d.id && 'opacity-50',
                )}
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-medium text-text-primary">
                    {d.title}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-text-secondary">
                    <span>{documentKindLabel(d.kind)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{d.projectName ?? 'Unknown project'}</span>
                    {/* ⚠️ A LEAD'S NAME ONLY WHEN IT HAS ONE. Printing "—" for a
                        project document would suggest a lead is missing. */}
                    {d.leadName && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{d.leadName}</span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{(d.sizeBytes / 1024).toFixed(0)} KB</span>
                  </span>
                </span>
                <span className="shrink-0 text-caption text-text-secondary">
                  {relativeAge(d.createdAt, nowMs)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
