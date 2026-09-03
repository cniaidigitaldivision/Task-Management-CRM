import type { Metadata } from 'next';
import Link from 'next/link';

import { APP_NAME, DIVISION_NAME, ORGANISATION_NAME } from '@/lib/domain/constants';

import { DocTitle, Mail, Note, P, Section, UL } from '../_doc';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: `The terms on which ${ORGANISATION_NAME} provides access to ${APP_NAME}.`,
};

export default function TermsPage() {
  return (
    <article>
      <DocTitle
        title="Terms of service"
        summary={`The terms on which ${ORGANISATION_NAME} provides access to ${APP_NAME}. They apply to everyone who signs in.`}
      />

      <Section n={1} title="What this is">
        <P>
          {APP_NAME} is an internal work-management system built and operated by{' '}
          {ORGANISATION_NAME} for its {DIVISION_NAME}. It manages projects, tasks, attendance,
          documents and reporting for the division and the clients it works for.
        </P>
        <P>
          It is not a product sold to the public and not available by subscription. Using it means
          accepting these terms.
        </P>
      </Section>

      <Section n={2} title="Who may use it">
        <P>
          Accounts are created by an administrator. There is no public sign-up and no way to create
          one yourself.
        </P>
        <UL>
          <>Employees and contractors of {ORGANISATION_NAME}, for their work.</>
          <>Client representatives, where access to their own project has been granted.</>
          <>Nobody else.</>
        </UL>
        <P>
          Your account is yours alone. Do not share your password, do not let somebody else act
          under your name, and tell an administrator promptly if you think either has happened.
        </P>
      </Section>

      <Section n={3} title="Acceptable use">
        <P>When signed in, you agree not to:</P>
        <UL>
          <>
            Take, copy or forward data belonging to the business or to a client for any purpose
            outside your work.
          </>
          <>
            Attempt to reach records your role does not grant you, or to work around the
            permissions that decide what you see.
          </>
          <>Upload anything unlawful, malicious, or that you have no right to share.</>
          <>Interfere with the system&rsquo;s operation, security or availability.</>
          <>
            Use credentials held in the vault for anything other than the client work they were
            issued for.
          </>
        </UL>
        <Note>
          Significant actions are recorded in an audit log that identifies who performed them. This
          is not surveillance of ordinary work — it is how a business answers &ldquo;who changed
          this, and when&rdquo; when something goes wrong.
        </Note>
      </Section>

      <Section n={4} title="Who owns what">
        <P>
          Work created in the course of employment or engagement — tasks, content, designs,
          documents, reports — belongs to {ORGANISATION_NAME} or to the client it was produced for,
          as the relevant contract sets out. Using this system does not change who owns anything.
        </P>
        <P>
          {APP_NAME} itself, including its design and source code, belongs to {ORGANISATION_NAME}.
        </P>
      </Section>

      <Section n={5} title="Connected accounts and third-party platforms">
        <P>
          The system may connect to third-party services on the division&rsquo;s or a client&rsquo;s
          behalf — Google Drive for documents, and Meta&rsquo;s platforms for the performance of
          Facebook and Instagram accounts we manage.
        </P>
        <UL>
          <>
            A connection is made only with the account owner&rsquo;s permission, and can be
            withdrawn by them at any time from that platform&rsquo;s own settings.
          </>
          <>
            When you connect an account, you confirm you are entitled to do so — that it is yours,
            or that its owner has authorised you.
          </>
          <>
            Use of those platforms through {APP_NAME} remains subject to each platform&rsquo;s own
            terms, and we comply with them.
          </>
          <>
            We do not control those services. If one changes what it offers or withdraws access, the
            related features may change or stop.
          </>
        </UL>
      </Section>

      <Section n={6} title="Availability">
        <P>
          We aim to keep the system running and will give notice of planned maintenance where we
          can. We do not guarantee uninterrupted availability: it depends on hosting, database and
          network providers we do not operate.
        </P>
        <P>Keep your own copies of anything you cannot afford to lose.</P>
      </Section>

      <Section n={7} title="Ending access">
        <P>
          Access ends when your employment or engagement ends, or where these terms have been
          seriously or repeatedly broken. An administrator can suspend an account immediately where
          there is a security concern.
        </P>
        <P>
          Deactivating an account does not delete the work done under it — that work belongs to the
          business or the client. What happens to personal data is on the{' '}
          <Link
            href="/data-deletion"
            className="font-medium text-text-brand underline-offset-4 hover:underline"
          >
            deleting your data
          </Link>{' '}
          page.
        </P>
      </Section>

      <Section n={8} title="Liability">
        <P>
          The system is provided for the business&rsquo;s own operations. To the extent the law
          allows, {ORGANISATION_NAME} is not liable for indirect or consequential loss arising from
          its use. Nothing here limits liability that cannot lawfully be limited.
        </P>
      </Section>

      <Section n={9} title="Changes and contact">
        <P>
          These terms may change as the system does. Material changes update the date at the top and
          are notified to account holders.
        </P>
        <P>
          Anything unclear here, or a dispute about it: <Mail />.
        </P>
      </Section>
    </article>
  );
}
