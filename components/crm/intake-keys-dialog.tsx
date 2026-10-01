'use client';

import * as React from 'react';
import { Check, Copy, Globe, KeyRound, Plus, Trash2 } from 'lucide-react';

import {
  listIntakeKeysAction,
  mintIntakeKeyAction,
  revokeIntakeKeyAction,
} from '@/app/actions/crm-intake';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import type { CrmIntakeKey } from '@/lib/db/queries/crm-intake';
import { sourceLabel } from '@/lib/domain/lead-source';
import { cn } from '@/lib/utils';

/* ============================================================================
 * CONNECT A WEBSITE FORM
 * ----------------------------------------------------------------------------
 * Owner, 2026-09-30: *"Webform and inbound API: do it right now."*
 *
 * The endpoint is `app/api/crm/intake/route.ts`; this is where somebody gets a
 * key for it and the snippet to paste into a site.
 *
 * ── ⚠️ THE SNIPPET IS THE POINT, NOT THE KEY ──────────────────────────────
 * A key on its own is a string somebody then has to work out how to use, which
 * means a message to whoever maintains the website and a week of back and
 * forth. A ready `<form>` that already posts to the right place, with the right
 * field names and a honeypot, is a thing that can be pasted and finished today.
 *
 * ── ⚠️ AND THE KEY IS SHOWN ONCE, WHICH THE SCREEN SAYS PLAINLY ───────────
 * 277 stores only a hash, so it genuinely cannot be shown again. A panel that
 * implied otherwise would be a lie somebody discovers at the worst moment.
 * ========================================================================= */

export function IntakeKeysDialog({
  open,
  onClose,
  projects,
  initialProjectId,
  baseUrl,
}: {
  open: boolean;
  onClose: () => void;
  projects: readonly { id: string; name: string }[];
  initialProjectId: string | null;
  /** Where this app is served from, for the snippet. */
  baseUrl: string;
}) {
  const toast = useToast();
  const [projectId, setProjectId] = React.useState(initialProjectId ?? projects[0]?.id ?? '');
  const [keys, setKeys] = React.useState<readonly CrmIntakeKey[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [source, setSource] = React.useState('website');
  const [minted, setMinted] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);

  /* ⚠️ WHICH PROJECT THE LIST BELONGS TO, ADJUSTED DURING RENDER. The obvious
     shape — an effect that calls `setLoading(true)` and then fetches — is what
     `react-hooks/set-state-in-effect` refuses, and rightly: a synchronous
     setState in an effect body is a second render of a panel that has not
     painted its first. Remembering which project was last asked for is state,
     so it is updated during render, and the effect does nothing until after an
     await. Same shape as the lead desk's `wish`. */
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null);
  const [reloads, setReloads] = React.useState(0);
  if (open && projectId && loadedFor !== projectId) {
    setLoadedFor(projectId);
    setKeys([]);
    setLoading(true);
  }

  React.useEffect(() => {
    if (!open || !loadedFor) return;
    let live = true;
    /* The first statement is an await, so nothing is set synchronously. */
    void (async () => {
      const result = await listIntakeKeysAction(loadedFor);
      if (!live) return;
      setKeys(result.ok ? (result.keys ?? []) : []);
      setLoading(false);
    })();
    return () => { live = false; };
  }, [open, loadedFor, reloads]);

  /** Ask again after a mint or a withdrawal. */
  const reload = React.useCallback(() => setReloads((n) => n + 1), []);

  /* ⚠️ CLOSING IS AN EVENT, not an effect watching `open`. Six setState calls
     in an effect body is six cascading renders of a dialog already closing —
     `react-hooks/set-state-in-effect` refuses it, rightly. */
  const close = React.useCallback(() => {
    setMinted(null);
    setLabel('');
    setCopied(null);
    onClose();
  }, [onClose]);

  async function mint() {
    setBusy(true);
    const result = await mintIntakeKeyAction(projectId, label, source);
    setBusy(false);
    if (!result.ok) {
      toast({ tone: 'error', text: result.error ?? 'That key could not be issued.' });
      return;
    }
    setMinted(result.key ?? null);
    setLabel('');
    reload();
  }

  async function revoke(key: CrmIntakeKey) {
    /* ⚠️ THE ROW CHANGES IN THIS FRAME, NOT AFTER TWO ROUND TRIPS. Rule Zero's
       first law. It was written as "await the action, then refetch the list",
       and driving it showed the row still offering Withdraw five seconds after
       the database had already withdrawn it — so the only thing on screen said
       the key was live when it was not. The refetch still happens underneath
       and reconciles; this is what the reader sees meanwhile.

       ⚠️ AND IT IS PUT BACK IF THE WRITE FAILS. An optimistic update that
       cannot be undone is just a lie with better timing. */
    const before = keys;
    setKeys(keys.map((k) => (k.id === key.id ? { ...k, isEnabled: false } : k)));
    setBusy(true);
    const result = await revokeIntakeKeyAction(key.id);
    setBusy(false);
    if (!result.ok) {
      setKeys(before);
      toast({ tone: 'error', text: result.error ?? 'That key could not be withdrawn.' });
      return;
    }
    toast({ tone: 'ok', text: `“${key.label}” will not file any more leads.` });
    reload();
  }

  function copy(what: string, text: string) {
    void navigator.clipboard.writeText(text).then(
      () => { setCopied(what); toast({ tone: 'ok', text: 'Copied.' }); },
      () => toast({ tone: 'error', text: 'Your browser would not let us copy that.' }),
    );
  }

  const endpoint = `${baseUrl}/api/crm/intake`;
  const example = minted ?? 'YOUR_KEY';

  const formSnippet = `<form method="post" action="${endpoint}?k=${example}&redirect=https://your-site.example/thank-you">
  <input name="name" placeholder="Your name" required>
  <input name="mobile" placeholder="Phone number">
  <input name="mail" type="email" placeholder="Email">
  <input name="town" placeholder="City">
  <textarea name="message" placeholder="What are you looking for?"></textarea>

  <!-- Leave this empty. It is a trap for bots and is never shown to a person. -->
  <input name="website_url" tabindex="-1" autocomplete="off" style="display:none">

  <button type="submit">Send</button>
</form>`;

  const apiSnippet = `curl -X POST ${endpoint} \\
  -H "content-type: application/json" \\
  -H "x-api-key: ${example}" \\
  -d '{"fullName":"Ayesha Noor","phone":"0300 1234567","city":"Islamabad",
       "enquiry":"5 marla plot in Block A"}'`;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Connect a website form"
      size="lg"
      header={
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-primary/10">
            <Globe className="size-5 text-accent-primary" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-h3 font-semibold leading-tight text-text-primary">
              Connect a website form
            </span>
            <span className="block text-caption text-text-secondary">
              A form on your own site, or another system, filing leads straight into this desk
            </span>
          </span>
        </div>
      }
      footer={
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={close}
            className="inline-flex min-h-[2.4rem] items-center rounded-xl border border-border-default px-4 text-body-sm font-medium text-text-primary transition-colors hover:bg-bg-subtle"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="min-h-[24rem] space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent-primary/40 bg-[color-mix(in_oklab,var(--accent-primary)_6%,transparent)] px-3 py-2">
          <span className="text-body-sm font-medium text-text-brand">Leads arrive on</span>
          <select
            aria-label="Project"
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value); setMinted(null); }}
            className="min-h-[2.2rem] min-w-[14rem] flex-1 rounded-lg border border-border-subtle bg-bg-surface px-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
          >
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* ── ⚠️ THE KEY, ONCE ─────────────────────────────────────────── */}
        {minted && (
          <div className="rounded-xl border border-feedback-success bg-feedback-success/10 p-3">
            <p className="text-body-sm font-semibold text-text-primary">
              Here is the key. Copy it now.
            </p>
            <p className="mt-0.5 text-caption leading-relaxed text-text-secondary">
              Only a fingerprint of it is stored, so this is the one and only time it can be
              shown. Close this panel without copying and the key is gone — issue another one,
              there is no harm in it.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-bg-surface px-2 py-1.5 text-caption text-text-primary">
                {minted}
              </code>
              <CopyButton on={copied === 'key'} onClick={() => copy('key', minted)} />
            </div>
          </div>
        )}

        {/* ── Issue one ─────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border-default p-3">
          <p className="flex items-center gap-1.5 text-body-sm font-medium text-text-primary">
            <KeyRound className="size-4 text-text-secondary" aria-hidden="true" />
            Issue a key
          </p>
          <p className="mb-2 mt-0.5 text-micro leading-relaxed text-text-secondary">
            One per place that will send leads, so you can turn a single one off without
            breaking the rest.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="What is it for? e.g. Contact page"
              className="min-h-[2.2rem] min-w-[12rem] flex-1 rounded-lg border border-border-subtle bg-bg-surface px-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
            />
            <select
              aria-label="Files leads as"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="min-h-[2.2rem] rounded-lg border border-border-subtle bg-bg-surface px-2 text-body-sm text-text-primary focus:border-accent-primary focus:outline-none"
            >
              {['website', 'referral', 'manual', 'import'].map((s) => (
                <option key={s} value={s}>Files as {sourceLabel(s)}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !label.trim() || !projectId}
              onClick={() => void mint()}
              className={cn(
                'inline-flex min-h-[2.2rem] items-center gap-1.5 rounded-lg bg-accent-primary px-3 text-body-sm font-semibold text-white transition-opacity',
                (busy || !label.trim() || !projectId) ? 'cursor-not-allowed opacity-50' : 'hover:opacity-90',
              )}
            >
              <Plus className="size-4" aria-hidden="true" />
              Issue
            </button>
          </div>
        </div>

        {/* ── What to paste ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-border-default p-3">
          <p className="text-body-sm font-medium text-text-primary">Paste this into the website</p>
          <p className="mb-2 mt-0.5 text-micro leading-relaxed text-text-secondary">
            Plain HTML, no JavaScript needed. The field names here are the ones we recognise —
            and we also accept <code>name</code>, <code>mobile</code>, <code>mail</code> and{' '}
            <code>message</code>, so an existing form usually works unchanged.
          </p>
          <Snippet text={formSnippet} on={copied === 'form'} onCopy={() => copy('form', formSnippet)} />

          <p className="mt-3 text-body-sm font-medium text-text-primary">Or from another system</p>
          <Snippet text={apiSnippet} on={copied === 'api'} onCopy={() => copy('api', apiSnippet)} />
        </div>

        {/* ── The keys that exist ───────────────────────────────────────── */}
        <div>
          <p className="mb-1.5 text-body-sm font-medium text-text-primary">
            Keys on this project
          </p>
          {loading ? (
            <p className="text-caption text-text-secondary">Reading…</p>
          ) : keys.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-default px-3 py-4 text-center text-caption text-text-secondary">
              None yet. Issue one above and paste the form into the site.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {keys.map((k) => (
                <li
                  key={k.id}
                  className={cn(
                    'flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2',
                    k.isEnabled ? 'border-border-subtle' : 'border-border-subtle opacity-60',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium text-text-primary">
                      {k.label}
                      {!k.isEnabled && (
                        <span className="ml-1.5 text-caption font-normal text-text-tertiary">
                          · withdrawn
                        </span>
                      )}
                    </span>
                    <span className="block text-micro text-text-secondary">
                      <code>{k.prefix}…</code> · files as {sourceLabel(k.defaultSource)} ·{' '}
                      {/* ⚠️ BOTH NUMBERS, ALWAYS. "Accepted 40" alone hides a form
                          that has been refusing every submission since somebody
                          changed a field name. */}
                      {k.accepted} filed, {k.refused} refused
                      {k.lastRefusal && (
                        <span className="text-feedback-error"> · last call failed: {k.lastRefusal}</span>
                      )}
                      {/* ⚠️ AN ABSOLUTE DATE, NOT "3d ago". `Date.now()` during
                          render is an impure read — `react-hooks/purity` refuses
                          it — and the honest alternatives were to thread a
                          server clock through for one line, or to print the day.
                          The day is what somebody checking a key wants anyway. */}
                      {k.lastUsedAt && (
                        <> · last used {new Date(k.lastUsedAt).toLocaleDateString('en-GB', {
                          timeZone: 'Asia/Karachi', day: 'numeric', month: 'short',
                        })}</>
                      )}
                    </span>
                  </span>
                  {k.isEnabled && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void revoke(k)}
                      className="inline-flex items-center gap-1 rounded-lg border border-border-default px-2 py-1 text-caption font-medium text-text-secondary transition-colors hover:border-feedback-error hover:text-feedback-error"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Withdraw
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function CopyButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border-default px-2 py-1.5 text-caption font-medium text-text-primary transition-colors hover:bg-bg-subtle"
    >
      {on ? <Check className="size-3.5 text-feedback-success" aria-hidden="true" />
          : <Copy className="size-3.5" aria-hidden="true" />}
      {on ? 'Copied' : 'Copy'}
    </button>
  );
}

function Snippet({ text, on, onCopy }: { text: string; on: boolean; onCopy: () => void }) {
  return (
    <div className="relative mt-1.5">
      {/* ⚠️ `overflow-auto`, NOT WRAPPING. A pasted snippet that has been
          soft-wrapped is a snippet somebody pastes broken.

          ⚠️ AND `pr-20`, BECAUSE THE COPY BUTTON FLOATS OVER THIS. Without it
          the first line of the form tag runs underneath the button and the one
          line that carries the key is the one you cannot read. */}
      <pre className="max-h-[11rem] overflow-auto rounded-lg bg-bg-subtle p-2.5 pr-20 text-micro leading-relaxed text-text-primary">
        <code>{text}</code>
      </pre>
      <span className="absolute right-2 top-2">
        <CopyButton on={on} onClick={onCopy} />
      </span>
    </div>
  );
}
