import type { Metadata } from 'next';
import Link from 'next/link';

import { APP_NAME, DIVISION_NAME, ORGANISATION_NAME } from '@/lib/domain/constants';

import { DocTitle, Mail, Note, P, Rows, Section, UL } from '../_doc';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: `How ${ORGANISATION_NAME} collects, uses and stores data in ${APP_NAME}.`,
};

/* ============================================================================
 * PRIVACY POLICY
 * ----------------------------------------------------------------------------
 * ⚠️ EVERY FACTUAL CLAIM HERE WAS CHECKED AGAINST THE SYSTEM, not written from a
 * template. Two in particular, because they are the ones that would be
 * embarrassing to have wrong:
 *
 *   · The biometric paragraph (§3). `attendance_scans.raw` was inspected — its
 *     keys are dateTime, eventType, ipAddress, macAddress, AccessControllerEvent
 *     and so on. There is no fingerprint or facial template anywhere in the
 *     payload; the terminal matches on-device and sends an employee number. The
 *     policy says exactly that and no more.
 *   · The personal fields listed in §2 are the real columns on `public.users`.
 *
 * If any of those two change, this page changes with them.
 * ========================================================================= */

export default function PrivacyPage() {
  return (
    <article>
      <DocTitle
        title="Privacy policy"
        summary={`How ${ORGANISATION_NAME} handles personal data in ${APP_NAME}, the internal work-management system used by its ${DIVISION_NAME}.`}
      />

      <Section n={1} title="Who this is about">
        <P>
          {APP_NAME} is an internal business system operated by {ORGANISATION_NAME} for its{' '}
          {DIVISION_NAME}. {ORGANISATION_NAME} is the controller of the personal data described
          below and decides why and how it is processed.
        </P>
        <P>
          It is not a consumer product. There is no public sign-up, no advertising, and no
          self-registration. Accounts exist only because an administrator created one — for an
          employee of the division, or for a client representative given access to their own
          project.
        </P>
        <P>
          Questions, requests and complaints about anything on this page go to <Mail />.
        </P>
      </Section>

      <Section n={2} title="What we hold, and why">
        <Rows
          rows={[
            {
              term: 'Account details',
              detail:
                'Name, work email address, phone number, profile photo, job title, and — where the person uses it to sign documents — a stored signature image. Needed to identify who is doing what.',
            },
            {
              term: 'Work records',
              detail:
                'Projects, tasks, statuses, comments, time logged, attachments, and links to published social media posts. This is the substance of the system.',
            },
            {
              term: 'Attendance',
              detail:
                'Arrival and departure times, and the corrections an administrator makes to them. See section 3 — the biometric terminal is not what you might assume.',
            },
            {
              term: 'Pay information',
              detail:
                'Salary and compensation records for employees, visible only to Admin and Super Admin roles.',
            },
            {
              term: 'Security records',
              detail:
                'Sign-in attempts, sessions, two-factor enrolment, and an audit log of significant actions. Kept to answer "who changed this, and when".',
            },
            {
              term: 'Stored credentials',
              detail:
                'Where the division manages a client account, its credentials may be held in the encrypted vault. Encrypted at rest and released only to people explicitly granted them.',
            },
          ]}
        />
        <P>
          We process this because it is necessary to run the business relationship — to manage work,
          pay people, meet obligations to clients, and keep the system secure. We do not sell
          personal data, and we do not use it for advertising or profiling.
        </P>
      </Section>

      <Section n={3} title="The attendance terminal, stated precisely">
        <P>
          Some offices record attendance through a biometric terminal that recognises a fingerprint
          or a face. It is worth being exact about what that means, because the obvious assumption
          is wrong.
        </P>
        <Note>
          <strong className="font-semibold text-text-primary">
            The matching happens on the terminal, and {APP_NAME} never receives a biometric
            template.
          </strong>{' '}
          What reaches this system is an employee number, a timestamp, the terminal&rsquo;s identity,
          and which verification method was used. No fingerprint image, no facial geometry, and no
          template capable of reconstructing either is transmitted to or stored by {APP_NAME}.
        </Note>
        <P>
          The biometric enrolment itself lives on the device and is governed by the device
          administrator, not by this system. A person who wants their enrolment removed from the
          terminal should ask an administrator directly; removing it there does not delete the
          attendance times already recorded here, which are ordinary employment records.
        </P>
      </Section>

      <Section n={4} title="Who else processes it">
        <P>
          We keep this list short on purpose, and each entry is a service that genuinely holds data
          rather than merely touches it.
        </P>
        <Rows
          rows={[
            {
              term: 'Supabase',
              detail: 'The database and file storage. All application data lives here, encrypted at rest.',
            },
            {
              term: 'Vercel',
              detail: 'Hosting. Serves the application and holds operational logs.',
            },
            {
              term: 'Resend',
              detail:
                'Transactional email only — invitations, password resets, notifications. No marketing.',
            },
            {
              term: 'Google Drive',
              detail:
                'Where the division has connected it, approved documents are copied to its own Google account.',
            },
            {
              term: 'Anthropic',
              detail:
                'Powers the in-app assistant. Where the assistant is used, the relevant question and the records needed to answer it are sent to be processed, and are not used to train models.',
            },
            {
              term: 'Buffer',
              detail:
                'Publishes to TikTok on our behalf, using an API key; no personal data beyond scheduled post content is shared.',
            },
            {
              term: 'Social platforms',
              detail:
                'Meta (Facebook and Instagram), LinkedIn, and Google (YouTube) receive scheduled post content directly via the division’s own registered apps. They process only the content an employee composed for that platform.',
            },
          ]}
        />
        <P>
          We do not transfer personal data to anyone else except where the law requires it, or where
          a client is entitled to records about their own project.
        </P>
      </Section>

      <Section n={5} title="Social media accounts">
        <P>
          The division operates an internal social media scheduling tool that connects to social accounts{' '}
          <strong className="font-semibold text-text-primary">owned by Crescent Nova International itself</strong>{' '}
          across Facebook, Instagram, LinkedIn, TikTok, and YouTube.
        </P>
        <P>Where these connections are active, the following applies:</P>
        <UL>
          <>
            For Facebook, Instagram, LinkedIn, and TikTok, the tool{' '}
            <strong className="font-semibold text-text-primary">publishes scheduled posts</strong>{' '}
            (text, images, video) that employees compose.
          </>
          <>
            We do <strong className="font-semibold text-text-primary">not</strong> read private
            messages, comments&rsquo; author details, or the personal profiles of the people who
            follow or interact with a page.
          </>
          <>
            Access tokens (where applicable) are encrypted at rest and used solely to publish scheduled content.
          </>
          <>
            Access can be revoked by the account owner at any time from that platform&rsquo;s own settings, which
            immediately stops any further publishing capability.
          </>
        </UL>
        <Note>
          As of {`12 September 2026`}, these integrations are live.
        </Note>
      </Section>

      <Section n="5a" title="YouTube specifically">
        <P>
          The tool uses the YouTube Data API to upload videos to YouTube channels owned or managed by{' '}
          Crescent Nova International&rsquo;s own team — no other user&rsquo;s or the public&rsquo;s YouTube data is accessed.
        </P>
        <P>
          Google&rsquo;s use of information from this integration is governed by the Google Privacy Policy:{' '}
          <Link
            href="https://policies.google.com/privacy"
            className="font-medium text-text-brand underline-offset-4 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            https://policies.google.com/privacy
          </Link>
        </P>
        <P>
          Any team member&rsquo;s Google account authorization can be revoked at any time from{' '}
          <Link
            href="https://myaccount.google.com/permissions"
            className="font-medium text-text-brand underline-offset-4 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            https://myaccount.google.com/permissions
          </Link>
          , which immediately stops this tool&rsquo;s ability to upload videos to that account&rsquo;s channel.
        </P>
        <P>
          Disconnecting an account from this tool removes the local record of that connection, but it does
          not retroactively delete videos already uploaded to YouTube itself (only YouTube Studio can do that).
        </P>
      </Section>

      <Section n={6} title="How long it is kept">
        <P>
          Work records — projects, tasks, published posts, reports — are kept for as long as they are
          useful to the business and to the client relationship they belong to.
        </P>
        <P>
          Security and audit records are kept deliberately longer, and are deliberately hard to
          alter. An audit log that can be edited is not an audit log. This means some entries
          recording that an action occurred survive the deletion of the account that performed it;
          they identify the actor by an internal reference rather than by name.
        </P>
        <P>
          Employment records, including attendance and pay, are kept for as long as employment law
          and tax obligations require.
        </P>
      </Section>

      <Section n={7} title="Security">
        <UL>
          <>Encrypted in transit and at rest.</>
          <>
            Two-factor authentication is mandatory for Admin and Super Admin accounts, and available
            to everyone else.
          </>
          <>
            Access is enforced in the database itself through row-level security, not only in the
            interface — so a person sees what their role permits regardless of how they ask for it.
          </>
          <>Stored credentials and integration tokens are encrypted with a separate key.</>
          <>Significant actions are written to an audit log.</>
        </UL>
      </Section>

      <Section n={8} title="Your rights">
        <P>
          You may ask what we hold about you, ask for it to be corrected, ask for a copy, or ask for
          it to be deleted. Write to <Mail /> and we will respond within 30 days.
        </P>
        <P>
          Deletion has limits worth understanding before you ask, and they are set out on the{' '}
          <Link
            href="/data-deletion"
            className="font-medium text-text-brand underline-offset-4 hover:underline"
          >
            deleting your data
          </Link>{' '}
          page.
        </P>
      </Section>

      <Section n={9} title="Changes">
        <P>
          If this policy changes materially, the date at the top changes with it and anyone with an
          account is told. We do not change it quietly.
        </P>
      </Section>
    </article>
  );
}
