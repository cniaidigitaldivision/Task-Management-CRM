/* ============================================================================
 * THE PUBLIC HOMEPAGE
 * ----------------------------------------------------------------------------
 * What a stranger sees at taskly.aidigitaldivision.com. It follows one lead
 * from the form somebody fills in to the month it is invoiced, because that is
 * the thing this product does that a folder of tasks does not.
 *
 * -- NO FIGURES, AND THAT IS DELIBERATE ---------------------------------------
 * There is no metric, client count, uptime number or testimonial anywhere on
 * this page. None of them could be sourced from anything real, and an invented
 * number on the public page is worse than silence. Anything added here later
 * must be true and checkable.
 *
 * -- THE LEAD DESK IS DESCRIBED IN THE PRESENT TENSE --------------------------
 * Owner's explicit instruction. It is built and its leads are in the database;
 * what waits on Meta business verification is WhatsApp sending, which this page
 * does not mention. Nothing here claims a capability that does not exist.
 *
 * -- THE STYLESHEET IS SCOPED, NOT GLOBAL ------------------------------------
 * `.taskly-home` wraps everything and every selector in home.css sits under it.
 * Next.js keeps a stylesheet in the document after you navigate away, so an
 * unscoped `h1` rule here would restyle /login. See the header of home.css.
 *
 * The two walkthrough slots are placeholders naming the file to drop in.
 * ========================================================================= */

import {
  ArrowRight,
  ChartColumn,
  ClipboardCheck,
  Clock,
  Eye,
  FileText,
  FolderKanban,
  Layers,
  Lightbulb,
  MessageSquare,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import Link from 'next/link';

import { LogoMark } from '@/components/brand/logo';
import { HomepageMotion } from '@/components/marketing/homepage-motion';
import { PlatformIcon } from '@/components/brand/platform-icon';
import { ParticleField } from '@/components/marketing/particle-field';
import { ThemeClip } from '@/components/marketing/theme-clip';

import './home.css';

/* The six the reference names, in its order. Each is a real screen in the
   product — nothing here is aspirational. */
const SHOT_STRIP = [
  { icon: ClipboardCheck, name: 'Tasks', line: 'Plan and track work' },
  { icon: FolderKanban, name: 'Projects', line: 'Keep everything organised' },
  { icon: Users, name: 'Team', line: 'Manage your people' },
  { icon: Clock, name: 'Attendance', line: 'Track time and presence' },
  { icon: ChartColumn, name: 'Reports', line: 'Turn data into clarity' },
  { icon: FileText, name: 'Documents', line: 'Store what matters' },
] as const;

/* Three steps, and they are a real sequence — see the note at the markup. */
const PROCESS = [
  { no: '01', name: 'Set up your projects', line: 'Create projects and add your team.' },
  { no: '02', name: 'Assign and track tasks', line: 'Keep work moving, every day.' },
  { no: '03', name: 'Review the bigger picture', line: 'See progress, performance and what’s next.' },
] as const;

export function Homepage({ fontClassName }: { fontClassName: string }) {
  return (
    /* The wrapper undoes the application's 90% density scale (--ui-scale): this
       page was drawn and contrast-measured at 1:1. See home.css. */
    <div className={`taskly-home ${fontClassName}`}>
      <HomepageMotion />

      <header>
        {/* Three columns — 1fr auto 1fr — so the menu is centred on the PAGE
            rather than between whatever the logo and the button happen to
            measure. See the note in home.css. */}
        <div className="wrap bar">
          <a className="mark" href="#top">
            {/* ⛔ The supplied artwork, shown through a window. It is never
                recoloured, cropped to a new file, or redrawn — see the rules at
                the top of logo.tsx. <LogoMark> is the brain alone, which is the
                only lockup that reads on a dark ground: the supplied wordmark
                “AI & DIGITAL” is dark teal and measures about 2.3:1 here, so the
                words beside it are real HTML taking their colour from this
                page’s own tokens. */}
            {/* ⚠️ THE GLOW GOES ON A WRAPPER, NOT ON <LogoMark> ITSELF. That component's
                span carries `overflow-hidden` so its CSS window on the artwork cannot
                spill — which also clips any pseudo-element placed on it, turning a soft
                radial halo into a hard-edged rectangle. Ask me how I know. */}
            <span className="brand-mark">
              <LogoMark width={72} priority />
            </span>
            <span>Taskly<small>AI & Digital Division</small></span>
          </a>
          <nav className="links">
            {/* ⚠️ FOUR ITEMS, FOUR SECTIONS. "What it holds" pointed at the
                modules section, which the owner removed — an anchor to a target
                that no longer exists does nothing at all when clicked, silently.
                It is replaced by the Studio, which is a real section. */}
            <a href="#layer">What it is</a>
            <a href="#studio">The Studio</a>
            <a href="#thread">How it works</a>
            <a href="#ai">The assistant</a>
            <a href="#films">See it</a>
          </nav>
          <div className="right">
            <Link className="btn btn-primary" href="/login">Open workspace</Link>
          </div>
        </div>
      </header>

      <main id="top">

        {/* ══ HERO ══════════════════════════════════════════════════════════ */}
        <div className="hero">
          {/* The owner's own clip, shown at its native 16:9 across the full
              width — see the note in home.css about why it is not `cover`. */}
          <ThemeClip clip="hero" className="hero-clip" />

          <div className="wrap hero-copy">
            {/* One line, so it is sized to fit the column rather than the column
                being sized to it. The accent is the two words that say what it
                is; "AI-powered" is the qualifier and stays in plain ink. */}
            <h1>AI-powered <em>operations platform</em></h1>
            {/* Cut from four lines to two. Every item the owner listed is still
                named; what went is the connective prose between them. */}
            <p className="standfirst">
              One intelligent system for the whole business — tasks, teams and projects, finance,
              credentials and documents, social performance in the Trend &amp; Engagement Studio, and a
              lead desk that closes.
            </p>
            <div className="cta">
              <Link className="btn btn-primary btn-lg" href="/login">Open workspace</Link>
              <a className="btn btn-ghost btn-lg" href="#thread">See how it works</a>
            </div>
          </div>

        </div>

        {/* ⚠️ OUTSIDE `.hero`, DELIBERATELY. The hero is a full screen whose
            column is bottom-aligned; anything else inside it would be pushed to
            that same floor and the copy would no longer rest on it. */}
        {/* ══ THE SYSTEM OVERVIEW ════════════════════════════════════ */}
        <div className="overview band">
          <ParticleField className="overview-field" />

        {/* Shown whole, flanked by two quiet labels and captioned beneath — the
            owner's reference for this band. */}
        <div className="hero-shot" data-reveal>
          <p className="shot-flank shot-flank-l" aria-hidden="true">
            <span>People</span><span>Projects</span><span>Progress</span><span>A brighter tomorrow</span>
          </p>

          <div className="frame">
            <div className="chrome"><i /><i /><i /><span>taskly.aidigitaldivision.com</span></div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/home/workspace.jpg"
              alt="The Taskly dashboard: open, in-progress, completed and overdue tasks, the team's capacity, an operations score with its recommendations, and today's attendance."
              width={1900}
              height={841}
              loading="eager"
              decoding="async"
            />
          </div>

          {/* ⚠️ aria-hidden, and both of them. These two labels are atmosphere,
              not information — read aloud between the headline and the caption they
              would interrupt the sentence the page is actually making. */}
          <p className="shot-flank shot-flank-r" aria-hidden="true">
            <span>Same work,</span><span>higher clarity.</span>
          </p>
        </div>

        <p className="shot-caption" data-reveal>
          <span>A clear view of your entire operation</span>
        </p>

        <div className="shot-strip" data-reveal-group>
          {SHOT_STRIP.map(({ icon: Icon, name, line }) => (
            <div className="strip-item" key={name} data-reveal>
              <Icon aria-hidden="true" />
              <div>
                <h3>{name}</h3>
                <p>{line}</p>
              </div>
            </div>
          ))}
        </div>
        </div>

        {/* ══ THE OPERATING LAYER ═══════════════════════════════════ */}
        <section id="layer" className="layer">
          <div className="wrap layer-grid">
            {/* ⚠️ THE DIAGRAM IS THE OWNER'S OWN ARTWORK, USED AS SUPPLIED — the
                nine modules and the hub are drawn in it, so nothing here
                re-states them. Native size 893x511, displayed at that and never
                stretched past it.

                This is the owner's second export. It replaced a 570x345
                transparent copy: 57% more resolution matters more here than
                transparency does, because the artwork's own ground is within a
                few values of this page's and the seam is handled in CSS. Its
                outer 3px were a scrollbar artifact and are cropped. */}
            <div className="layer-art tilt" data-reveal>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/home/operating-layer.png"
                alt="Taskly as an operating layer: a hub connected to Tasks, Projects, Team, Attendance, Documents, Finance, Vault, Reports and AI."
                width={893}
                height={511}
                loading="lazy"
                decoding="async"
              />
            </div>

            <div className="pitch layer-copy" data-reveal>
              <p className="pitch-eyebrow">A bigger system than task management</p>
              <h2>Taskly is an <em>operating layer</em> for the division</h2>
              <p className="pitch-lede">
                It connects the daily work of teams with the business controls leadership needs.
              </p>
              <hr className="layer-rule" />
              <p className="layer-claim">
                <ShieldCheck aria-hidden="true" />
                <span>
                  One connected layer.
                  <em>Everything runs better.</em>
                </span>
              </p>
            </div>
          </div>

          <div className="layer-points" data-reveal-group>
              <div className="point point-teal" data-reveal>
                <span className="point-no">01</span>
                <Layers className="point-icon" aria-hidden="true" />
                <div>
                  <h3>Structured execution</h3>
                  <p>Every module works together so teams execute with clarity.</p>
                </div>
              </div>
              <div className="point point-gold" data-reveal>
                <span className="point-no">02</span>
                <Eye className="point-icon" aria-hidden="true" />
                <div>
                  <h3>Management visibility</h3>
                  <p>Leaders see work, people, money and risk in one place.</p>
                </div>
              </div>
              <div className="point point-violet" data-reveal>
                <span className="point-no">03</span>
                <Sparkles className="point-icon" aria-hidden="true" />
                <div>
                  <h3>AI intelligence</h3>
                  <p>The assistant answers from live workspace data.</p>
                </div>
              </div>
            </div>
          </section>

        {/* ══ THE STUDIO ══════════════════════════════════════════════ */}
        <section id="studio" className="studio band">
          <div className="wrap studio-grid">
            <div className="pitch studio-copy" data-reveal>
              <p className="pitch-eyebrow">Trend &amp; Engagement Studio</p>
              <h2>Connect the work <em>with its results.</em></h2>
              <p className="pitch-lede">
                Review content targets, published posts and social performance in one place.
              </p>

              {/* The four things the Studio actually measures, named in its own
                  order. Not links — there is nothing behind them on a public
                  page, and a word styled as a link that does nothing is worse
                  than one that is plainly a label. */}
              <p className="studio-facets">
                <span>Targets</span>
                <span>Content</span>
                <span>Engagement</span>
                <span>Reach</span>
              </p>

              {/* ⚠️ THE APP'S OWN MARKS, VIA <PlatformIcon>. The product draws
                  Facebook and Instagram from lib/brand/platform-marks.ts, and a
                  second hand-drawn copy on the marketing page would be one more
                  thing to miss on the day the brand changes. */}
              <div className="studio-accounts">
                <div className="account">
                  <PlatformIcon slug="facebook" size={38} />
                  <div>
                    <h3>Facebook</h3>
                    <p>Connected</p>
                  </div>
                </div>
                <div className="account">
                  <PlatformIcon slug="instagram" size={38} />
                  <div>
                    <h3>Instagram</h3>
                    <p>Connected</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="studio-shot tilt" data-reveal>
              <div className="frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/home/studio.jpg"
                  alt="The Trend & Engagement Studio: monthly target and posts achieved, total followers, engagement rate, views and reach, with a performance chart and top locations."
                  width={1909}
                  height={860}
                  loading="lazy"
                  decoding="async"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ══ THE THREAD ════════════════════════════════════════════════════ */}
        <section id="thread">
          <div className="wrap thread-grid">
            {/* Film left, words right — the mirror of the Studio above it, so the
                three showcase sections alternate down the page.

                ⚠️ NOT TILTED, unlike the two panels above. This clip is an
                infographic whose six step labels have to be readable, and a 3D
                turn costs a measured ~25% of sharpness on fine text — the same
                effect that was blurring the Studio screenshot. Tilting a moving
                image also fights the motion. Flat is the right trade here. */}
            <div className="thread-film" data-reveal>
              <ThemeClip
                clip="thread"
                className="thread-clip"
                poster="/home/thread-poster.jpg"
                playInView
                rate={0.72}
              />
            </div>

            <div className="pitch thread-copy" data-reveal>
              <p className="pitch-eyebrow">Lead desk</p>
              {/* Three parts, like the operating layer's heading — white, accent,
                  white. As two parts the accent ran to 20 characters against the
                  `.pitch` measure and broke as "followed all the / way", leaving
                  a one-word line. */}
              <h2>One lead, <em>followed</em> all the way</h2>
              <p className="pitch-lede">
                Most tools keep tasks in one place and clients in another, with the join between them
                living in a spreadsheet. Taskly keeps the join.
              </p>
            </div>
          </div>
        </section>

        {/* ══ THE ASSISTANT ═══════════════════════════════════════════ */}
        <section id="ai" className="assistant band">
          <div className="wrap">
            {/* One bordered panel holding three columns, as the owner's
                reference has it: the pitch, the clip, and what it is for. */}
            <div className="assistant-panel" data-reveal>
              <div className="pitch assistant-copy">
                <p className="pitch-eyebrow">Your AI assistant</p>
                <h2>Ask about work. <em>Find your next step.</em></h2>
                <p className="pitch-lede">
                  Bring questions about projects, workload and overdue tasks into one place.
                </p>

                {/* ⚠️ SPANS, NOT BUTTONS. These are examples of what you can ask,
                    and on a public page there is nothing behind them to ask. A
                    control styled as a control that does nothing when pressed is
                    worse than a plain label. */}
                <p className="assistant-asks">
                  <span>Which projects need attention?</span>
                  <span>Who has capacity this week?</span>
                </p>

                <Link className="assistant-more" href="/login">
                  Explore the AI Assistant
                  <ArrowRight aria-hidden="true" />
                </Link>
              </div>

              <div className="assistant-clip">
                <ThemeClip
                  clip="assistant"
                  className="assistant-video"
                  poster="/home/assistant-poster.jpg"
                  playInView
                  rate={0.8}
                />
              </div>

              <ul className="assistant-points">
                <li>
                  <MessageSquare aria-hidden="true" />
                  <span>Get instant answers about your work</span>
                </li>
                <li>
                  <Search aria-hidden="true" />
                  <span>Find information across projects and people</span>
                </li>
                <li>
                  <Lightbulb aria-hidden="true" />
                  <span>Make better decisions with full context</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ══ FILMS ═════════════════════════════════════════════════════════ */}
        <section id="films">
          <div className="wrap">
            <div className="pitch films-head" data-reveal>
              <p className="pitch-eyebrow">See it working</p>
              <h2>Watch it <em>do the work.</em></h2>
              <p className="pitch-lede">
                Short walkthroughs of the parts people ask about most.
              </p>
            </div>

            <div className="films" data-reveal-group>
              <div className="film" data-reveal>
                <div className="frame">
                  <div className="chrome"><i /><i /><i /><span>Lead desk</span></div>
                  {/* <video className="stage" controls playsinline poster="/home/leads-poster.jpg"><source src="/home/leads.mp4" type="video/mp4"></video> */}
                  <div className="stage stage-empty">
                    <span className="play" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
                    {/* The title lives on the <h3> below. Repeating it here printed it
                         twice on the page, and it vanishes the moment the real <video>
                         above replaces this placeholder. Instruction only. */}
                    <strong>Drop leads.mp4 here</strong>
                  </div>
                </div>
                <h3>A lead, start to finish</h3>
                <p>Arriving, shared out, called, won.</p>
              </div>

              <div className="film" data-reveal>
                <div className="frame">
                  <div className="chrome"><i /><i /><i /><span>Studio</span></div>
                  {/* ⚠️ `controls` AND `preload="none"` — BOTH LOAD-BEARING. This is
                      a 13.5 MB screen recording, the heaviest asset on the page by
                      a wide margin. It must never autoplay and must never be
                      fetched until somebody actually presses play; the poster is
                      87 KB and carries the tile until then. */}
                  {/* No `<track>`: the file carries a stereo audio stream, but it
                      is SILENT — decoded and measured, peak amplitude exactly 0.
                      There is nothing to caption. If a narrated version ever
                      replaces it, it needs captions and this note is the cue. */}
                  <video
                    className="stage"
                    controls
                    playsInline
                    preload="none"
                    poster="/home/studio-tour-poster.jpg"
                  >
                    <source src="/home/studio-tour.mp4" type="video/mp4" />
                  </video>
                </div>
                <h3>Trend & Engagement Studio</h3>
                <p>What every client’s pages actually did this month.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ══ CLOSE ═════════════════════════════════════════════════════════ */}
        {/* ══ THE PROCESS ══════════════════════════════════════════════ */}
        <section className="process band">
          <div className="wrap">
            <h2 className="process-title" data-reveal>A simple way to bring work together.</h2>

            {/* ⚠️ NUMBERED BECAUSE IT REALLY IS A SEQUENCE. You set projects up,
                then work moves, then you review it — each step depends on the one
                before. Numbering something that is merely a list is decoration;
                here it carries the order. */}
            <ol className="steps" data-reveal-group>
              {PROCESS.map(({ no, name, line }) => (
                <li className="step" key={no} data-reveal>
                  <span className="step-no" aria-hidden="true">{no}</span>
                  <div>
                    <h3>{name}</h3>
                    <p>{line}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ══ THE CLOSE ════════════════════════════════════════════════ */}
        <section className="close">
          <div className="wrap">
            <div className="close-panel" data-reveal>
              {/* The same flow field as the overview band, at a lower density —
                  it is a 200px strip here, not a screenful. */}
              <ParticleField className="close-field" />
              <div className="close-say">
                <h2>One place to keep work moving.</h2>
                <p>Your next task, your team and the bigger picture.</p>
              </div>
              <Link className="btn btn-primary btn-lg close-go" href="/login">
                Open workspace
                <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

      </main>

      <footer>
        <div className="wrap foot">
          <a className="mark foot-mark" href="#top">
            {/* ⛔ The supplied artwork through its window, as the header uses —
                never the letter "T" in a box, which is what stood here. */}
            <span className="brand-mark">
              <LogoMark width={44} />
            </span>
            <span>Taskly<small>AI &amp; Digital Division</small></span>
          </a>

          <nav className="foot-links">
            <a href="#layer">Features</a>
            <a href="#ai">AI Assistant</a>
            <Link href="/login">Sign in</Link>
          </nav>

          <p className="foot-note">Built for modern teams.</p>
        </div>

        <div className="wrap foot-fine">
          <p>© 2026 Crescent Nova International · AI &amp; Digital Division</p>
          <nav>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
