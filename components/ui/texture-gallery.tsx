import {
  Skeleton,
  SkeletonHeader,
  SkeletonKpiRow,
  SkeletonList,
  SkeletonTable,
  SkeletonText,
} from './skeleton';

/* ============================================================================
 * TEXTURE AND SKELETON GALLERIES — for /design-system
 * ----------------------------------------------------------------------------
 * These exist for the same reason `ControlGallery` does: a texture that is only
 * ever seen in situ cannot be checked. Side by side on one page, in both themes,
 * it is obvious when grain has stopped rendering or glass has lost its edge.
 *
 * It also earns its place as a test surface. Both of the bugs found while building
 * these tokens — grain and the orbit ring invisible behind their own parent's
 * background — would have been visible here immediately, and were instead found by
 * injecting a probe into a live page.
 * ========================================================================= */

function Swatch({
  label,
  note,
  className,
  style,
}: {
  label: string;
  note: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="space-y-1.5">
      <div
        className={`flex h-24 items-center justify-center rounded-xl border border-border-default ${className ?? ''}`}
        style={style}
      >
        <span className="text-caption font-semibold text-text-primary">{label}</span>
      </div>
      <p className="text-micro text-text-tertiary">{note}</p>
    </div>
  );
}

export function TextureGallery() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Swatch
          label="Plain surface"
          note="The baseline — bg-surface with a border. Everything below is this, plus one thing."
          className="bg-bg-surface"
        />

        <Swatch
          label="Grain"
          note="A tiled SVG turbulence at 3.5% light / 5.5% dark. Stops a large flat panel reading as a flat panel."
          className="grain bg-bg-surface"
        />

        <Swatch
          label="Lit panel"
          note="A vertical gradient rather than a flat fill — the same reasoning the sidebar uses. A lit plane, not a void."
          className="panel-lit bg-bg-surface"
        />

        <Swatch
          label="Grain + lit"
          note="How a real data panel is dressed: texture and light, no blur, full text contrast."
          className="grain panel-lit bg-bg-surface"
        />

        <Swatch
          label="Dot grid"
          note="Empty states only. Behind content it competes with text; behind emptiness it reads as a surface waiting to be filled."
          className="dot-grid bg-bg-surface"
        />

        <Swatch
          label="Header glow"
          note="Brand light behind a page title — teal and gold, matching the aura already behind the logo."
          className="glow-header bg-bg-surface"
        />
      </div>

      {/* Glass needs something behind it to be glass at all, so it sits over a
          patterned bed rather than over the page. */}
      <div className="space-y-1.5">
        <div className="relative overflow-hidden rounded-xl border border-border-default">
          <div className="dot-grid glow-header h-40 bg-bg-surface-sunken" />
          <div className="absolute inset-0 grid place-items-center">
            <div className="glass rounded-xl border px-6 py-4">
              <p className="text-caption font-semibold text-text-primary">Frosted chrome</p>
              <p className="mt-0.5 text-micro text-text-secondary">
                Top bar, dialogs, dropdowns, the timer bar
              </p>
            </div>
          </div>
        </div>
        <p className="text-micro text-text-tertiary">
          Falls back to an opaque surface where <code className="font-mono">backdrop-filter</code>{' '}
          is unsupported — otherwise text would sit over content unblurred, which is worse than not
          being glass.
        </p>
      </div>

      {/* The orbiting ring from video 2. Two arcs 180° apart in a conic gradient,
          masked to a 1px edge. */}
      <div className="space-y-1.5">
        <div className="orbit-border grid h-32 place-items-center rounded-2xl bg-bg-surface">
          <div className="text-center">
            <p className="text-caption font-semibold text-text-primary">Orbiting border</p>
            <p className="mt-0.5 text-micro text-text-secondary">
              For the sign-in card — teal and gold, not the reference&rsquo;s cyan and magenta
            </p>
          </div>
        </div>
        <p className="text-micro text-text-tertiary">
          A rotating conic gradient masked to the border. <code className="font-mono">@property</code>{' '}
          is what makes the angle animate at all — an unregistered custom property is a string to the
          compositor and jumps between keyframes instead of interpolating.
        </p>
      </div>

      {/* Staggered reveal. Static in a gallery, but the delays are visible on load. */}
      <div className="space-y-1.5">
        <div className="grid gap-3 sm:grid-cols-4">
          {['First', 'Second', 'Third', 'Fourth'].map((label, i) => (
            <div
              key={label}
              className="reveal grain rounded-xl border border-border-default bg-bg-surface p-4"
              style={{ '--reveal-index': i } as React.CSSProperties}
            >
              <p className="text-caption font-semibold text-text-primary">{label}</p>
              <p className="text-micro text-text-tertiary">{i * 55}ms</p>
            </div>
          ))}
        </div>
        <p className="text-micro text-text-tertiary">
          Staggered arrival, 55ms apart. Transform and opacity only — animating height or margin
          would reflow the page once per frame per card.
        </p>
      </div>
    </div>
  );
}

export function SkeletonGallery() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <p className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
          Page header
        </p>
        <SkeletonHeader withActions />
      </div>

      <div className="space-y-2">
        <p className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
          Figures
        </p>
        <SkeletonKpiRow />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
            List
          </p>
          <SkeletonList rows={4} />
        </div>
        <div className="space-y-2">
          <p className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
            Table
          </p>
          <SkeletonTable rows={4} columns={4} />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
          Text — uneven by design
        </p>
        <div className="max-w-md rounded-xl border border-border-default bg-bg-surface p-4">
          <SkeletonText lines={3} />
        </div>
        <p className="text-micro text-text-tertiary">
          Widths vary because real prose does. A stack of identical bars reads as a loading graphic;
          100%, 92% and 64% read as a paragraph.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-micro font-semibold tracking-[0.06em] text-text-tertiary uppercase">
          Shapes
        </p>
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border-default bg-bg-surface p-4">
          <Skeleton rounded="full" className="h-10 w-10" />
          <Skeleton rounded="lg" className="h-9 w-9" />
          <Skeleton rounded="full" className="h-4 w-16" />
          <Skeleton rounded="lg" className="h-9 w-28" />
          <Skeleton rounded="full" className="h-1.5 w-32" />
        </div>
        <p className="text-micro text-text-tertiary">
          Avatar, icon tile, badge, control and progress bar — the five shapes every composite is
          built from.
        </p>
      </div>
    </div>
  );
}
