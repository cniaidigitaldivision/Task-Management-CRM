'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileText, Info, Loader2, Upload, X } from 'lucide-react';

import {
  addClientAction,
  clientDuplicatesAction,
  clientOwnerChoicesAction,
  importClientsAction,
  importMatchesAction,
  updateClientAction,
} from '@/app/actions/crm-client-board';
import { uploadCrmDocumentAction } from '@/app/actions/crm-documents';
import { ink, tint } from '@/components/crm/appointments-board-parts';
import { useToast } from '@/components/ui/toast';
import type { ClientRow } from '@/lib/db/queries/crm-client-board';
import type { CrmDuplicate } from '@/lib/db/queries/crm-leads';
import {
  importRows,
  parseCsv,
  SOURCE_OPTIONS,
  STORED_STATUS_OPTIONS,
  type ImportRow,
  type StoredStatus,
} from '@/lib/domain/crm-client-board';
import { toE164 } from '@/lib/domain/phone';
import { readXlsx } from '@/lib/view/xlsx-read';
import { cn } from '@/lib/utils';

/* ============================================================================
 * CLIENTS — the Add / Edit dialog and the import
 * ----------------------------------------------------------------------------
 * ⚠️ PORTALLED, every one. The page column carries a transform (the reveal
 * animation), which becomes the containing block for anything `fixed` inside
 * it — measured at 1231×605 in a 1512×1000 viewport on /follow-ups before the
 * same fix there.
 * ========================================================================= */

const INPUT =
  'h-9 w-full rounded-xl border border-border-default bg-bg-base px-3 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none';

export function Shell({
  title,
  subtitle,
  width = 'max-w-2xl',
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  width?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = was;
    };
  }, [onClose]);

  const body = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 bg-black/45" />
      <div className={cn('relative flex max-h-[92vh] w-full flex-col rounded-2xl border border-border-subtle bg-bg-surface shadow-xl', width)}>
        <div className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-body font-semibold text-text-primary">{title}</h2>
            {subtitle && <p className="mt-0.5 text-caption text-text-secondary">{subtitle}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-caption font-semibold text-text-secondary">
        {label}
        {required && <span style={{ color: ink('red') }}> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-caption text-text-tertiary">{hint}</span>}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-caption font-semibold uppercase tracking-wide text-text-tertiary">{title}</h3>
      {children}
    </section>
  );
}

/* ── Add / Edit ──────────────────────────────────────────────────────────── */

export function ClientForm({
  mode,
  client,
  projects,
  defaultProjectId,
  viewerId,
  viewerName,
  onClose,
  onSaved,
}: {
  mode: 'add' | 'edit';
  client?: ClientRow;
  projects: ReadonlyArray<{ id: string; name: string }>;
  /** The project in view, or the one most clients are on — not whichever sorts first. */
  defaultProjectId?: string | null;
  viewerId: string;
  viewerName: string;
  onClose: () => void;
  /** `draft` is the row as it will read, so the list can show it in this frame. */
  onSaved: (result: { clientId: string; name: string; draft?: ClientRow }) => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState(client?.name ?? '');
  const [phone, setPhone] = React.useState(client?.phoneE164 ?? '');
  const [email, setEmail] = React.useState(client?.email ?? '');
  const [city, setCity] = React.useState(client?.city ?? '');
  const [company, setCompany] = React.useState(client?.company ?? '');
  const [projectId, setProjectId] = React.useState(
    client?.primaryProjectId ??
      (defaultProjectId && projects.some((p) => p.id === defaultProjectId) ? defaultProjectId : projects[0]?.id) ??
      '',
  );
  const [source, setSource] = React.useState(client?.source ?? 'manual');
  const [ownerId, setOwnerId] = React.useState<string>(client?.ownerId ?? viewerId);
  const [channel, setChannel] = React.useState<string>(client?.preferredChannel ?? 'whatsapp');
  const [status, setStatus] = React.useState<StoredStatus>(client?.status ?? 'active');
  const [notes, setNotes] = React.useState(client?.notes ?? '');
  const [files, setFiles] = React.useState<File[]>([]);
  const [greet, setGreet] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  /* Who this client may be given to — the project's own rota. A non-manager is
     only ever offered themselves, which is the rule the database enforces. */
  const [choices, setChoices] = React.useState<{ manages: boolean; people: Array<{ id: string; name: string }> } | null>(null);
  React.useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void clientOwnerChoicesAction(projectId).then((r) => {
      if (alive) setChoices(r);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);
  const people = React.useMemo(() => {
    const list = choices?.people ?? [];
    const withMe = list.some((p) => p.id === viewerId) ? list : [{ id: viewerId, name: viewerName }, ...list];
    const cur = client?.ownerId && !withMe.some((p) => p.id === client.ownerId)
      ? [...withMe, { id: client.ownerId, name: client.ownerName ?? 'Current owner' }]
      : withMe;
    return choices?.manages ? cur : cur.filter((p) => p.id === (client?.ownerId ?? viewerId));
  }, [choices, viewerId, viewerName, client]);

  /* ── Duplicate detection, before Save ─────────────────────────────────── */
  /* ⚠️ THE ANSWER CARRIES THE QUESTION IT ANSWERS. "Still checking" and "no
     longer relevant" are then derived — nothing is reset inside the effect,
     and a slow answer for an old number can never be shown for a new one. */
  const enough = phone.trim().replace(/\D/g, '').length >= 7 || /@.+\./.test(email.trim());
  const query = mode === 'add' && projectId && enough ? `${projectId}|${phone.trim()}|${email.trim()}` : null;
  const [answer, setAnswer] = React.useState<{ query: string; list: CrmDuplicate[] } | null>(null);
  React.useEffect(() => {
    if (!query) return;
    let alive = true;
    const [pid, p, e] = query.split('|');
    /* A short pause, so it asks once for a typed number rather than per key. */
    const t = window.setTimeout(() => {
      void clientDuplicatesAction(pid, p, e).then((r) => {
        if (alive) setAnswer({ query, list: r.duplicates });
      });
    }, 350);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query]);
  const dupes = query && answer?.query === query ? answer.list : null;
  const checking = query !== null && answer?.query !== query;

  /* ⚠️ WHICH MATCHES STOP A SAVE — the same two the database refuses: an
     existing client, and an open lead for this person on THIS project. A lead
     on another project is a warning: one person may enquire about two things. */
  const blocking = (dupes ?? []).filter((d) => d.kind === 'client' || (d.sameProject && d.isOpen));

  const canSave = name.trim() && (phone.trim() || email.trim()) && (mode === 'edit' || projectId) && blocking.length === 0 && !busy;

  const save = async () => {
    setBusy(true);
    if (mode === 'add') {
      const r = await addClientAction({
        projectId,
        fullName: name,
        phone,
        email,
        city,
        company,
        source,
        ownerId,
        channel: channel || null,
        status,
        notes,
        greet,
      });
      if (!r.ok) {
        setBusy(false);
        toast({ tone: 'error', text: r.error });
        return;
      }
      /* Documents go onto the client's new lead — the same place the drawer's
         Files tab reads them from. */
      let failedFiles = 0;
      for (const f of files) {
        const form = new FormData();
        form.set('projectId', projectId);
        form.set('leadId', r.leadId);
        form.set('title', f.name.replace(/\.[^.]+$/, ''));
        form.set('kind', 'other');
        form.set('product', 'any');
        form.set('file', f);
        const up = await uploadCrmDocumentAction({ ok: false }, form);
        if (!up.ok) failedFiles += 1;
      }
      setBusy(false);
      toast({
        tone: failedFiles ? 'error' : 'ok',
        text:
          `${name.trim()} added${r.ownerName && ownerId !== viewerId ? ` and given to ${r.ownerName}` : ''}.` +
          (failedFiles ? ` ${failedFiles} document${failedFiles === 1 ? '' : 's'} could not be uploaded.` : ''),
      });
      /* ⚠️ THE NEW ROW, BUILT FROM WHAT WAS TYPED AND WHAT CAME BACK. Measured
         on the dev server: the page refresh that brings it took over six
         seconds, during which the list still said the old count. The server's
         row replaces this one the moment it arrives. */
      const now = new Date().toISOString();
      const project = projects.find((x) => x.id === projectId);
      const draft: ClientRow = {
        id: r.clientId,
        refNo: r.refNo,
        name: name.trim(),
        company: company.trim() || null,
        phoneE164: toE164(phone),
        email: email.trim().toLowerCase() || null,
        city: city.trim() || null,
        notes: notes.trim() || null,
        source,
        preferredChannel: (channel || null) as ClientRow['preferredChannel'],
        status,
        archivedAt: null,
        createdAt: now,
        ownerId,
        ownerName: r.ownerName ?? (ownerId === viewerId ? viewerName : null),
        leadIds: [r.leadId],
        primaryLeadId: r.leadId,
        primaryProjectId: projectId,
        primaryProjectName: project?.name ?? null,
        projectNames: project ? [project.name] : [],
        leadStage: 'contacted',
        openDeals: 1,
        wonLeads: 0,
        lastContactAt: null,
        lastDirection: null,
        nextAt: null,
        nextKind: null,
        nextLabel: null,
        properties: 0,
        quotations: 0,
        appointments: 0,
        bookings: 0,
        invoices: 0,
        unpaidInvoices: 0,
        unpaidAmount: 0,
        overdueInvoices: 0,
        bookedValue: 0,
        quotedValue: 0,
      };
      onSaved({ clientId: r.clientId, name: name.trim(), draft });
      return;
    }

    const r = await updateClientAction(client!.id, {
      fullName: name,
      company,
      phone,
      email,
      city,
      source,
      channel,
      status,
      notes,
      ...(ownerId !== client!.ownerId ? { ownerId } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error });
      return;
    }
    toast({ tone: 'ok', text: 'Client saved.' });
    onSaved({ clientId: client!.id, name: name.trim() });
  };

  return (
    <Shell
      title={mode === 'add' ? 'Add client' : `Edit ${client?.name ?? 'client'}`}
      subtitle={mode === 'add' ? 'We check for this person before anything is saved.' : undefined}
      onClose={onClose}
      footer={
        <>
          {checking && (
            <span className="mr-auto inline-flex items-center gap-1.5 text-caption text-text-secondary">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> Checking for this person…
            </span>
          )}
          <button type="button" onClick={onClose} className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => void save()}
            className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {mode === 'add' ? 'Add client' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <Section title="Personal details">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" required>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={INPUT} placeholder="Faisal Rehman" />
            </Field>
            <Field label="Phone" hint="With the country code, e.g. +92 300 1234567">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} inputMode="tel" placeholder="+92 300 1234567" />
            </Field>
            <Field label="Email">
              <input value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} type="email" placeholder="name@company.com" />
            </Field>
            <Field label="City / location">
              <input value={city} onChange={(e) => setCity(e.target.value)} className={INPUT} placeholder="Islamabad" />
            </Field>
          </div>
        </Section>

        {/* ── What is already known about this person ─────────────────── */}
        {mode === 'add' && dupes && dupes.length > 0 && (
          <div
            className="space-y-1.5 rounded-xl border px-3 py-2.5"
            style={{
              borderColor: tint(blocking.length ? 'red' : 'amber', 45),
              background: tint(blocking.length ? 'red' : 'amber', 8),
            }}
          >
            <p className="flex items-center gap-1.5 text-caption font-semibold" style={{ color: ink(blocking.length ? 'red' : 'amber') }}>
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {blocking.length ? 'This person is already here — it cannot be saved twice.' : 'We may already know this person.'}
            </p>
            <ul className="space-y-1">
              {dupes.map((d) => (
                <li key={`${d.kind}-${d.id}`} className="text-caption text-text-primary">
                  <strong className="font-semibold">{d.name}</strong>{' '}
                  <span className="text-text-secondary">
                    — {d.kind === 'client' ? 'already a client' : `${d.isOpen ? 'open' : 'closed'} lead${d.projectName ? ` on ${d.projectName}` : ''}`}
                    {d.ownerName ? `, with ${d.isMine ? 'you' : d.ownerName}` : ''} · matched on {d.matchedOn}
                  </span>
                </li>
              ))}
            </ul>
            {blocking.length > 0 && (
              <p className="text-caption text-text-secondary">
                Open the existing record instead — two records for one person split their history in two.
              </p>
            )}
          </div>
        )}

        <Section title="Company and project">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company">
              <input value={company} onChange={(e) => setCompany(e.target.value)} className={INPUT} placeholder="AGC Construction" />
            </Field>
            {mode === 'add' ? (
              <Field label="Project" required>
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={INPUT}>
                  {projects.length === 0 && <option value="">No project open to you</option>}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Project">
                <input value={client?.projectNames.join(', ') ?? ''} disabled className={cn(INPUT, 'opacity-70')} />
              </Field>
            )}
            <Field label="Source">
              <select value={source} onChange={(e) => setSource(e.target.value)} className={INPUT}>
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Relationship">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Assigned salesperson" hint={choices && !choices.manages ? 'Only a manager can give a client to somebody else.' : undefined}>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={!choices?.manages} className={INPUT}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.id === viewerId ? `${p.name} (you)` : p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Preferred channel">
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className={INPUT}>
                <option value="whatsapp">WhatsApp</option>
                <option value="call">Phone call</option>
                <option value="email">Email</option>
                <option value="">No preference</option>
              </select>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as StoredStatus)} className={INPUT}>
                {STORED_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <p className="text-caption text-text-secondary">
            &ldquo;Needs attention&rdquo; is never set by hand — the page shows it by itself when something is overdue, an
            invoice is late, or the client is waiting on a reply.
          </p>
        </Section>

        <Section title={mode === 'add' ? 'Initial notes' : 'Notes'}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="What they are looking for, how they found us, anything the next person should know."
            className="w-full resize-y rounded-xl border border-border-default bg-bg-base px-3 py-2 text-body-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none"
          />
        </Section>

        {mode === 'add' && (
          <Section title="Documents">
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border-default px-3 py-3 text-body-sm text-text-secondary hover:bg-bg-subtle">
              <Upload className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} chosen` : 'CNIC copy, agreements, anything to keep with this client'}
              </span>
              <input type="file" multiple className="sr-only" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
            </label>
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f) => (
                  <li key={f.name} className="flex items-center gap-2 text-caption text-text-primary">
                    <FileText className="size-3.5 text-text-tertiary" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-text-secondary">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                  </li>
                ))}
              </ul>
            )}

            {/* ⚠️ OFF BY DEFAULT, AND SAID PLAINLY. Adding somebody we already
                know must not send them the project's first-contact greeting
                (migration 249). */}
            {phone.trim() && (
              <label className="flex items-start gap-2.5 rounded-xl bg-bg-subtle/60 px-3 py-2.5 text-body-sm text-text-primary">
                <input type="checkbox" checked={greet} onChange={(e) => setGreet(e.target.checked)} className="mt-0.5" />
                <span className="min-w-0">
                  Send the project&rsquo;s WhatsApp greeting
                  <span className="block text-caption text-text-secondary">
                    Off unless you tick it — somebody you already know should not get a first-contact message.
                  </span>
                </span>
              </label>
            )}
          </Section>
        )}

        {mode === 'add' && (
          <p className="flex items-start gap-1.5 text-caption text-text-secondary">
            <Info className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
            A lead is opened for them on the project, so they appear on its desk. Mark it won there when they buy.
          </p>
        )}
      </div>
    </Shell>
  );
}

/* ── Import ──────────────────────────────────────────────────────────────── */

type Checked = ImportRow & { match: string | null; include: boolean };

const TEMPLATE = 'Name,Phone,Email,Company,City,Source,Status,Preferred channel,Notes\r\n' +
  'Faisal Rehman,+92 300 1234567,faisal@example.com,Rehman Builders,Islamabad,referral,active,whatsapp,Wants a corner plot\r\n';

export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  downloadBlob(name, text, type);
}

/** Text, a workbook's bytes or a PDF's — one way to hand a file to the browser. */
export function downloadBlob(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportDialog({
  projects,
  defaultProjectId,
  viewerId,
  viewerName,
  onClose,
  onDone,
}: {
  projects: ReadonlyArray<{ id: string; name: string }>;
  defaultProjectId?: string | null;
  viewerId: string;
  viewerName: string;
  onClose: () => void;
  onDone: (added: number) => void;
}) {
  const toast = useToast();
  const [projectId, setProjectId] = React.useState(
    (defaultProjectId && projects.some((p) => p.id === defaultProjectId) ? defaultProjectId : projects[0]?.id) ?? '',
  );
  const [ownerId, setOwnerId] = React.useState(viewerId);
  const [choices, setChoices] = React.useState<{ manages: boolean; people: Array<{ id: string; name: string }> } | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Checked[] | null>(null);
  const [missing, setMissing] = React.useState<string[]>([]);
  const [reading, setReading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ added: number; failed: Array<{ line: number; name: string; error: string }> } | null>(null);

  React.useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void clientOwnerChoicesAction(projectId).then((r) => {
      if (alive) setChoices(r);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const people = choices?.manages
    ? choices.people.some((p) => p.id === viewerId)
      ? choices.people
      : [{ id: viewerId, name: viewerName }, ...choices.people]
    : [{ id: viewerId, name: viewerName }];

  const pick = async (f: File) => {
    setFileName(f.name);
    setRows(null);
    setResult(null);
    setReading(true);
    try {
      const table = /\.xlsx$/i.test(f.name)
        ? await readXlsx(new Uint8Array(await f.arrayBuffer()))
        : parseCsv(await f.text());
      const read = importRows(table);
      setMissing(read.missing);
      /* ⚠️ WHO ALREADY EXISTS, ASKED ONCE FOR THE WHOLE SHEET. */
      const matches = await importMatchesAction(
        read.rows.map((r) => r.phone).filter(Boolean),
        read.rows.map((r) => r.email).filter(Boolean),
      );
      const digits = (s: string) => s.replace(/\D/g, '').slice(-10);
      setRows(
        read.rows.map((r) => {
          const hit = matches.find(
            (m) =>
              (r.phone && m.phoneE164 && digits(m.phoneE164) === digits(r.phone)) ||
              (r.email && m.email && m.email === r.email),
          );
          const match = hit
            ? hit.kind === 'client'
              ? `already a client (${hit.name}${hit.ownerName ? `, ${hit.ownerName}` : ''})`
              : `open lead${hit.projectName ? ` on ${hit.projectName}` : ''}${hit.ownerName ? ` with ${hit.ownerName}` : ''}`
            : null;
          /* An existing client cannot be imported again; everything else with no
             problem starts ticked. */
          return { ...r, match, include: r.problems.length === 0 && !(hit && hit.kind === 'client') };
        }),
      );
    } catch (e) {
      toast({ tone: 'error', text: (e as Error).message || 'That file could not be read.' });
    } finally {
      setReading(false);
    }
  };

  const chosen = (rows ?? []).filter((r) => r.include);

  const go = async () => {
    setBusy(true);
    const r = await importClientsAction({
      projectId,
      ownerId,
      rows: chosen.map((x) => ({
        line: x.line,
        name: x.name,
        phone: x.phone,
        email: x.email,
        company: x.company,
        city: x.city,
        source: x.source,
        status: x.status,
        channel: x.channel,
        notes: x.notes,
      })),
    });
    setBusy(false);
    if (r.error) {
      toast({ tone: 'error', text: r.error });
      return;
    }
    setResult({ added: r.added, failed: r.failed });
    if (r.added) onDone(r.added);
  };

  return (
    <Shell
      title="Import clients"
      subtitle="From a CSV or an Excel (.xlsx) sheet. Nothing is saved until you press Import."
      width="max-w-4xl"
      onClose={onClose}
      footer={
        result ? (
          <button type="button" onClick={onClose} className="rounded-xl bg-accent-primary px-4 py-2 text-body-sm font-semibold text-white hover:opacity-90">
            Done
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => downloadText('clients-template.csv', `﻿${TEMPLATE}`)}
              className="mr-auto text-caption font-semibold text-text-brand hover:underline"
            >
              Download a template
            </button>
            <button type="button" onClick={onClose} className="rounded-xl border border-border-default px-3.5 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle">
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || chosen.length === 0 || !projectId}
              onClick={() => void go()}
              className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2 text-body-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {busy ? 'Importing…' : `Import ${chosen.length} client${chosen.length === 1 ? '' : 's'}`}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-body-sm font-semibold" style={{ color: ink('green') }}>
            <CheckCircle2 className="size-4" aria-hidden="true" /> {result.added} client{result.added === 1 ? '' : 's'} imported.
          </p>
          {result.failed.length > 0 && (
            <div className="rounded-xl border border-border-subtle p-3">
              <p className="text-caption font-semibold text-text-primary">{result.failed.length} not imported:</p>
              <ul className="mt-1.5 max-h-60 space-y-1 overflow-y-auto">
                {result.failed.map((f) => (
                  <li key={f.line} className="text-caption text-text-secondary">
                    Row {f.line} · <strong className="font-semibold text-text-primary">{f.name}</strong> — {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Project they belong to" required>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={INPUT}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Assign to" hint={choices && !choices.manages ? 'Imported clients are yours — only a manager can give them to somebody else.' : undefined}>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} disabled={!choices?.manages} className={INPUT}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.id === viewerId ? `${p.name} (you)` : p.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border-default px-4 py-5 hover:bg-bg-subtle">
            <FileSpreadsheet className="size-6 shrink-0 text-text-tertiary" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block text-body-sm font-semibold text-text-primary">{fileName ?? 'Choose a .csv or .xlsx file'}</span>
              <span className="block text-caption text-text-secondary">
                The first row names the columns — Name, Phone, Email, Company, City, Source, Status, Preferred channel, Notes.
              </span>
            </span>
            {reading && <Loader2 className="size-4 animate-spin text-text-tertiary" aria-hidden="true" />}
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pick(f);
              }}
            />
          </label>

          {missing.length > 0 && (
            <p className="rounded-xl px-3 py-2 text-caption" style={{ background: tint('red', 10), color: ink('red') }}>
              This sheet has no {missing.includes('name') ? 'name column' : ''}
              {missing.length > 1 ? ' and no ' : ''}
              {missing.includes('phone') ? 'phone or email column' : ''} — every client needs those.
            </p>
          )}

          <p className="flex items-start gap-1.5 text-caption text-text-secondary">
            <Info className="mt-0.5 size-3.5 shrink-0 text-text-tertiary" aria-hidden="true" />
            Imported clients are never sent the WhatsApp greeting — they are people you already know.
          </p>

          {rows && rows.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border-subtle">
              <table className="w-full min-w-[42rem] text-left text-caption">
                <thead className="bg-bg-subtle/60 text-text-secondary">
                  <tr>
                    <th className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Include every row that can be imported"
                        checked={chosen.length > 0 && chosen.length === rows.filter((r) => r.problems.length === 0 && !r.match?.startsWith('already')).length}
                        onChange={(e) =>
                          setRows(rows.map((r) => ({ ...r, include: e.target.checked && r.problems.length === 0 && !r.match?.startsWith('already') })))
                        }
                      />
                    </th>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {rows.slice(0, 500).map((r, i) => {
                    const blocked = r.problems.length > 0 || Boolean(r.match?.startsWith('already'));
                    return (
                      <tr key={r.line} className={blocked ? 'opacity-70' : undefined}>
                        <td className="px-3 py-1.5">
                          <input
                            type="checkbox"
                            aria-label={`Include row ${r.line}`}
                            disabled={blocked}
                            checked={r.include}
                            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
                          />
                        </td>
                        <td className="px-3 py-1.5 text-text-secondary">{r.line}</td>
                        <td className="px-3 py-1.5 font-semibold text-text-primary">{r.name || '—'}</td>
                        <td className="px-3 py-1.5 text-text-primary">{r.phone || '—'}</td>
                        <td className="px-3 py-1.5 text-text-primary">{r.email || '—'}</td>
                        <td className="px-3 py-1.5 capitalize text-text-primary">{r.status}</td>
                        <td className="px-3 py-1.5">
                          {r.problems.length > 0 ? (
                            <span style={{ color: ink('red') }}>{r.problems.join(', ')}</span>
                          ) : r.match ? (
                            <span style={{ color: ink(r.match.startsWith('already') ? 'red' : 'amber') }}>{r.match}</span>
                          ) : (
                            <span style={{ color: ink('green') }}>Ready</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > 500 && (
                <p className="border-t border-border-subtle px-3 py-2 text-caption text-text-secondary">
                  Showing the first 500 of {rows.length} rows — an import takes 500 at a time.
                </p>
              )}
            </div>
          )}
          {rows && rows.length === 0 && missing.length === 0 && (
            <p className="text-caption text-text-secondary">That sheet has a header row but no clients under it.</p>
          )}
        </div>
      )}
    </Shell>
  );
}
