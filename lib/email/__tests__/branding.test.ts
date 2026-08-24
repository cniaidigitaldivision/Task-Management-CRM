import { describe, expect, it } from 'vitest';

import { APP_NAME, DIVISION_NAME } from '@/lib/domain/constants';
import { MARK_CID } from '../mark';
import {
  emailChangedEmail,
  invitationEmail,
  loginAlertEmail,
  passwordResetEmail,
  unlockEmail,
  welcomeEmail,
} from '../templates';

/* ============================================================================
 * WHAT THE TEAM ACTUALLY RECEIVES
 * ----------------------------------------------------------------------------
 * These messages are the first thing a new person ever sees of this system, and
 * they are the only part of it nobody on the team can look at before it is sent.
 * There is no staging inbox — a mistake here is discovered by the recipient.
 *
 * So the things that would be embarrassing or dangerous are asserted:
 *
 *   · the product is named, and named consistently (it was "CNI CRM" until
 *     2026-08-23, and a rename that reaches five files but not the email is the
 *     kind of miss nobody notices until a client is copied in);
 *   · the header image is carried WITH the message and its cid matches the
 *     attachment — see below, this is a real bug that shipped;
 *   · every message still carries a plain-text alternative, which spam filters
 *     score on and recovery depends on.
 * ========================================================================= */

const INVITE = {
  fullName: 'Najmulla Khan',
  invitedByName: 'Umm-e-Habiba',
  roleLabel: 'Team Member',
  activationUrl: 'https://taskly.aidigitaldivision.com/activate?token=abc123',
};

const RESET = {
  fullName: 'Kashif Ahmed',
  code: '481920',
  resetUrl: 'https://taskly.aidigitaldivision.com/reset-password?token=xyz789',
};

const WELCOME = {
  fullName: 'Lareeb Khan',
  appUrl: 'https://taskly.aidigitaldivision.com',
  roleLabel: 'Team Member',
};

/* All six, not the three that used to be here. The mark and the plain-text rule
   apply to every message, and the two security alerts are exactly the ones
   nobody looks at until the day they matter. */
const ALL = [
  ['invitation', invitationEmail(INVITE)],
  ['password reset', passwordResetEmail(RESET)],
  ['welcome', welcomeEmail(WELCOME)],
  [
    'unlock',
    unlockEmail({
      fullName: 'Yusra Khan',
      code: '224466',
      unlockUrl: 'https://taskly.aidigitaldivision.com/unlock?code=224466',
      lockAfter: 5,
      lockClearsAfterMinutes: 15,
    }),
  ],
  [
    'login alert',
    loginAlertEmail({
      fullName: 'Ammar Afzal Khan',
      when: new Date('2026-08-23T09:00:00Z'),
      ip: '203.0.113.4',
      country: 'Pakistan',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      appUrl: WELCOME.appUrl,
    }),
  ],
  [
    'email changed',
    emailChangedEmail({
      fullName: 'Kashif Ahmed',
      newEmail: 'someone@example.com',
      when: new Date('2026-08-23T09:00:00Z'),
      isSuperAdmin: false,
      appUrl: WELCOME.appUrl,
    }),
  ],
] as const;

describe('every message is branded as the product', () => {
  for (const [name, email] of ALL) {
    it(`${name} names ${APP_NAME} in the subject`, () => {
      expect(email.subject).toContain(APP_NAME);
    });

    it(`${name} carries the wordmark and the division in the body`, () => {
      expect(email.html).toContain(APP_NAME);
      expect(email.html).toContain(DIVISION_NAME);
    });

    it(`${name} no longer says "CNI CRM"`, () => {
      /* The old product name. Asserted as an absence because the rename touched
         five files and this one is the only one nobody sees before sending. */
      expect(email.html).not.toContain('CNI CRM');
      expect(email.subject).not.toContain('CNI CRM');
    });
  }
});

/* ============================================================================
 * THE HEADER MARK — THE REGRESSION THIS SECTION EXISTS FOR
 * ----------------------------------------------------------------------------
 * The logo used to be <img src="{appUrl}/brand/cni-ai-digital-division.png">,
 * an absolute URL built from whatever link the message carried. Sending from a
 * development machine made that http://localhost:4310 — a host inside that
 * laptop — so the owner's first real invitation arrived with a broken image
 * where the logo should be. The old test here asserted the src was absolute and
 * https, and passed, because "absolute" was never the property that mattered.
 *
 * The mark is now attached to the message and referenced by content id. What is
 * asserted is the pair: the html points at a cid, and an attachment answers to
 * it. Either one alone is a broken image.
 * ========================================================================= */
describe('the header mark travels with the message', () => {
  for (const [name, email] of ALL) {
    it(`${name} references the mark by content id`, () => {
      expect(email.html).toContain(`src="cid:${MARK_CID}"`);
    });

    it(`${name} attaches something answering to that content id`, () => {
      const attached = email.attachments.find((file) => file.contentId === MARK_CID);
      expect(attached, `an attachment with contentId ${MARK_CID}`).toBeTruthy();
      expect(attached!.contentType).toBe('image/png');
      /* Base64 of a real PNG. A truncated or empty payload is still a broken
         image, and it would sail past a mere "is defined" check. */
      expect(attached!.content.length).toBeGreaterThan(1000);
      expect(attached!.content.startsWith('iVBORw0KGgo')).toBe(true);
    });

    it(`${name} fetches no image over the network`, () => {
      /* The actual rule. A remote image is blocked by default in Outlook and
         every corporate client, and unreachable altogether when the origin is a
         developer's laptop — which is exactly how this broke. */
      expect(email.html).not.toMatch(/<img[^>]+src="https?:/i);
      expect(email.html).not.toContain('localhost');
    });
  }
});

describe('plain text is not optional', () => {
  for (const [name, email] of ALL) {
    it(`${name} has a text alternative naming the product`, () => {
      expect(email.text.length).toBeGreaterThan(40);
      expect(email.text).toContain(APP_NAME);
    });
  }
});

describe('the links the recipient is asked to follow', () => {
  it('puts the activation url in the invitation, in both parts', () => {
    const email = invitationEmail(INVITE);
    expect(email.html).toContain(INVITE.activationUrl);
    expect(email.text).toContain(INVITE.activationUrl);
  });

  it('puts the reset code in the body, so it can be read without clicking', () => {
    expect(passwordResetEmail(RESET).html).toContain(RESET.code);
    expect(passwordResetEmail(RESET).text).toContain(RESET.code);
  });
});

/* ============================================================================
 * HOW THE INVITATION READS
 * ----------------------------------------------------------------------------
 * Owner, 2026-08-23, on seeing the first one that arrived:
 *
 *   *"The 'Choose your password' button is not appropriate… it should be like
 *   'Accept Invitation'."*
 *
 *   *"Ummehabiba is not appropriate because Ummehabiba is the CTO… you can add
 *   something more like 'Welcome to AI Digital Division'."*
 *
 * Both are about who the message is addressed to. Naming the sender first makes
 * an invitation read as a notification about somebody else, and leading with a
 * password makes joining a company read as a chore. Asserted because copy is
 * the easiest thing in a codebase to undo by accident.
 * ========================================================================= */
describe('the invitation welcomes the recipient', () => {
  const email = invitationEmail(INVITE);

  it('asks them to accept an invitation, not to choose a password', () => {
    /* Cased as the reference design has it. */
    expect(email.html).toContain('Accept Invitation');
    expect(email.html).not.toContain('Choose your password');
  });

  it('opens by inviting the reader, in a headline of its own', () => {
    /* ⚠️ Was `Welcome to the ${DIVISION_NAME}`. The owner's reference design of
       2026-08-24 leads with "You're invited to join Taskly" instead — same
       intent, which is what this actually guards: the first line is addressed to
       the person reading it, not a statement about who sent it. `&rsquo;` because
       the headline goes through HTML. */
    expect(email.html).toContain(`You&rsquo;re invited to join ${APP_NAME}`);
    expect(email.html).toContain(DIVISION_NAME);
  });

  it('does not put the inviter in the subject line', () => {
    expect(email.subject).not.toContain(INVITE.invitedByName);
    /* The subject is about the reader's invitation, not about a sender. */
    expect(email.subject).toContain(`invited to join ${APP_NAME}`);
  });

  it('still credits the inviter, further down', () => {
    /* Attribution is right; a headline is not the place for it. */
    expect(email.html).toContain(INVITE.invitedByName);
  });

  it('names the role they are joining as', () => {
    expect(email.html).toContain(INVITE.roleLabel);
    expect(email.text).toContain(INVITE.roleLabel);
  });

  it('claims no job title for the inviter', () => {
    /* There is no title field on a user. Anything printed here would be a
       hardcoded fact about one person that goes stale on their next promotion. */
    for (const title of ['CTO', 'CEO', 'Chief', 'Director', 'Manager']) {
      expect(email.html).not.toContain(title);
    }
  });
});
