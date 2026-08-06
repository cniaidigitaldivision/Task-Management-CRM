/* ============================================================================
 * THE CONTROL SCALE — one size system for every interactive element
 * ----------------------------------------------------------------------------
 * ⛔ Every button, select, input, chip and toggle imports its dimensions from
 *    here. No component sets its own height, padding or radius.
 *
 * ── WHY THIS FILE EXISTS (owner feedback, Session 08) ────────────────────────
 *   "Some buttons are big and some are small. Some buttons and some dropdowns
 *    are bigger than the normal screen."
 *
 * Both complaints had the same cause. The tasks toolbar put five controls in
 * one row and each was styled by hand:
 *
 *     segmented buttons   px-2  py-1    →  ~30px
 *     native <select>     h-8           →   32px, plus whatever the OS adds
 *     hide-closed toggle  px-2.5 py-1.5 →  ~28px
 *     filter chip         px-2.5 py-1.5 →  ~30px
 *     <Button size="md">  h-9           →   36px
 *
 * Four different heights on one line. Nothing was "wrong" individually; the row
 * was ragged because there was no shared scale to be wrong against.
 *
 * A scale in a file is enforceable. A convention in someone's head is not.
 * ========================================================================= */

export type ControlSize = 'sm' | 'md' | 'lg';

/**
 * 32 / 36 / 44px.
 *
 * `md` is the default for anything a person aims at with a mouse. `sm` is for
 * dense toolbars where controls sit in a row together. `lg` is for the primary
 * action on an otherwise empty screen — sign-in, activation, empty states.
 *
 * 44px is not arbitrary: it is the minimum comfortable touch target, so `lg`
 * is also what mobile-first surfaces use (NFR-007).
 */
export const CONTROL_HEIGHT: Readonly<Record<ControlSize, string>> = {
  sm: 'h-8',
  md: 'h-9',
  lg: 'h-11',
};

/** Horizontal padding, paired to the height so proportions stay constant. */
export const CONTROL_PADDING: Readonly<Record<ControlSize, string>> = {
  sm: 'px-2.5',
  md: 'px-3.5',
  lg: 'px-5',
};

export const CONTROL_TEXT: Readonly<Record<ControlSize, string>> = {
  sm: 'text-caption',
  md: 'text-body-sm',
  lg: 'text-body',
};

/** Gap between an icon and its label. */
export const CONTROL_GAP: Readonly<Record<ControlSize, string>> = {
  sm: 'gap-1.5',
  md: 'gap-2',
  lg: 'gap-2',
};

/** Icon dimensions inside a control. */
export const CONTROL_ICON: Readonly<Record<ControlSize, string>> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-[18px] w-[18px]',
};

/** Square icon-only controls. Same heights, so a row never goes ragged. */
export const CONTROL_SQUARE: Readonly<Record<ControlSize, string>> = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
};

/** One radius for every control. Tight enough to match the faceted mark. */
export const CONTROL_RADIUS = 'rounded-lg';

/** The default resting surface: bordered, on the card colour, barely raised. */
export const CONTROL_SURFACE =
  'border border-border-default bg-bg-surface shadow-xs transition-[background-color,border-color,box-shadow,transform] duration-[140ms]';

/**
 * Shared by every control so nothing can be sized independently by accident.
 * `shrink-0` matters as much as the rest: without it, flexbox squashes controls
 * unevenly in a crowded toolbar, which is the other half of "some are big and
 * some are small".
 */
export const CONTROL_BASE =
  'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45';

export function controlClasses(size: ControlSize): string {
  return [
    CONTROL_BASE,
    CONTROL_RADIUS,
    CONTROL_HEIGHT[size],
    CONTROL_PADDING[size],
    CONTROL_TEXT[size],
    CONTROL_GAP[size],
  ].join(' ');
}
