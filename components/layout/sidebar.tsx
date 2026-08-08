'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, X } from 'lucide-react';

import { LogoSidebar } from '@/components/brand/logo';
import { Avatar } from '@/components/ui/avatar';
import { ORGANISATION_NAME, ROLE_LABEL, type Role } from '@/lib/domain/constants';
import { cn } from '@/lib/utils';

import { sectionsForRole } from './nav-config';

/* ============================================================================
 * SIDEBAR — the navigation rail
 * ----------------------------------------------------------------------------
 * ★ THEME-INVARIANT. Every colour here comes from the `--sidebar-*` tokens,
 *   which styles/tokens.css declares once outside both theme blocks. The rail
 *   looks identical in light and dark mode, by owner decision (Session 08) and
 *   in line with how ClickUp, Linear, Asana and Notion all handle it.
 *
 *   The reason it matters: a white rail beside a near-white page has no edge,
 *   so the interface reads as one flat sheet. A dark rail draws the frame and
 *   lets the content area become the thing you actually look at.
 *
 * `.on-chrome` switches the focus ring to its light-on-dark equivalent, since
 * the page's teal ring would be almost invisible against the rail (FR-214).
 * ========================================================================= */

const BADGE_COUNTS: Record<string, { count: number; tone: 'neutral' | 'alert' }> = {
  myTasks: { count: 7, tone: 'neutral' },
  review: { count: 3, tone: 'neutral' },
  overdue: { count: 4, tone: 'alert' },
};

/* ---- Counter chip, styled for the rail ---------------------------------- */

function RailBadge({ count, tone }: { count: number; tone: 'neutral' | 'alert' }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'tabular inline-flex min-w-[21px] shrink-0 items-center justify-center',
        'rounded-full px-1.5 py-0.5 text-micro font-semibold',
      )}
      style={
        tone === 'alert'
          ? { backgroundColor: 'var(--feedback-error)', color: 'var(--neutral-0)' }
          : { backgroundColor: 'var(--sidebar-badge-bg)', color: 'var(--sidebar-badge-text)' }
      }
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function Sidebar({
  role,
  userName,
  open,
  onClose,
  pinned = false,
}: {
  role: Role;
  userName: string;
  open: boolean;
  onClose: () => void;
  /** Open or collapsed. Toggled ONLY by the tab in app-shell.tsx — the rail no
   *  longer reacts to the pointer at all (owner instruction, Session 17). */
  pinned?: boolean;
}) {
  const pathname = usePathname();
  const sections = sectionsForRole(role);

  return (
    <>
      {/* Mobile scrim */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-[var(--bg-scrim)] backdrop-blur-sm transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        id="main-navigation"
        aria-label="Main navigation"
        data-pinned={pinned}
        className={cn(
          'group/rail chrome-surface on-chrome',
          'fixed inset-y-0 left-0 z-50 flex flex-col overflow-hidden',
          'w-[var(--sidebar-width)]',
          // ── CLICK TO OPEN, NOT HOVER (owner instruction, Session 17) ──────
          // This used to carry `lg:hover:w-[var(--sidebar-width)]`, from owner
          // decision D6 in Session 09. The owner has since reversed that: the
          // rail opening under the pointer on the way past was the problem, not
          // the feature. The tab in app-shell.tsx is now the only control.
          //
          // It still PUSHES the content rather than covering it (owner decision
          // D7, NOT reversed): app-shell tracks this width in `--rail` and
          // animates the content's left padding with it. Do not make it overlay.
          pinned ? 'lg:w-[var(--sidebar-width)]' : 'lg:w-[var(--sidebar-width-collapsed)]',
          'transition-[width,transform] duration-[240ms] ease-out lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ boxShadow: 'var(--sidebar-shadow)' }}
      >
        {/* ---- Brand ----
            The logo sits in its gold aura with nothing boxing it in. A hairline
            of brand gradient runs beneath, which is what separates the brand
            block from the navigation without drawing a grey line across it. */}
        {/* ── The brand block height is FIXED, and that is the whole point ────
            Owner report: "when it closes the icons jump up and leave a lot of
            space at the bottom."

            The height must not change between the expanded and collapsed rail,
            or every nav item below is dragged with it and the animation appears
            to crack rather than glide.

            It was 148px, sized for the full 150×112 artwork. The rail now shows
            the MARK plus real text — about 28px tall either way — so 148px would
            be 100px of nothing above the navigation. 76px is the padded height
            of the current lockup (28 + 20 + 16, rounded up for breathing room),
            and it is still FIXED for the original reason. */}
        <div className="relative flex h-[76px] shrink-0 items-center px-4 pt-5 pb-4 lg:px-3 lg:group-data-[pinned=true]/rail:px-4">
          <div className="flex w-full items-center justify-between gap-2">
            <Link
              href="/dashboard"
              className="rounded-xl focus-visible:outline-none"
              aria-label={`${ORGANISATION_NAME} — go to dashboard`}
            >
              <span className="block lg:hidden lg:group-data-[pinned=true]/rail:block">
                <LogoSidebar />
              </span>
              <span className="hidden lg:flex lg:w-full lg:justify-center lg:group-data-[pinned=true]/rail:hidden">
                <LogoSidebar collapsed />
              </span>
            </Link>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation"
              className="-mr-1 rounded-md p-1.5 transition-colors duration-[120ms] hover:bg-[var(--sidebar-item-hover-bg)] focus-visible:outline-none lg:hidden"
              style={{ color: 'var(--sidebar-item)' }}
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>

          {/* Gradient hairline — fades out rather than stopping, so it reads as
              light falling off rather than a rule someone drew. */}
          <span
            aria-hidden="true"
            className="absolute inset-x-4 bottom-0 h-px"
            style={{
              background:
                'linear-gradient(90deg, var(--brand-glow-gold), var(--sidebar-border) 55%, transparent)',
            }}
          />
        </div>

        {/* ---- Navigation ---- */}
        <nav className="chrome-scroll flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {sections.map((section, index) => (
            <div key={section.label ?? `section-${index}`} className="space-y-0.5">
              {section.label && (
                <p
                  className={cn(
                    'px-3 pt-1 pb-1.5 text-micro font-semibold tracking-[0.1em] uppercase',
                    'transition-opacity duration-150 lg:opacity-0 lg:group-data-[pinned=true]/rail:opacity-100',
                  )}
                  style={{ color: 'var(--sidebar-section-label)' }}
                >
                  {section.label}
                </p>
              )}

              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const badge = item.badgeKey ? BADGE_COUNTS[item.badgeKey] : undefined;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-2.5 rounded-lg py-2 pr-2.5 pl-3',
                      'text-body-sm font-medium transition-colors duration-[120ms]',
                      'focus-visible:outline-none',
                      !isActive && 'hover:bg-[var(--sidebar-item-hover-bg)]',
                    )}
                    style={{
                      backgroundColor: isActive ? 'var(--sidebar-item-active-bg)' : undefined,
                      color: isActive
                        ? 'var(--sidebar-item-active-text)'
                        : 'var(--sidebar-item)',
                    }}
                  >
                    {/* Gold rail marks the active item. Chrome, not state —
                        it identifies where you are, it never warns. BR-024. */}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-[7px] -left-px w-[3px] rounded-full"
                        style={{
                          backgroundColor: 'var(--accent-gold)',
                          boxShadow: '0 0 10px -1px var(--brand-glow-bloom-tight)',
                        }}
                      />
                    )}

                    <Icon
                      className="h-[17px] w-[17px] shrink-0 transition-colors duration-[120ms]"
                      strokeWidth={isActive ? 2.1 : 1.75}
                      style={{ color: isActive ? 'var(--sidebar-item-active-icon)' : undefined }}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        'flex-1 truncate transition-colors duration-[120ms]',
                        !isActive && 'group-hover:text-[var(--sidebar-item-hover-text)]',
                      )}
                    >
                      {item.label}
                    </span>
                    {badge && (
                      <span className="shrink-0 transition-opacity duration-150 lg:opacity-0 lg:group-data-[pinned=true]/rail:opacity-100">
                        <RailBadge count={badge.count} tone={badge.tone} />
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* ---- Current user ----
            ── ONE VERTICAL AXIS FOR EVERY ICON IN THE RAIL ────────────────────
            Owner report, Session 17: this row sat "a little bit left sided"
            compared with the navigation icons. It did, and so did the settings
            row below it — there were three different axes in one rail:

              nav icon      px-3 container + pl-3 link + 17px icon → centre 32.5
              avatar        p-3  container + p-2  link + 36px      → centre 38
              settings icon p-3  container + px-2 link + 16px      → centre 28

            Only visible once the rail is collapsed, which since the hover change
            is now its resting state — so it matters far more than it used to.
            This block now uses the SAME geometry as a nav link (px-3 container,
            pl-3 link) with the avatar centred in a 17px slot, so all three land
            on 32.5px. Change one, change the other.

            ── AND THERE IS ONLY ONE SETTINGS ICON NOW ─────────────────────────
            Owner: *"two settings icons… I don't want that."* There were. This
            row linked to /settings and so does the System section of the
            navigation above — the same destination, the same icon, twice in one
            rail. The nav item is the one that belongs to the navigation, so the
            duplicate here is gone. Profile is reachable from this row, and
            Settings from the nav. */}
        <div
          className="shrink-0 border-t px-3 py-3"
          style={{ borderColor: 'var(--sidebar-border)' }}
        >
          <Link
            href="/profile"
            onClick={onClose}
            className="group flex items-center gap-2.5 rounded-lg py-2 pr-2.5 pl-3 transition-colors duration-[120ms] hover:bg-[var(--sidebar-item-hover-bg)] focus-visible:outline-none"
          >
            <span className="flex w-[17px] shrink-0 justify-center">
              <Avatar name={userName} size="sm" />
            </span>
            <span className="min-w-0 flex-1 transition-opacity duration-150 lg:opacity-0 lg:group-data-[pinned=true]/rail:opacity-100">
              <span
                className="block truncate text-body-sm font-semibold"
                style={{ color: 'var(--sidebar-heading)' }}
              >
                {userName}
              </span>
              <span
                className="block truncate text-micro"
                style={{ color: 'var(--sidebar-muted)' }}
              >
                {ROLE_LABEL[role]}
              </span>
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100"
              style={{ color: 'var(--sidebar-muted)' }}
            >
              <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </span>
          </Link>
        </div>
      </aside>
    </>
  );
}
