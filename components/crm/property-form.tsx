'use client';

import * as React from 'react';
import {
  AlertTriangle, ArrowRight, Check, FileText, HousePlus, Info, Lock, Pencil, Ruler,
} from 'lucide-react';

import type { PropertyForm } from '@/app/actions/crm-properties';
import { cv, OUTLINE, outlineStyle, SOLID, solidStyle, Select } from '@/components/crm/clients-ui';
import { Dialog } from '@/components/ui/dialog';
import type { PropertyRow } from '@/lib/db/queries/crm-properties';
import {
  areaCheck, areaLabel, areaSqft, money, propertyChanges, SELECTABLE_STATUSES,
  sizeLabel, statusLook, statusNeedsPaperwork,
} from '@/lib/domain/crm-property';
import { cn } from '@/lib/utils';

/* ============================================================================
 * ADD AND EDIT A PROPERTY — the owner's two references, 2026-09-27
 * ----------------------------------------------------------------------------
 * Two dialogs, one set of fields, because they write the same row. They look
 * different on purpose and the owner drew both:
 *
 *   **Add** is a WIZARD. Four steps, an Area check beside the fields, and a
 *   Save draft that works from step one. Somebody entering a scheme's first
 *   plot has thirty things to type and no reason to hold them all at once.
 *
 *   **Edit** is TABBED, with a change reason and a preview of what will move.
 *   Somebody editing has one thing to change and a great deal to leave alone,
 *   so the risk is the opposite one: a stray keystroke in a field they were not
 *   looking at.
 *
 * ── ⚠️ EVERY FIELD IS CLIENT STATE AND NOTHING FETCHES ────────────────────
 * Rule Zero. Stepping between 1 and 4, switching tabs, ticking a checkbox —
 * none of it touches the network. The only round trip is Save.
 * ========================================================================= */

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
  readonly marlaStandard: number;
}

export type FormValues = Omit<PropertyForm, 'marlaStandard'>;

export const BLANK_FORM: FormValues = {
  projectId: '',
  code: '',
  plotNumber: '',
  block: '',
  kind: 'Residential plot',
  sizeMarla: '',
  widthFt: '',
  lengthFt: '',
  category: 'Standard',
  isCorner: false,
  isParkFacing: false,
  isMainBoulevard: false,
  facing: '',
  roadWidthFt: '',
  basePrice: '',
  premiumCharges: '0',
  status: 'available',
  developmentStatus: '',
  expectedPossession: '',
  notes: '',
};

/** The sizes a scheme actually sells, as a picker rather than free text. */
const SIZES = [
  { label: '3 Marla', marla: '3' }, { label: '5 Marla', marla: '5' },
  { label: '7 Marla', marla: '7' }, { label: '8 Marla', marla: '8' },
  { label: '10 Marla', marla: '10' }, { label: '1 Kanal', marla: '20' },
  { label: '2 Kanal', marla: '40' },
] as const;
const CATEGORIES = ['Standard', 'Corner', 'Park facing', 'Boulevard'] as const;
const DEV_STATES = ['Developed', 'Under development', 'Balloted', 'Possession ready'] as const;
const FACINGS = ['North', 'South', 'East', 'West'] as const;
const TYPES = ['Residential plot', 'Commercial plot', 'Apartment', 'House', 'Shop', 'Office'] as const;
const ROADS = ['30 ft road', '40 ft road', '60 ft road', '80 ft road'] as const;

const FIELD =
  'h-[2.5rem] w-full rounded-[0.45rem] border bg-[var(--cl-surface)] px-[0.7rem] text-[0.9rem] transition-colors focus:outline-none';
const READONLY = 'h-[2.5rem] w-full rounded-[0.45rem] border px-[0.7rem] text-[0.9rem] flex items-center gap-2';

function Field({
  label, children, hint, required, wide, locked,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
  wide?: boolean;
  locked?: boolean;
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-[0.3rem]', wide && 'sm:col-span-2')}>
      <span className="inline-flex items-center gap-[0.3rem] text-[0.78rem] font-medium" style={{ color: cv('soft') }}>
        {label}
        {/* ⚠️ DECORATIVE. Without aria-hidden the field's accessible name becomes
            "Width (ft) *" — the asterisk is read aloud and voice control stops
            matching the words on screen. The requirement is carried by the
            control, not by the glyph. */}
        {required && <span aria-hidden="true" style={{ color: cv('red') }}>*</span>}
        {locked && <Lock className="size-[0.7rem]" aria-hidden="true" />}
      </span>
      {children}
      {hint ? <span className="text-[0.72rem]" style={{ color: cv('mute') }}>{hint}</span> : null}
    </label>
  );
}

/**
 * ⚠️ A `<label>` MUST WRAP EXACTLY ONE CONTROL. `Field` above is a label, which
 * is right for a single input — but the Property ID has a pencil button beside
 * it and Dimensions has two boxes and a ×. Nested in a label, every one of them
 * answers to the field's name: a screen reader offers "Property ID" twice, and
 * Playwright's getByLabel found two elements, which is how this was noticed.
 */
function FieldBlock({
  label, children, hint, required, locked,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
  locked?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-[0.3rem]">
      <span className="inline-flex items-center gap-[0.3rem] text-[0.78rem] font-medium" style={{ color: cv('soft') }}>
        {label}
        {/* ⚠️ DECORATIVE. Without aria-hidden the field's accessible name becomes
            "Width (ft) *" — the asterisk is read aloud and voice control stops
            matching the words on screen. The requirement is carried by the
            control, not by the glyph. */}
        {required && <span aria-hidden="true" style={{ color: cv('red') }}>*</span>}
        {locked && <Lock className="size-[0.7rem]" aria-hidden="true" />}
      </span>
      {children}
      {hint ? <span className="text-[0.72rem]" style={{ color: cv('mute') }}>{hint}</span> : null}
    </div>
  );
}

function Text({
  value, onChange, placeholder, mode,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mode?: 'numeric' | 'decimal';
}) {
  return (
    <input
      className={FIELD}
      style={{ borderColor: cv('line'), color: cv('ink') }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={mode}
    />
  );
}

function Readonly({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className={READONLY} style={{ borderColor: cv('line'), background: cv('head'), color: cv('soft') }}>
      {icon}
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The Area check — the owner's own panel
 * ------------------------------------------------------------------------- */

function AreaCheckPanel({ form, standard }: { form: FormValues; standard: number }) {
  const marla = Number(form.sizeMarla);
  const w = Number(form.widthFt);
  const l = Number(form.lengthFt);
  const check = areaCheck(marla, standard, w, l);

  return (
    <aside className="rounded-[0.6rem] border p-[0.85rem]" style={{ borderColor: cv('line'), background: cv('strip') }}>
      <h4 className="mb-[0.7rem] inline-flex items-center gap-[0.45rem] text-[0.95rem] font-semibold" style={{ color: cv('ink') }}>
        <span className="grid size-[1.9rem] place-items-center rounded-[0.42rem]" style={{ background: cv('tile') }}>
          <Ruler className="size-[1rem]" style={{ color: cv('tile-ink') }} aria-hidden="true" />
        </span>
        Area check
      </h4>

      <p className="text-[0.78rem] font-medium" style={{ color: cv('soft') }}>From Marla standard</p>
      <p className="mb-[0.6rem] text-[0.95rem]" style={{ color: cv('ink') }}>
        {Number.isFinite(marla) && marla > 0
          ? `${sizeLabel(marla).replace(/ (Marla|Kanal).*/, (m) => m)} × ${standard} = ${areaLabel(areaSqft(marla, standard))}`
          : '—'}
      </p>

      <p className="text-[0.78rem] font-medium" style={{ color: cv('soft') }}>From dimensions</p>
      <p className="mb-[0.7rem] text-[0.95rem]" style={{ color: cv('ink') }}>
        {check.fromDimensions !== null ? `${w} × ${l} = ${areaLabel(check.fromDimensions)}` : '—'}
      </p>

      <p
        className="inline-flex w-full items-start gap-[0.45rem] rounded-[0.45rem] px-[0.6rem] py-[0.45rem] text-[0.82rem]"
        style={
          check.match
            ? { background: cv('green-soft'), color: cv('green') }
            : check.deltaPct === null
              ? { background: cv('pill'), color: cv('soft') }
              : { background: cv('amber-soft'), color: cv('amber') }
        }
      >
        {check.match
          ? <Check className="mt-[0.1rem] size-[0.9rem] shrink-0" strokeWidth={3} aria-hidden="true" />
          : <Info className="mt-[0.1rem] size-[0.9rem] shrink-0" aria-hidden="true" />}
        <span>{check.note}</span>
      </p>
    </aside>
  );
}

/* ---------------------------------------------------------------------------
 * ADD — the four-step wizard
 * ------------------------------------------------------------------------- */

const STEPS = ['Property details', 'Features & pricing', 'Documents', 'Review'] as const;

export function AddPropertyWizard({
  open, onClose, projects, busy, error, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  projects: readonly ProjectOption[];
  busy: boolean;
  error: string | null;
  onSubmit: (form: PropertyForm, draft: boolean) => void;
}) {
  const [step, setStep] = React.useState(0);
  const [f, setF] = React.useState<FormValues>({ ...BLANK_FORM, projectId: projects[0]?.id ?? '' });
  const [idLocked, setIdLocked] = React.useState(true);

  /* Reopening starts clean. */
  const was = React.useRef(open);
  if (was.current !== open) {
    was.current = open;
    if (open) { setStep(0); setF({ ...BLANK_FORM, projectId: projects[0]?.id ?? '' }); setIdLocked(true); }
  }

  const set = (patch: Partial<FormValues>) => setF((c) => ({ ...c, ...patch }));
  const project = projects.find((p) => p.id === f.projectId) ?? projects[0];
  const standard = project?.marlaStandard ?? 225;
  const submit = (draft: boolean) =>
    onSubmit({ ...f, projectId: f.projectId || project?.id || '', marlaStandard: standard, isDraft: draft }, draft);

  /* ⚠️ The ID is suggested from the plot number and then LOCKED behind a pencil.
     A scheme's IDs are a convention — PROP-A101 for plot A-101 — and letting the
     field drift from it by accident is how two plots end up impossible to
     reconcile with the developer's own sheet. */
  const suggestId = (plot: string) =>
    idLocked ? `PROP-${plot.replace(/[^A-Za-z0-9]/g, '').toUpperCase()}` : f.code;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add property"
      description="Create a property inventory record."
      size="lg"
      header={
        <div className="flex items-center gap-3">
          <span className="grid size-[2.6rem] shrink-0 place-items-center rounded-[0.55rem]" style={{ background: cv('tile') }}>
            <HousePlus className="size-[1.3rem]" style={{ color: cv('tile-ink') }} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-[1.25rem] font-bold leading-tight" style={{ color: cv('ink') }}>Add property</span>
            <span className="block text-[0.86rem]" style={{ color: cv('soft') }}>Create a property inventory record.</span>
          </span>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* ⚠️ The owner's own line, printed where the decision is made. */}
          <span className="inline-flex items-center gap-[0.4rem] text-[0.8rem]" style={{ color: cv('mute') }}>
            <Info className="size-[0.9rem] shrink-0" aria-hidden="true" />
            Adding a property does not reserve it.
          </span>
          <span className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => submit(true)}
                    className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>
              Save draft
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" onClick={() => setStep(step + 1)} className={`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`} style={solidStyle}>
                Continue <ArrowRight className="size-[1rem]" aria-hidden="true" />
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => submit(false)} className={`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`} style={solidStyle}>
                {busy ? 'Saving…' : 'Save property'}
              </button>
            )}
          </span>
        </div>
      }
    >
      <Stepper at={step} onGo={setStep} />

      {step === 0 && (
        <div className="grid gap-[0.9rem] lg:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="grid gap-[0.8rem] sm:grid-cols-3">
            <Field label="Project" required wide>
              <Select label="Project" value={f.projectId} onChange={(v) => set({ projectId: v })} className="h-[2.5rem] w-full">
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <FieldBlock label="Property ID" required>
              <span className="flex gap-[0.4rem]">
                <input
                  aria-label="Property ID"
                  className={FIELD}
                  style={{ borderColor: cv('line'), color: cv('ink'), background: idLocked ? cv('head') : cv('surface') }}
                  value={f.code}
                  readOnly={idLocked}
                  onChange={(e) => set({ code: e.target.value })}
                  placeholder="PROP-A101"
                />
                <button
                  type="button"
                  onClick={() => setIdLocked(!idLocked)}
                  aria-label={idLocked ? 'Type the property ID by hand' : 'Follow the plot number again'}
                  title={idLocked ? 'Type it by hand' : 'Follow the plot number'}
                  className="grid size-[2.5rem] shrink-0 place-items-center rounded-[0.45rem] border transition-colors hover:bg-[var(--cl-head)]"
                  style={{ borderColor: cv('line'), color: cv('brand-ink') }}
                >
                  <Pencil className="size-[0.95rem]" aria-hidden="true" />
                </button>
              </span>
            </FieldBlock>

            <Field label="Block" required>
              <Text value={f.block} onChange={(v) => set({ block: v, code: suggestId(f.plotNumber) })} placeholder="A" />
            </Field>
            <Field label="Plot number" required>
              <Text value={f.plotNumber} onChange={(v) => set({ plotNumber: v, code: suggestId(v) })} placeholder="A-101" />
            </Field>
            <Field label="Property type" required>
              <Select label="Property type" value={f.kind} onChange={(v) => set({ kind: v })} className="h-[2.5rem] w-full">
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Field>

            {/* ⚠️ The aria-label must MATCH the visible one. `Select` puts its
                `label` on the control as an aria-label, and an aria-label
                overrides the wrapping `<label>` — so "Size" here against
                "Size (Marla)" on screen means somebody using voice control says
                the words they can see and nothing happens. */}
            <Field label="Size (Marla)" required>
              <Select label="Size (Marla)" value={f.sizeMarla} onChange={(v) => set({ sizeMarla: v })} className="h-[2.5rem] w-full">
                <option value="">Choose…</option>
                {SIZES.map((s) => <option key={s.marla} value={s.marla}>{s.label}</option>)}
              </Select>
            </Field>
            {/* ⚠️ READ-ONLY, AND IT COMES FROM THE PROJECT. This field existing at
                all is the owner's instruction made visible: change the project
                above and this number changes with it. */}
            <Field label="Marla standard" locked hint="Set on the project.">
              <Readonly>{standard} sq ft</Readonly>
            </Field>
            <Field label="Total area" locked>
              <Readonly>{areaLabel(areaSqft(Number(f.sizeMarla), standard))}</Readonly>
            </Field>

            <Field label="Width (ft)" required>
              <Text value={f.widthFt} onChange={(v) => set({ widthFt: v })} placeholder="25" mode="decimal" />
            </Field>
            <Field label="Length (ft)" required>
              <Text value={f.lengthFt} onChange={(v) => set({ lengthFt: v })} placeholder="45" mode="decimal" />
            </Field>
            <Field label="Facing" required>
              <Select label="Facing" value={f.facing} onChange={(v) => set({ facing: v })} className="h-[2.5rem] w-full">
                <option value="">Choose…</option>
                {FACINGS.map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
            </Field>

            <Field label="Road width (ft)" required>
              <Text value={f.roadWidthFt} onChange={(v) => set({ roadWidthFt: v })} placeholder="30" mode="numeric" />
            </Field>
            <Field label="Category" required>
              <Select label="Category" value={f.category} onChange={(v) => set({ category: v })} className="h-[2.5rem] w-full">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <span className="flex flex-wrap items-end gap-[0.9rem] pb-[0.5rem]">
              {/* ⚠️ INDEPENDENT of Category, because a corner plot can also face a
                  park. Deriving them from one dropdown made those exclusive. */}
              <Tick label="Corner" on={f.isCorner} onFlip={() => set({ isCorner: !f.isCorner })} />
              <Tick label="Park facing" on={f.isParkFacing} onFlip={() => set({ isParkFacing: !f.isParkFacing })} />
              <Tick label="Main boulevard" on={f.isMainBoulevard} onFlip={() => set({ isMainBoulevard: !f.isMainBoulevard })} />
            </span>

            <Field label="Status" required>
              <Select label="Status" value={f.status} onChange={(v) => set({ status: v })} className="h-[2.5rem] w-full">
                {SELECTABLE_STATUSES.map((s) => <option key={s} value={s}>{statusLook(s).label}</option>)}
              </Select>
            </Field>
            <Field label="Development status" required>
              <Select label="Development status" value={f.developmentStatus} onChange={(v) => set({ developmentStatus: v })} className="h-[2.5rem] w-full">
                <option value="">Choose…</option>
                {DEV_STATES.map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
            </Field>
            <Field label="Expected possession">
              <input type="date" className={FIELD} style={{ borderColor: cv('line'), color: cv('ink') }}
                     value={f.expectedPossession} onChange={(e) => set({ expectedPossession: e.target.value })} />
            </Field>
          </div>

          <AreaCheckPanel form={f} standard={standard} />
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-[0.8rem] sm:grid-cols-3">
          <Field label="Base price (PKR)" required>
            <Text value={f.basePrice} onChange={(v) => set({ basePrice: v })} placeholder="4500000" mode="numeric" />
          </Field>
          <Field label="Premium charges (PKR)" hint="Corner, park or boulevard premium.">
            <Text value={f.premiumCharges} onChange={(v) => set({ premiumCharges: v })} placeholder="0" mode="numeric" />
          </Field>
          <Field label="Total price" locked>
            <Readonly>
              {money((Number(f.basePrice.replace(/[^0-9]/g, '')) || 0) + (Number(f.premiumCharges.replace(/[^0-9]/g, '')) || 0))}
            </Readonly>
          </Field>
          <Field label="Internal notes" hint="⚠️ Never included when a property is shared." wide>
            <textarea className={cn(FIELD, 'h-[5rem] py-[0.5rem]')} style={{ borderColor: cv('line'), color: cv('ink') }}
                      value={f.notes} onChange={(e) => set({ notes: e.target.value })}
                      placeholder="Anything the team should know. Stays inside the company." />
          </Field>
        </div>
      )}

      {step === 2 && <DocumentSlots />}

      {step === 3 && (
        <Review form={f} standard={standard} projectName={project?.name ?? '—'} />
      )}

      {error ? (
        <p className="mt-3 flex items-start gap-2 text-[0.85rem]" style={{ color: cv('red') }}>
          <AlertTriangle className="mt-[0.1rem] size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

function Stepper({ at, onGo }: { at: number; onGo: (i: number) => void }) {
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-x-[0.5rem] gap-y-2">
      {STEPS.map((label, i) => (
        <React.Fragment key={label}>
          <li>
            <button
              type="button"
              onClick={() => onGo(i)}
              className="inline-flex items-center gap-[0.45rem] text-[0.84rem] font-medium"
              style={{ color: i <= at ? cv('ink') : cv('mute') }}
            >
              <span className="grid size-[1.6rem] place-items-center rounded-full text-[0.78rem] font-semibold"
                    style={i < at ? { background: cv('green-dot'), color: '#fff' }
                          : i === at ? { background: cv('brand'), color: cv('on-brand') }
                          : { background: cv('pill'), color: cv('mute') }}>
                {i < at ? <Check className="size-[0.8rem]" strokeWidth={3} aria-hidden="true" /> : i + 1}
              </span>
              {label}
            </button>
          </li>
          {i < STEPS.length - 1 && <span className="h-px w-[2rem]" style={{ background: cv('line') }} aria-hidden="true" />}
        </React.Fragment>
      ))}
    </ol>
  );
}

function Tick({ label, on, onFlip }: { label: string; on: boolean; onFlip: () => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-[0.4rem] text-[0.86rem]" style={{ color: cv('ink') }}>
      <input type="checkbox" checked={on} onChange={onFlip}
             className="size-[1.05rem] cursor-pointer rounded-[0.25rem]" style={{ accentColor: 'var(--cl-brand)' }} />
      {label}
    </label>
  );
}

/* ⚠️ SLOTS, NOT A GENERATOR. The owner's instruction about legal papers is a
   legal point: *"Do not generate dummy NOCs, title documents or government
   approvals."* Nothing here makes a document; it names the three a plot carries
   and says plainly when one is missing. */
function DocumentSlots() {
  return (
    <div className="space-y-2">
      <p className="text-[0.85rem]" style={{ color: cv('soft') }}>
        Upload these after the plot is saved — the property sheet and site plan are files the scheme
        supplies, and the payment plan is generated from the price.
      </p>
      <ul className="divide-y rounded-[0.5rem] border" style={{ borderColor: cv('line') }}>
        {['Property sheet', 'Site plan', 'Payment plan'].map((d) => (
          <li key={d} className="flex items-center justify-between gap-2 px-3 py-[0.6rem] text-[0.88rem]"
              style={{ borderColor: cv('grid') }}>
            <span className="inline-flex items-center gap-[0.45rem]" style={{ color: cv('ink') }}>
              <FileText className="size-[0.95rem]" style={{ color: cv('mute') }} aria-hidden="true" />
              {d}
            </span>
            <span className="text-[0.8rem]" style={{ color: cv('mute') }}>Not uploaded</span>
          </li>
        ))}
      </ul>
      <p className="text-[0.78rem]" style={{ color: cv('mute') }}>
        Allotment letters, agreements, NOCs and title documents are never generated here.
      </p>
    </div>
  );
}

function Review({ form, standard, projectName }: { form: FormValues; standard: number; projectName: string }) {
  const marla = Number(form.sizeMarla);
  const check = areaCheck(marla, standard, Number(form.widthFt), Number(form.lengthFt));
  const rows: readonly [string, string][] = [
    ['Project', projectName],
    ['Property ID', form.code || '—'],
    ['Plot number', form.plotNumber || '—'],
    ['Block', form.block || '—'],
    ['Type', form.kind || '—'],
    ['Size', sizeLabel(marla)],
    ['Total area', areaLabel(areaSqft(marla, standard))],
    ['Dimensions', check.fromDimensions !== null ? `${form.widthFt} × ${form.lengthFt} ft` : '—'],
    ['Facing', form.facing || '—'],
    ['Road width', form.roadWidthFt ? `${form.roadWidthFt} ft` : '—'],
    ['Category', form.category],
    ['Features', [form.isCorner && 'Corner', form.isParkFacing && 'Park facing', form.isMainBoulevard && 'Main boulevard']
      .filter(Boolean).join(' · ') || 'None'],
    ['Base price', money(Number(form.basePrice.replace(/[^0-9]/g, '')) || 0)],
    ['Premium', money(Number(form.premiumCharges.replace(/[^0-9]/g, '')) || 0)],
    ['Status', statusLook(form.status).label],
    ['Development', form.developmentStatus || '—'],
    ['Expected possession', form.expectedPossession || '—'],
  ];

  return (
    <div className="space-y-3">
      {!check.match && check.deltaPct !== null && (
        <p className="flex items-start gap-2 rounded-[0.45rem] px-3 py-2 text-[0.85rem]"
           style={{ background: cv('amber-soft'), color: cv('amber') }}>
          <AlertTriangle className="mt-[0.1rem] size-4 shrink-0" aria-hidden="true" />
          {check.note} You can still save it.
        </p>
      )}
      <div className="grid gap-x-5 gap-y-[0.25rem] rounded-[0.5rem] border p-3 sm:grid-cols-2" style={{ borderColor: cv('line') }}>
        {rows.map(([k, v]) => (
          <p key={k} className="flex items-baseline justify-between gap-3 text-[0.84rem]">
            <span style={{ color: cv('soft') }}>{k}</span>
            <span className="min-w-0 truncate text-right font-medium" style={{ color: cv('ink') }}>{v}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * EDIT — tabbed, with a reason and a preview of what moves
 * ------------------------------------------------------------------------- */

const TABS = ['Details', 'Features', 'Pricing', 'Availability', 'Documents'] as const;

export function formFromRow(row: PropertyRow): FormValues {
  const nums = (row.dimensions ?? '').match(/\d+(?:\.\d+)?/g) ?? [];
  return {
    projectId: row.projectId,
    code: row.code,
    plotNumber: row.plotNumber ?? '',
    block: row.block ?? '',
    kind: row.kind ?? '',
    sizeMarla: row.sizeMarla != null ? String(row.sizeMarla) : '',
    widthFt: nums[0] ?? '',
    lengthFt: nums[1] ?? '',
    category: row.category ?? 'Standard',
    isCorner: row.isCorner,
    isParkFacing: row.isParkFacing,
    isMainBoulevard: row.isMainBoulevard,
    facing: row.facing ?? '',
    roadWidthFt: row.roadWidthFt != null ? String(row.roadWidthFt) : '',
    basePrice: row.basePrice != null ? String(row.basePrice) : '',
    premiumCharges: String(row.premiumCharges ?? 0),
    status: row.status,
    developmentStatus: row.developmentStatus ?? '',
    expectedPossession: (row.expectedPossession ?? '').slice(0, 10),
    notes: row.notes ?? '',
  };
}

/** The values a person reads, which is what the preview compares. */
function shown(f: FormValues, standard: number): Record<string, string> {
  return {
    'Plot number': f.plotNumber,
    Block: f.block,
    Size: sizeLabel(Number(f.sizeMarla)),
    'Total area': areaLabel(areaSqft(Number(f.sizeMarla), standard)),
    Dimensions: f.widthFt && f.lengthFt ? `${f.widthFt} × ${f.lengthFt} ft` : '',
    Facing: f.facing,
    'Road size': f.roadWidthFt ? `${f.roadWidthFt} ft road` : '',
    Category: f.category,
    Corner: f.isCorner ? 'Yes' : 'No',
    'Park facing': f.isParkFacing ? 'Yes' : 'No',
    'Main boulevard': f.isMainBoulevard ? 'Yes' : 'No',
    'Base price': money(Number(f.basePrice.replace(/[^0-9]/g, '')) || 0),
    Premium: money(Number(f.premiumCharges.replace(/[^0-9]/g, '')) || 0),
    Status: statusLook(f.status).label,
    'Development status': f.developmentStatus,
    'Expected possession': f.expectedPossession,
    'Internal notes': f.notes,
  };
}

export function EditPropertyDialog({
  open, onClose, row, projects, busy, error, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  row: PropertyRow | null;
  projects: readonly ProjectOption[];
  busy: boolean;
  error: string | null;
  onSubmit: (form: PropertyForm, reason: string, draft: boolean) => void;
}) {
  const original = React.useMemo(() => (row ? formFromRow(row) : BLANK_FORM), [row]);
  const [f, setF] = React.useState<FormValues>(original);
  const [tab, setTab] = React.useState<(typeof TABS)[number]>('Details');
  const [reason, setReason] = React.useState('');

  const seen = React.useRef(original);
  if (seen.current !== original) {
    seen.current = original;
    setF(original);
    setTab('Details');
    setReason('');
  }

  const set = (patch: Partial<FormValues>) => setF((c) => ({ ...c, ...patch }));
  const standard = row?.marlaStandard ?? projects.find((p) => p.id === f.projectId)?.marlaStandard ?? 225;
  const changes = propertyChanges(shown(original, standard), shown(f, standard));
  const paperwork = f.status !== original.status ? statusNeedsPaperwork(f.status) : null;

  if (!row) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Edit ${row.code}`}
      size="lg"
      header={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-3">
            <span className="grid size-[2.6rem] shrink-0 place-items-center rounded-[0.55rem]" style={{ background: cv('tile') }}>
              <Pencil className="size-[1.2rem]" style={{ color: cv('tile-ink') }} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[1.25rem] font-bold leading-tight" style={{ color: cv('ink') }}>Edit property</span>
              <span className="block text-[0.86rem]" style={{ color: cv('soft') }}>
                {row.code} · Plot {row.plotNumber} {row.block ? `· Block ${row.block}` : ''}
              </span>
            </span>
          </span>
          <span
            className="inline-flex items-center gap-[0.4rem] rounded-full px-[0.7rem] py-[0.28rem] text-[0.8rem] font-medium"
            style={{ background: cv(`${statusLook(f.status).tone}-bg`), color: cv(statusLook(f.status).tone) }}
          >
            <span className="size-[0.45rem] rounded-full" style={{ background: cv(`${statusLook(f.status).tone}-dot`) }} aria-hidden="true" />
            {statusLook(f.status).label}
          </span>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[0.8rem]" style={{ color: cv('mute') }}>
            {changes.length === 0 ? 'Nothing has changed yet.' : `${changes.length} field${changes.length === 1 ? '' : 's'} will change.`}
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>Cancel</button>
            <button type="button" disabled={busy} onClick={() => onSubmit({ ...f, marlaStandard: standard, isDraft: true }, reason, true)}
                    className={`${OUTLINE} h-[2.4rem] px-4 text-[0.93rem]`} style={outlineStyle}>Save draft</button>
            <button
              type="button"
              /* ⚠️ A reason is required the moment something actually moves — not
                 on every open. Asking why nothing changed teaches people to type
                 a full stop to get past it. */
              disabled={busy || changes.length === 0 || reason.trim().length < 3}
              onClick={() => onSubmit({ ...f, marlaStandard: standard, isDraft: false }, reason, false)}
              className={`${SOLID} h-[2.4rem] px-5 text-[0.93rem]`}
              style={solidStyle}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </span>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-[1.2rem] border-b" style={{ borderColor: cv('line') }} role="tablist">
        {TABS.map((t) => {
          const on = tab === t;
          return (
            <button key={t} type="button" role="tab" aria-selected={on} onClick={() => setTab(t)}
                    className="relative -mb-px h-[2.3rem] text-[0.92rem] font-medium"
                    style={{ color: on ? cv('brand-ink') : cv('soft') }}>
              {t}
              {on && <span className="absolute inset-x-0 -bottom-px block h-[0.13rem] rounded-full" style={{ background: cv('brand') }} />}
            </button>
          );
        })}
      </div>

      <div className="grid gap-[0.9rem] lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-[0.8rem]">
          {tab === 'Details' && (
            <div className="grid gap-[0.8rem] sm:grid-cols-3">
              <Field label="Plot number" required><Text value={f.plotNumber} onChange={(v) => set({ plotNumber: v })} /></Field>
              <Field label="Block" required><Text value={f.block} onChange={(v) => set({ block: v })} /></Field>
              <Field label="Size" required>
                <Select label="Size" value={f.sizeMarla} onChange={(v) => set({ sizeMarla: v })} className="h-[2.5rem] w-full">
                  {SIZES.map((s) => <option key={s.marla} value={s.marla}>{s.label}</option>)}
                </Select>
              </Field>
              <Field label="Marla standard" locked hint="Set on the project."><Readonly>{standard} sq ft</Readonly></Field>
              <Field label="Area (calculated)" locked><Readonly>{areaLabel(areaSqft(Number(f.sizeMarla), standard))}</Readonly></Field>
              <FieldBlock label="Dimensions" required>
                <span className="flex items-center gap-[0.35rem]">
                  <input aria-label="Width (ft)" className={FIELD} style={{ borderColor: cv('line'), color: cv('ink') }}
                         value={f.widthFt} onChange={(e) => set({ widthFt: e.target.value })} inputMode="decimal" />
                  <span style={{ color: cv('mute') }}>×</span>
                  <input aria-label="Length (ft)" className={FIELD} style={{ borderColor: cv('line'), color: cv('ink') }}
                         value={f.lengthFt} onChange={(e) => set({ lengthFt: e.target.value })} inputMode="decimal" />
                </span>
              </FieldBlock>
              <Field label="Facing" required>
                <Select label="Facing" value={f.facing} onChange={(v) => set({ facing: v })} className="h-[2.5rem] w-full">
                  <option value="">Not recorded</option>
                  {FACINGS.map((x) => <option key={x} value={x}>{x}</option>)}
                </Select>
              </Field>
              <Field label="Road size" required>
                <Select label="Road size" value={f.roadWidthFt ? `${f.roadWidthFt} ft road` : ''}
                        onChange={(v) => set({ roadWidthFt: v.replace(/[^0-9]/g, '') })} className="h-[2.5rem] w-full">
                  <option value="">Not recorded</option>
                  {ROADS.map((x) => <option key={x} value={x}>{x}</option>)}
                </Select>
              </Field>
              <Field label="Category" required>
                <Select label="Category" value={f.category} onChange={(v) => set({ category: v })} className="h-[2.5rem] w-full">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
            </div>
          )}

          {tab === 'Features' && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-[1.2rem]">
                <Tick label="Corner" on={f.isCorner} onFlip={() => set({ isCorner: !f.isCorner })} />
                <Tick label="Park facing" on={f.isParkFacing} onFlip={() => set({ isParkFacing: !f.isParkFacing })} />
                <Tick label="Main boulevard" on={f.isMainBoulevard} onFlip={() => set({ isMainBoulevard: !f.isMainBoulevard })} />
              </div>
              <Field label="Property type"><Text value={f.kind} onChange={(v) => set({ kind: v })} /></Field>
              <Field label="Internal notes" hint="⚠️ Never included when a property is shared.">
                <textarea className={cn(FIELD, 'h-[5rem] py-[0.5rem]')} style={{ borderColor: cv('line'), color: cv('ink') }}
                          value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
              </Field>
            </div>
          )}

          {tab === 'Pricing' && (
            <div className="rounded-[0.5rem] border p-[0.7rem]" style={{ borderColor: cv('line') }}>
              <h4 className="mb-[0.6rem] text-[0.95rem] font-semibold" style={{ color: cv('ink') }}>Pricing (PKR)</h4>
              <div className="grid gap-[0.8rem] sm:grid-cols-3">
                <Field label="Base price" required><Text value={f.basePrice} onChange={(v) => set({ basePrice: v })} mode="numeric" /></Field>
                <Field label="Premium"><Text value={f.premiumCharges} onChange={(v) => set({ premiumCharges: v })} mode="numeric" /></Field>
                <Field label="Total price" locked>
                  <Readonly>{money((Number(f.basePrice.replace(/[^0-9]/g, '')) || 0) + (Number(f.premiumCharges.replace(/[^0-9]/g, '')) || 0))}</Readonly>
                </Field>
              </div>
            </div>
          )}

          {tab === 'Availability' && (
            <div className="grid gap-[0.8rem] sm:grid-cols-2">
              <Field label="Status" required>
                <Select label="Status" value={f.status} onChange={(v) => set({ status: v })} className="h-[2.5rem] w-full">
                  {SELECTABLE_STATUSES.map((s) => <option key={s} value={s}>{statusLook(s).label}</option>)}
                </Select>
              </Field>
              <Field label="Development status" required>
                <Select label="Development status" value={f.developmentStatus} onChange={(v) => set({ developmentStatus: v })} className="h-[2.5rem] w-full">
                  <option value="">Not recorded</option>
                  {DEV_STATES.map((x) => <option key={x} value={x}>{x}</option>)}
                </Select>
              </Field>
              <Field label="Expected possession">
                <input type="date" className={FIELD} style={{ borderColor: cv('line'), color: cv('ink') }}
                       value={f.expectedPossession} onChange={(e) => set({ expectedPossession: e.target.value })} />
              </Field>
              <Field label="Active booking" locked>
                <Readonly>{row.activeBooking ?? 'No active booking'}</Readonly>
              </Field>
            </div>
          )}

          {tab === 'Documents' && <DocumentSlots />}

          {/* ── the reason, and what will move ─────────────────────────── */}
          <div className="grid gap-[0.8rem] sm:grid-cols-2">
            <Field label="Change reason" required hint="Saved in this property’s change history.">
              <textarea className={cn(FIELD, 'h-[4rem] py-[0.5rem]')} style={{ borderColor: cv('line'), color: cv('ink') }}
                        value={reason} onChange={(e) => setReason(e.target.value)}
                        placeholder="Correct road width after inventory review." />
            </Field>
            <div>
              <p className="mb-[0.3rem] text-[0.78rem] font-medium" style={{ color: cv('soft') }}>Change preview</p>
              <div className="max-h-[7rem] overflow-y-auto rounded-[0.45rem] border" style={{ borderColor: cv('line') }}>
                {changes.length === 0 ? (
                  <p className="px-3 py-2 text-[0.82rem]" style={{ color: cv('mute') }}>Nothing has changed yet.</p>
                ) : (
                  changes.map((c) => (
                    <p key={c.field} className="flex items-center gap-2 border-b px-3 py-[0.35rem] text-[0.8rem] last:border-b-0"
                       style={{ borderColor: cv('grid') }}>
                      <span className="w-[8rem] shrink-0 truncate" style={{ color: cv('soft') }}>{c.field}</span>
                      <span className="min-w-0 flex-1 truncate" style={{ color: cv('mute') }}>{c.from}</span>
                      <ArrowRight className="size-[0.8rem] shrink-0" style={{ color: cv('mute') }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate font-medium" style={{ color: cv('ink') }}>{c.to}</span>
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>

          {paperwork && (
            <p className="flex items-start gap-2 rounded-[0.45rem] px-3 py-2 text-[0.83rem]"
               style={{ background: cv('amber-soft'), color: cv('amber') }}>
              <AlertTriangle className="mt-[0.1rem] size-4 shrink-0" aria-hidden="true" />
              <span>
                {paperwork} Status history is never overwritten, and every change here is logged.
              </span>
            </p>
          )}

          {error ? (
            <p className="flex items-start gap-2 text-[0.85rem]" style={{ color: cv('red') }}>
              <AlertTriangle className="mt-[0.1rem] size-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          ) : null}
        </div>

        {/* Quick update, as the reference draws it */}
        <aside className="rounded-[0.6rem] border p-[0.8rem]" style={{ borderColor: cv('line'), background: cv('strip') }}>
          <h4 className="mb-[0.6rem] text-[0.95rem] font-semibold" style={{ color: cv('ink') }}>Quick update</h4>
          <div className="space-y-[0.7rem]">
            <Field label="Status" required>
              <Select label="Status" value={f.status} onChange={(v) => set({ status: v })} className="h-[2.5rem] w-full">
                {SELECTABLE_STATUSES.map((s) => <option key={s} value={s}>{statusLook(s).label}</option>)}
              </Select>
            </Field>
            <Field label="Development status" required>
              <Select label="Development status" value={f.developmentStatus} onChange={(v) => set({ developmentStatus: v })} className="h-[2.5rem] w-full">
                <option value="">Not recorded</option>
                {DEV_STATES.map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
            </Field>
            <p className="text-[0.78rem]" style={{ color: cv('mute') }}>
              Last updated {(row.updatedAt ?? '').slice(0, 10) || '—'}
            </p>
          </div>
        </aside>
      </div>
    </Dialog>
  );
}
