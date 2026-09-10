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

import { ThemeSwitch } from '@/components/brand/theme-toggle';
import { ThemeClip } from '@/components/marketing/theme-clip';

import './home.css';

export function Homepage({ fontClassName }: { fontClassName: string }) {
  return (
    /* The wrapper undoes the application's 90% density scale (--ui-scale): this
       page was drawn and contrast-measured at 1:1. See home.css. */
    <div className={`taskly-home ${fontClassName}`}>
      <header>
        <div className="wrap bar">
          <a className="mark" href="#top">
            <span className="glyph" aria-hidden="true">T</span>
            <span>Taskly<small>AI & Digital Division</small></span>
          </a>
          <nav className="links">
            <a href="#thread">How it works</a>
            <a href="#modules">What it holds</a>
            <a href="#ai">The assistant</a>
            <a href="#films">See it</a>
          </nav>
          <div className="right">
            {/* The application’s own control, not a copy of it: it writes the
                choice to the account, so a visitor who signs in keeps the theme
                they were reading in. A second toggle here would set a different
                key and the two would disagree the moment somebody logged in. */}
            <ThemeSwitch />
            <Link className="btn btn-primary" href="/login">Log in</Link>
          </div>
        </div>
      </header>

      <main id="top">

        {/* ══ HERO ══════════════════════════════════════════════════════════ */}
        <div className="hero">
          {/* The dashboard’s own control-room clip. `src` is set in script so only
               the cut for the current theme is ever fetched. */}
          <ThemeClip clip="room" className="hero-clip" />

          <div className="wrap">
            <h1>The whole agency, on <em>one thread</em>.</h1>
            <p className="standfirst">
              Taskly follows a piece of work from the moment a stranger fills in a form to the month it
              is invoiced — the lead, the person who calls them, the task, the post, the credential,
              the report. One system, one record, nothing left in somebody’s head.
            </p>
            <div className="cta">
              <Link className="btn btn-primary btn-lg" href="/login">Log in</Link>
              <a className="btn btn-ghost btn-lg" href="#films">Watch it work</a>
            </div>
            <p className="who">Built and run by the AI & Digital Division of Crescent Nova International.</p>

            <div className="frame">
              <div className="chrome"><i /><i /><i /><span>taskly.aidigitaldivision.com</span></div>
              {/* Swap for: <video className="stage" controls playsinline poster="/home/tour-poster.jpg"><source src="/home/tour.mp4" type="video/mp4"></video> */}
              <div className="stage stage-empty">
                <span className="play" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></span>
                <strong>A minute inside Taskly</strong>
                <span>Your walkthrough video goes here</span>
              </div>
            </div>
          </div>
        </div>

        {/* ══ THE THREAD ════════════════════════════════════════════════════ */}
        <section id="thread">
          <div className="wrap">
            <div className="section-head">
              <h2>One lead, followed all the way</h2>
              <p>
                Most tools give you a folder for tasks and a different one for clients, and the join
                between them lives in a spreadsheet. Taskly keeps the join. Here is the same enquiry,
                moving through the system.
              </p>
            </div>

            <div className="thread">

              <div className="stop">
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

              <div className="stop">
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

              <div className="stop">
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

              <div className="stop gold">
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

              <div className="stop">
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

              <div className="stop">
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
            <div className="section-head">
              <h2>And everything else an agency has to keep somewhere</h2>
              <p>
                The parts that usually end up in a shared drive, a WhatsApp group, or one person’s
                memory.
              </p>
            </div>

            <div className="grid">
              <div className="cell">
                <span className="tag">Team</span>
                <h3>People and departments</h3>
                <p>
                  Sales, delivery, development, finance, HR — each with a manager, each seeing what
                  belongs to them. Four permission levels, and a department that decides what somebody
                  can actually open.
                </p>
              </div>
              <div className="cell">
                <span className="tag">Vault</span>
                <h3>Credentials</h3>
                <p>
                  Client logins, API keys and tokens, encrypted and held per project. Who read what is
                  recorded. Nobody asks in a group chat for a password again.
                </p>
              </div>
              <div className="cell">
                <span className="tag">Documents</span>
                <h3>Files and contracts</h3>
                <p>
                  Briefs, contracts and deliverables against the project they belong to, with Google
                  Drive folders linked where the originals already live.
                </p>
              </div>
              <div className="cell">
                <span className="tag">Attendance</span>
                <h3>Who is in</h3>
                <p>
                  Check in from the app or the office terminal, with late arrivals, missing checkouts
                  and leave in one place — per office, so two sites never blur together.
                </p>
              </div>
              <div className="cell">
                <span className="tag">Finance</span>
                <h3>Invoices and money</h3>
                <p>
                  Invoices, payments received, expenses and payroll, per client and per office. A
                  statement of account for any client, on one screen.
                </p>
              </div>
              <div className="cell">
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
            <div className="section-head">
              <h2>The assistant knows your data, not the internet</h2>
              <p>
                Ask in plain language and it answers from your own tables, through the same permissions
                you have. It never sees a project you cannot open.
              </p>
            </div>

            <div className="ai-stage">
              {/* The assistant’s own clip, from inside the product. Lazy: it is
                   around 6 MB a cut, so it is not fetched until it scrolls into view. */}
              <ThemeClip clip="brain" className="brain-clip" lazy />
              <div className="caption">
                <p>
                  Every answer comes with the rows behind it. Nothing is estimated, and where the data
                  cannot answer a question yet, it says so instead of guessing.
                </p>
              </div>
            </div>

            <div className="ai-list">
              <div className="ai-item on">
                <h3>Ask about the work</h3>
                <p>
                  “What is overdue on Chitral Royal Homes?” “Who is over capacity this week?” “How many
                  posts went out for this client in August?” Answers with the rows behind them, not a
                  paragraph you have to take on trust.
                </p>
              </div>
              <div className="ai-item on">
                <h3>Written reports</h3>
                <p>
                  The monthly client report computes its own figures, then the model writes the prose
                  over the top. The arithmetic is yours; only the wording is drafted.
                </p>
              </div>
              <div className="ai-item on">
                <h3>Smart lead distribution</h3>
                <p>
                  Leads divide themselves across the team by who is genuinely free, so nobody sits on
                  forty enquiries while a colleague waits for one.
                </p>
              </div>
              <div className="ai-item">
                <h3>Coaching before a call</h3>
                <p>
                  A two-line summary of what a lead wants, talking points before you ring them, and a
                  drafted follow-up you edit before it sends — never sent for you.
                </p>
              </div>
              <div className="ai-item">
                <h3>Campaign or staff?</h3>
                <p>
                  Same campaign, different people, different results — it is the person. Same person
                  across campaigns — it is the campaign. Shown as arithmetic anybody can check.
                </p>
              </div>
              <div className="ai-item">
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
            <div className="section-head">
              <h2>See it working</h2>
              <p>Short walkthroughs of the parts people ask about most.</p>
            </div>

            <div className="films">
              <div className="film">
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

              <div className="film">
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
          <div className="wrap">
            <h2>Your team is already in here.</h2>
            <p>
              Sign in with the address your administrator set up. If you have not been given an account
              yet, ask them — accounts are created from inside Taskly, never self-served.
            </p>
            <div className="cta">
              <Link className="btn btn-primary btn-lg" href="/login">Log in to Taskly</Link>
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
          <Link href="/login">Log in</Link>
        </div>
      </footer>
    </div>
  );
}
