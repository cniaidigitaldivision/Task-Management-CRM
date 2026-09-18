'use client';

import * as React from 'react';
import { Loader2, Mail, MapPin, Phone, Tag, User, X } from 'lucide-react';

import { updateLeadDetailsAction } from '@/app/actions/crm-leads';
import { useToast } from '@/components/ui/toast';
import type { CrmLeadRecord } from '@/lib/db/queries/crm-leads';
import { cn } from '@/lib/utils';

/* ============================================================================
 * CORRECTING WHAT WE KNOW ABOUT THE PERSON
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-18: *"add the edit option for things like phone number, email,
 * for example, if I want to change it, or their name, their interest… when I
 * contact him and he gives me a correct number or a correct email, I want to add
 * that information."*
 *
 * So it is five fields and nothing else: the name, the number, the address, the
 * city, and what they are after. Stage, owner and temperature are decisions with
 * their own controls elsewhere; putting them in a form called "Edit details"
 * would make a correction look like a change of plan.
 *
 * ⚠️ WHAT IS BEING REPLACED IS SHOWN. Every field starts with what is on record
 * and says so underneath once it differs, because the commonest way this goes
 * wrong is somebody overwriting a good number with a worse one from memory.
 *
 * ⚠️ AND IT LEAVES A NOTE. `crmUpdateLeadDetails` writes "Phone: 0300 1234567 →
 * 0321 7654321" into the lead's notes, in the same transaction, so the timeline
 * says when the number moved. A record that can be edited silently is a record
 * nobody can trust.
 * ========================================================================= */

export function EditLeadDetails({
  lead,
  onClose,
}: {
  lead: CrmLeadRecord;
  onClose: () => void;
}) {
  const toast = useToast();
  const [fullName, setFullName] = React.useState(lead.fullName ?? '');
  const [phone, setPhone] = React.useState(lead.phone ?? '');
  const [email, setEmail] = React.useState(lead.email ?? '');
  const [city, setCity] = React.useState(lead.city ?? '');
  const [interest, setInterest] = React.useState(lead.answers?.interest ?? '');
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await updateLeadDetailsAction({
        leadId: lead.id,
        fullName,
        phone,
        email,
        city,
        interest,
      });
      if (!result.ok) {
        toast({ tone: 'error', text: result.error ?? 'That did not save.' });
        return;
      }
      toast({
        tone: 'ok',
        text:
          result.changed === 0
            ? 'Nothing had changed.'
            : `${result.changed} detail${result.changed === 1 ? '' : 's'} corrected, and noted on the timeline.`,
      });
      /* ⚠️ NO RE-READ FROM HERE. `updateLeadDetailsAction` revalidates
         `/my-leads` and the lead's own page, so the drawer and the desk both come
         back with the correction — the same arrangement `RecordOutcome` uses. A
         second mechanism would be a second thing to keep in step. */
      onClose();
    } catch {
      toast({ tone: 'error', text: 'That did not save — the connection dropped.' });
    } finally {
      setSaving(false);
    }
  };

  /* ⚠️ ESCAPE CLOSES THIS, NOT THE DRAWER BEHIND IT. `stopPropagation` on the
     capture phase, the same arrangement the Related items dialog uses. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Edit the lead's details"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border-subtle bg-bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-border-subtle px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-bg-subtle text-text-secondary">
            <User className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-body font-semibold text-text-primary">Edit details</h2>
            <p className="truncate text-caption text-text-secondary">
              What we know about {lead.fullName ?? 'this lead'}. Every change is noted on the timeline.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-bg-subtle hover:text-text-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-3 px-5 py-4">
          <Field label="Name" icon={User} value={fullName} was={lead.fullName} onChange={setFullName} placeholder="Their full name" />
          <Field
            label="Phone"
            icon={Phone}
            value={phone}
            was={lead.phone}
            onChange={setPhone}
            placeholder="0300 1234567"
            type="tel"
            hint="What WhatsApp and every call button use."
          />
          <Field
            label="Email"
            icon={Mail}
            value={email}
            was={lead.email}
            onChange={setEmail}
            placeholder="name@example.com"
            type="email"
            hint="Quotations and follow-up emails go here."
          />
          <Field label="City" icon={MapPin} value={city} was={lead.city} onChange={setCity} placeholder="Islamabad" />
          <Field
            label="Interest"
            icon={Tag}
            value={interest}
            was={lead.answers?.interest ?? null}
            onChange={setInterest}
            placeholder="5 Marla plot, Block A"
            hint="What they are after, in their own words."
          />
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[2.5rem] items-center rounded-lg border border-border-default bg-bg-surface px-4 text-body-sm font-semibold text-text-primary transition-colors hover:bg-bg-subtle"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="inline-flex min-h-[2.5rem] items-center gap-2 rounded-lg bg-accent-primary px-4 text-body-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  value,
  was,
  onChange,
  placeholder,
  hint,
  type = 'text',
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
  value: string;
  was: string | null;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
}) {
  const changed = (was ?? '') !== value.trim();
  return (
    <label className="block">
      <span className="text-caption text-text-secondary">{label}</span>
      <span
        className={cn(
          'mt-1 flex items-center gap-2 rounded-lg border bg-bg-base px-3 py-2',
          changed ? 'border-accent-primary' : 'border-border-default',
        )}
      >
        <Icon className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-body-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
        />
      </span>
      {/* ⚠️ ONLY ONCE IT DIFFERS, and it says what is being replaced. */}
      {changed ? (
        <span className="mt-1 block truncate text-caption text-text-secondary">
          Replacing <span className="font-medium text-text-primary">{was?.trim() || 'nothing'}</span>
        </span>
      ) : hint ? (
        <span className="mt-1 block truncate text-caption text-text-tertiary">{hint}</span>
      ) : null}
    </label>
  );
}
