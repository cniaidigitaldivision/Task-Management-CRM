import type { Metadata } from 'next';
import Link from 'next/link';

import { APP_NAME, ORGANISATION_NAME } from '@/lib/domain/constants';

import { CONTACT_EMAIL, DocTitle, Mail, Note, P, Rows, Section, UL } from '../_doc';

export const metadata: Metadata = {
  title: 'Deleting your data',
  description: `How to ask ${ORGANISATION_NAME} to delete your data from ${APP_NAME}, what is removed, and what is kept.`,
};

/* ============================================================================
 * DATA DELETION INSTRUCTIONS
 * ----------------------------------------------------------------------------
 * Meta App Review accepts either a callback endpoint or an instructions page.
 * This is the instructions page, and a reviewer will judge it on whether a real
 * person could actually follow it — so it leads with the exact steps and the
 * exact address, not with preamble.
 *
 * ⚠️ IT ALSO STATES WHAT SURVIVES DELETION, which is the part a template would
 * leave out. Two things genuinely cannot be erased on request: the audit log,
 * which is designed to be unalterable, and employment records the law requires
 * us to keep. Promising a clean wipe and then not delivering one is worse than
 * saying so here.
 * ========================================================================= */

export default function DataDeletionPage() {
  return (
    <article>
      <DocTitle
        title="Deleting your data"
        summary={`How to ask ${ORGANISATION_NAME} to delete your data from ${APP_NAME} — what we remove, what we cannot, and how long it takes.`}
      />

      <Section n={1} title="How to make the request">
        <P>
          There is no form to fill in. Send an email and we will act on it.
        </P>
        <Rows
          rows={[
            { term: 'Send to', detail: <Mail /> },
            { term: 'Subject line', detail: <code className="font-mono">Data deletion request</code> },
            {
              term: 'Include',
              detail:
                'Your full name, the email address on the account, and — if you are asking about a connected Facebook Page or Instagram account rather than your own login — which account it is.',
            },
            {
              term: 'We reply within',
              detail: '30 days, and usually far sooner. You will get written confirmation of what was deleted.',
            },
          ]}
        />
        <P>
          If you are an employee or contractor, an administrator can also start this for you —
          asking us directly is simply faster.
        </P>
      </Section>

      <Section n={2} title="If you connected a Facebook Page or Instagram account">
        <P>
          Where the division manages social media for a client, that client may have connected their
          Facebook Page or Instagram Business account so performance figures appear beside the work.
          There are two separate things you can do, and they have different effects.
        </P>
        <Rows
          rows={[
            {
              term: 'Disconnect it yourself',
              detail: (
                <>
                  In Meta&rsquo;s own settings — <strong className="font-semibold text-text-primary">Facebook → Settings → Business integrations</strong>, or{' '}
                  <strong className="font-semibold text-text-primary">Instagram → Settings → Apps and websites</strong> — remove {APP_NAME}. This stops all
                  further collection immediately and needs nothing from us. Figures already collected
                  stay until you ask us to delete them.
                </>
              ),
            },
            {
              term: 'Ask us to delete what was collected',
              detail: (
                <>
                  Email <Mail /> as in section 1. We erase the stored statistics for that account —
                  reach, views, engagement, follower history — and the encrypted access token.
                </>
              ),
            },
          ]}
        />
        <Note>
          As of 3 September 2026 this integration is{' '}
          <strong className="font-semibold text-text-primary">planned and not yet built</strong>, so
          there is currently no Meta data to delete. These instructions are published in advance of
          any connection being made, and apply from the moment one is.
        </Note>
      </Section>

      <Section n={3} title="What we delete">
        <P>On request, and within 30 days, we remove:</P>
        <UL>
          <>Your account, and with it your name, email address, phone number and profile photo.</>
          <>Your stored signature image, if you had one.</>
          <>Your sessions, sign-in history and two-factor enrolment.</>
          <>Your notifications, saved preferences and any conversations with the in-app assistant.</>
          <>
            Statistics collected from a connected Facebook Page or Instagram account, and its
            encrypted access token.
          </>
          <>Personal files you uploaded that belong to you rather than to the business.</>
        </UL>
      </Section>

      <Section n={4} title="What stays, and why">
        <P>
          Three things survive a deletion request. We would rather set that out plainly than promise
          a clean erasure and quietly not deliver one.
        </P>
        <Rows
          rows={[
            {
              term: 'Work products',
              detail:
                'Tasks, content, designs, reports and published posts created in the course of your work belong to the business or to the client they were made for, not to the person who typed them. They remain, and are re-attributed rather than deleted.',
            },
            {
              term: 'The audit log',
              detail:
                'Records of significant actions are deliberately unalterable — an audit log that can be edited on request is not an audit log. Entries survive, but identify the actor by an internal reference rather than by name.',
            },
            {
              term: 'Employment records',
              detail:
                'Attendance, pay and contract records are kept for as long as employment, tax and accounting law requires, and are deleted when that period ends.',
            },
          ]}
        />
        <P>
          Backups are the practical exception to any deletion: data may persist in encrypted backups
          for a short retention window and is removed as those backups age out. It is not restored
          into the live system.
        </P>
      </Section>

      <Section n={5} title="Deactivation is not deletion">
        <P>
          When someone leaves, their account is normally{' '}
          <strong className="font-semibold text-text-primary">deactivated</strong> rather than
          deleted. They can no longer sign in, but the record remains so that past work stays
          attributable and the history stays intelligible.
        </P>
        <P>
          Deactivation happens automatically when access ends. Deletion happens only when someone
          asks for it, using section 1.
        </P>
      </Section>

      <Section n={6} title="Related">
        <P>
          What we hold and why is set out in the{' '}
          <Link
            href="/privacy"
            className="font-medium text-text-brand underline-offset-4 hover:underline"
          >
            privacy policy
          </Link>
          . The terms of access are in the{' '}
          <Link
            href="/terms"
            className="font-medium text-text-brand underline-offset-4 hover:underline"
          >
            terms of service
          </Link>
          .
        </P>
        <P>
          Anything unclear about this page: <span className="font-mono">{CONTACT_EMAIL}</span>.
        </P>
      </Section>
    </article>
  );
}
