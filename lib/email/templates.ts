import 'server-only';

import { APP_NAME, DIVISION_NAME, ORGANISATION_NAME, SYSTEM_DEFAULTS } from '@/lib/domain/constants';

/* ============================================================================
 * EMAIL TEMPLATES
 * ----------------------------------------------------------------------------
 * ── ALWAYS THE LIGHT PALETTE, NEVER THE DARK ONE (FR-215) ────────────────────
 * The application has a dark theme. Email does not get one. Dark-mode handling
 * in mail clients ranges from good to actively destructive — Outlook inverts
 * some colours and not others, several clients ignore `prefers-color-scheme`
 * entirely, and a few rewrite backgrounds while leaving the text alone. The
 * result is unreadable in a way you cannot test for across every client.
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

const BRAND = '#0E5C63';
const GOLD = '#D4A63C';
const INK = '#12222a';
const MUTED = '#5b6f77';
const BORDER = '#dbe5e7';
const PAGE = '#f2f6f7';

export interface Email {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/** The frame every message shares. */
function shell(body: string, preheader: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PAGE};">
  <!-- The preview line in the inbox list. Hidden in the body, but it is the
       first thing anybody reads, so it says something useful rather than
       repeating the subject. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">
        <tr><td style="padding:22px 28px 0 28px;">
          <p style="margin:0;font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${BRAND};letter-spacing:.02em;">
            ${ORGANISATION_NAME}
          </p>
          <p style="margin:2px 0 0 0;font:400 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
            ${DIVISION_NAME}
          </p>
          <div style="height:2px;background:${GOLD};width:38px;margin-top:12px;border-radius:2px;"></div>
        </td></tr>
        <tr><td style="padding:20px 28px 28px 28px;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
          ${body}
        </td></tr>
      </table>
      <p style="max-width:520px;margin:14px auto 0;font:400 12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};text-align:center;">
        Sent by ${APP_NAME}. If you were not expecting this, you can ignore it —
        no action is taken unless you follow the link.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
    <tr><td style="background:${BRAND};border-radius:9px;">
      <a href="${href}" style="display:inline-block;padding:12px 22px;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;">${label}</a>
    </td></tr>
  </table>`;
}

/** A code, big enough to read off a phone and copy without mistyping. */
function codeBlock(code: string): string {
  return `<div style="margin:20px 0;padding:16px;background:${PAGE};border:1px solid ${BORDER};border-radius:10px;text-align:center;">
    <span style="font:700 30px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.22em;color:${INK};">${code}</span>
  </div>`;
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
    subject: `${input.invitedByName} has set up your ${APP_NAME} account`,
    html: shell(
      `<p style="margin:0 0 14px 0;">Hello ${firstName},</p>
       <p style="margin:0 0 14px 0;">
         <strong>${input.invitedByName}</strong> has created an account for you on
         ${APP_NAME} — where the ${DIVISION_NAME} plans its work, tracks who is
         doing what, and keeps an eye on who is at capacity.
       </p>
       <p style="margin:0 0 4px 0;">You have been set up as <strong>${input.roleLabel}</strong>.</p>
       ${button(input.activationUrl, 'Choose your password')}
       <p style="margin:0 0 14px 0;color:${MUTED};font-size:13px;">
         This link works once and expires in ${SYSTEM_DEFAULTS.activationTokenTtlHours} hours.
         Nobody sent you a password, and nobody has one — you choose your own, and
         only you will ever know it.
       </p>
       <p style="margin:14px 0 0 0;color:${MUTED};font-size:12px;word-break:break-all;">
         If the button does not work, paste this into your browser:<br>${input.activationUrl}
       </p>`,
      `Set your password and get into ${APP_NAME}.`,
    ),
    text: [
      `Hello ${firstName},`,
      ``,
      `${input.invitedByName} has created an account for you on ${APP_NAME}.`,
      `You have been set up as ${input.roleLabel}.`,
      ``,
      `Choose your password:`,
      input.activationUrl,
      ``,
      `The link works once and expires in ${SYSTEM_DEFAULTS.activationTokenTtlHours} hours.`,
      `Nobody sent you a password and nobody has one — you choose your own.`,
    ].join('\n'),
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
      `<p style="margin:0 0 14px 0;">Hello ${firstName},</p>
       <p style="margin:0 0 4px 0;">Somebody asked to reset the password on your account. Your code is:</p>
       ${codeBlock(input.code)}
       ${button(input.resetUrl, 'Reset your password')}
       <p style="margin:0 0 14px 0;color:${MUTED};font-size:13px;">
         The code expires in ${SYSTEM_DEFAULTS.recoveryCodeTtlMinutes} minutes and
         works once. Resetting signs you out everywhere, on every device.
       </p>
       <p style="margin:0;color:${MUTED};font-size:13px;">
         <strong>If this was not you</strong>, ignore this message — your password
         has not changed. Tell your administrator if it keeps happening.
       </p>`,
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
  };
}

/* ==========================================================================
 * Account unlock — FR-155a
 * ========================================================================== */

export function unlockEmail(input: { fullName: string; code: string; unlockUrl: string }): Email {
  const firstName = input.fullName.split(' ')[0];

  return {
    subject: `Your ${APP_NAME} account has been locked`,
    html: shell(
      `<p style="margin:0 0 14px 0;">Hello ${firstName},</p>
       <p style="margin:0 0 4px 0;">
         Your account locked itself after ${SYSTEM_DEFAULTS.failedLoginsToLock} failed
         sign-in attempts. Use this code to unlock it — your password does not change:
       </p>
       ${codeBlock(input.code)}
       ${button(input.unlockUrl, 'Unlock my account')}
       <p style="margin:0 0 14px 0;color:${MUTED};font-size:13px;">
         The lock also clears on its own after
         ${SYSTEM_DEFAULTS.accountLockAutoClearMinutes} minutes.
       </p>
       <p style="margin:0;color:${MUTED};font-size:13px;">
         <strong>If those attempts were not you</strong>, somebody is trying your
         password. Tell your administrator, and change it once you are back in.
       </p>`,
      `Unlock code: ${input.code}.`,
    ),
    text: [
      `Hello ${firstName},`,
      ``,
      `Your ${APP_NAME} account locked after ${SYSTEM_DEFAULTS.failedLoginsToLock} failed sign-in attempts.`,
      ``,
      `Unlock code: ${input.code}`,
      input.unlockUrl,
      ``,
      `Your password does not change. The lock also clears on its own after ${SYSTEM_DEFAULTS.accountLockAutoClearMinutes} minutes.`,
      ``,
      `If those attempts were not you, somebody is trying your password. Tell your administrator.`,
    ].join('\n'),
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
      `<p style="margin:0 0 14px 0;">Hello ${firstName},</p>
       <p style="margin:0 0 12px 0;">Your account was signed into from a device we have not seen before.</p>
       <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px 0;width:100%;background:${PAGE};border:1px solid ${BORDER};border-radius:10px;">
         <tr><td style="padding:12px 14px;font:400 14px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
           <strong>When</strong> · ${stamp} (Karachi)<br>
           <strong>Where</strong> · ${where}<br>
           <strong>What</strong> · ${browser} on ${platform}
         </td></tr>
       </table>
       <p style="margin:0 0 14px 0;color:${MUTED};font-size:13px;">
         <strong style="color:${INK};">If this was you</strong>, nothing to do — you will not be
         told again for this device.
       </p>
       <p style="margin:0;color:${MUTED};font-size:13px;">
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
      `<p style="margin:0 0 14px 0;">Hello ${firstName},</p>
       <p style="margin:0 0 14px 0;">
         Your account is active. You are signed in as <strong>${input.roleLabel}</strong>.
       </p>
       <p style="margin:0 0 6px 0;">Worth knowing:</p>
       <ul style="margin:0 0 14px 0;padding-left:20px;color:${INK};">
         <li style="margin-bottom:6px;"><strong>My Work</strong> is your queue and your capacity for the week.</li>
         <li style="margin-bottom:6px;">Every task carries an estimate — that is what stops anyone being quietly overloaded.</li>
         <li>If work is stuck, move it to <strong>Blocked</strong> and say why. That is how it gets unstuck.</li>
       </ul>
       ${button(input.appUrl, 'Open the CRM')}`,
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
  };
}
