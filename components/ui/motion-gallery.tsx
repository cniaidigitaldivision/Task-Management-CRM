import { CountUp } from './count-up';
import { Reveal } from './motion';

/* ============================================================================
 * MOTION GALLERY — for /design-system
 * ----------------------------------------------------------------------------
 * The theme wipe is not demonstrated here, because it has nowhere better to be
 * demonstrated than the real control: press either card under **Theming** below
 * and the circle grows from the card that was pressed. A second toggle on this
 * page would be a second thing to keep in step for no gain.
 * ========================================================================= */

const FIGURES = [
  { label: 'Tasks completed', value: 1284, unit: 'this quarter' },
  { label: 'On time', value: 94.6, unit: 'per cent', decimal: true },
  { label: 'Active projects', value: 37, unit: 'across five clients' },
  { label: 'Hours logged', value: 2160, unit: 'this quarter' },
] as const;

export function MotionGallery() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
          Figures that arrive
        </p>
        <Reveal className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FIGURES.map((figure) => (
            <div
              key={figure.label}
              className="grain panel-lit h-full rounded-xl border border-border-default bg-bg-surface p-4 shadow-sm"
            >
              <p className="truncate text-micro font-semibold tracking-[0.07em] text-text-tertiary uppercase">
                {figure.label}
              </p>
              <p className="mt-2 text-[1.75rem] leading-none font-semibold tracking-tight text-text-primary">
                <CountUp
                  value={figure.value}
                  format={'decimal' in figure ? 'percent' : 'integer'}
                />
              </p>
              <p className="mt-1.5 text-micro text-text-tertiary">{figure.unit}</p>
            </div>
          ))}
        </Reveal>
        <p className="text-micro text-text-tertiary">
          Both at once — the cards land 55ms apart and each figure counts up as its card arrives.
          Reload the page to see it again. The count eases out rather than running linearly: a linear
          count reads as a stopwatch. Under{' '}
          <code className="font-mono">prefers-reduced-motion</code> the cards are simply there and
          the figures are simply right.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
          The rule the count obeys
        </p>
        <div className="rounded-xl border border-border-default bg-bg-surface p-4">
          <p className="max-w-3xl text-body-sm text-text-secondary">
            The animation is never what decides which number appears. The server renders the real
            figure, so it is correct with JavaScript disabled; the final frame is assigned rather
            than interpolated, so an interrupted count still ends on the truth; and a figure that
            changes while it is counting continues from where the screen already was instead of
            falling to zero and climbing back. A decorative animation has to fail towards the
            truth — which is why one frame of the real number may show before the count starts,
            rather than a zero showing before the number is known.
          </p>
        </div>
      </div>
    </div>
  );
}
