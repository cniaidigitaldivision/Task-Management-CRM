'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { cn } from '@/lib/utils';

import {
  CONTROL_HEIGHT,
  CONTROL_RADIUS,
  CONTROL_SURFACE,
  CONTROL_TEXT,
  type ControlSize,
} from './control';

/* ============================================================================
 * PASSWORD INPUT — the field with the eye on it
 * ----------------------------------------------------------------------------
 * ── WHY IT IS A COMPONENT AND NOT A PROP ON `Input` ──────────────────────────
 * Owner, 2026-08-24: *"in all of the password fields … dots are appearing.
 * There is no eye button."* Every one of the ten password fields in this
 * application was a plain `<Input type="password">`, so somebody typing a
 * sixteen-character passphrase on a phone keyboard had no way to check it
 * before submitting — which is exactly when "Type it again" starts failing for
 * reasons nobody can see.
 *
 * The reveal needs `useState`, and `components/ui/input.tsx` deliberately has no
 * `'use client'` so a server component can still render a `Field`. Adding state
 * there would make every consumer of `Input` a client boundary. So the toggle
 * lives here, in the one file that has to be client-side anyway.
 *
 * ── ONE INPUT ELEMENT, A CHANGING `type` ─────────────────────────────────────
 * ⚠️ Not two inputs swapped by a conditional. React keeps the same DOM node when
 * only an attribute changes, which is what preserves the caret position and the
 * selection through a toggle. Rendering `shown ? <input type="text"> : <input
 * type="password">` remounts the field, sending the cursor to the end and
 * dropping the selection — and on iOS it dismisses the keyboard.
 *
 * ── IT ALWAYS MOUNTS HIDDEN ──────────────────────────────────────────────────
 * The state is local and unpersisted on purpose. A revealed password that
 * survives a remount is a password left on screen in a shared office, and there
 * is no version of "remember that I wanted to see it" worth that.
 *
 * ── THE BROWSER'S OWN EYE IS SUPPRESSED ──────────────────────────────────────
 * Edge draws `::-ms-reveal` inside password fields and Safari can add its own
 * decoration. Left alone, they sit next to this button and the field ends up
 * with two eyes that disagree about state. Hidden below.
 * ========================================================================= */

/* The button is inset inside the field rather than matching its height, so the
   field's own border stays the outer edge. Paired to CONTROL_HEIGHT, and the
   input's right padding is paired to the button — a field whose text runs under
   its own toggle is worse than no toggle. */
const TOGGLE_BOX: Readonly<Record<ControlSize, string>> = {
  sm: 'h-6 w-6 right-1',
  md: 'h-7 w-7 right-1',
  lg: 'h-8 w-8 right-1.5',
};

const TOGGLE_ICON: Readonly<Record<ControlSize, string>> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-[18px] w-[18px]',
};

const INPUT_PAD: Readonly<Record<ControlSize, string>> = {
  sm: 'pr-8',
  md: 'pr-10',
  lg: 'pr-12',
};

export function PasswordInput({
  size = 'md',
  className,
  invalid = false,
  ref,
  disabled,
  /* ── `className` GOES TO THE WRAPPER, NOT THE INPUT ────────────────────────
     Same convention as `SearchInput`, for the same reason: the wrapper is what
     a caller positions (`mt-1.5 w-full`), and the input is what this component
     is responsible for. `inputClassName` is the escape hatch for the rare
     caller that really means the field. */
  inputClassName,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> & {
  size?: ControlSize;
  invalid?: boolean;
  inputClassName?: string;
  ref?: React.Ref<HTMLInputElement>;
}) {
  const [shown, setShown] = React.useState(false);

  return (
    // `min-w-0` is load-bearing in a flex parent — without it the field refuses
    // to shrink below its content width and overflows the dialog it sits in.
    <span className={cn('relative block min-w-0', className)}>
      <input
        ref={ref}
        type={shown ? 'text' : 'password'}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={cn(
          'w-full min-w-0 pl-3 text-text-primary placeholder:text-text-tertiary',
          'focus-visible:outline-none',
          /* Edge's and Safari's built-in reveal controls, suppressed so this
             button is the only eye in the field. */
          '[&::-ms-reveal]:hidden [&::-ms-clear]:hidden',
          INPUT_PAD[size],
          CONTROL_HEIGHT[size],
          CONTROL_TEXT[size],
          CONTROL_RADIUS,
          CONTROL_SURFACE,
          invalid
            ? 'border-[var(--feedback-error)] focus:border-[var(--feedback-error)]'
            : 'hover:border-border-strong focus:border-border-brand focus:bg-bg-surface',
          inputClassName,
        )}
        {...props}
      />
      {/* ⚠️ `type="button"`. The default is `submit`, and every one of these
          fields sits in a form — an unqualified button here would submit the
          sign-in form the first time somebody tried to look at what they typed.

          It stays in the tab order. Skipping it with `tabIndex={-1}` is a
          common shortcut and it takes the feature away from precisely the
          people who need it most: a keyboard-only user cannot reach it at all.
          Placed after the input in the DOM, so tabbing goes field → eye →
          submit, which is the order they are read in. */}
      <button
        type="button"
        onClick={() => setShown((previous) => !previous)}
        disabled={disabled}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        aria-controls={props.id}
        title={shown ? 'Hide password' : 'Show password'}
        className={cn(
          'absolute top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-md',
          'text-text-tertiary transition-colors duration-[140ms]',
          'hover:bg-bg-surface-sunken hover:text-text-secondary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/50',
          'disabled:pointer-events-none disabled:opacity-45',
          TOGGLE_BOX[size],
        )}
      >
        {shown ? (
          <EyeOff className={TOGGLE_ICON[size]} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Eye className={TOGGLE_ICON[size]} strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>
    </span>
  );
}
