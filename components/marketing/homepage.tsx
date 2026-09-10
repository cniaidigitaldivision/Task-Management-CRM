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

import Link from 'next/link';

import { LogoMark } from '@/components/brand/logo';
import { HomepageMotion } from '@/components/marketing/homepage-motion';
import { ThemeClip } from '@/components/marketing/theme-clip';

import './home.css';

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
            <a href="#thread">How it works</a>
            <a href="#modules">What it holds</a>
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
            <p className="standfirst">
              One intelligent system for the whole business — tasks, the team behind them, projects,
              finance, credentials and documentation, your social performance across every platform in
              the Trend &amp; Engagement Studio, and a lead desk that captures every enquiry and follows
              it through to a closed deal.
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
        {/* Shown whole, at the same width as the headline above it. */}
        <div className="hero-shot" data-reveal>
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
        </div>

        {/* ══ THE THREAD ════════════════════════════════════════════════════ */}
        <section id="thread">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <h2>One lead, followed all the way</h2>
              <p>
                Most tools give you a folder for tasks and a different one for clients, and the join
                between them lives in a spreadsheet. Taskly keeps the join. Here is the same enquiry,
                moving through the system.
              </p>
            </div>

            <div className="thread">

              <div className="stop" data-reveal>
                <div>
                  <p className="where">Campaign & Lead Desk</p>
                  <h3>Somebody fills in a form</h3>
                </div>
                <div>
                  <p>
                    Leads arrive from your Meta campaigns on their own, every fifteen minutes, and land
                    against the right project and the right team. Their name, their number and every
                    answer they gave — kept, because Meta deletes lead data after ninety days and your
                    copy becomes the only one that exists.
                  </p>
                  <ul>
                    <li>Automatic import, with a record of every run so a broken one is visible</li>
                    <li>Numbers normalised, so one person is never two leads</li>
                    <li>Filed by the campaign that produced them, not by guesswork</li>
                  </ul>
                </div>
              </div>

              <div className="stop" data-reveal>
                <div>
                  <p className="where">Assignment</p>
                  <h3>It goes to whoever is free</h3>
                </div>
                <div>
                  <p>
                    Share the day’s leads out and each goes to whoever holds the fewest open ones, and
                    on a tie to whoever has waited longest — oldest enquiry first. The rule is printed
                    on the screen, so a salesperson can check it rather than suspect it.
                  </p>
                  <ul>
                    <li>Or hand a lead to a named person, when it should be theirs</li>
                    <li>Only the department’s own manager can move one</li>
                    <li>Everybody is told the moment a lead becomes theirs</li>
                  </ul>
                </div>
              </div>

              <div className="stop" data-reveal>
                <div>
                  <p className="where">Working the lead</p>
                  <h3>Somebody calls them</h3>
                </div>
                <div>
                  <p>
                    Stage, temperature, what was quoted, what was said, what happens next and when.
                    Call and WhatsApp are one tap from the record. Every change writes itself to the
                    timeline, so who did what is never something anybody has to reconstruct.
                  </p>
                  <ul>
                    <li>Response time measured from when they enquired, not from when you got to it</li>
                    <li>A note thread that cannot be quietly rewritten afterwards</li>
                    <li>Reminders before a follow-up is late, and an alert when leads go quiet</li>
                  </ul>
                </div>
              </div>

              <div className="stop gold" data-reveal>
                <div>
                  <p className="where">Clients</p>
                  <h3>They say yes</h3>
                </div>
                <div>
                  <p>
                    Winning a lead makes them a client — one moment, no second button to remember. If
                    the same person enquired twice they stay one client with two enquiries, matched on
                    their number rather than on how they happened to type it.
                  </p>
                </div>
              </div>

              <div className="stop" data-reveal>
                <div>
                  <p className="where">Projects, Tasks, Workload</p>
                  <h3>The work begins</h3>
                </div>
                <div>
                  <p>
                    A project with its own page: the tasks, the people on it, the posts scheduled, the
                    documents, the credentials, the money. Work is assigned within real capacity, so
                    nobody is quietly given a fortnight of work in a week.
                  </p>
                  <ul>
                    <li>Boards, a calendar, and a personal list for each person</li>
                    <li>Time limits, extensions, review and approval</li>
                    <li>Capacity in points, with a hard stop rather than a warning nobody reads</li>
                  </ul>
                </div>
              </div>

              <div className="stop" data-reveal>
                <div>
                  <p className="where">Studio & Reports</p>
                  <h3>You find out whether it worked</h3>
                </div>
                <div>
                  <p>
                    Reach, engagement and posting cadence per client, pulled from Meta into your own
                    tables. Lead reports say where the enquiries came from, how fast each person
                    answered and what closed — computed once and kept, so a figure you quoted in
                    September still reads the same in December.
                  </p>
                  <ul>
                    <li>Exports to PDF, CSV and Excel, with each number’s definition attached</li>
                    <li>Every report states what it counted and what it cannot yet tell you</li>
                  </ul>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* ══ MODULES ═══════════════════════════════════════════════════════ */}
        <section id="modules" className="band">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <h2>And everything else an agency has to keep somewhere</h2>
              <p>
                The parts that usually end up in a shared drive, a WhatsApp group, or one person’s
                memory.
              </p>
            </div>

            <div className="grid" data-reveal-group>
              <div className="cell" data-reveal>
                <span className="tag">Team</span>
                <h3>People and departments</h3>
                <p>
                  Sales, delivery, development, finance, HR — each with a manager, each seeing what
                  belongs to them. Four permission levels, and a department that decides what somebody
                  can actually open.
                </p>
              </div>
              <div className="cell" data-reveal>
                <span className="tag">Vault</span>
                <h3>Credentials</h3>
                <p>
                  Client logins, API keys and tokens, encrypted and held per project. Who read what is
                  recorded. Nobody asks in a group chat for a password again.
                </p>
              </div>
              <div className="cell" data-reveal>
                <span className="tag">Documents</span>
                <h3>Files and contracts</h3>
                <p>
                  Briefs, contracts and deliverables against the project they belong to, with Google
                  Drive folders linked where the originals already live.
                </p>
              </div>
              <div className="cell" data-reveal>
                <span className="tag">Attendance</span>
                <h3>Who is in</h3>
                <p>
                  Check in from the app or the office terminal, with late arrivals, missing checkouts
                  and leave in one place — per office, so two sites never blur together.
                </p>
              </div>
              <div className="cell" data-reveal>
                <span className="tag">Finance</span>
                <h3>Invoices and money</h3>
                <p>
                  Invoices, payments received, expenses and payroll, per client and per office. A
                  statement of account for any client, on one screen.
                </p>
              </div>
              <div className="cell" data-reveal>
                <span className="tag">Security</span>
                <h3>Accounts and access</h3>
                <p>
                  Two-factor sign-in, sessions you can end remotely, forced password resets, and an
                  audit trail nobody — including an administrator — can quietly edit.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ══ THE ASSISTANT ═════════════════════════════════════════════════ */}
        <section id="ai" className="ai">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <h2>The assistant knows your data, not the internet</h2>
              <p>
                Ask in plain language and it answers from your own tables, through the same permissions
                you have. It never sees a project you cannot open.
              </p>
            </div>

            <div className="ai-stage" data-reveal>
              {/* The assistant’s own clip, from inside the product. Lazy: it is
                   around 6 MB a cut, so it is not fetched until it scrolls into view. */}
              <ThemeClip clip="room" className="brain-clip" lazy />
              <div className="caption">
                <p>
                  Every answer comes with the rows behind it. Nothing is estimated, and where the data
                  cannot answer a question yet, it says so instead of guessing.
                </p>
              </div>
            </div>

            <div className="ai-list" data-reveal-group>
              <div className="ai-item on" data-reveal>
                <h3>Ask about the work</h3>
                <p>
                  “What is overdue on Chitral Royal Homes?” “Who is over capacity this week?” “How many
                  posts went out for this client in August?” Answers with the rows behind them, not a
                  paragraph you have to take on trust.
                </p>
              </div>
              <div className="ai-item on" data-reveal>
                <h3>Written reports</h3>
                <p>
                  The monthly client report computes its own figures, then the model writes the prose
                  over the top. The arithmetic is yours; only the wording is drafted.
                </p>
              </div>
              <div className="ai-item on" data-reveal>
                <h3>Smart lead distribution</h3>
                <p>
                  Leads divide themselves across the team by who is genuinely free, so nobody sits on
                  forty enquiries while a colleague waits for one.
                </p>
              </div>
              <div className="ai-item" data-reveal>
                <h3>Coaching before a call</h3>
                <p>
                  A two-line summary of what a lead wants, talking points before you ring them, and a
                  drafted follow-up you edit before it sends — never sent for you.
                </p>
              </div>
              <div className="ai-item" data-reveal>
                <h3>Campaign or staff?</h3>
                <p>
                  Same campaign, different people, different results — it is the person. Same person
                  across campaigns — it is the campaign. Shown as arithmetic anybody can check.
                </p>
              </div>
              <div className="ai-item" data-reveal>
                <h3>Nothing invented</h3>
                <p>
                  The rule the whole system is built on: a screen shows a number only when a real one
                  exists. No figure is estimated, and an empty report says why it is empty.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ══ FILMS ═════════════════════════════════════════════════════════ */}
        <section id="films" className="band">
          <div className="wrap">
            <div className="section-head" data-reveal>
              <h2>See it working</h2>
              <p>Short walkthroughs of the parts people ask about most.</p>
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
                  {/* <video className="stage" controls playsinline poster="/home/studio-poster.jpg"><source src="/home/studio.mp4" type="video/mp4"></video> */}
                  <div className="stage stage-empty">
                    <span className="play" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
                    {/* The title lives on the <h3> below. Repeating it here printed it
                         twice on the page, and it vanishes the moment the real <video>
                         above replaces this placeholder. Instruction only. */}
                    <strong>Drop studio.mp4 here</strong>
                  </div>
                </div>
                <h3>Trend & Engagement Studio</h3>
                <p>What every client’s pages actually did this month.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ══ CLOSE ═════════════════════════════════════════════════════════ */}
        <section className="close">
          <div className="wrap" data-reveal>
            <h2>Your team is already in here.</h2>
            <p>
              Open it with the address your administrator set up. If you have not been given an account
              yet, ask them — accounts are created from inside Taskly, never self-served.
            </p>
            <div className="cta">
              <Link className="btn btn-primary btn-lg" href="/login">Open your workspace</Link>
            </div>
          </div>
        </section>

      </main>

      <footer>
        <div className="wrap foot">
          <a className="mark" href="#top">
            <span className="glyph" aria-hidden="true">T</span>
            <span>Taskly</span>
          </a>
          <p className="spacer">© 2026 Crescent Nova International · AI & Digital Division</p>
          <Link href="/login">Open workspace</Link>
        </div>
      </footer>
    </div>
  );
}
