'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

import { updateProfileAction, type PeopleActionResult } from '@/app/actions/people';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DEFAULT_TIMEZONE } from '@/lib/domain/constants';

/* ============================================================================
 * YOUR OWN DETAILS
 * ----------------------------------------------------------------------------
 * No permission check, and that is not an oversight: `updateProfileAction` writes
 * to `app.current_user_id()` and nothing else. There is no id in the form to
 * tamper with, so there is no wider scope to reach for.
 * ========================================================================= */

const EMPTY: PeopleActionResult = { ok: false };

/* The timezones this team plausibly works across. A full IANA list is 400+
   entries in a dropdown nobody scrolls; ADR-004 fixes the team's calendar to
   Asia/Karachi and these cover the realistic exceptions. */
const TIMEZONES = [
  DEFAULT_TIMEZONE,
  'Asia/Dubai',
  'Asia/Riyadh',
  'Europe/London',
  'America/New_York',
  'UTC',
];

export function ProfileForm({
  defaults,
}: {
  defaults: { fullName: string; phone: string; timezone: string };
}) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState(updateProfileAction, EMPTY);

  /* "Saved" is derived from the action's own result, not tracked in state. The
     effect below only tells the router to re-read — it sets nothing, so there is
     no cascading render to avoid.

     The confirmation stays until the next submission rather than fading after
     four seconds. A timer would need state, and a message that disappears on its
     own is one somebody who looked away never sees. */
  const saved = state.ok;

  React.useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg px-3 py-2.5"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--feedback-error) var(--tint-soft), var(--bg-surface))',
            border: '1px solid color-mix(in oklab, var(--feedback-error) 32%, transparent)',
          }}
        >
          <AlertTriangle
            className="mt-px h-4 w-4 shrink-0"
            style={{ color: 'var(--feedback-error)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="text-caption text-text-primary">{state.error}</p>
        </div>
      )}

      {saved && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2.5"
          style={{
            backgroundColor:
              'color-mix(in oklab, var(--feedback-success) var(--tint-soft), var(--bg-surface))',
            border: '1px solid color-mix(in oklab, var(--feedback-success) 32%, transparent)',
          }}
        >
          <CheckCircle2
            className="h-4 w-4 shrink-0"
            style={{ color: 'var(--feedback-success)' }}
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="text-caption text-text-primary">Saved.</p>
        </div>
      )}

      <Field label="Your name" htmlFor="fullName">
        <Input id="fullName" name="fullName" defaultValue={defaults.fullName} required />
      </Field>

      <Field
        label="Phone"
        htmlFor="phone"
        hint="Optional. Used only for WhatsApp notifications, if those are ever switched on."
      >
        <Input id="phone" name="phone" type="tel" defaultValue={defaults.phone} />
      </Field>

      <Field
        label="Timezone"
        htmlFor="timezone"
        hint="The team calendar is Monday–Saturday, 09:00–17:00 Asia/Karachi (ADR-004). This only affects how times are shown to you."
      >
        <Select size="md" id="timezone" name="timezone" defaultValue={defaults.timezone}>
          {TIMEZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </Field>

      <Button type="submit" variant="primary" size="md" disabled={pending}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        {pending ? 'Saving…' : 'Save changes'}
      </Button>

      <p className="text-micro text-text-tertiary">
        Your email is your sign-in identity and changing it needs a confirmation to both addresses —
        that arrives with the invitation chain (Step 5.2).
      </p>
    </form>
  );
}
