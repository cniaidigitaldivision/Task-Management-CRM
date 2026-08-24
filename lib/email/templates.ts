import 'server-only';

import { APP_NAME, DIVISION_NAME, ORGANISATION_NAME, SYSTEM_DEFAULTS } from '@/lib/domain/constants';
import { maskEmail } from '@/lib/domain/email-address';
import {
  MARK_BASE64,
  MARK_CID,
  MARK_FILENAME,
  MARK_HEIGHT,
  MARK_WIDTH,
} from './mark';

/* ============================================================================
 * EMAIL TEMPLATES
 * ----------------------------------------------------------------------------
 * ── REBUILT 2026-08-23, AND THE REASON IS WORTH KEEPING ──────────────────────
 * The owner saw the first invitation that actually reached an inbox and said:
 * *"How pathetic this whole template is… totally out of theme. Nothing is in my
 * theme, and the statics totally disappointed me."*
 *
 * Fair. The old version was a white card with a hairline and a teal button — it
 * carried none of the product's identity, the mark arrived broken, and it opened
 * by naming the sender rather than welcoming the recipient. Four things changed:
 *
 *   1. THE BUTTON SAYS WHAT THE MESSAGE IS. *"'Choose your password' is not
 *      appropriate… it should be like 'Accept Invitation'."* An invitation asks
 *      you to accept it; choosing a password is a step that happens after, and
 *      leading with it made an invitation read like a chore.
 *
 *   2. THE DIVISION WELCOMES YOU, NOT A COLLEAGUE'S NAME. *"Ummehabiba is not
 *      appropriate because Ummehabiba is the CTO."* The organisation is now the
 *      subject of the sentence and the inviter is attribution in the fine print.
 *      ⚠️ Deliberately NO job title anywhere: there is no title field on a user,
 *      so anything printed here would be a hardcoded fact about one person that
 *      goes stale the moment somebody is promoted.
 *
 *   3. THE MARK TRAVELS WITH THE MESSAGE — see ./mark.ts for the whole story.
 *
 *   4. THE PALETTE IS THE APPLICATION'S. Every hex below is copied from
 *      styles/tokens.css and named after the token it came from. The header is
 *      the navigation rail: same #071e22, same mark, same wordmark over the same
 *      division line. Somebody who uses the product recognises the email.
 *
 * ── ALWAYS THE LIGHT PALETTE, NEVER THE DARK ONE (FR-215) ────────────────────
 * The application has a dark theme. Email does not get one. Dark-mode handling
 * in mail clients ranges from good to actively destructive — Outlook inverts
 * some colours and not others, several clients ignore `prefers-color-scheme`
 * entirely, and a few rewrite backgrounds while leaving the text alone. The
 * result is unreadable in a way you cannot test for across every client.
 *
 * The dark header band is not an exception to that. It is painted explicitly on
 * a table cell with both a `bgcolor` attribute and a CSS background, which is
 * how a colour survives a client that strips one or the other.
 *
 * ── INLINE STYLES, TABLES, NO CSS VARIABLES ──────────────────────────────────
 * Everything the app does properly, email must do the 2005 way. Gmail strips
 * <style> blocks in some contexts, `var()` is unsupported in most clients, and
 * flexbox is unreliable. The hex values below are the only place in this
 * codebase where BR-025 (no raw hex outside tokens.css) is deliberately broken —
 * because a token cannot survive the journey into somebody's inbox.
 *
 * ── EVERY TEMPLATE RETURNS TEXT AS WELL ──────────────────────────────────────
 * Not politeness. A message with no plain-text alternative scores worse with
 * spam filters, and ADR-007's entire recovery design assumes these arrive.
 * ========================================================================= */

/* ── THE PALETTE, LIFTED FROM styles/tokens.css ────────────────────────────────
   Each constant names the token it copies so a brand change can be traced here.
   ⚠️ GOLD IS NOT A TEXT COLOUR ON WHITE. tokens.css carries the warning and the
   measurement: gold-500 on white is 2.1:1. Gold appears below as a rule, a
   border and a chip background; where gold text is wanted it is GOLD_TEXT
   (gold-800, 5.4:1), which is the only step that passes. */
const BAND = '#071e22'; /* --sidebar-bg — the navigation rail */
const BAND_HEADING = '#eef7f7'; /* --sidebar-heading */
const BAND_MUTED = '#7c9699'; /* --sidebar-muted */
const BRAND = '#0e5c63'; /* --teal-700, core brand teal */
const BRAND_DEEP = '#0a4046'; /* --teal-800, the button's lower edge */
const GOLD = '#d4a63c'; /* --gold-500, core brand gold */
const GOLD_TEXT = '#8c6417'; /* --gold-800 — the only gold safe on light */
const GOLD_TINT = '#fcf7ee'; /* --gold-50 */
const GOLD_EDGE = '#f2ddb4'; /* --gold-200 */
const INK = '#12222a'; /* --text-primary */
const MUTED = '#5b6f77'; /* --text-secondary */
const BORDER = '#dde7e8'; /* --neutral-200 */
const PAGE = '#f4f8f8'; /* --neutral-50 — teal-tinted, never a dead grey */
const PANEL = '#f4f8f8';

/** The system stack. Declared once; a webfont cannot be relied on in mail. */
const SANS = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

export interface EmailAttachment {
  readonly filename: string;
  readonly content: string;
  readonly contentId: string;
  readonly contentType: string;
}

export interface Email {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Carried inline by content id. Empty is valid; the mark is on every message. */
  readonly attachments: readonly EmailAttachment[];
}

/** The header mark, attached to every message so it never has to be fetched. */
const MARK_ATTACHMENT: EmailAttachment = {
  filename: MARK_FILENAME,
  content: MARK_BASE64,
  contentId: MARK_CID,
  contentType: 'image/png',
};

/**
 * The frame every message shares — the navigation rail, then a gold rule, then
 * the message on white.
 *
 * ⚠️ No `appUrl` parameter any more. It existed only to build an absolute URL
 * for the header image, and the image is now attached rather than fetched, so
 * there is nothing left for a caller to get wrong.
 */
function shell(body: string, preheader: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${APP_NAME}</title></head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-font-smoothing:antialiased;">
  <!-- The preview line in the inbox list. Hidden in the body, but it is the
       first thing anybody reads, so it says something useful rather than
       repeating the subject. The run of zero-width spaces after it stops Gmail
       pulling the opening sentence in behind it. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
  <div style="display:none;max-height:0;overflow:hidden;">&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};padding:36px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;">

        <!-- ── THE RAIL, AS A HEADER ──────────────────────────────────────────
             ⚠️ THE MARK IS AN img WITH A TEXT LOCKUP BESIDE IT, NOT INSTEAD OF
             IT. The image is attached rather than remote, so it is not blocked
             the way a tracking pixel is — but a client can still fail to render
             it, and the product name must never depend on a picture. The
             wordmark is real text; the mark is the flourish.
             ⚠️ NO BACKTICKS IN THIS COMMENT. It sits inside a JS template
             literal, so one would end the string and the file would stop
             parsing — which is exactly what happened when this was written.
             The alt attribute is empty because the name is already spelled out
             beside it; a screen reader announcing "Taskly logo Taskly" is
             noise. -->
        <tr><td bgcolor="${BAND}" style="background:${BAND};padding:20px 30px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="padding-right:11px;vertical-align:middle;">
              <img src="cid:${MARK_CID}" width="${MARK_WIDTH}" height="${MARK_HEIGHT}" alt=""
                   style="display:block;width:${MARK_WIDTH}px;height:${MARK_HEIGHT}px;border:0;outline:none;text-decoration:none;" />
            </td>
            <td style="vertical-align:middle;">
              <div style="font:600 18px/1.15 ${SANS};color:${BAND_HEADING};letter-spacing:-.015em;">${APP_NAME}</div>
              <div style="margin-top:3px;font:500 10px/1.3 ${SANS};color:${BAND_MUTED};letter-spacing:.09em;text-transform:uppercase;">${DIVISION_NAME}</div>
            </td>
          </tr></table>
        </td></tr>

        <!-- The gold rule. Full bleed and only 3px, so it reads as an edge on
             the band rather than as a block of colour. -->
        <tr><td bgcolor="${GOLD}" style="background:${GOLD};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>

        <tr><td style="padding:30px;font:400 15px/1.65 ${SANS};color:${INK};">
          ${body}
        </td></tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr><td style="padding:18px 8px 0 8px;font:400 12px/1.6 ${SANS};color:${MUTED};text-align:center;">
          ${ORGANISATION_NAME} &middot; ${DIVISION_NAME}<br />
          If you were not expecting this, you can ignore it — no action is taken
          unless you follow the link.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** The headline that opens a message. One per email, never two. */
function heading(text: string): string {
  return `<h1 style="margin:0 0 14px 0;font:600 22px/1.3 ${SANS};color:${INK};letter-spacing:-.02em;">${text}</h1>`;
}

/**
 * The primary action.
 *
 * `bgcolor` as well as CSS because Outlook honours the attribute and ignores
 * parts of the style; the border-bottom is a hairline of the darker teal, which
 * is what stops it reading as a flat rectangle.
 */
function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr><td bgcolor="${BRAND}" style="background:${BRAND};border-radius:10px;border-bottom:2px solid ${BRAND_DEEP};">
      <a href="${href}" style="display:inline-block;padding:13px 26px;font:600 15px/1 ${SANS};color:#ffffff;text-decoration:none;letter-spacing:.005em;">${label}</a>
    </td></tr>
  </table>`;
}

/**
 * A gold-tinted pill, the same shape the application puts a role in.
 *
 * Gold TEXT here is gold-800, not the brand gold — see the palette warning.
 */
function chip(label: string, value: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0 0;">
    <tr><td bgcolor="${GOLD_TINT}" style="background:${GOLD_TINT};border:1px solid ${GOLD_EDGE};border-radius:999px;padding:7px 15px;font:400 13px/1.3 ${SANS};color:${MUTED};">
      ${label} <strong style="color:${GOLD_TEXT};font-weight:600;">${value}</strong>
    </td></tr>
  </table>`;
}

/** A code, big enough to read off a phone and copy without mistyping. */
function codeBlock(code: string): string {
  return `<div style="margin:22px 0;padding:18px;background:${PANEL};border:1px solid ${BORDER};border-radius:12px;text-align:center;">
    <div style="font:500 10px/1 ${SANS};color:${MUTED};letter-spacing:.11em;text-transform:uppercase;margin-bottom:9px;">Your code</div>
    <span style="font:700 31px/1 ${MONO};letter-spacing:.2em;color:${INK};">${code}</span>
  </div>`;
}

/** The "paste this instead" line. Every message with a button carries one. */
function fallbackLink(url: string): string {
  return `<div style="margin:22px 0 0 0;padding-top:18px;border-top:1px solid ${BORDER};font:400 12px/1.6 ${SANS};color:${MUTED};word-break:break-all;">
    If the button does not work, paste this into your browser:<br /><span style="color:${BRAND};">${url}</span>
  </div>`;
}

/** Facts under a message: quiet, small, never competing with the action. */
function note(text: string): string {
  return `<p style="margin:0 0 12px 0;font:400 13px/1.6 ${SANS};color:${MUTED};">${text}</p>`;
}

/* ==========================================================================
 * Invitation — FR-142
 * ========================================================================== */

export function invitationEmail(input: {
  fullName: string;
  invitedByName: string;
  roleLabel: string;
  activationUrl: string;
}): Email {
  const firstName = input.fullName.split(' ')[0];

  return {
    /* ⚠️ The subject no longer opens with the inviter's name. It was
       "X has set up your account", which in an inbox reads as a notification
       about somebody else. This one is addressed to the reader. */
    subject: `Welcome to ${APP_NAME} — your account is ready`,
    html: shell(
      `${heading(`Welcome to the ${DIVISION_NAME}.`)}
       <p style="margin:0 0 14px 0;">Hello ${firstName},</p>
       <p style="margin:0 0 14px 0;">
         An account has been created for you on <strong>${APP_NAME}</strong> — where the
         ${DIVISION_NAME} plans its work, tracks who is doing what, and keeps an eye
         on who is at capacity.
       </p>
       ${chip('You join as', input.roleLabel)}
       ${button(input.activationUrl, 'Accept invitation')}
       ${note(
         `Accepting takes you to ${APP_NAME}, where you choose your own password. Nobody sent you
          one and nobody has one — only you will ever know it.`,
       )}
       ${note(
         `This invitation was set up by ${input.invitedByName}. The link works once and expires in
          ${SYSTEM_DEFAULTS.activationTokenTtlHours} hours.`,
       )}
       ${fallbackLink(input.activationUrl)}`,
      `Accept your invitation and set up your sign-in.`,
    ),
    text: [
      `Welcome to the ${DIVISION_NAME}.`,
      ``,
      `Hello ${firstName},`,
      ``,
      `An account has been created for you on ${APP_NAME}.`,
      `You join as ${input.roleLabel}.`,
      ``,
      `Accept your invitation:`,
      input.activationUrl,
      ``,
      `Accepting takes you to ${APP_NAME}, where you choose your own password.`,
      `Nobody sent you one and nobody has one.`,
      ``,
      `Set up by ${input.invitedByName}. The link works once and expires in ${SYSTEM_DEFAULTS.activationTokenTtlHours} hours.`,
    ].join('\n'),
    attachments: [MARK_ATTACHMENT],
  };
}

/* ==========================================================================
 * Password reset — FR-155
 * ========================================================================== */

export function passwordResetEmail(input: { fullName: string; code: string; resetUrl: string }): Email {
  const firstName = input.fullName.split(' ')[0];

  return {
    subject: `Your ${APP_NAME} password reset code`,
    html: shell(
      `${heading('Reset your password')}
       <p style="margin:0 0 4px 0;">Hello ${firstName}, somebody asked to reset the password on your account.</p>
       ${codeBlock(input.code)}
       ${button(input.resetUrl, 'Reset my password')}
       ${note(
         `The code expires in ${SYSTEM_DEFAULTS.recoveryCodeTtlMinutes} minutes and works once.
          Resetting signs you out everywhere, on every device.`,
       )}
       <p style="margin:0;font:400 13px/1.6 ${SANS};color:${MUTED};">
         <strong style="color:${INK};">If this was not you</strong>, ignore this message — your password
         has not changed. Tell your administrator if it keeps happening.
       </p>
       ${fallbackLink(input.resetUrl)}`,
      `Your reset code is ${input.code}. It expires in ${SYSTEM_DEFAULTS.recoveryCodeTtlMinutes} minutes.`,
    ),
    text: [
      `Hello ${firstName},`,
      ``,
      `Your ${APP_NAME} password reset code is: ${input.code}`,
      ``,
      input.resetUrl,
      ``,
      `It expires in ${SYSTEM_DEFAULTS.recoveryCodeTtlMinutes} minutes and works once.`,
      `Resetting signs you out on every device.`,
      ``,
      `If this was not you, ignore this message. Your password has not changed.`,
    ].join('\n'),
    attachments: [MARK_ATTACHMENT],
  };
}

/* ==========================================================================
 * Account unlock — FR-155a
 * ========================================================================== */

export function unlockEmail(input: {
  fullName: string;
  code: string;
  unlockUrl: string;
  /* Passed in, not imported. Both are editable settings (FR-057), and an email
     that states the wrong lock policy is worse than one that omits it — the
     recipient has no way to tell it is stale. */
  lockAfter: number;
  lockClearsAfterMinutes: number;
}): Email {
  const firstName = input.fullName.split(' ')[0];

  return {
    subject: `Your ${APP_NAME} account has been locked`,
    html: shell(
      `${heading('Your account is locked')}
       <p style="margin:0 0 4px 0;">
         Hello ${firstName}, your account locked itself after ${input.lockAfter} failed
         sign-in attempts. Use this code to unlock it — your password does not change:
       </p>
       ${codeBlock(input.code)}
       ${button(input.unlockUrl, 'Unlock my account')}
       ${note(`The lock also clears on its own after ${input.lockClearsAfterMinutes} minutes.`)}
       <p style="margin:0;font:400 13px/1.6 ${SANS};color:${MUTED};">
         <strong style="color:${INK};">If those attempts were not you</strong>, somebody is trying your
         password. Tell your administrator, and change it once you are back in.
       </p>
       ${fallbackLink(input.unlockUrl)}`,
      `Unlock code: ${input.code}.`,
    ),
    text: [
      `Hello ${firstName},`,
      ``,
      `Your ${APP_NAME} account locked after ${input.lockAfter} failed sign-in attempts.`,
      ``,
      `Unlock code: ${input.code}`,
      input.unlockUrl,
      ``,
      `Your password does not change. The lock also clears on its own after ${input.lockClearsAfterMinutes} minutes.`,
      ``,
      `If those attempts were not you, somebody is trying your password. Tell your administrator.`,
    ].join('\n'),
    attachments: [MARK_ATTACHMENT],
  };
}

/* ==========================================================================
 * Login alert — FR-151
 * ========================================================================== */

export function loginAlertEmail(input: {
  fullName: string;
  when: Date;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  appUrl: string;
}): Email {
  const firstName = input.fullName.split(' ')[0];

  /* A raw user-agent string is unreadable and the interesting part is small:
     which browser, on what. Anything unparseable is reported honestly as
     "an unrecognised browser" rather than guessed at. */
  const ua = input.userAgent ?? '';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : 'an unrecognised browser';
  const platform =
    /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'an unknown device';

  const stamp = input.when.toLocaleString('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Karachi',
  });
  const where = [input.country, input.ip].filter(Boolean).join(' · ') || 'an unknown location';

  return {
    subject: `New sign-in to your ${APP_NAME} account`,
    html: shell(
      `${heading('A new device signed in')}
       <p style="margin:0 0 16px 0;">Hello ${firstName}, your account was signed into from a device we have not seen before.</p>
       <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;width:100%;background:${PANEL};border:1px solid ${BORDER};border-radius:12px;">
         <tr><td style="padding:14px 16px;font:400 14px/1.75 ${SANS};color:${INK};">
           <strong>When</strong> &middot; ${stamp} (Karachi)<br />
           <strong>Where</strong> &middot; ${where}<br />
           <strong>What</strong> &middot; ${browser} on ${platform}
         </td></tr>
       </table>
       ${note(
         `<strong style="color:${INK};">If this was you</strong>, nothing to do — you will not be told
          again for this device.`,
       )}
       <p style="margin:0;font:400 13px/1.6 ${SANS};color:${MUTED};">
         <strong style="color:${INK};">If it was not</strong>, change your password now. That signs
         out every device immediately, including whoever this was.
       </p>
       ${button(`${input.appUrl}/forgot-password`, 'Change my password')}`,
      `Signed in from ${where}.`,
    ),
    text: [
      `Hello ${firstName},`,
      ``,
      `Your ${APP_NAME} account was signed into from a device we have not seen before.`,
      ``,
      `When:  ${stamp} (Karachi)`,
      `Where: ${where}`,
      `What:  ${browser} on ${platform}`,
      ``,
      `If this was you, nothing to do.`,
      `If it was not, change your password now — that signs out every device immediately.`,
      `${input.appUrl}/forgot-password`,
    ].join('\n'),
    attachments: [MARK_ATTACHMENT],
  };
}

/* ==========================================================================
 * The sign-in address was changed — sent to the OLD address
 * ==========================================================================
 * ── THIS IS THE ONLY CONTROL ON AN IMMEDIATE EMAIL CHANGE ────────────────────
 * The change applies at once (REDESIGN-PLAN §2), because confirming a link at
 * the new address needs a verified sending domain the owner has deliberately
 * deferred. What keeps that honest is this message: somebody who moves the
 * account cannot do it silently. Take this away and an attacker with a live
 * session and a password changes the sign-in identity with no trace the real
 * owner would ever see.
 *
 * ── IT DOES NOT OFFER A RESET LINK, AND THAT IS NOT AN OVERSIGHT ─────────────
 * Every other alert in this file ends with "change your password". That advice
 * is useless here and would be actively cruel: by the time this arrives, this
 * address is no longer attached to the account, so "forgot password" on it
 * reaches nothing. The only real remedy is a person, so the message names one.
 *
 * ── THE NEW ADDRESS IS MASKED ────────────────────────────────────────────────
 * Enough to recognise your own typo, not enough to hand an attacker's inbox to
 * whoever else reads this mailbox.
 */

export function emailChangedEmail(input: {
  fullName: string;
  newEmail: string;
  when: Date;
  isSuperAdmin: boolean;
  appUrl: string;
}): Email {
  const firstName = input.fullName.split(' ')[0];
  const masked = maskEmail(input.newEmail);

  const stamp = input.when.toLocaleString('en-GB', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Karachi',
  });

  /* Who to shout at. The Super Admin has nobody above them — saying "contact
     your Super Admin" to the Super Admin would be a dead end, and the real
     answer for that account is direct database access (doc 16 §6). */
  const remedy = input.isSuperAdmin
    ? 'Contact whoever administers this deployment straight away. Restoring the Super Admin address needs direct database access — it cannot be undone from inside the application.'
    : 'Contact your Super Admin straight away and ask them to change it back. You cannot do it yourself from here, because this address no longer signs in.';

  const remedyText = input.isSuperAdmin
    ? 'Contact whoever administers this deployment straight away. Restoring the Super Admin address needs direct database access.'
    : 'Contact your Super Admin straight away and ask them to change it back.';

  return {
    subject: `The sign-in address on your ${APP_NAME} account was changed`,
    html: shell(
      `${heading('Your sign-in address changed')}
       <p style="margin:0 0 14px 0;">
         Hello ${firstName}, the email address used to sign in to your account was changed. This
         message is going to the <strong>old</strong> address — the one you are reading now.
       </p>
       <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;width:100%;background:${PANEL};border:1px solid ${BORDER};border-radius:12px;">
         <tr><td style="padding:14px 16px;font:400 14px/1.75 ${SANS};color:${INK};">
           <strong>When</strong> &middot; ${stamp} (Karachi)<br />
           <strong>Changed to</strong> &middot; ${masked}
         </td></tr>
       </table>
       ${note(
         `<strong style="color:${INK};">If this was you</strong>, nothing to do. Sign in with the new
          address from now on — this one no longer works.`,
       )}
       ${note(
         `<strong style="color:${INK};">If it was not you</strong>, your account has been taken over.
          ${remedy}`,
       )}
       <p style="margin:0;font:400 13px/1.6 ${SANS};color:${MUTED};">
         The change is recorded in the security log with the time and the address it came from, so
         there is a trail either way.
       </p>`,
      `Your sign-in address was changed to ${masked}.`,
    ),
    text: [
      `Hello ${firstName},`,
      ``,
      `The email address used to sign in to your ${APP_NAME} account was changed.`,
      `This message is going to the OLD address — the one you are reading now.`,
      ``,
      `When:       ${stamp} (Karachi)`,
      `Changed to: ${masked}`,
      ``,
      `If this was you, nothing to do. Sign in with the new address from now on —`,
      `this one no longer works.`,
      ``,
      `If it was not you, your account has been taken over. ${remedyText}`,
      ``,
      `The change is recorded in the security log either way.`,
      ``,
      input.appUrl,
    ].join('\n'),
    attachments: [MARK_ATTACHMENT],
  };
}

/* ==========================================================================
 * Welcome, after activation
 * ========================================================================== */

export function welcomeEmail(input: { fullName: string; appUrl: string; roleLabel: string }): Email {
  const firstName = input.fullName.split(' ')[0];

  return {
    subject: `You are set up on ${APP_NAME}`,
    html: shell(
      `${heading(`You are in, ${firstName}.`)}
       <p style="margin:0 0 14px 0;">
         Your account is active and your password is set. Welcome to the ${DIVISION_NAME}.
       </p>
       ${chip('Signed in as', input.roleLabel)}
       <p style="margin:20px 0 8px 0;font:600 13px/1.4 ${SANS};color:${MUTED};letter-spacing:.07em;text-transform:uppercase;">Worth knowing</p>
       <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${PANEL};border:1px solid ${BORDER};border-radius:12px;">
         <tr><td style="padding:14px 16px;font:400 14px/1.7 ${SANS};color:${INK};">
           <strong>My Work</strong> is your queue and your capacity for the week.<br />
           Every task carries an estimate — that is what stops anyone being quietly overloaded.<br />
           If work is stuck, move it to <strong>Blocked</strong> and say why. That is how it gets unstuck.
         </td></tr>
       </table>
       ${button(input.appUrl, `Open ${APP_NAME}`)}`,
      `Your account is ready.`,
    ),
    text: [
      `Hello ${firstName},`,
      ``,
      `Your ${APP_NAME} account is active. You are set up as ${input.roleLabel}.`,
      ``,
      `My Work is your queue and your capacity for the week.`,
      `Every task carries an estimate — that is what stops anyone being quietly overloaded.`,
      `If work is stuck, move it to Blocked and say why.`,
      ``,
      input.appUrl,
    ].join('\n'),
    attachments: [MARK_ATTACHMENT],
  };
}
