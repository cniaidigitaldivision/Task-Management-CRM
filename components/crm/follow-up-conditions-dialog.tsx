'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  Ban,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  Info,
  Loader2,
  Lock,
  Mail,
  MinusCircle,
  ShieldCheck,
  Users,
  X,
  XCircle,
} from 'lucide-react';

import { followUpConditionsAction, saveFollowUpConditionsAction } from '@/app/actions/crm-followup-board';
import { ink, tint } from '@/components/crm/appointments-board-parts';
import { useToast } from '@/components/ui/toast';
import {
  CONDITION_ROWS,
  editFrom,
  FIXED_ROWS,
  GAP_OPTIONS,
  isDefault,
  isUnchanged,
  liveChecks,
  ON_OPT_OUT_OPTIONS,
  ON_QUOTE_EXPIRED_OPTIONS,
  ON_REPLY_OPTIONS,
  shown,
  toggle,
  verdict,
  type ConditionEdit,
  type FollowUpConditions,
} from '@/lib/domain/crm-followup-conditions';
import { purposeLabel } from '@/lib/domain/crm-followup-plans';
import { cn } from '@/lib/utils';

/* ============================================================================
 * FOLLOW-UP CONDITIONS — the owner's design, 2026-09-22
 * ----------------------------------------------------------------------------
 * *"These are basically follow-up checks or, you can say, advanced settings.
 * There will be some button and when I click it that modal will appear.
 * Properly and logically each and everything should be wired up. Right now it
 * should be set to the default, according to the default setting of follow-up,
 * but if I want to change I can change it over here and it will implement
 * accordingly."*
 *
 * ── ⚠️ IT DESCRIBES THE GATE; IT DOES NOT IMPLEMENT IT ─────────────────────
 * Every rule here is enforced by `app.crm_followups_to_send` at the moment of
 * sending (247), and every value shown was resolved by
 * `app.crm_followup_conditions`. This component decides nothing — a second
 * opinion drawn in a dialog is how a screen ends up promising a send that
 * never happens.
 *
 * ── ⚠️ THE RIGHT-HAND COLUMN IS LIVE ──────────────────────────────────────
 * "Before sending" is read back from the database, so a tick means that check
 * passes now. A check somebody switched OFF is drawn as not applied rather
 * than as a tick — a green tick beside a rule nobody enforces is the kind of
 * thing a person acts on.
 *
 * ── ⚠️ RULE ZERO ───────────────────────────────────────────────────────────
 * Opening, toggling and closing are all client state. Exactly one round trip
 * happens on open (to read the resolved set) and one on Save.
 * ========================================================================= */

const CARD = 'rounded-2xl border border-border-subtle bg-bg-surface p-4';
const SELECT =
  'h-9 w-full rounded-xl border border-border-default bg-bg-base px-2.5 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none';

const ROW_ICON = { noReply: Mail, quoteValid: FileText, notBooked: Users } as const;
const FIXED_ICON = { consent: ShieldCheck, leadOpen: Lock } as const;

export function FollowUpConditionsDialog({
  followUpId,
  leadId,
  leadName,
  projectName,
  ownerName,
  propertyLabel,
  dueAt,
  onClose,
  onSaved,
}: {
  followUpId: string;
  leadId: string;
  leadName: string | null;
  projectName: string | null;
  ownerName: string | null;
  propertyLabel: string | null;
  dueAt: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [conditions, setConditions] = React.useState<FollowUpConditions | null>(null);
  const [edit, setEdit] = React.useState<ConditionEdit | null>(null);
  const [saved, setSaved] = React.useState<ConditionEdit | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void followUpConditionsAction(followUpId).then((r) => {
      if (!alive) return;
      if (!r.ok || !r.conditions) {
        setError(r.error ?? 'Those conditions could not be read.');
        return;
      }
      setConditions(r.conditions);
      const e = editFrom(r.conditions);
      setEdit(e);
      setSaved(e);
    });
    return () => {
      alive = false;
    };
  }, [followUpId]);

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

  const save = async () => {
    if (!edit || !conditions) return;
    setSaving(true);
    const r = await saveFollowUpConditionsAction(followUpId, leadId, edit);
    setSaving(false);
    if (!r.ok) {
      toast({ tone: 'error', text: r.error ?? 'Those conditions could not be saved.' });
      return;
    }
    if (r.conditions) {
      setConditions(r.conditions);
      const e = editFrom(r.conditions);
      setEdit(e);
      setSaved(e);
    }
    toast({ tone: 'ok', text: 'Conditions saved — the sender uses these from now on.' });
    onSaved?.();
    onClose();
  };

  const dirty = edit && saved ? !isUnchanged(edit, saved) : false;

  /* ⚠️ PORTALLED. The page column carries a transform (`reveal-children`),
     which becomes the containing block for anything `fixed` inside it — the
     "View lead" panel shipped trapped that way on 2026-09-21. */
  const body = (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Follow-up conditions">
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 bg-black/45" />
      <div className="relative my-auto w-full max-w-4xl rounded-2xl border border-border-subtle bg-bg-surface shadow-xl">
        {/* ── The heading, as drawn ──────────────────────────────────────── */}
        <div className="flex items-start gap-3 px-6 pb-3 pt-5">
          <div className="min-w-0 flex-1">
            <p className="text-caption text-text-secondary">
              {leadName ?? 'This follow-up'} <span className="px-1 text-text-tertiary">/</span> Advanced settings
            </p>
            <h2 className="mt-0.5 text-[1.55rem] font-bold leading-tight text-text-primary">Follow-up conditions</h2>
            <p className="mt-0.5 text-body-sm text-text-secondary">Send only when these checks pass.</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-text-secondary hover:bg-bg-subtle"
          >
            <X className="size-4.5" aria-hidden="true" />
          </button>
        </div>

        {error ? (
          <p className="px-6 pb-6 text-body-sm" style={{ color: ink('red') }}>{error}</p>
        ) : !conditions || !edit ? (
          <div className="grid place-items-center gap-2 px-6 py-16 text-center">
            <Loader2 className="size-5 animate-spin text-text-tertiary" aria-hidden="true" />
            <p className="text-body-sm text-text-secondary">Reading what this follow-up is set to…</p>
          </div>
        ) : (
          <>
            <div className="grid max-h-[calc(100dvh-16rem)] gap-4 overflow-y-auto px-6 pb-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
              {/* ── Left: what may be changed ─────────────────────────── */}
              <div className="space-y-4">
                <section className={CARD}>
                  <h3 className="text-body font-semibold text-text-primary">All conditions must match</h3>
                  <p className="mt-0.5 text-caption text-text-secondary">
                    The follow-up is sent only if all of the checks below are true.
                  </p>
                  <ul className="mt-3 divide-y divide-border-subtle">
                    {CONDITION_ROWS.map((row) => {
                      const Icon = ROW_ICON[row.key];
                      const on = shown(edit, conditions, row.key);
                      return (
                        <li key={row.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                          <Switch
                            on={on}
                            label={row.label}
                            onChange={() => setEdit(toggle(edit, conditions, row.key))}
                          />
                          <Icon className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-body-sm font-semibold text-text-primary">{row.label}</span>
                              {isDefault(edit, row.key) ? (
                                <span className="rounded-full bg-bg-subtle px-1.5 py-0.5 text-caption text-text-secondary">
                                  default
                                </span>
                              ) : (
                                <span
                                  className="rounded-full px-1.5 py-0.5 text-caption font-medium"
                                  style={{ background: tint('blue', 14), color: ink('blue') }}
                                >
                                  your choice
                                </span>
                              )}
                            </span>
                            <span className="block text-caption text-text-secondary">{row.detail}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  {/* ⚠️ The two that are not preferences, and the reason. */}
                  <ul className="mt-3 space-y-2 rounded-xl bg-bg-subtle/60 p-3">
                    {FIXED_ROWS.map((row) => {
                      const Icon = FIXED_ICON[row.key];
                      return (
                        <li key={row.key} className="flex items-start gap-2.5">
                          <span
                            className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full"
                            style={{ background: tint('green', 18) }}
                          >
                            <CheckCircle2 className="size-3.5" style={{ color: ink('green') }} aria-hidden="true" />
                          </span>
                          <Icon className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                          <span className="min-w-0">
                            <span className="block text-body-sm font-semibold text-text-primary">{row.label}</span>
                            <span className="block text-caption text-text-secondary">{row.detail}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>

                <section className={CARD}>
                  <h3 className="text-body font-semibold text-text-primary">If something changes</h3>
                  <p className="mt-0.5 text-caption text-text-secondary">
                    What to do if this happens before the follow-up is sent.
                  </p>
                  <div className="mt-3 space-y-2.5">
                    <Action icon={Users} label="Client replies">
                      <select
                        aria-label="If the client replies"
                        className={SELECT}
                        value={edit.onReply}
                        onChange={(e) => setEdit({ ...edit, onReply: e.target.value as ConditionEdit['onReply'] })}
                      >
                        {ON_REPLY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Action>
                    <Action icon={Ban} label="Client opts out">
                      <select
                        aria-label="If the client opts out"
                        className={SELECT}
                        value={edit.onOptOut}
                        onChange={(e) => setEdit({ ...edit, onOptOut: e.target.value as ConditionEdit['onOptOut'] })}
                      >
                        {ON_OPT_OUT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Action>
                    <Action icon={FileText} label="Quotation expires">
                      <select
                        aria-label="If the quotation expires"
                        className={SELECT}
                        value={edit.onQuoteExpired}
                        onChange={(e) =>
                          setEdit({ ...edit, onQuoteExpired: e.target.value as ConditionEdit['onQuoteExpired'] })
                        }
                      >
                        {ON_QUOTE_EXPIRED_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </Action>
                  </div>
                </section>

                <section className={CARD}>
                  <h3 className="text-body font-semibold text-text-primary">Send limits</h3>
                  {/* ⚠️ RETRIES, NOT MESSAGES TO THE CLIENT. Said plainly here,
                      because "maximum attempts 3" reads like three messages. */}
                  <p className="mt-0.5 text-caption text-text-secondary">
                    How many times to retry if WhatsApp or email refuses it. This is not how many messages the client
                    gets — a follow-up is sent once.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-caption font-semibold text-text-secondary">Maximum attempts</span>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={edit.maxAttempts}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          setEdit({ ...edit, maxAttempts: Number.isFinite(n) ? Math.max(1, Math.min(8, n)) : 8 });
                        }}
                        className={SELECT}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-caption font-semibold text-text-secondary">
                        Minimum gap between attempts
                      </span>
                      <select
                        className={SELECT}
                        value={edit.retryGapMinutes}
                        onChange={(e) => setEdit({ ...edit, retryGapMinutes: Number(e.target.value) })}
                      >
                        {GAP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="mt-2 text-caption text-text-tertiary">
                    Attempted {conditions.attemptsSoFar} time{conditions.attemptsSoFar === 1 ? '' : 's'} so far. It
                    gives up after six hours whatever this says.
                  </p>
                </section>
              </div>

              {/* ── Right: what is true right now ─────────────────────── */}
              <div className="space-y-4">
                <section className={CARD}>
                  <h3 className="text-body font-semibold text-text-primary">Before sending</h3>
                  <p className="mt-0.5 text-caption text-text-secondary">
                    These are checked again the moment it goes out. This is how they stand now.
                  </p>
                  <ul className="mt-3 space-y-2.5">
                    {liveChecks(conditions).map((k) => (
                      <li key={k.label} className="flex items-start gap-2.5">
                        <span
                          className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full"
                          style={{
                            background: !k.applied ? tint('grey', 16) : k.pass ? tint('green', 18) : tint('red', 16),
                          }}
                        >
                          {!k.applied ? (
                            <MinusCircle className="size-3.5 text-text-tertiary" aria-hidden="true" />
                          ) : k.pass ? (
                            <CheckCircle2 className="size-3.5" style={{ color: ink('green') }} aria-hidden="true" />
                          ) : (
                            <XCircle className="size-3.5" style={{ color: ink('red') }} aria-hidden="true" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                'text-body-sm font-semibold',
                                k.applied ? 'text-text-primary' : 'text-text-tertiary',
                              )}
                            >
                              {k.label}
                            </span>
                            {!k.applied && (
                              <span className="rounded-full bg-bg-subtle px-1.5 py-0.5 text-caption text-text-secondary">
                                not applied
                              </span>
                            )}
                          </span>
                          <span className="block text-caption text-text-secondary">{k.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {(() => {
                    const v = verdict(conditions);
                    return (
                      <p
                        className="mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-caption"
                        style={{ background: tint(v.willSend ? 'green' : 'amber', 12) }}
                      >
                        <Info
                          className="mt-0.5 size-3.5 shrink-0"
                          style={{ color: ink(v.willSend ? 'green' : 'amber') }}
                          aria-hidden="true"
                        />
                        <span className="text-text-primary">
                          <strong className="font-semibold">
                            {v.willSend ? 'As things stand, this will send' : 'As things stand, this will not send'}
                          </strong>
                          {` — ${v.because}.`}
                        </span>
                      </p>
                    );
                  })()}
                </section>

                <section className={CARD}>
                  <h3 className="text-body font-semibold text-text-primary">Lead &amp; project</h3>
                  <dl className="mt-3 space-y-1.5 text-body-sm">
                    <Fact label="Lead" value={leadName ?? '—'} />
                    <Fact label="Project" value={projectName ?? '—'} />
                    <Fact label="Owner" value={ownerName ?? '—'} />
                    <Fact label="Stage" value={conditions.leadStage.replace(/_/g, ' ')} />
                    <Fact label="Property" value={propertyLabel ?? 'Not selected'} />
                    <Fact label="Quotation" value={conditions.quotationNumber ?? 'None'} />
                    <Fact label="Purpose" value={purposeLabel(conditions.purpose)} />
                  </dl>
                  <div className="mt-3 space-y-1.5 border-t border-border-subtle pt-3">
                    <p className="flex items-center gap-2 text-body-sm text-text-primary">
                      <Calendar className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                      {new Date(dueAt).toLocaleDateString('en-GB', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        timeZone: 'Asia/Karachi',
                      })}
                    </p>
                    <p className="flex items-center gap-2 text-body-sm text-text-primary">
                      <Clock3 className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                      {new Date(dueAt).toLocaleTimeString('en-GB', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                        timeZone: 'Asia/Karachi',
                      })}
                      <span className="text-caption text-text-secondary">(Asia/Karachi)</span>
                    </p>
                  </div>
                </section>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-6 py-4">
              <p className="min-w-0 flex-1 text-caption text-text-secondary">
                {dirty ? 'Not saved yet.' : 'Saved. The sender checks these again when it goes out.'}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-border-default px-4 py-2 text-body-sm font-medium text-text-primary hover:bg-bg-subtle"
              >
                Back
              </button>
              <button
                type="button"
                disabled={saving || !dirty}
                onClick={() => void save()}
                className="inline-flex items-center gap-2 rounded-xl bg-accent-primary px-4 py-2 text-body-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} Save conditions
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return typeof document === 'undefined' ? body : createPortal(body, document.body);
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={cn(
        'mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors',
        on ? 'bg-accent-primary' : 'bg-border-strong',
      )}
    >
      <span
        className={cn(
          'size-5 rounded-full bg-white shadow-sm transition-transform',
          on ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

function Action({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <span className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bg-subtle">
          <Icon className="size-4 text-text-secondary" />
        </span>
        <span className="min-w-0 truncate text-body-sm text-text-primary">{label}</span>
      </span>
      {children}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-start gap-2">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-text-primary">{value}</dd>
    </div>
  );
}

/** The button that opens it — used by the details panel and anywhere else. */
export function ConditionsButton({ onClick, count }: { onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-caption font-semibold text-text-brand hover:underline"
    >
      <CalendarClock className="size-3.5" aria-hidden="true" />
      Conditions{typeof count === 'number' ? ` (${count})` : ''}
    </button>
  );
}
